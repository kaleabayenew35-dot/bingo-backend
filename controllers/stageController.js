const amountService = require('../services/stageService');

async function getAmountTable(req, res, next) {
  const { amount } = req.params;
  try {
    const rows = await amountService.getAll(amount);
    res.json({ table: amountService.tableNameFor(amount), amount: Number(amount), rows });
  } catch (err) {
    next(err);
  }
}

async function placeBet(req, res, next) {
  const { amount } = req.params;
  const payload = req.body;
  try {
    const result = await amountService.placeBet(amount, payload);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
}

async function cancelBet(req, res, next) {
  const { amount } = req.params;
  const { phone, numbers } = req.body;
  try {
    const result = await amountService.cancelBet(amount, phone, numbers);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAmountTable,
  placeBet,
  cancelBet,
};
