const drawService = require('../services/drawService');

// POST /api/draw/:gameId/generate — generate + save 75-number sequence
function generateDraw(req, res) {
  const { gameId } = req.params;
  drawService.generateDraw(gameId, (err, sequence) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ gameId, sequence, total: sequence.length });
  });
}

// GET /api/draw/:gameId — get the full saved sequence
function getDraw(req, res) {
  const { gameId } = req.params;
  drawService.getDraw(gameId, (err, data) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ gameId, ...data });
  });
}

// POST /api/draw/:gameId/next — advance to next call, return it
function nextCall(req, res) {
  const { gameId } = req.params;
  drawService.nextCall(gameId, (err, data) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ gameId, ...data });
  });
}

module.exports = { generateDraw, getDraw, nextCall };
