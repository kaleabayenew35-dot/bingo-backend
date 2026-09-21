const gameService = require('../services/gameService');

function getGames(req, res) {
  gameService.listGames((err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
}

function getGame(req, res) {
  const { gameId } = req.params;
  gameService.getGame(gameId, (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Game not found' });
    res.json(row);
  });
}

function createGame(req, res) {
  const { gameId, amount, players, status } = req.body;
  if (!gameId) return res.status(400).json({ error: 'gameId is required' });

  gameService.createGame({ gameId, amount, players, status }, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ gameId, amount: amount || 10, players: players || 0, status: status || 'waiting' });
  });
}

function updateGame(req, res) {
  const { gameId } = req.params;
  const { amount, players, status } = req.body;

  gameService.updateGame(gameId, { amount, players, status }, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ gameId, amount, players, status });
  });
}

module.exports = {
  getGames,
  getGame,
  createGame,
  updateGame,
};
