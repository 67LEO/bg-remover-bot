const config = require('./config');

const POOL_SIZE = 3;
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
  };
}

function getNextFromPool() {
  for (let i = 0; i < tokenPool.length; i++) {
    const idx = (currentIdx + i) % tokenPool.length;
    const entry = tokenPool[idx];
    if (entry && !entry.bad && Date.now() < entry.expiry) {
      currentIdx = (idx + 1) % tokenPool.length;
      return entry;
    }
  }
  return null;
}

async function ensureAuth() {
  if (currentEntry && !currentEntry.bad && Date.now() < currentEntry.expiry) {
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

async function rotateToken() {
  if (currentEntry) currentEntry.bad = true;
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

async function replenishPool() {
  const good = tokenPool.filter(t => !t.bad && Date.now() < t.expiry);
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
  console.log(`[auth] Pool ready: ${tokenPool.length} tokens`);
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
  console.log('[auth] Initializing token pool...');
  await replenishPool();
  setInterval(replenishPool, 10 * 60 * 1000);
}

module.exports = { ensureAuth, rotateToken, appStartup, initPool };
