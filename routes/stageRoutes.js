const express = require('express');
const router = express.Router();
const amountController = require('../controllers/stageController');
const timerController = require('../controllers/timerController');

// GET /api/amount/:amount
router.get('/:amount', amountController.getAmountTable);
// GET /api/amount/:amount/timer
router.get('/:amount/timer', timerController.getTimer);
// POST /api/amount/:amount/bet
router.post('/:amount/bet', amountController.placeBet);
// POST /api/amount/:amount/cancel
router.post('/:amount/cancel', amountController.cancelBet);

module.exports = router;
