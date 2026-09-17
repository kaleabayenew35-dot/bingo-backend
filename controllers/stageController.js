const stageService = require('../services/stageService');

async function getStageTable(req, res, next) {
  const { stage, amount } = req.params;
  try {
    const rows = await stageService.getAll(stage, amount);
    res.json({ table: stageService.tableNameFor(stage, amount), rows });
  } catch (err) {
    next(err);
  }
}

async function placeBet(req, res, next) {
  const { stage, amount } = req.params;
  const payload = req.body;
  try {
    const result = await stageService.placeBet(stage, amount, payload);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
}

async function cancelBet(req, res, next) {
  const { stage, amount } = req.params;
  const { phone, numbers } = req.body;
  try {
    const result = await stageService.cancelBet(stage, amount, phone, numbers);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getStageTable,
  placeBet,
  cancelBet,
};
