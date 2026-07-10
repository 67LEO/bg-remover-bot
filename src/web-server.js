require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const db = require('./db');

const app = express();

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

const staticDir = path.join(__dirname, '..', 'website', 'dist');
app.use(express.static(staticDir));
app.get('/{*path}', (req, res) => {
  const indexPath = path.join(staticDir, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(404).end('Not found');
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Web server on port ${PORT}`);
});
