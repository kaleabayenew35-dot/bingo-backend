require('dotenv').config();
const express = require('express');
const cors = require('cors');
const gameRoutes = require('./routes/gameRoutes');
const betRoutes = require('./routes/betRoutes');
const playerRoutes = require('./routes/playerRoutes');
const amountRoutes = require('./routes/stageRoutes');
const drawRoutes = require('./routes/drawRoutes');
const errorHandler = require('./middleware/errorHandler');
const db = require('./config/database');
const { initTimers, getAllTimers } = require('./services/timerService');
const timerController = require('./controllers/timerController');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Start one timer for each supported bet amount.
initTimers();

app.use('/api/games', gameRoutes);
app.use('/api/bets', betRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/amount', amountRoutes);
app.use('/api/draw', drawRoutes);

// GET /api/timers — all amount timers at once
app.get('/api/timers', timerController.getAllTimers);

app.get('/', (req, res) => {
  res.json({ message: 'Bingo backend is running' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'bingo-backend', amounts: [10, 20, 30, 50, 100, 200] });
});

app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

module.exports = app;
