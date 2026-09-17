const playerService = require('../services/playerService');

function getPlayers(req, res) {
  playerService.listPlayers((err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
}

function getPlayer(req, res) {
  const { userId } = req.params;
  playerService.getPlayer(userId, (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Player not found' });
    res.json(row);
  });
}

function createPlayer(req, res) {
  const { userId, username, phone, balance } = req.body;
  if (!userId || !username) {
    return res.status(400).json({ error: 'userId and username are required' });
  }
  playerService.createPlayer({ userId, username, phone, balance }, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ userId, username, phone, balance: balance || 0 });
  });
}

// GET /api/players/history?phone=+1234567890
function getPlayerHistory(req, res) {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'phone query param required' });
  playerService.getPlayerHistory(phone, (err, history) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ phone, history });
  });
}

module.exports = {
  getPlayers,
  getPlayer,
  createPlayer,
  getPlayerHistory,
};
