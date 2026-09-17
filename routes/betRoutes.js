const express = require('express');
const router = express.Router();
const betController = require('../controllers/betController');

router.get('/', betController.getAllBets);
router.get('/:gameId', betController.getBets);
router.post('/:gameId', betController.createBet);

module.exports = router;
