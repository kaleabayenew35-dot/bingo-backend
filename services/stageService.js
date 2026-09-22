const db = require('../config/database');
const { normalizeAmount, tableNameForAmount, prefixForAmount, canonicalGameId } = require('../config/amounts');

function tableNameFor(amount) {
  return tableNameForAmount(amount);
}

// ── Normalize a phone to a canonical digits-only form ──────────────────────
// Ensures consistent comparison regardless of whether the phone was stored
// with a leading 0, +251 prefix, or bare 9-digit form.
function normalizePhone(phone) {
  const clean = String(phone || '').replace(/\D/g, '');
  if (!clean) return '';
  if (clean.length === 9) return `251${clean}`;
  if (clean.startsWith('251') && clean.length >= 12) return clean;
  if (clean.startsWith('0') && clean.length >= 10) return `251${clean.slice(1)}`;
  return clean;
}

/** Insert one row into bets table per number */
function insertBetRows(userId, gameId, numbers, amount, callback) {
  if (!numbers || numbers.length === 0) return callback(null);
  let done = 0;
  let firstErr = null;
  numbers.forEach((num) => {
    db.run(
      'INSERT INTO bets (game_id, user_id, number, amount) VALUES (?, ?, ?, ?)',
      [gameId, userId, num, amount],
      (err) => {
        if (err && !firstErr) firstErr = err;
        done += 1;
        if (done === numbers.length) callback(firstErr);
      }
    );
  });
}

/** Update the player's local balance after a successful bet deduction */
function updatePlayerBalance(userId, newBalance, callback) {
  if (newBalance == null) return callback(null);
  db.run(
    'UPDATE players SET balance = ? WHERE user_id = ?',
    [newBalance, userId],
    callback
  );
}

/** Update the player's local balance by phone number */
function updatePlayerBalanceByPhone(phone, newBalance, callback) {
  if (newBalance == null) return callback(null);
  db.run(
    'UPDATE players SET balance = ? WHERE phone = ? OR user_id = ?',
    [newBalance, phone, phone],
    callback
  );
}

function getAll(amount) {
  return new Promise((resolve, reject) => {
    let t;
    try {
      t = tableNameFor(amount);
    } catch (e) {
      return reject(e);
    }
    const sql = `SELECT * FROM ${t} ORDER BY created_at DESC`;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map((row) => ({
        ...row,
        game_id: canonicalGameId(row.game_id, amount),
      })));
    });
  });
}

function placeBet(amount, payload) {
  return new Promise((resolve, reject) => {
    let t;
    try {
      t = tableNameFor(amount);
    } catch (e) {
      return reject(e);
    }

    const { phone, username, balance, numbers } = payload;
    const normalizedAmount = normalizeAmount(amount);
    if (!phone || !numbers || !Array.isArray(numbers) || numbers.length === 0) {
      return reject(new Error('Missing required fields'));
    }

    const canonicalPhone = normalizePhone(phone) || phone;
    const userId = canonicalPhone; // phone is used as user_id, but canonicalized to avoid collisions

    db.serialize(() => {
      // ensure player record exists
      db.get(
        'SELECT user_id FROM players WHERE phone = ? OR phone = ? OR user_id = ? OR user_id = ? LIMIT 1',
        [canonicalPhone, phone, canonicalPhone, phone],
        (err, row) => {
          if (err) return reject(err);

          const ensurePlayer = (cb) => {
            if (row && row.user_id) return cb(null, row.user_id);
            db.run(
              'INSERT OR IGNORE INTO players (user_id, username, phone, balance) VALUES (?, ?, ?, ?)',
              [userId, username || userId, canonicalPhone, balance || 0],
              function (pe) {
                if (pe) return cb(pe);
                db.get(
                  'SELECT user_id FROM players WHERE phone = ? OR phone = ? OR user_id = ? OR user_id = ? LIMIT 1',
                  [canonicalPhone, phone, canonicalPhone, phone],
                  (se, srow) => {
                    if (se) return cb(se);
                    return cb(null, srow ? srow.user_id : userId);
                  }
                );
              }
            );
          };

        ensurePlayer((pe, uid) => {
          if (pe) return reject(pe);

          // get latest game row for this amount
          db.get(`SELECT * FROM ${t} ORDER BY id DESC LIMIT 1`, [], (err2, prow) => {
            if (err2) return reject(err2);

            // ── Uniqueness check: no number may be taken by any player ────────
            if (prow && prow.mark) {
              const takenNumbers = [];
              prow.mark.split(',').forEach((entry) => {
                const colonIdx = entry.indexOf(':');
                if (colonIdx === -1) return;
                entry.slice(colonIdx + 1).split('|').map(Number).filter(Boolean).forEach((n) => {
                  if (!takenNumbers.includes(n)) takenNumbers.push(n);
                });
              });
              const conflict = numbers.filter((n) => takenNumbers.includes(n));
              if (conflict.length > 0) {
                return reject(Object.assign(
                  new Error(`Number${conflict.length > 1 ? 's' : ''} ${conflict.join(', ')} already taken`),
                  { code: 'NUMBER_TAKEN', conflict }
                ));
              }
            }

            // build new mark entry for this bet: "username|phone:num1|num2"
            const markEntry = `${username || uid}|${uid}:${numbers.join('|')}`;

            if (!prow) {
              // no game row yet — create first game + first row
              // PostgreSQL-compatible: use LIKE prefix match and CAST(SUBSTRING(col, pos) AS INTEGER)
              const prefix = prefixForAmount(normalizedAmount);
              db.get(
                `SELECT MAX(CAST(SUBSTRING(game_id, 2) AS INTEGER)) AS "maxId"
                 FROM games WHERE game_id LIKE '${prefix}%'`,
                [],
                (maxErr, maxRow) => {
                  if (maxErr) return reject(maxErr);
                  const nextId = (maxRow && Number(maxRow.maxId) ? Number(maxRow.maxId) : 0) + 1;
                  const gameId = `${prefix}${nextId}`;
                  db.run(
                    'INSERT OR IGNORE INTO games (game_id, amount, players, status) VALUES (?, ?, ?, ?)',
                    [gameId, normalizedAmount, 1, 'active'],
                    function (gErr) {
                      if (gErr) return reject(gErr);
                      db.run(
                        `INSERT INTO ${t} (game_id, total_players, mark, payout, owner, winner_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)`,
                        [gameId, 1, markEntry, 0, uid],
                        function (irErr) {
                          if (irErr) return reject(irErr);
                          const rowId = this.lastID;
                          // Insert one bets row per number
                          insertBetRows(uid, gameId, numbers, normalizedAmount, (bErr) => {
                            if (bErr) console.warn('bets insert warning:', bErr.message);
                            // Update player balance
                            updatePlayerBalance(uid, balance, (balErr) => {
                              if (balErr) console.warn('balance update warning:', balErr.message);
                              db.get(`SELECT * FROM ${t} WHERE id = ?`, [rowId], (finalErr, finalRow) => {
                                if (finalErr) return reject(finalErr);
                                resolve({ table: t, gameId, row: finalRow });
                              });
                            });
                          });
                        }
                      );
                    }
                  );
                }
              );
            } else {
              // game row exists — append new mark entry for this player
              const newTotal = (prow.total_players || 0) + 1;
              const newMark = prow.mark && prow.mark.length
                ? `${prow.mark},${markEntry}`
                : markEntry;

              db.run(
                `UPDATE ${t} SET total_players = ?, mark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [newTotal, newMark, prow.id],
                function (upErr) {
                  if (upErr) return reject(upErr);
                  db.run(
                    'UPDATE games SET players = players + 1 WHERE game_id = ?',
                    [prow.game_id],
                    function (gupErr) {
                      if (gupErr) console.warn('Failed to update games.players:', gupErr.message);
                      // Insert one bets row per number
                      insertBetRows(uid, prow.game_id, numbers, normalizedAmount, (bErr) => {
                        if (bErr) console.warn('bets insert warning:', bErr.message);
                        // Update player balance in local DB
                        updatePlayerBalance(uid, balance, (balErr) => {
                          if (balErr) console.warn('balance update warning:', balErr.message);
                          db.get(`SELECT * FROM ${t} WHERE id = ?`, [prow.id], (finalErr, finalRow) => {
                            if (finalErr) return reject(finalErr);
                            resolve({ table: t, gameId: prow.game_id, row: finalRow });
                          });
                        });
                      });
                    }
                  );
                }
              );
            }
          });
        });
      });
    });
  });
}

// cancelBet removes a specific bet entry (matched by numbers) for this player,
// or all entries if no numbers are provided.
async function cancelBet(amount, phone, numbers) {
  return new Promise((resolve, reject) => {
    let t;
    try {
      t = tableNameFor(amount);
    } catch (e) {
      return reject(e);
    }

    if (!phone) return reject(new Error('Missing phone'));

    const userId = phone;
    const normalizedCallerPhone = normalizePhone(phone);

    db.serialize(() => {
      db.get(`SELECT * FROM ${t} ORDER BY id DESC LIMIT 1`, [], (err, prow) => {
        if (err) return reject(err);
        if (!prow) return reject(new Error('No active game'));

        const parts = (prow.mark || '').split(',').map((p) => p.trim()).filter(Boolean);

        // Helper: extract the phone from an entry regardless of format.
        // new format: "username|phone:nums"  → phone is between "|" and ":"
        // old format: "phone:nums"           → phone is before ":"
        function entryPhone(entry) {
          const colonIdx = entry.indexOf(':');
          if (colonIdx === -1) return '';
          const beforeColon = entry.slice(0, colonIdx);
          const pipeIdx = beforeColon.indexOf('|');
          return pipeIdx !== -1 ? beforeColon.slice(pipeIdx + 1) : beforeColon;
        }

        // Helper: extract the numbers array from an entry
        function entryNums(entry) {
          const colonIdx = entry.indexOf(':');
          if (colonIdx === -1) return [];
          return entry.slice(colonIdx + 1).split('|').map(Number).filter(Boolean);
        }

        // Use normalized phone comparison to handle different phone formats
        function isOwnEntry(entry) {
          return normalizePhone(entryPhone(entry)) === normalizedCallerPhone;
        }

        let toRemove = [];
        let remaining = [];
        let numbersToDelete = null; // null means delete all for user

        if (numbers && Array.isArray(numbers) && numbers.length > 0) {
          const sortedTarget = [...numbers].map(Number).sort((a, b) => a - b).join('|');
          // match entries that belong to this phone AND whose numbers match
          toRemove = parts.filter((p) => {
            if (!isOwnEntry(p)) return false; // HARD GUARD: own entries only
            const sorted = entryNums(p).sort((a, b) => a - b).join('|');
            return sorted === sortedTarget;
          });
          remaining = parts.filter((p) => !toRemove.includes(p));
          if (toRemove.length === 0) return reject(new Error('Matching bet entry not found'));
          // Only delete these specific numbers from the bets table
          numbersToDelete = numbers.map(Number);
        } else {
          // cancel ALL entries belonging to this phone only
          toRemove = parts.filter((p) => isOwnEntry(p));
          remaining = parts.filter((p) => !isOwnEntry(p));
          if (toRemove.length === 0) return reject(new Error('User has not placed a bet'));
          // Delete ALL bets for this user in this game
          numbersToDelete = null;
        }

        const newMark = remaining.join(',');
        const newTotal = Math.max(0, (prow.total_players || toRemove.length) - toRemove.length);

        db.run(
          `UPDATE ${t} SET total_players = ?, mark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [newTotal, newMark, prow.id],
          function (upErr) {
            if (upErr) return reject(upErr);

            // Delete only the specific bet numbers (partial cancel) or all (full cancel)
            const deleteQuery = numbersToDelete
              ? `DELETE FROM bets WHERE game_id = ? AND user_id = ? AND number = ANY(?)`
              : `DELETE FROM bets WHERE game_id = ? AND user_id = ?`;
            const deleteParams = numbersToDelete
              ? [prow.game_id, userId, numbersToDelete]
              : [prow.game_id, userId];

            db.run(deleteQuery, deleteParams, function (delErr) {
              if (delErr) console.warn('Failed to delete bet records:', delErr.message);
              db.run(
                'UPDATE games SET players = GREATEST(players - ?, 0) WHERE game_id = ?',
                [toRemove.length, prow.game_id],
                function (gErr) {
                  if (gErr) console.warn('Failed to decrement games.players:', gErr.message);
                  db.get(`SELECT * FROM ${t} WHERE id = ?`, [prow.id], (finalErr, finalRow) => {
                    if (finalErr) return reject(finalErr);
                    resolve({ table: t, gameId: prow.game_id, row: finalRow, removedCount: toRemove.length });
                  });
                }
              );
            });
          }
        );
      });
    });
  });
}

module.exports = {
  getAll,
  placeBet,
  cancelBet,
  tableNameFor,
  updatePlayerBalanceByPhone,
};
