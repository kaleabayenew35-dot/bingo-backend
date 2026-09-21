const playerService = require('../services/playerService');

async function syncPlayer(req, res) {
  const { launch, username, phone, balance } = req.body || {};
  if (!launch || !phone) {
    return res.status(400).json({ error: 'launch and phone are required' });
  }

  try {
    const systemApiUrl = process.env.SYSTEM_BACKEND_API_URL || 'https://system-backend-jbnd.onrender.com/api';
    const verification = await fetch(`${systemApiUrl}/verify-launch-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ launch }),
    });

    const data = await verification.json();
    if (!verification.ok || !data.valid || !data.user) {
      return res.status(401).json({ error: data.reason || 'Invalid launch token' });
    }

    if (data.user.phone !== phone) {
      return res.status(401).json({ error: 'Launch user does not match phone' });
    }

    const user = {
      userId: data.user.phone,
      username: data.user.username || username || data.user.phone,
      phone: data.user.phone,
      balance: Number(data.user.balance ?? balance ?? 0),
    };
    const synced = await playerService.upsertPlayer(user);
    return res.json({ success: true, user: synced });
  } catch (error) {
    return res.status(502).json({ error: `System backend unavailable: ${error.message}` });
  }
}

function getPlayers(req, res) {
  playerService.listPlayers((err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
}

function getPlayer(req, res) {
  const { userId } = req.params;
  playerService.getPlayer(userId, (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Player not found' });
    res.json(row);
  });
}

function createPlayer(req, res) {
  const { userId, username, phone, balance } = req.body;
  if (!userId || !username) {
    return res.status(400).json({ error: 'userId and username are required' });
  }
  playerService.createPlayer({ userId, username, phone, balance }, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ userId, username, phone, balance: balance || 0 });
  });
}

// GET /api/players/history?phone=+1234567890
function getPlayerHistory(req, res) {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'phone query param required' });
  playerService.getPlayerHistory(phone, (err, history) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ phone, history });
  });
}

module.exports = {
  syncPlayer,
  getPlayers,
  getPlayer,
  createPlayer,
  getPlayerHistory,
};
