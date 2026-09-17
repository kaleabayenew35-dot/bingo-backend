const betService = require('../services/betService');
const gameService = require('../services/gameService');

function getBets(req, res) {
  const { gameId } = req.params;
  betService.listBets(gameId, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
}

function getAllBets(req, res) {
  betService.listAllBets((err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
}

function createBet(req, res) {
  const { gameId } = req.params;
  const { userId, number, amount } = req.body;
  if (!userId || number == null || amount == null) {
    return res.status(400).json({ error: 'userId, number, and amount are required' });
  }

  gameService.getGame(gameId, (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Game not found' });

    betService.createBet({ gameId, userId, number, amount }, function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ gameId, userId, number, amount });
    });
  });
}

module.exports = {
  getBets,
  getAllBets,
  createBet,
};
