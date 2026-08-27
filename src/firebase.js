const config = require('./config');

const POOL_SIZE = parseInt(process.env.FIREBASE_POOL_SIZE, 10) || 8;
const COOLDOWN_MS = (parseInt(process.env.FIREBASE_COOLDOWN_MS, 10) || 60) * 60 * 1000;

let tokenPool = [];
let currentIdx = 0;
let currentEntry = null;

async function createAccount() {
  const res = await fetch(`${config.FIREBASE_SIGNUP_URL}?key=${config.FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Firebase sign-in failed: ${res.status} ${err}`);
  }
  const data = await res.json();
  return {
    idToken: data.idToken,
    localId: data.localId,
    refreshToken: data.refreshToken,
    expiry: Date.now() + (parseInt(data.expiresIn) - 60) * 1000,
    bad: false,
    cooldownUntil: 0,
  };
}

function isUsable(entry) {
  return entry && !entry.bad && Date.now() < entry.expiry && Date.now() >= (entry.cooldownUntil || 0);
}

function getNextFromPool() {
  for (let i = 0; i < tokenPool.length; i++) {
    const idx = (currentIdx + i) % tokenPool.length;
    const entry = tokenPool[idx];
    if (isUsable(entry)) {
      currentIdx = (idx + 1) % tokenPool.length;
      return entry;
    }
  }
  return null;
}

async function ensureAuth() {
  if (isUsable(currentEntry)) {
    return currentEntry;
  }
  const entry = getNextFromPool();
  if (entry) {
    currentEntry = entry;
    return entry;
  }
  currentEntry = await createAccount();
  tokenPool.push(currentEntry);
  currentIdx = tokenPool.length;
  return currentEntry;
}

// Rotate to the next usable account. If `exhausted` is true, the current
// account hit an entitlement rate-limit and goes on cool-down (usable again
// after COOLDOWN_MS) instead of being discarded permanently.
async function rotateToken(exhausted = false) {
  if (currentEntry) {
    if (exhausted) {
      currentEntry.cooldownUntil = Date.now() + COOLDOWN_MS;
    } else {
      currentEntry.bad = true;
    }
  }
  const entry = getNextFromPool();
  if (entry) {
    currentEntry = entry;
    console.log(`[auth] Rotated → ${entry.localId.slice(0, 8)}...`);
    return entry;
  }
  currentEntry = await createAccount();
  tokenPool.push(currentEntry);
  currentIdx = tokenPool.length;
  console.log(`[auth] Fresh account → ${currentEntry.localId.slice(0, 8)}...`);
  return currentEntry;
}

// Force-create a brand new account (bypassing the pool) to burst past a
// per-user entitlement limit. The caller is responsible for calling
// markUsedFresh() so it gets recycled into the pool instead of leaking.
async function fetchFreshAccount() {
  const entry = await createAccount();
  tokenPool.push(entry);
  currentIdx = tokenPool.length;
  currentEntry = entry;
  console.log(`[auth] Fresh burst account → ${entry.localId.slice(0, 8)}...`);
  return { ...entry };
}

function markExhausted(entry) {
  if (!entry) return;
  const poolEntry = tokenPool.find(t => t.localId === entry.localId);
  if (poolEntry) poolEntry.cooldownUntil = Date.now() + COOLDOWN_MS;
}

function clearCooldowns() {
  for (const t of tokenPool) t.cooldownUntil = 0;
  console.log('[auth] Cleared all cool-downs');
}

async function replenishPool() {
  const good = tokenPool.filter(t => isUsable(t));
  const needed = POOL_SIZE - good.length;
  if (needed <= 0) return;
  tokenPool = good;
  currentIdx = 0;
  const results = await Promise.allSettled(
    Array.from({ length: needed }, () => createAccount())
  );
  for (const r of results) {
    if (r.status === 'fulfilled') tokenPool.push(r.value);
  }
  const usable = tokenPool.filter(isUsable).length;
  console.log(`[auth] Pool ready: ${tokenPool.length} tokens (${usable} usable)`);
}

async function appStartup() {
  const { idToken } = await ensureAuth();
  const res = await fetch(config.STARTUP_API_URL, {
    method: 'POST',
    headers: { authorization: idToken },
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn(`[app-startup] warning: ${res.status} ${text.slice(0, 200)}`);
  }
}

async function initPool() {
  console.log(`[auth] Initializing token pool (size=${POOL_SIZE})...`);
  await replenishPool();
  setInterval(replenishPool, 10 * 60 * 1000);
}

module.exports = {
  ensureAuth,
  rotateToken,
  appStartup,
  initPool,
  fetchFreshAccount,
  markExhausted,
  clearCooldowns,
};
