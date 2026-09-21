const express = require('express');
const router = express.Router();
const stageController = require('../controllers/stageController');
const timerController = require('../controllers/timerController');

// GET /api/amount/:amount
router.get('/:amount', stageController.getAmountTable);
// GET /api/amount/:amount/timer
router.get('/:amount/timer', timerController.getTimer);
// POST /api/amount/:amount/bet
router.post('/:amount/bet', stageController.placeBet);
// POST /api/amount/:amount/cancel
router.post('/:amount/cancel', stageController.cancelBet);

module.exports = router;
