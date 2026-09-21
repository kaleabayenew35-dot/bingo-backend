/**
 * timerService.js
 * Manages one server-side countdown timer per bet amount.
 * Each timer runs continuously and resets automatically when it reaches 0.
 *
 * Timer duration (seconds):
 * All amounts use the same round duration.
 */

const validAmounts = [10, 20, 30, 50, 100, 200];

// Map key: amount value: { amount, duration, endsAt (ms epoch) }
const timers = new Map();

function timerKey(amount) {
  return String(amount);
}

function initTimers() {
  validAmounts.forEach((a) => {
    const duration = 60;
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
  const a = Number(amount);
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
