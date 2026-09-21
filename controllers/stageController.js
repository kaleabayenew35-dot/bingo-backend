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
      if (!verifyRes.ok || !verifyData.valid) {
        return res.status(401).json({ error: verifyData.reason || 'Invalid launch token' });
      }
      // verify-launch-token returns flat { valid, phone, username, balance }
      verifiedPhone    = verifyData.phone    ?? verifyData.user?.phone    ?? phone;
      verifiedUsername = verifyData.username ?? verifyData.user?.username ?? verifiedUsername;
      liveBalance      = Number(verifyData.balance ?? verifyData.user?.balance ?? 0);
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
    const systemToken = process.env.SYSTEM_BACKEND_TOKEN;
    const playerId = `ph_${verifiedPhone.replace(/^\+/, '')}`;

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (systemToken) headers['x-api-token'] = systemToken;

      const deductRes = await fetch(
        `${systemApiBase()}/players/${encodeURIComponent(playerId)}/balance`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ amount: -betAmount }), // negative = deduct
        }
      );

      if (deductRes.ok) {
        const deductData = await deductRes.json();
        // system backend wraps in { ok: true, data: { balance, ... } }
        const serverBalance = deductData.data?.balance ?? deductData.balance ?? null;
        if (serverBalance != null) newBalance = Number(serverBalance);
      } else {
        const errText = await deductRes.text();
        console.warn(`[placeBet] Deduct returned ${deductRes.status}: ${errText}`);
      }
    } catch (deductErr) {
      console.warn('[placeBet] System backend deduct failed:', deductErr.message);
      // proceed with optimistic balance — bet is still saved
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

/**
 * POST /api/amount/:amount/cancel
 *
 * Body: { phone, numbers?, launch? }
 *
 * Flow:
 *  1. Cancel the bet entry in bingo DB (mark + bets table)
 *  2. Refund removedCount × amount back to player via system backend
 *     PATCH /api/players/ph_<phone>/balance  { amount: +refund }
 *  3. Update local player balance
 *  4. Return { success, gameId, refundAmount, newBalance }
 */
async function cancelBet(req, res, next) {
  const { amount } = req.params;
  const betAmount = Number(amount);
  const { phone, numbers, launch } = req.body || {};

  if (!phone && !launch) {
    return res.status(400).json({ error: 'phone or launch token required' });
  }

  try {
    // ── 1. Resolve verified phone (from launch token if provided) ──────────
    let verifiedPhone = phone;

    if (launch) {
      try {
        const verifyRes = await fetch(`${systemApiBase()}/verify-launch-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ launch }),
        });
        const verifyData = await verifyRes.json();
        if (verifyRes.ok && verifyData.valid) {
          verifiedPhone = verifyData.phone ?? verifyData.user?.phone ?? verifiedPhone;
        }
      } catch (_) {
        // fall back to client-provided phone
      }
    }

    if (!verifiedPhone) {
      return res.status(400).json({ error: 'Could not resolve player phone' });
    }

    // ── 2. Remove bet from bingo DB ────────────────────────────────────────
    const result = await amountService.cancelBet(betAmount, verifiedPhone, numbers);
    const refundAmount = (result.removedCount || 1) * betAmount;

    // ── 3. Refund balance on system backend ────────────────────────────────
    let newBalance = null;
    const systemToken = process.env.SYSTEM_BACKEND_TOKEN;
    const playerId = `ph_${verifiedPhone.replace(/^\+/, '')}`;

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (systemToken) headers['x-api-token'] = systemToken;

      const refundRes = await fetch(
        `${systemApiBase()}/players/${encodeURIComponent(playerId)}/balance`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ amount: refundAmount }), // positive = credit back
        }
      );

      if (refundRes.ok) {
        const refundData = await refundRes.json();
        // system backend wraps in { ok: true, data: { balance, ... } }
        const serverBalance = refundData.data?.balance ?? refundData.balance ?? null;
        if (serverBalance != null) newBalance = Number(serverBalance);
      } else {
        const errBody = await refundRes.text();
        console.warn(`[cancelBet] Refund returned ${refundRes.status}: ${errBody}`);
      }
    } catch (refundErr) {
      console.warn('[cancelBet] System backend refund failed:', refundErr.message);
    }

    // ── 4. Sync local player balance ────────────────────────────────────────
    if (newBalance != null) {
      await new Promise((resolve) => {
        amountService.updatePlayerBalanceByPhone(verifiedPhone, newBalance, (err) => {
          if (err) console.warn('[cancelBet] local balance sync failed:', err.message);
          resolve();
        });
      });
    }

    return res.json({
      success: true,
      gameId: result.gameId,
      refundAmount,
      newBalance,
      result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAmountTable,
  placeBet,
  cancelBet,
};
