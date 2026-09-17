const express = require('express');
const router = express.Router();
const gameController = require('../controllers/gameController');

router.get('/', gameController.getGames);
router.get('/:gameId', gameController.getGame);
router.post('/', gameController.createGame);
router.put('/:gameId', gameController.updateGame);

module.exports = router;
