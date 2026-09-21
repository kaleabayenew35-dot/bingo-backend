const db = require('../config/database');

function listGames(callback) {
  db.all('SELECT * FROM games ORDER BY created_at DESC', callback);
}

function getGame(gameId, callback) {
  db.get('SELECT * FROM games WHERE game_id = ?', [gameId], callback);
}

function createGame({ gameId, amount, players, status }, callback) {
  const stmt = db.prepare(
    'INSERT INTO games (game_id, amount, players, status) VALUES (?, ?, ?, ?)'
  );
  stmt.run(gameId, amount || 10, players || 0, status || 'waiting', callback);
}

function updateGame(gameId, { amount, players, status }, callback) {
  db.run(
    'UPDATE games SET amount = COALESCE(?, amount), players = COALESCE(?, players), status = COALESCE(?, status) WHERE game_id = ?',
    [amount, players, status, gameId],
    callback
  );
}

module.exports = {
  listGames,
  getGame,
  createGame,
  updateGame,
};
