const db = require('../config/database');
const { normalizeAmount, prefixForAmount } = require('../config/amounts');

// PostgreSQL-compatible next game ID lookup using LIKE prefix + CAST
function getNextGameId(prefix, callback) {
  db.get(
    `SELECT MAX(CAST(SUBSTRING(game_id, 2) AS INTEGER)) AS "maxId"
     FROM games WHERE game_id LIKE '${prefix}%'`,
    [],
    (err, row) => {
      if (err) return callback(err);
      const nextId = (row && Number(row.maxId) ? Number(row.maxId) : 0) + 1;
      callback(null, `${prefix}${nextId}`);
    }
  );
}

function createNextRound(gameId, callback) {
  db.get('SELECT amount FROM games WHERE game_id = ?', [gameId], (gameError, game) => {
    if (gameError) return callback(gameError);
    let amount;
    try {
      amount = normalizeAmount(game?.amount);
    } catch (error) {
      return callback(error);
    }
    const prefix = prefixForAmount(amount);
    const table = `amount_${amount}`;

    getNextGameId(prefix, (maxError, nextGameId) => {
      if (maxError) return callback(maxError);
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
    });
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
 * The draw_sequence and draw_index columns are defined in the schema —
 * no runtime ALTER TABLE needed.
 */
function generateDraw(gameId, callback) {
  if (!gameId) return callback(new Error('Missing gameId'));

  // Multiple players reach the game at the same time. Reuse an existing
  // sequence so one browser cannot overwrite another browser's draw.
  db.get(
    'SELECT draw_sequence, draw_index FROM games WHERE game_id = ?',
    [gameId],
    (readError, existingGame) => {
      if (readError) return callback(readError);
      if (existingGame?.draw_sequence) {
        try {
          return callback(null, JSON.parse(existingGame.draw_sequence));
        } catch (parseError) {
          return callback(parseError);
        }
      }

      const sequence = generateSequence();
      const seqJson = JSON.stringify(sequence);

      db.run(
        `UPDATE games SET draw_sequence = ?, draw_index = 0
         WHERE game_id = ? AND draw_sequence IS NULL`,
        [seqJson, gameId],
        function (err) {
          if (err) return callback(err);
          if (this.changes > 0) {
            callback(null, sequence);
            return;
          }

          // Another player initialized this game first; return that sequence.
          db.get(
            'SELECT draw_sequence FROM games WHERE game_id = ?',
            [gameId],
            (finalError, finalGame) => {
              if (finalError) return callback(finalError);
              if (!finalGame?.draw_sequence) return callback(new Error('Game not found'));
              try {
                callback(null, JSON.parse(finalGame.draw_sequence));
              } catch (parseError) {
                callback(parseError);
              }
            }
          );
        }
      );
    }
  );
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
