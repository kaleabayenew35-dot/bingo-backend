const express = require('express');
const router = express.Router();
const stageController = require('../controllers/stageController');
const timerController = require('../controllers/timerController');

// GET /api/stage/:stage/amount/:amount
router.get('/:stage/amount/:amount', stageController.getStageTable);
// GET /api/stage/:stage/amount/:amount/timer
router.get('/:stage/amount/:amount/timer', timerController.getTimer);
// POST /api/stage/:stage/amount/:amount/bet
router.post('/:stage/amount/:amount/bet', stageController.placeBet);
// POST /api/stage/:stage/amount/:amount/cancel
router.post('/:stage/amount/:amount/cancel', stageController.cancelBet);

module.exports = router;
