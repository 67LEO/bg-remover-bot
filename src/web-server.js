require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const db = require('./db');

const app = express();
// Requests arrive via the bot server's proxy on loopback; trust it so req.ip is the real client IP (rate limits, ad caps)
app.set('trust proxy', 'loopback');

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.SITE_URL || true)
    : ['http://localhost:5173', 'http://localhost:3000'],
}));
app.use(express.json({ limit: '1mb' }));

const ipRateMap = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ipRateMap) {
    if (now - v.ts > 60000) ipRateMap.delete(k);
  }
}, 30000);

app.use((req, res, next) => {
  if (req.url.startsWith('/api/')) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = ipRateMap.get(ip);
    if (entry && now - entry.ts < 60000) {
      if (entry.count >= 30) {
        return res.status(429).json({ error: 'Too many requests' });
      }
      entry.count++;
    } else {
      ipRateMap.set(ip, { ts: now, count: 1 });
    }
  }
  next();
});

const { router: webApi } = require('./web-api');
app.use('/api', webApi);

app.get('/health', async (req, res) => {
  try {
    await db.getUserCount();
    res.status(200).send('OK');
  } catch {
    res.status(503).send('DB DOWN');
  }
});

// Telegram Mini App page that plays the AdsGram video ad (opened from the bot's "Watch Ad" button)
app.get('/earn', (req, res) => {
  const adsgramBlock = String(process.env.ADSGRAM_MINIAPP_BLOCK_ID || '').replace(/\D/g, '');
  const monetagZone = String(process.env.MONETAG_ZONE_ID || '').replace(/\D/g, '');
  // Networks that are set up, tried in this order (AD_PROVIDERS can reorder or limit them, e.g. "adsgram,monetag")
  const providers = String(process.env.AD_PROVIDERS || 'monetag,adsgram').split(',').map(s => s.trim())
    .filter((p, i, a) => a.indexOf(p) === i && ((p === 'monetag' && monetagZone) || (p === 'adsgram' && adsgramBlock)));
  const cfg = JSON.stringify({
    providers, monetagZone, adsgramBlock,
    debug: process.env.ADSGRAM_MINIAPP_DEBUG === '1', // AdsGram test platform: test ads, not counted
  }).replace(/</g, '\\u003c');
  // Monetag wants exactly one SDK tag on the page
  const monetagTag = monetagZone && providers.includes('monetag')
    ? `<script src='//libtl.com/sdk.js' data-zone='${monetagZone}' data-sdk='show_${monetagZone}'></script>` : '';
  let html;
  try {
    html = require('fs').readFileSync(path.join(__dirname, 'earn.html'), 'utf8');
  } catch {
    return res.status(404).end('Not found');
  }
  res.set('Cache-Control', 'no-store').type('html').send(html.replace('__CFG__', () => cfg).replace('__MONETAG_TAG__', () => monetagTag));
});

const staticDir = path.join(__dirname, '..', 'website', 'dist');
app.use(express.static(staticDir));
app.get('/{*path}', (req, res) => {
  const indexPath = path.join(staticDir, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(404).end('Not found');
  });
});

const PORT = process.env.WEB_PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`Web server on port ${PORT}`);
});
// Don't take the bot down if the port is taken (e.g. web-server.js also started separately)
server.on('error', (err) => console.error('Web server failed to start:', err.message));
