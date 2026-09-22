const playerService = require('../services/playerService');

function normalizePhoneForComparison(value) {
  if (!value) return '';
  const clean = String(value).replace(/\D/g, '');
  if (!clean) return '';
  if (clean.startsWith('251')) return clean;
  if (clean.startsWith('0') && clean.length === 10) return `251${clean.slice(1)}`;
  if (clean.length === 9) return `251${clean}`;
  return clean;
}

async function syncPlayer(req, res) {
  const { launch, username, phone, balance } = req.body || {};
  if (!launch) {
    return res.status(400).json({ error: 'launch is required' });
  }

  try {
    const systemApiUrl = (process.env.SYSTEM_BACKEND_API_URL || process.env.SYSTEM_BACKEND_URL || 'https://system-backend-1u5m.onrender.com').replace(/\/$/, '');
    const verifyUrl = systemApiUrl.endsWith('/api')
      ? `${systemApiUrl}/verify-launch-token`
      : `${systemApiUrl}/api/verify-launch-token`;
    const verification = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ launch }),
    });

    const data = await verification.json();

    // verify-launch-token returns { valid, phone, username, balance } at top level
    if (!verification.ok || !data.valid) {
      return res.status(401).json({ error: data.reason || 'Invalid launch token' });
    }

    // support both flat response and nested user object
    const verifiedPhone    = data.phone    ?? data.user?.phone;
    const verifiedUsername = data.username ?? data.user?.username;
    const verifiedBalance  = data.balance  ?? data.user?.balance;

    if (!verifiedPhone) {
      return res.status(401).json({ error: 'Launch token missing phone' });
    }

    const normalizedVerifiedPhone = normalizePhoneForComparison(verifiedPhone);
    const normalizedClientPhone = normalizePhoneForComparison(phone);
    if (phone && normalizedVerifiedPhone && normalizedClientPhone && normalizedVerifiedPhone !== normalizedClientPhone) {
      return res.status(401).json({ error: 'Launch user does not match phone' });
    }

    const canonicalPhone = normalizedVerifiedPhone || verifiedPhone;
    const user = {
      userId:   canonicalPhone,
      username: verifiedUsername || username || canonicalPhone,
      phone:    canonicalPhone,
      balance:  Number(verifiedBalance ?? balance ?? 0),
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
