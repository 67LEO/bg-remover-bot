const SIGN = '68d6165b72a7f2d8d17b0dc6fe9691abdf77c583';
const API_BASE = 'https://t2v.aritek.app';

let tokenCache = null;
let deviceCounter = 0;

async function getFreshToken() {
  deviceCounter++;
  const deviceId = `web_gen_${Date.now()}_${deviceCounter}_${Math.random().toString(36).slice(2, 8)}`;

  const res = await fetch(`${API_BASE}/api/v1/user/info`, {
    headers: {
      Sign: SIGN,
      'Device-Id': deviceId,
      'Ctry-Target': 'others',
      versionCode: '78',
    },
  });

  if (!res.ok) throw new Error(`T2V auth failed: ${res.status}`);

  const data = await res.json();
  const token = data.data?.token;
  if (!token) throw new Error('No token returned from T2V API');

  let expiresAt = Date.now() + 3600000;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    expiresAt = payload.exp * 1000;
  } catch {}

  const cache = { token, deviceId, expiresAt };
  tokenCache = cache;
  return cache;
}

async function ensureToken() {
  if (!tokenCache || Date.now() >= tokenCache.expiresAt - 60000) {
    return getFreshToken();
  }
  return tokenCache;
}

async function generateVideo(prompt, aspectRatio = 'auto') {
  if (!prompt || !prompt.trim()) throw new Error('Prompt is required');

  const cache = await ensureToken();

  const body = {
    prompt,
    versionCode: 78,
    deviceID: cache.deviceId,
    isPremium: 0,
    ctry_target: 'others',
    used: [],
    aspect_ratio: aspectRatio,
    ai_sound: 0,
  };

  const genRes = await fetch(`${API_BASE}/api/v1/video/t2v`, {
    method: 'POST',
    headers: {
      Sign: SIGN,
      'Device-Id': cache.deviceId,
      'Ctry-Target': 'others',
      versionCode: '78',
      Authorization: `Bearer ${cache.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!genRes.ok) {
    if (genRes.status === 429) {
      tokenCache = null;
      throw new Error('Daily video generation limit reached. Try again tomorrow.');
    }
    const errBody = await genRes.text();
    throw new Error(`T2V generation failed (${genRes.status}): ${errBody.substring(0, 200)}`);
  }

  const genData = await genRes.json();

  if (genData.data?.url) {
    return { url: genData.data.url };
  }

  throw new Error(genData.message || 'T2V generation returned no URL');
}

module.exports = { generateVideo };
