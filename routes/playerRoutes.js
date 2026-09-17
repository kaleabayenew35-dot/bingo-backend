const express = require('express');
const router = express.Router();
const playerController = require('../controllers/playerController');

router.get('/history', playerController.getPlayerHistory);
router.get('/', playerController.getPlayers);
router.get('/:userId', playerController.getPlayer);
router.post('/', playerController.createPlayer);

module.exports = router;
