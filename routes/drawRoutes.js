const express = require('express');
const router = express.Router();
const drawController = require('../controllers/drawController');

// POST /api/draw/:gameId/generate — generate + save 75-number sequence
router.post('/:gameId/generate', drawController.generateDraw);

// GET  /api/draw/:gameId — get the full sequence
router.get('/:gameId', drawController.getDraw);

// POST /api/draw/:gameId/next — get next call number (advances draw_index)
router.post('/:gameId/next', drawController.nextCall);

module.exports = router;
