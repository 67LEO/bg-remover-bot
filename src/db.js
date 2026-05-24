const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function init() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      chat_id BIGINT PRIMARY KEY,
      first_name TEXT,
      username TEXT,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      total_uses INTEGER DEFAULT 0,
      is_premium BOOLEAN DEFAULT FALSE,
      premium_until TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS daily_usage (
      chat_id BIGINT,
      date DATE,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (chat_id, date)
    );
    CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY,
      referrer_id BIGINT NOT NULL,
      referee_id BIGINT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS images (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      original_size INTEGER,
      result_size INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('Database tables ready');
}

async function upsertUser(chatId, firstName, username) {
  await query(
    `INSERT INTO users (chat_id, first_name, username)
     VALUES ($1, $2, $3)
     ON CONFLICT (chat_id) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       username = EXCLUDED.username`,
    [chatId, firstName, username]
  );
}

async function getUsage(chatId) {
  const today = new Date().toISOString().split('T')[0];
  const r = await query('SELECT count FROM daily_usage WHERE chat_id = $1 AND date = $2', [chatId, today]);
  return r.rows[0]?.count || 0;
}

async function incrementUsage(chatId) {
  const today = new Date().toISOString().split('T')[0];
  await query(
    `INSERT INTO daily_usage (chat_id, date, count) VALUES ($1, $2, 1)
     ON CONFLICT (chat_id, date) DO UPDATE SET count = daily_usage.count + 1`,
    [chatId, today]
  );
  await query('UPDATE users SET total_uses = total_uses + 1 WHERE chat_id = $1', [chatId]);
}

async function logImage(chatId, originalSize, resultSize) {
  await query(
    'INSERT INTO images (chat_id, original_size, result_size) VALUES ($1, $2, $3)',
    [chatId, originalSize, resultSize]
  );
}

async function addReferral(referrerId, refereeId) {
  await query(
    'INSERT INTO referrals (referrer_id, referee_id) VALUES ($1, $2) ON CONFLICT (referee_id) DO NOTHING',
    [referrerId, refereeId]
  );
}

async function getReferralCount(chatId) {
  const r = await query('SELECT COUNT(*) as count FROM referrals WHERE referrer_id = $1', [chatId]);
  return parseInt(r.rows[0]?.count || '0');
}

async function getUserStats(chatId) {
  const r = await query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
  const user = r.rows[0];
  if (!user) return null;
  const dailyUsed = await getUsage(chatId);
  return {
    totalUses: user.total_uses,
    dailyUsed,
    dailyRemaining: Math.max(0, user.is_premium ? Infinity : require('./config').FREE_LIMIT_DAILY - dailyUsed),
    isPremium: !!user.is_premium,
    referrals: await getReferralCount(chatId),
    joinedAt: user.joined_at,
  };
}

async function getAllUsers() {
  const r = await query('SELECT chat_id, first_name, username, total_uses, is_premium, joined_at FROM users ORDER BY total_uses DESC');
  return r.rows;
}

async function getTotalStats() {
  const users = await query('SELECT COUNT(*) as count FROM users');
  const images = await query('SELECT COUNT(*) as count FROM images');
  const todayImages = await query("SELECT COUNT(*) as count FROM images WHERE created_at::date = CURRENT_DATE");
  return {
    totalUsers: parseInt(users.rows[0]?.count || '0'),
    totalImages: parseInt(images.rows[0]?.count || '0'),
    todayImages: parseInt(todayImages.rows[0]?.count || '0'),
  };
}

async function getDailyActiveCount() {
  const r = await query("SELECT COUNT(DISTINCT chat_id) as c FROM daily_usage WHERE date = CURRENT_DATE");
  return parseInt(r.rows[0]?.c || '0');
}

init();

module.exports = { upsertUser, getUsage, incrementUsage, logImage, addReferral, getReferralCount, getUserStats, getAllUsers, getTotalStats, getDailyActiveCount };
