const config = require('./config');

let authCache = null;
let tokenExpiry = 0;

async function signInAnonymously() {
  if (authCache && Date.now() < tokenExpiry) return authCache;

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
  authCache = { idToken: data.idToken, localId: data.localId, refreshToken: data.refreshToken };
  tokenExpiry = Date.now() + (parseInt(data.expiresIn) - 60) * 1000;
  return authCache;
}

async function refreshToken() {
  if (!authCache?.refreshToken) throw new Error('No refresh token available');
  const res = await fetch(`${config.FIREBASE_TOKEN_URL}?key=${config.FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: authCache.refreshToken }),
  });
  if (!res.ok) {
    authCache = null;
    return signInAnonymously();
  }
  const data = await res.json();
  authCache.idToken = data.id_token;
  authCache.refreshToken = data.refresh_token;
  tokenExpiry = Date.now() + (parseInt(data.expires_in) - 60) * 1000;
  return authCache;
}

async function ensureAuth() {
  if (Date.now() >= tokenExpiry) {
    try { return await refreshToken(); }
    catch { return await signInAnonymously(); }
  }
  return authCache;
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

module.exports = { signInAnonymously, ensureAuth, appStartup };
