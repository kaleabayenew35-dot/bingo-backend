/**
 * timerService.js
 * Manages 18 independent server-side countdown timers — one per stage/amount pair.
 * Each timer runs continuously and resets automatically when it reaches 0.
 *
 * Timer durations (seconds) — you can adjust these per stage/amount:
 *   Stage 1: 60s  |  Stage 2: 90s  |  Stage 3: 120s
 *   (same duration across all amounts within a stage)
 */

const validStages  = [1, 2, 3];
const validAmounts = [10, 20, 30, 50, 100, 200];

// Duration in seconds for each stage
const STAGE_DURATIONS = {
  1: 60,
  2: 90,
  3: 120,
};

// Map key: "stage_amount"  value: { stage, amount, duration, endsAt (ms epoch) }
const timers = new Map();

function timerKey(stage, amount) {
  return `${stage}_${amount}`;
}

function initTimers() {
  validStages.forEach((s) => {
    validAmounts.forEach((a) => {
      const duration = STAGE_DURATIONS[s] || 60;
      const endsAt = Date.now() + duration * 1000;
      timers.set(timerKey(s, a), {
        stage: s,
        amount: a,
        duration,
        endsAt,
      });
    });
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
 * Returns current timer state for a given stage/amount.
 * @returns {{ stage, amount, duration, remaining, endsAt }}
 */
function getTimer(stage, amount) {
  const s = Number(stage);
  const a = Number(amount);
  const key = timerKey(s, a);
  const t = timers.get(key);
  if (!t) return null;
  const remaining = Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000));
  return {
    stage: t.stage,
    amount: t.amount,
    duration: t.duration,
    remaining,
    endsAt: t.endsAt,
  };
}

/**
 * Returns all 18 timer states at once.
 */
function getAllTimers() {
  const result = [];
  timers.forEach((t) => {
    const remaining = Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000));
    result.push({ stage: t.stage, amount: t.amount, duration: t.duration, remaining, endsAt: t.endsAt });
  });
  return result;
}

module.exports = { initTimers, getTimer, getAllTimers };
