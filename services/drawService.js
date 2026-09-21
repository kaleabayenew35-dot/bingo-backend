const db = require('../config/database');

const amountPrefixes = { 10: 'A', 20: 'B', 30: 'C', 50: 'D', 100: 'E', 200: 'F' };

function createNextRound(gameId, callback) {
  db.get('SELECT amount FROM games WHERE game_id = ?', [gameId], (gameError, game) => {
    if (gameError) return callback(gameError);
    const amount = Number(game?.amount);
    const prefix = amountPrefixes[amount];
    if (!prefix) return callback(new Error('Cannot create next round for invalid amount'));

    const table = `amount_${amount}`;
    db.get(
      `SELECT MAX(CAST(SUBSTRING(game_id FROM 2) AS INTEGER)) AS "maxId"
       FROM games WHERE game_id ~ '^${prefix}[0-9]+$'`,
      [],
      (maxError, maxRow) => {
        if (maxError) return callback(maxError);
        const nextId = (maxRow && Number(maxRow.maxId) ? Number(maxRow.maxId) : 0) + 1;
        const nextGameId = `${prefix}${nextId}`;
        db.run(
          'INSERT INTO games (game_id, amount, players, status) VALUES (?, ?, 0, ?)',
          [nextGameId, amount, 'waiting'],
          (insertGameError) => {
            if (insertGameError) return callback(insertGameError);
            db.run(
              `INSERT INTO ${table} (game_id, total_players, mark, payout, owner, winner_id)
               VALUES (?, 0, NULL, 0, NULL, NULL)`,
              [nextGameId],
              (insertRoundError) => callback(insertRoundError, nextGameId)
            );
          }
        );
      }
    );
  });
}

// Fisher-Yates shuffle of numbers 1-75
function generateSequence() {
  const arr = Array.from({ length: 75 }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generate a fresh 75-number draw for a game, reset draw_index to 0.
 */
function generateDraw(gameId, callback) {
  if (!gameId) return callback(new Error('Missing gameId'));

  const sequence = generateSequence();
  const seqJson  = JSON.stringify(sequence);

  db.serialize(() => {
    // Migration-safe: add columns if they don't exist yet
    db.run(`ALTER TABLE games ADD COLUMN IF NOT EXISTS draw_sequence TEXT`,           () => {});
    db.run(`ALTER TABLE games ADD COLUMN IF NOT EXISTS draw_index INTEGER DEFAULT 0`, () => {});

    db.run(
      `UPDATE games SET draw_sequence = ?, draw_index = 0 WHERE game_id = ?`,
      [seqJson, gameId],
      function (err) {
        if (err) return callback(err);
        if (this.changes === 0) {
          db.run(
            `INSERT OR IGNORE INTO games (game_id, draw_sequence, draw_index) VALUES (?, ?, 0)`,
            [gameId, seqJson],
            (ie) => callback(ie, sequence)
          );
        } else {
          callback(null, sequence);
        }
      }
    );
  });
}

/**
 * Get the full draw sequence for a game.
 */
function getDraw(gameId, callback) {
  if (!gameId) return callback(new Error('Missing gameId'));
  db.get(
    `SELECT draw_sequence, draw_index FROM games WHERE game_id = ?`,
    [gameId],
    (err, row) => {
      if (err) return callback(err);
      if (!row || !row.draw_sequence) return callback(null, { sequence: [], drawIndex: 0 });
      try {
        const sequence = JSON.parse(row.draw_sequence);
        callback(null, { sequence, drawIndex: row.draw_index || 0 });
      } catch (e) {
        callback(e);
      }
    }
  );
}

/**
 * Get the current call number and advance draw_index by 1.
 * Returns { number, drawIndex, total, done }
 *   number    — the called number (null if done)
 *   drawIndex — index AFTER advance (1-based count of numbers called so far)
 *   total     — always 75
 *   done      — true when all numbers have been called
 */
function nextCall(gameId, callback) {
  if (!gameId) return callback(new Error('Missing gameId'));
  db.serialize(() => {
    db.get(
      `SELECT draw_sequence, draw_index FROM games WHERE game_id = ?`,
      [gameId],
      (err, row) => {
        if (err) return callback(err);
        if (!row || !row.draw_sequence) return callback(new Error('Draw not found'));

        let sequence;
        try { sequence = JSON.parse(row.draw_sequence); }
        catch (e) { return callback(e); }

        const currentIndex = row.draw_index || 0;
        const total        = sequence.length;

        if (currentIndex >= total) {
          // already done
          return callback(null, { number: null, drawIndex: currentIndex, total, done: true });
        }

        const calledNumber = sequence[currentIndex];
        const newIndex     = currentIndex + 1;

        db.run(
          `UPDATE games SET draw_index = ?, status = ? WHERE game_id = ?`,
          [newIndex, newIndex >= total ? 'completed' : 'active', gameId],
          (ue) => {
            if (ue) return callback(ue);
            const result = {
              number: calledNumber,
              drawIndex: newIndex,
              total,
              done: newIndex >= total,
            };
            if (!result.done) return callback(null, result);
            createNextRound(gameId, (roundError, nextGameId) => {
              if (roundError) return callback(roundError);
              callback(null, { ...result, nextGameId });
            });
          }
        );
      }
    );
  });
}

module.exports = { generateDraw, getDraw, nextCall };
