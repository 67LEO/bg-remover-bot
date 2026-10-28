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
const earnTokens = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of earnTokens) {
    if (now - v.exp > 600000) earnTokens.delete(k);
  }
}, 60000);

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

// Anti-abuse limits for ad rewards (override via env)
const AD_DAILY_LIMIT = parseInt(process.env.AD_DAILY_LIMIT || '5');        // rewards per bot user per day
const AD_IP_DAILY_LIMIT = parseInt(process.env.AD_IP_DAILY_LIMIT || '20'); // rewards per IP per day
const AD_MIN_WATCH_MS = parseInt(process.env.AD_MIN_WATCH_MS || '8000');   // min time between /earn/start and /earn/claim
const earnClaiming = new Set(); // chatIds with a claim in flight (so concurrent claims can't beat the daily cap)
const hashOf = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const LIMIT_MSG = 'Daily ad reward limit reached. Come back tomorrow, or use /share to invite friends for credits.';

router.post('/earn/token', async (req, res) => {
  try {
    const chatId = parseInt((req.body || {}).chatId);
    if (!chatId) return res.status(400).json({ error: 'chatId required' });
    const base = process.env.SITE_URL || '';
    const urlFor = (t) => (base ? `${base}/earn?token=${t}` : `/earn?token=${t}`);

    const { byUser } = await db.countAdRewardsToday(chatId, '');
    if (byUser >= AD_DAILY_LIMIT) return res.status(429).json({ error: LIMIT_MSG, limitReached: true });

    // One live token per user: pressing the button repeatedly must not mint unlimited tokens
    for (const [t, v] of earnTokens) {
      if (v.chatId === chatId && !v.used && Date.now() < v.exp) return res.json({ token: t, url: urlFor(t) });
    }
    const token = crypto.randomBytes(24).toString('hex');
    earnTokens.set(token, { chatId, exp: Date.now() + 600000, used: false, startedAt: null });
    res.json({ token, url: urlFor(token) });
  } catch {
    res.status(500).json({ error: 'Failed' });
  }
});

// Called by the Earn page right before the ad is shown; claim needs AD_MIN_WATCH_MS to have passed since this
router.post('/earn/start', (req, res) => {
  const { token } = req.body || {};
  const entry = token && earnTokens.get(token);
  if (!entry || entry.used || Date.now() > entry.exp) return res.status(400).json({ error: 'Invalid or expired token' });
  if (!entry.startedAt) entry.startedAt = Date.now();
  res.json({ ok: true });
});

router.post('/earn/claim', async (req, res) => {
  let entry = null;
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token required' });
    entry = earnTokens.get(token);
    if (!entry || entry.used || Date.now() > entry.exp) return res.status(400).json({ error: 'Invalid or expired token' });
    if (!entry.startedAt || Date.now() - entry.startedAt < AD_MIN_WATCH_MS) {
      return res.status(400).json({ error: 'Ad not completed. No credits added.' });
    }
    if (earnClaiming.has(entry.chatId)) return res.status(429).json({ error: 'Another claim is in progress. Try again.' });

    const ip = req.ip || req.socket.remoteAddress || '';
    const ipHash = hashOf(ip);
    const uaHash = hashOf(req.headers['user-agent'] || '');

    earnClaiming.add(entry.chatId);
    entry.used = true; // burn first so the same token can't be claimed twice concurrently
    try {
      const { byUser, byIp } = await db.countAdRewardsToday(entry.chatId, ipHash);
      if (byUser >= AD_DAILY_LIMIT || byIp >= AD_IP_DAILY_LIMIT) {
        return res.status(429).json({ error: LIMIT_MSG, limitReached: true });
      }
      await db.addCreditsBot(entry.chatId, 3);
      await db.logAdReward({ user_type: 'bot', user_id: entry.chatId, credits_given: 3, ip_hash: ipHash, user_agent_hash: uaHash });
    } catch (err) {
      entry.used = false; // DB failure: don't burn the user's token
      throw err;
    } finally {
      earnClaiming.delete(entry.chatId);
    }
    res.json({ ok: true, credits: 3, message: '+3 credits added!' });
  } catch {
    res.status(500).json({ error: 'Failed' });
  }
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
