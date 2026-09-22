const db = require('../config/database');
const { AMOUNTS, canonicalGameId } = require('../config/amounts');

function listPlayers(callback) {
  db.all('SELECT * FROM players ORDER BY created_at DESC', callback);
}

function getPlayer(userId, callback) {
  db.get('SELECT * FROM players WHERE user_id = ?', [userId], callback);
}

function createPlayer({ userId, username, phone, balance }, callback) {
  const stmt = db.prepare(
    'INSERT INTO players (user_id, username, phone, balance) VALUES (?, ?, ?, ?)'
  );
  stmt.run(userId, username, phone, balance || 0, callback);
}

function upsertPlayer({ userId, username, phone, balance }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO players (user_id, username, phone, balance)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         username = EXCLUDED.username,
         phone = EXCLUDED.phone,
         balance = EXCLUDED.balance`,
      [userId, username, phone, balance],
      (error) => {
        if (error) return reject(error);
        getPlayer(userId, (getError, row) => {
          if (getError) return reject(getError);
          if (!row) return reject(new Error('Failed to load synced player'));
          resolve(row);
        });
      }
    );
  });
}

/**
 * Get full bet history for a player by phone.
 * Scans all amount tables and returns every entry matching the phone.
 */
function getPlayerHistory(phone, callback) {
  if (!phone) return callback(new Error('Missing phone'));

  const results = [];
  let completed = 0;
  const total = AMOUNTS.length;

  AMOUNTS.forEach((a) => {
    const table = `amount_${a}`;
    db.all(`
      SELECT a.game_id, a.mark, a.payout, a.winner_id, a.created_at, a.updated_at,
             g.status AS game_status
      FROM ${table} a
      LEFT JOIN games g ON g.game_id = a.game_id
      ORDER BY a.id DESC
    `, [], (err, rows) => {
      completed += 1;
      if (!err && rows) {
        rows.forEach((row) => {
          const entries = (row.mark || '').split(',').map((e) => e.trim()).filter(Boolean);
          entries.forEach((entry) => {
            // parse both formats: "username|phone:nums" and "phone:nums"
            const colonIdx = entry.indexOf(':');
            if (colonIdx === -1) return;
            const beforeColon = entry.slice(0, colonIdx);
            const numStr = entry.slice(colonIdx + 1);
            const pipeIdx = beforeColon.indexOf('|');
            const entryPhone = pipeIdx !== -1 ? beforeColon.slice(pipeIdx + 1) : beforeColon;
            const entryUsername = pipeIdx !== -1 ? beforeColon.slice(0, pipeIdx) : beforeColon;
            if (entryPhone !== phone) return;
            const numbers = numStr.split('|').map(Number).filter(Boolean);
            const hasWinner = Boolean(row.winner_id);
            const isWinner = hasWinner && row.winner_id === entryPhone;
            const isComplete = row.game_status === 'completed';
            results.push({
              gameId: canonicalGameId(row.game_id, a),
              amount: a,
              numbers,
              username: entryUsername,
              status: isComplete && hasWinner ? (isWinner ? 'win' : 'lose') : 'pending',
              payout: isWinner ? Number(row.payout || 0) : 0,
              placedAt: row.updated_at || row.created_at,
            });
          });
        });
      }
      if (completed === total) {
        // sort newest first
        results.sort((a, b) => (b.placedAt || '').localeCompare(a.placedAt || ''));
        callback(null, results);
      }
    });
  });
}

module.exports = {
  listPlayers,
  getPlayer,
  createPlayer,
  upsertPlayer,
  getPlayerHistory,
};
