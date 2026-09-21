const amountService = require('../services/stageService');

const SYSTEM_BACKEND_URL = (
  process.env.SYSTEM_BACKEND_API_URL ||
  process.env.SYSTEM_BACKEND_URL ||
  'https://system-backend-1u5m.onrender.com'
).replace(/\/$/, '');

// The bingo game token registered in the system backend game_tokens table
const BINGO_GAME_TOKEN = process.env.SYSTEM_BACKEND_TOKEN || '';

function systemApiBase() {
  return SYSTEM_BACKEND_URL.endsWith('/api')
    ? SYSTEM_BACKEND_URL
    : `${SYSTEM_BACKEND_URL}/api`;
}

/**
 * Call POST /api/game-api/game-action on the system backend.
 * action: 'deduct' (bet placed) | 'refund' (bet cancelled)
 * Returns the new balance, or null if the call fails.
 */
async function systemBalanceAction(action, phone, amount) {
  if (!BINGO_GAME_TOKEN) {
    console.warn('[bingo] SYSTEM_BACKEND_TOKEN not set — skipping balance action');
    return null;
  }
  try {
    const res = await fetch(`${systemApiBase()}/game-api/game-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token:  BINGO_GAME_TOKEN,
        action,           // 'deduct' or 'refund'
        phone,
        amount: Number(amount),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.warn(`[bingo] game-action/${action} returned ${res.status}:`, data);
      return null;
    }
    // Returns { ok: true, balance: number } or { ok: true, data: { balance } }
    const newBalance = data.balance ?? data.data?.balance ?? null;
    return newBalance != null ? Number(newBalance) : null;
  } catch (err) {
    console.warn(`[bingo] game-action/${action} failed:`, err.message);
    return null;
  }
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
    // POST /api/game-api/game-action { action:'deduct', phone, amount, token }
    let newBalance = liveBalance - betAmount; // optimistic fallback
    const serverBalance = await systemBalanceAction('deduct', verifiedPhone, betAmount);
    if (serverBalance != null) newBalance = serverBalance;

    // ── 4. Save bet in bingo DB ───────────────────────────────────────────
    let result;
    try {
      result = await amountService.placeBet(betAmount, {
        phone: verifiedPhone,
        username: verifiedUsername,
        balance: newBalance,
        numbers,
      });
    } catch (dbErr) {
      // If number already taken, refund the deducted amount and return 409
      if (dbErr.code === 'NUMBER_TAKEN') {
        await systemBalanceAction('refund', verifiedPhone, betAmount).catch(() => {});
        return res.status(409).json({
          error: dbErr.message,
          conflict: dbErr.conflict || [],
        });
      }
      throw dbErr; // re-throw other DB errors
    }

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
    // POST /api/game-api/game-action { action:'refund', phone, amount, token }
    const serverBalance = await systemBalanceAction('refund', verifiedPhone, refundAmount);
    let newBalance = serverBalance; // null if system backend unreachable

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
