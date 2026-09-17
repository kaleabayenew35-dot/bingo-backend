const timerService = require('../services/timerService');

// GET /api/stage/:stage/amount/:amount/timer
function getTimer(req, res) {
  const { stage, amount } = req.params;
  const timer = timerService.getTimer(stage, amount);
  if (!timer) {
    return res.status(404).json({ error: 'Invalid stage or amount' });
  }
  res.json(timer);
}

// GET /api/timers  — all 18 timers at once
function getAllTimers(req, res) {
  res.json(timerService.getAllTimers());
}

module.exports = { getTimer, getAllTimers };
