const timerService = require('../services/timerService');

// GET /api/amount/:amount/timer
function getTimer(req, res) {
  const { amount } = req.params;
  const timer = timerService.getTimer(amount);
  if (!timer) {
    return res.status(404).json({ error: 'Invalid amount' });
  }
  res.json(timer);
}

// GET /api/timers  — all amount timers at once
function getAllTimers(req, res) {
  res.json(timerService.getAllTimers());
}

module.exports = { getTimer, getAllTimers };
