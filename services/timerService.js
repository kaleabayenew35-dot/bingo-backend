/**
 * timerService.js
 * Manages one server-side countdown timer per bet amount.
 * Each timer runs continuously and resets automatically when it reaches 0.
 *
 * Each amount has its own round duration. Every player on the same amount
 * reads the same endsAt value, so their countdowns stay synchronized.
 */

const { AMOUNTS, normalizeAmount } = require('../config/amounts');

const DEFAULT_DURATIONS = Object.freeze({
  10: 60,
  20: 90,
  30: 120,
  50: 150,
  100: 180,
  200: 240,
});

function durationForAmount(amount) {
  const configured = Number(process.env[`BINGO_TIMER_SECONDS_${amount}`]);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_DURATIONS[amount];
}

// Map key: amount value: { amount, duration, endsAt (ms epoch) }
const timers = new Map();

function timerKey(amount) {
  return String(amount);
}

function initTimers() {
  AMOUNTS.forEach((a) => {
    const duration = durationForAmount(a);
    const endsAt = Date.now() + duration * 1000;
    timers.set(timerKey(a), { amount: a, duration, endsAt });
  });

  // Single interval ticks every second — resets any expired timers
  setInterval(() => {
    const now = Date.now();
    timers.forEach((t, key) => {
      if (now >= t.endsAt) {
        // auto-reset
        t.endsAt = now + t.duration * 1000;
      }
    });
  }, 1000);

  console.log(`[timerService] ${timers.size} timers initialised.`);
}

/**
 * Returns current timer state for a given amount.
 * @returns {{ amount, duration, remaining, endsAt }}
 */
function getTimer(amount) {
  let a;
  try { a = normalizeAmount(amount); } catch { return null; }
  const key = timerKey(a);
  const t = timers.get(key);
  if (!t) return null;
  const remaining = Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000));
  return {
    amount: t.amount,
    duration: t.duration,
    remaining,
    endsAt: t.endsAt,
  };
}

/**
 * Returns all timer states at once.
 */
function getAllTimers() {
  const result = [];
  timers.forEach((t) => {
    const remaining = Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000));
    result.push({ amount: t.amount, duration: t.duration, remaining, endsAt: t.endsAt });
  });
  return result;
}

module.exports = { initTimers, getTimer, getAllTimers };
