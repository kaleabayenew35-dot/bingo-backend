const db = require('../config/database');

const validAmounts = new Set([10, 20, 30, 50, 100, 200]);
const validStages = new Set([1, 2, 3]);

function tableNameFor(stage, amount) {
  const s = Number(stage);
  const a = Number(amount);
  if (!validStages.has(s) || !validAmounts.has(a)) {
    throw new Error('Invalid stage or amount');
  }
  return `stage${s}_${a}`;
}

function getAll(stage, amount) {
  return new Promise((resolve, reject) => {
    let t;
    try {
      t = tableNameFor(stage, amount);
    } catch (e) {
      return reject(e);
    }
    const sql = `SELECT * FROM ${t} ORDER BY created_at DESC`;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function placeBet(stage, amount, payload) {
  return new Promise((resolve, reject) => {
    let t;
    try {
      t = tableNameFor(stage, amount);
    } catch (e) {
      return reject(e);
    }

    const { phone, username, balance, numbers } = payload;
    if (!phone || !numbers || !Array.isArray(numbers) || numbers.length === 0) {
      return reject(new Error('Missing required fields'));
    }

    const userId = phone; // phone is used as user_id

    db.serialize(() => {
      // ensure player record exists
      db.get('SELECT user_id FROM players WHERE phone = ?', [phone], (err, row) => {
        if (err) return reject(err);

        const ensurePlayer = (cb) => {
          if (row && row.user_id) return cb(null, row.user_id);
          db.run(
            'INSERT OR IGNORE INTO players (user_id, username, phone, balance) VALUES (?, ?, ?, ?)',
            [userId, username || userId, phone, balance || 0],
            function (pe) {
              if (pe) return cb(pe);
              db.get(
                'SELECT user_id FROM players WHERE phone = ? OR user_id = ? LIMIT 1',
                [phone, userId],
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

          // get latest game row for this stage/amount
          db.get(`SELECT * FROM ${t} ORDER BY id DESC LIMIT 1`, [], (err2, prow) => {
            if (err2) return reject(err2);

            // build new mark entry for this bet: "username|phone:num1|num2"
            const markEntry = `${username || uid}|${uid}:${numbers.join('|')}`;

            if (!prow) {
              // no game row yet — create first game + first row
              db.get(
                'SELECT MAX(CAST(game_id AS INTEGER)) AS maxId FROM games WHERE game_id GLOB "[0-9]*"',
                [],
                (maxErr, maxRow) => {
                  if (maxErr) return reject(maxErr);
                  const nextId = (maxRow && Number(maxRow.maxId) ? Number(maxRow.maxId) : 0) + 1;
                  const gameId = String(nextId);
                  db.run(
                    'INSERT OR IGNORE INTO games (game_id, stage, amount, players, status) VALUES (?, ?, ?, ?, ?)',
                    [gameId, Number(stage), Number(amount), 1, 'active'],
                    function (gErr) {
                      if (gErr) return reject(gErr);
                      db.run(
                        `INSERT INTO ${t} (game_id, total_players, mark, payout, owner, winner_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)`,
                        [gameId, 1, markEntry, 0, uid],
                        function (irErr) {
                          if (irErr) return reject(irErr);
                          db.get(`SELECT * FROM ${t} WHERE id = ?`, [this.lastID], (finalErr, finalRow) => {
                            if (finalErr) return reject(finalErr);
                            resolve({ table: t, gameId, row: finalRow });
                          });
                        }
                      );
                    }
                  );
                }
              );
            } else {
              // game row exists — append new mark entry for this player
              // (same player is allowed multiple entries — each bet is a separate entry)
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
                      db.get(`SELECT * FROM ${t} WHERE id = ?`, [prow.id], (finalErr, finalRow) => {
                        if (finalErr) return reject(finalErr);
                        resolve({ table: t, gameId: prow.game_id, row: finalRow });
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
async function cancelBet(stage, amount, phone, numbers) {
  return new Promise((resolve, reject) => {
    let t;
    try {
      t = tableNameFor(stage, amount);
    } catch (e) {
      return reject(e);
    }

    if (!phone) return reject(new Error('Missing phone'));

    const userId = phone;
    db.serialize(() => {
      db.get(`SELECT * FROM ${t} ORDER BY id DESC LIMIT 1`, [], (err, prow) => {
        if (err) return reject(err);
        if (!prow) return reject(new Error('No active game'));

        const parts = (prow.mark || '').split(',').map((p) => p.trim()).filter(Boolean);

        // Helper: extract the phone from an entry regardless of format
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

        let toRemove = [];
        let remaining = [];

        if (numbers && Array.isArray(numbers) && numbers.length > 0) {
          const sortedTarget = [...numbers].map(Number).sort((a, b) => a - b).join('|');
          // match entries that belong to this phone AND whose numbers match
          toRemove = parts.filter((p) => {
            if (entryPhone(p) !== phone) return false; // HARD GUARD: own entries only
            const sorted = entryNums(p).sort((a, b) => a - b).join('|');
            return sorted === sortedTarget;
          });
          remaining = parts.filter((p) => !toRemove.includes(p));
          if (toRemove.length === 0) return reject(new Error('Matching bet entry not found'));
        } else {
          // cancel ALL entries belonging to this phone only
          toRemove = parts.filter((p) => entryPhone(p) === phone);
          remaining = parts.filter((p) => entryPhone(p) !== phone);
          if (toRemove.length === 0) return reject(new Error('User has not placed a bet'));
        }

        const newMark = remaining.join(',');
        const newTotal = Math.max(0, (prow.total_players || toRemove.length) - toRemove.length);

        db.run(
          `UPDATE ${t} SET total_players = ?, mark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [newTotal, newMark, prow.id],
          function (upErr) {
            if (upErr) return reject(upErr);
            db.run(
              'DELETE FROM bets WHERE game_id = ? AND user_id = ?',
              [prow.game_id, userId],
              function (delErr) {
                if (delErr) console.warn('Failed to delete bet records:', delErr.message);
                db.run(
                  'UPDATE games SET players = MAX(players - ?, 0) WHERE game_id = ?',
                  [toRemove.length, prow.game_id],
                  function (gErr) {
                    if (gErr) console.warn('Failed to decrement games.players:', gErr.message);
                    db.get(`SELECT * FROM ${t} WHERE id = ?`, [prow.id], (finalErr, finalRow) => {
                      if (finalErr) return reject(finalErr);
                      resolve({ table: t, gameId: prow.game_id, row: finalRow, removedCount: toRemove.length });
                    });
                  }
                );
              }
            );
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
};
