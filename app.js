require('dotenv').config();
const express = require('express');
const cors = require('cors');
const gameRoutes = require('./routes/gameRoutes');
const betRoutes = require('./routes/betRoutes');
const playerRoutes = require('./routes/playerRoutes');
const stageRoutes = require('./routes/stageRoutes');
const drawRoutes = require('./routes/drawRoutes');
const errorHandler = require('./middleware/errorHandler');
const db = require('./config/database');
const { initTimers, getAllTimers } = require('./services/timerService');
const timerController = require('./controllers/timerController');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Start all 18 stage/amount timers
initTimers();

app.use('/api/games', gameRoutes);
app.use('/api/bets', betRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/stage', stageRoutes);
app.use('/api/draw', drawRoutes);

// GET /api/timers — all 18 timers at once
app.get('/api/timers', timerController.getAllTimers);

app.get('/', (req, res) => {
  res.json({ message: 'Bingo backend is running' });
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
