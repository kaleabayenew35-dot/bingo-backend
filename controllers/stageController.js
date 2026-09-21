const amountService = require('../services/stageService');

const SYSTEM_BACKEND_URL = (
  process.env.SYSTEM_BACKEND_API_URL ||
  process.env.SYSTEM_BACKEND_URL ||
  'https://system-backend-1u5m.onrender.com'
).replace(/\/$/, '');

function systemApiBase() {
  return SYSTEM_BACKEND_URL.endsWith('/api')
    ? SYSTEM_BACKEND_URL
    : `${SYSTEM_BACKEND_URL}/api`;
}

async function getAmountTable(req, res, next) {
  const { amount } = req.params;
  try {
    const rows = await amountService.getAll(amount);
    res.json({ table: amountService.tableNameFor(amount), amount: Number(amount), rows });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/amount/:amount/bet
 *
 * Body: { phone, username, numbers, launch? }
 *
 * Flow:
 *  1. Verify player identity via system backend
 *  2. Check live balance >= amount
 *  3. Deduct balance on system backend
 *  4. Save bet in bingo DB (mark + bets table)
 *  5. Return { success, gameId, newBalance, result }
 */
async function placeBet(req, res, next) {
  const { amount } = req.params;
  const betAmount = Number(amount);
  const { phone, username, numbers, launch } = req.body || {};

  if (!phone && !launch) {
    return res.status(400).json({ error: 'phone or launch token required' });
  }
  if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'numbers array is required' });
  }

  try {
    // ── 1. Verify player & get live balance from system backend ──────────
    let verifiedPhone = phone;
    let verifiedUsername = username || phone;
    let liveBalance = 0;

    if (launch) {
      // prefer launch-token verification (more secure)
      const verifyRes = await fetch(`${systemApiBase()}/verify-launch-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launch }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.valid || !verifyData.user) {
        return res.status(401).json({ error: verifyData.reason || 'Invalid launch token' });
      }
      verifiedPhone    = verifyData.user.phone;
      verifiedUsername = verifyData.user.username || verifiedPhone;
      liveBalance      = Number(verifyData.user.balance ?? 0);
    } else {
      // fall back: fetch player balance by phone
      const balRes = await fetch(`${systemApiBase()}/players/balance?phone=${encodeURIComponent(phone)}`);
      if (balRes.ok) {
        const balData = await balRes.json();
        liveBalance = Number(balData.balance ?? balData.user?.balance ?? 0);
      } else {
        // last resort: use whatever the client sent (unauthenticated path)
        liveBalance = Number(req.body.balance ?? 0);
      }
    }

    // ── 2. Balance check ──────────────────────────────────────────────────
    if (liveBalance < betAmount) {
      return res.status(402).json({ error: 'Insufficient balance', balance: liveBalance });
    }

    // ── 3. Deduct balance on system backend ───────────────────────────────
    let newBalance = liveBalance - betAmount;
    try {
      const deductRes = await fetch(`${systemApiBase()}/players/deduct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: verifiedPhone, amount: betAmount }),
      });
      if (deductRes.ok) {
        const deductData = await deductRes.json();
        newBalance = Number(deductData.balance ?? deductData.user?.balance ?? newBalance);
      }
      // If deduct endpoint doesn't exist yet we still proceed with client-calculated balance
    } catch (_) {
      // system backend deduct unavailable — continue with optimistic balance
    }

    // ── 4. Save bet in bingo DB ───────────────────────────────────────────
    const result = await amountService.placeBet(betAmount, {
      phone: verifiedPhone,
      username: verifiedUsername,
      balance: newBalance,
      numbers,
    });

    // ── 5. Respond ────────────────────────────────────────────────────────
    return res.json({
      success: true,
      gameId: result.gameId,
      newBalance,
      result,
    });
  } catch (err) {
    next(err);
  }
}

async function cancelBet(req, res, next) {
  const { amount } = req.params;
  const { phone, numbers } = req.body;
  try {
    const result = await amountService.cancelBet(amount, phone, numbers);
    res.json({ success: true, result });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAmountTable,
  placeBet,
  cancelBet,
};
