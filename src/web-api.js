const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const config = require('./config');
const db = require('./db');
const { getMask, getUpscale, generateImage, getAiBackground, ContentViolationError } = require('./processor');
const { applyMask } = require('./image');
const { generateVideo } = require('./video');
const { getVoices, generateSpeech, SUPPORTED_LANGUAGES } = require('./elevenlabs');

const JWT_SECRET = process.env.JWT_SECRET || (() => { const s = require('crypto').randomBytes(64).toString('hex'); console.warn('WARNING: Using auto-generated JWT_SECRET. Set JWT_SECRET in .env for persistence.'); return s; })();
const JWT_EXPIRY = '7d';

const loginAttempts = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginAttempts) {
    if (now - v.ts > 900000) loginAttempts.delete(k);
  }
}, 60000);

function checkBruteForce(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.ts > 900000) { loginAttempts.delete(ip); return false; }
  return entry.count >= 5;
}

function recordBruteForce(ip) {
  const entry = loginAttempts.get(ip) || { count: 0, ts: Date.now() };
  entry.count++;
  entry.ts = Date.now();
  loginAttempts.set(ip, entry);
}
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const SITE_URL = process.env.SITE_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('Only JPG, PNG, WebP allowed'));
    cb(null, true);
  },
});

const router = Router();
const crypto = require('crypto');

function generateToken(user) {
  return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.userId = payload.userId;
    req.userEmail = payload.email;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function anonOrAuthMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET);
      req.userId = payload.userId;
      req.userEmail = payload.email;
      req.isAnon = false;
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }
  const anonId = req.headers['x-anon-id'];
  if (anonId && typeof anonId === 'string' && anonId.length >= 8) {
    req.anonId = anonId;
    req.isAnon = true;
    return next();
  }
  return res.status(401).json({ error: 'Authentication required. Login or use an anonymous session.' });
}

async function checkWebLimit(userIdOrAnon, res, isAnon) {
  let stats;
  if (isAnon) {
    const dailyUsed = await db.getAnonUsage(userIdOrAnon);
    stats = { dailyUsed, dailyRemaining: Math.max(0, config.FREE_LIMIT_DAILY - dailyUsed), isPremium: false };
  } else {
    stats = await db.getWebUserStats(userIdOrAnon);
  }
  if (!stats) return null;
  if (!stats.isPremium && stats.dailyUsed >= config.FREE_LIMIT_DAILY) {
    res.status(429).json({ error: 'Free limit reached. Login or sign up for more.', needsLogin: true, stats });
    return null;
  }
  return stats;
}

// AdsGram bot-ad Reward URL. Set in the AdsGram block as:
//   https://<your-domain>/api/adsgram/reward?userid=[userId]&secret=<ADSGRAM_REWARD_SECRET>
// Docs don't list the user-id parameter name, so a few common spellings are accepted (unknown param names are logged).
// A reward is only granted for an ad this bot actually sent to that user (one reward per ad), capped per day.
const adstate = require('./adstate');
const BOT_USERNAME = process.env.BOT_USERNAME || 'AiBgRemover_Bot';
const USER_ID_PARAMS = ['userid', 'userId', 'user_id', 'tgid', 'tg_id', 'uid', 'user', 'id'];

function rewardPage(ok, msg) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reward</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 20px;background:#0f172a;color:#f1f5f9">
<div style="font-size:48px">${ok ? '✅' : '⚠️'}</div><h2>${msg}</h2>
<p><a style="color:#38bdf8" href="https://t.me/${BOT_USERNAME}">Back to the bot</a></p></body></html>`;
}

router.get('/adsgram/reward', async (req, res) => {
  const wantsHtml = String(req.headers.accept || '').includes('text/html');
  const reply = (status, ok, msg, extra = {}) =>
    wantsHtml ? res.status(status).type('html').send(rewardPage(ok, msg)) : res.status(status).json({ ok, message: msg, ...extra });
  let chatId = 0, consumed = false;
  try {
    const expected = process.env.ADSGRAM_REWARD_SECRET || '';
    const given = String(req.query.secret || '');
    if (!expected) return reply(503, false, 'Not configured');
    const a = Buffer.from(given), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return reply(403, false, 'Forbidden');

    const key = USER_ID_PARAMS.find(k => parseInt(req.query[k]) > 0);
    chatId = key ? parseInt(req.query[key]) : 0;
    if (!chatId) {
      console.log('AdsGram reward call without a usable user id; query params:', Object.keys(req.query).filter(k => k !== 'secret').join(','));
      return reply(400, false, 'Could not identify the user. Please open the reward link from the bot again.');
    }

    const { byUser } = await db.countAdRewardsToday(chatId, '');
    const atLimit = byUser >= adstate.AD_DAILY_LIMIT;

    // A started ad pays out once: whichever of this callback / the Mini App page claim arrives first wins
    if (!atLimit && adstate.consumeIssued(chatId)) {
      consumed = true;
      await grantAdReward(chatId, 'adsgram');
      return reply(200, true, `+${adstate.AD_REWARD_CREDITS} credits added!`, { credits: adstate.AD_REWARD_CREDITS });
    }
    if (adstate.wasCredited(chatId, 30000)) return reply(200, true, 'Credits already added!'); // the page got there first
    if (atLimit) return reply(200, false, 'Daily ad reward limit reached. Come back tomorrow!', { limitReached: true });
    reply(200, false, 'No active ad found. Tap "Watch Ad & Earn Credits" in the bot to get a new one.');
  } catch {
    if (consumed) adstate.markIssued(chatId); // DB failed after using the ad up: let the user retry
    reply(500, false, 'Something went wrong. Please try the reward link again.');
  }
});

// ---- Mini App video ad page (/earn) ----
// Credits +AD_REWARD_CREDITS. One place, so the AdsGram callback and the Mini App claim behave identically.
async function grantAdReward(chatId, source) {
  await db.addCreditsBot(chatId, adstate.AD_REWARD_CREDITS);
  await db.logAdReward({ user_type: 'bot', user_id: chatId, credits_given: adstate.AD_REWARD_CREDITS, ip_hash: source, user_agent_hash: null });
  adstate.markCredited(chatId);
  // Best-effort DM so the user sees the credit in the chat
  fetch(`https://api.telegram.org/bot${config.BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: `✅ +${adstate.AD_REWARD_CREDITS} credits added! Thanks for watching.` }),
  }).catch(() => {});
}

// Validates Telegram Mini App initData (HMAC with the bot token) and returns the Telegram user id, or 0.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function userIdFromInitData(initData) {
  try {
    if (!initData || typeof initData !== 'string' || initData.length > 4096 || !config.BOT_TOKEN) return 0;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return 0;
    params.delete('hash');
    const check = [...params.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(config.BOT_TOKEN).digest();
    const calc = crypto.createHmac('sha256', secret).update(check).digest('hex');
    const a = Buffer.from(calc), b = Buffer.from(hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 0;
    const authDate = parseInt(params.get('auth_date'));
    if (!authDate || Date.now() / 1000 - authDate > 24 * 3600) return 0; // stale
    const id = parseInt(JSON.parse(params.get('user') || '{}').id);
    return id > 0 ? id : 0;
  } catch {
    return 0;
  }
}

const AD_MIN_WATCH_MS = parseInt(process.env.AD_MIN_WATCH_MS || '8000'); // a real video can't finish sooner than this
const MONETAG_POSTBACK_SECRET = process.env.MONETAG_POSTBACK_SECRET || ''; // set -> Monetag claims need its server confirmation
const MONETAG_WAIT_MS = parseInt(process.env.MONETAG_POSTBACK_WAIT_MS || '6000'); // how long a claim waits for that postback
const LIMIT_REACHED_MSG = 'You have used all of today\'s ad rewards. They reset tomorrow!';

router.post('/earn/start', async (req, res) => {
  try {
    const chatId = userIdFromInitData((req.body || {}).initData);
    if (!chatId) return res.status(401).json({ ok: false, error: 'Please open this page from the bot in Telegram.' });
    const { byUser } = await db.countAdRewardsToday(chatId, '');
    if (byUser >= adstate.AD_DAILY_LIMIT) return res.status(429).json({ ok: false, limitReached: true, error: LIMIT_REACHED_MSG });
    if ((req.body || {}).provider === 'monetag') {
      // Monetag needs a ymid that is unique per ad show (letters/digits/-/_/. only); it comes back in the postback
      const ymid = `m${chatId}_${crypto.randomBytes(6).toString('hex')}`;
      adstate.markIssued(chatId, 'app', Date.now(), ymid);
      return res.json({ ok: true, ymid });
    }
    adstate.markIssued(chatId, 'app');
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
});

// Called by the page after the video finished. The AdsGram server callback (Reward URL) may credit first;
// either way a started video pays out exactly once.
router.post('/earn/claim', async (req, res) => {
  let chatId = 0, claimed = false;
  try {
    chatId = userIdFromInitData((req.body || {}).initData);
    if (!chatId) return res.status(401).json({ ok: false, error: 'Please open this page from the bot in Telegram.' });
    const alreadyPaid = () => res.json({ ok: true, already: true, credits: adstate.AD_REWARD_CREDITS });
    const credited = adstate.wasCredited(chatId); // e.g. the AdsGram callback paid this video a moment ago

    const { byUser } = await db.countAdRewardsToday(chatId, '');
    if (byUser >= adstate.AD_DAILY_LIMIT) return credited ? alreadyPaid() : res.status(429).json({ ok: false, limitReached: true, error: LIMIT_REACHED_MSG });

    const body = req.body || {};
    const isMonetag = body.provider === 'monetag';
    const ymid = isMonetag ? String(body.ymid || '') : null;
    if (isMonetag) {
      // the ymid must be one this very user was given by /earn/start
      if (!new RegExp(`^m${chatId}_[0-9a-f]{12}$`).test(ymid)) return res.status(400).json({ ok: false, error: 'Please tap Watch again.' });
      // With the postback secret configured, credit only for an ad Monetag itself confirmed (server-to-server) as paid
      if (MONETAG_POSTBACK_SECRET) {
        const pb = await adstate.waitPostback(ymid, MONETAG_WAIT_MS);
        if (!pb) return res.status(400).json({ ok: false, error: 'We could not confirm the video yet. Please try again.' });
        if (pb.telegramId && pb.telegramId !== String(chatId)) return res.status(400).json({ ok: false, error: 'Please tap Watch again.' });
        if (!pb.valued) { adstate.dropPostback(ymid); return res.json({ ok: false, noReward: true, error: 'No reward for this video this time. Please try again.' }); }
      }
    }

    // A video that is still pending is judged on its own, even if the previous one was paid seconds ago
    const state = adstate.claimApp(chatId, AD_MIN_WATCH_MS, ymid);
    if (state === 'early') return res.status(400).json({ ok: false, error: 'Please watch the whole video to get your credits.' });
    if (state === 'none') return credited ? alreadyPaid() : res.status(400).json({ ok: false, error: 'No video was started. Tap Watch again.' });
    claimed = true;

    await grantAdReward(chatId, isMonetag ? 'monetag' : 'miniapp');
    if (ymid) adstate.dropPostback(ymid);
    res.json({ ok: true, credits: adstate.AD_REWARD_CREDITS });
  } catch {
    if (claimed) adstate.markIssued(chatId, 'app', Date.now() - 60000, (req.body || {}).provider === 'monetag' ? String((req.body || {}).ymid || '') : null); // DB failed after using the video up: let the user retry
    res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
});

// Monetag server-to-server postback. Set this as the Postback URL of the SDK zone in the Monetag dashboard:
//   https://<your-domain>/api/monetag/postback?secret=<MONETAG_POSTBACK_SECRET>&ymid={ymid}&zone_id={zone_id}&event_type={event_type}&reward_event_type={reward_event_type}&telegram_id={telegram_id}&estimated_price={estimated_price}
// The URL is stored at Monetag and never reaches the app, so a request with the right secret came from Monetag.
router.get('/monetag/postback', (req, res) => {
  if (!MONETAG_POSTBACK_SECRET) return res.sendStatus(503);
  const a = Buffer.from(String(req.query.secret || '')), b = Buffer.from(MONETAG_POSTBACK_SECRET);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(403);
  const ymid = String(req.query.ymid || '');
  if (/^m\d+_[0-9a-f]{12}$/.test(ymid)) { // ours; anything else (e.g. an ad shown without a ymid) is just acknowledged
    adstate.recordPostback(ymid, { valued: req.query.reward_event_type === 'valued', telegramId: String(req.query.telegram_id || '') });
  }
  res.sendStatus(200);
});

router.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email format' });

    const existing = await db.findWebUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.createWebUser(email, passwordHash, displayName || email.split('@')[0]);
    const token = generateToken(user);

    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name, authProvider: user.auth_provider } });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (checkBruteForce(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });

    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await db.findWebUserByEmail(email);
    if (!user) {
      recordBruteForce(ip);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.auth_provider === 'google') return res.status(400).json({ error: 'This account uses Google login. Please sign in with Google.' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      recordBruteForce(ip);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    loginAttempts.delete(ip);
    await db.updateWebUserLogin(user.id);
    const token = generateToken(user);

    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name, authProvider: user.auth_provider } });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.post('/auth/google', async (req, res) => {
  try {
    const { googleToken } = req.body;
    if (!googleToken) return res.status(400).json({ error: 'Google token required' });
    if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google login not configured' });

    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${googleToken}`);
    if (!verifyRes.ok) return res.status(401).json({ error: 'Invalid Google token' });

    const profile = await verifyRes.json();
    const email = profile.email;
    const googleId = profile.sub;
    const displayName = profile.name || email.split('@')[0];
    const avatarUrl = profile.picture || null;

    if (!email) return res.status(400).json({ error: 'Google account has no email' });

    let user = await db.findWebUserByGoogleId(googleId);
    if (!user) {
      user = await db.createWebUser(email, null, displayName, 'google', googleId);
      if (avatarUrl) {
        await db.query('UPDATE web_users SET avatar_url = $1 WHERE id = $2', [avatarUrl, user.id]);
      }
    } else {
      await db.updateWebUserLogin(user.id);
    }

    const token = generateToken(user);
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name, avatarUrl: user.avatar_url, authProvider: 'google' } });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.get('/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await db.findWebUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: { id: user.id, email: user.email, displayName: user.display_name, avatarUrl: user.avatar_url, authProvider: user.auth_provider } });
  } catch {
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.post('/process/bg-remove', anonOrAuthMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Image required' });

    const id = req.isAnon ? req.anonId : req.userId;
    const stats = await checkWebLimit(id, res, req.isAnon);
    if (!stats) return;

    const imageBuffer = req.file.buffer;
    const maskBuffer = await getMask(imageBuffer);
    const resultBuffer = await applyMask(imageBuffer, maskBuffer);

    if (req.isAnon) await db.incrementAnonUsage(id);
    else await db.incrementWebUsage(id);

    res.set('Content-Type', 'image/png');
    res.set('X-Usage-Remaining', String(stats.isPremium ? 'unlimited' : (config.FREE_LIMIT_DAILY - stats.dailyUsed - 1)));
    res.send(resultBuffer);
  } catch (err) {
    console.error('BG remove error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.post('/process/upscale', anonOrAuthMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Image required' });

    const id = req.isAnon ? req.anonId : req.userId;
    const stats = await checkWebLimit(id, res, req.isAnon);
    if (!stats) return;

    const resultBuffer = await getUpscale(req.file.buffer);

    if (req.isAnon) await db.incrementAnonUsage(id);
    else await db.incrementWebUsage(id);

    res.set('Content-Type', 'image/png');
    res.set('X-Usage-Remaining', String(stats.isPremium ? 'unlimited' : (config.FREE_LIMIT_DAILY - stats.dailyUsed - 1)));
    res.send(resultBuffer);
  } catch (err) {
    console.error('Upscale error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.post('/process/imagine', anonOrAuthMiddleware, async (req, res) => {
  try {
    const { prompt, size } = req.body;
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt required' });

    const id = req.isAnon ? req.anonId : req.userId;
    const stats = await checkWebLimit(id, res, req.isAnon);
    if (!stats) return;

    const resultBuffer = await generateImage(prompt, 'ultra-realistic', size || 'SQUARE_HD');

    if (req.isAnon) await db.incrementAnonUsage(id);
    else await db.incrementWebUsage(id);

    res.set('Content-Type', 'image/jpeg');
    res.set('X-Usage-Remaining', String(stats.isPremium ? 'unlimited' : (config.FREE_LIMIT_DAILY - stats.dailyUsed - 1)));
    res.send(resultBuffer);
  } catch (err) {
    if (err instanceof ContentViolationError) {
      return res.status(400).json({ error: 'Prompt rejected by content filter' });
    }
    console.error('Imagine error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.post('/process/video', anonOrAuthMiddleware, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt required' });

    const id = req.isAnon ? req.anonId : req.userId;
    const stats = await checkWebLimit(id, res, req.isAnon);
    if (!stats) return;

    const result = await generateVideo(prompt);

    if (req.isAnon) await db.incrementAnonUsage(id);
    else await db.incrementWebUsage(id);

    const videoRes = await fetch(result.url);
    if (!videoRes.ok) throw new Error('Download failed');

    const buf = Buffer.from(await videoRes.arrayBuffer());
    res.set('Content-Type', 'video/mp4');
    res.set('X-Usage-Remaining', String(stats.isPremium ? 'unlimited' : (config.FREE_LIMIT_DAILY - stats.dailyUsed - 1)));
    res.send(buf);
  } catch (err) {
    console.error('Video error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.post('/process/voice', anonOrAuthMiddleware, async (req, res) => {
  try {
    const { voiceId, text, language } = req.body;
    if (!voiceId || !text || !language) return res.status(400).json({ error: 'voiceId, text, and language required' });

    const id = req.isAnon ? req.anonId : req.userId;
    const stats = await checkWebLimit(id, res, req.isAnon);
    if (!stats) return;

    const audioBuf = await generateSpeech(voiceId, text, language);

    if (req.isAnon) await db.incrementAnonUsage(id);
    else await db.incrementWebUsage(id);

    res.set('Content-Type', 'audio/ogg');
    res.set('X-Usage-Remaining', String(stats.isPremium ? 'unlimited' : (config.FREE_LIMIT_DAILY - stats.dailyUsed - 1)));
    res.send(audioBuf);
  } catch (err) {
    console.error('Voice error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.get('/voices', anonOrAuthMiddleware, async (req, res) => {
  try {
    const voices = await getVoices();
    res.json({ voices, languages: SUPPORTED_LANGUAGES });
  } catch (err) {
    console.error('Voices error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.get('/user/stats', anonOrAuthMiddleware, async (req, res) => {
  try {
    if (req.isAnon) {
      const dailyUsed = await db.getAnonUsage(req.anonId);
      return res.json({ stats: { dailyUsed, dailyRemaining: Math.max(0, config.FREE_LIMIT_DAILY - dailyUsed), isPremium: false } });
    }
    const stats = await db.getWebUserStats(req.userId);
    if (!stats) return res.status(404).json({ error: 'User not found' });
    res.json({ stats });
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.get('/user/history', authMiddleware, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, type, original_size, result_size, created_at
       FROM images WHERE web_user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [req.userId]
    );
    res.json({ history: r.rows });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.post('/premium/order', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!plan || !config.PREMIUM_PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

    const planInfo = config.PREMIUM_PLANS[plan];
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let orderRef = 'BG-';
    for (let i = 0; i < 5; i++) orderRef += chars[Math.floor(Math.random() * chars.length)];

    await db.createPaymentOrder(orderRef, null, plan, planInfo.price);
    await db.query('UPDATE payment_orders SET web_user_id = $1 WHERE order_ref = $2', [req.userId, orderRef]);

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=upi://pay?pa=${encodeURIComponent(config.UPI_ID)}&pn=${encodeURIComponent(config.UPI_NAME)}&am=${planInfo.price}&tn=${orderRef}`;

    res.json({
      orderRef,
      plan,
      amount: planInfo.price,
      upiId: config.UPI_ID,
      upiName: config.UPI_NAME,
      qrUrl,
    });
  } catch (err) {
    console.error('Premium order error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.post('/premium/screenshot', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { orderRef } = req.body;
    if (!orderRef || !req.file) return res.status(400).json({ error: 'Order reference and screenshot required' });

    const order = await db.getPaymentOrderByRef(orderRef);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.web_user_id !== req.userId) return res.status(403).json({ error: 'Not your order' });

    await db.attachScreenshot(orderRef, 'web_upload');

    const displayName = order.first_name || order.username || `User ${req.userId}`;

    const adminChatId = config.ADMIN_CHAT_ID;
    if (adminChatId) {
      const adminBot = require('./admin-bot');
      if (adminBot) {
        adminBot.telegram.sendPhoto(adminChatId, { source: req.file.buffer }, {
          caption: `📸 *New Payment Screenshot (Web)*\n\n👤 ${displayName}\n🔖 Ref: ${orderRef}\n💰 ${order.plan}`,
          parse_mode: 'Markdown',
        }).catch(() => {});
      }
    }

    res.json({ success: true, message: 'Screenshot received. Admin will verify soon.' });
  } catch (err) {
    console.error('Screenshot error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.get('/health', async (req, res) => {
  try {
    await db.getUserCount();
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

module.exports = { router, authMiddleware, GOOGLE_CLIENT_ID };
