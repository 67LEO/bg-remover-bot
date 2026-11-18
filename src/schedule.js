// Time helpers for the admin's daily report. India has no daylight saving, so IST is a fixed UTC+5:30.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Milliseconds from `now` until the next HH:MM India time (never 0: if it is exactly that time, it means tomorrow).
function msUntilNextIST(hour, minute, now = Date.now()) {
  const ist = new Date(now + IST_OFFSET_MS);
  // Today's HH:MM IST wall-clock written as if it were UTC, then shifted back to the real instant
  let target = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hour, minute) - IST_OFFSET_MS;
  if (target <= now) target += DAY_MS;
  return target - now;
}

module.exports = { msUntilNextIST, IST_OFFSET_MS };
