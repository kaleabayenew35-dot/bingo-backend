const db = require('../config/database');

function listBets(gameId, callback) {
  db.all('SELECT * FROM bets WHERE game_id = ? ORDER BY created_at DESC', [gameId], callback);
}

function listAllBets(callback) {
  db.all('SELECT * FROM bets ORDER BY created_at DESC', callback);
}

function createBet({ gameId, userId, number, amount }, callback) {
  const stmt = db.prepare(
    'INSERT INTO bets (game_id, user_id, number, amount) VALUES (?, ?, ?, ?)'
  );
  stmt.run(gameId, userId, number, amount, callback);
}

module.exports = {
  listBets,
  listAllBets,
  createBet,
};
