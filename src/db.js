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
  try {
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
      CREATE TABLE IF NOT EXISTS support_tickets (
        id SERIAL PRIMARY KEY,
        chat_id BIGINT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        admin_reply TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        replied_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS user_subscriptions (
        id SERIAL PRIMARY KEY,
        chat_id BIGINT NOT NULL,
        feature TEXT NOT NULL DEFAULT 'all_access',
        plan TEXT NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        starts_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        activated_by TEXT DEFAULT 'admin',
        ticket_id INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS payment_orders (
        id SERIAL PRIMARY KEY,
        order_ref TEXT UNIQUE NOT NULL,
        chat_id BIGINT NOT NULL,
        plan TEXT NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        screenshot_file_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        confirmed_at TIMESTAMPTZ
      );
    `);
    console.log('Database tables ready');
  } catch (err) {
    console.error('Database init error:', err.message);
  }
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

async function createTicket(chatId, message) {
  const r = await query(
    'INSERT INTO support_tickets (chat_id, message) VALUES ($1, $2) RETURNING id',
    [chatId, message]
  );
  return r.rows[0].id;
}

async function getOpenTickets() {
  const r = await query(
    `SELECT t.*, u.first_name, u.username
     FROM support_tickets t
     LEFT JOIN users u ON u.chat_id = t.chat_id
     WHERE t.status = 'open'
     ORDER BY t.id ASC`
  );
  return r.rows;
}

async function getTicketById(id) {
  const r = await query('SELECT * FROM support_tickets WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function replyTicket(id, adminReply) {
  await query(
    "UPDATE support_tickets SET status = 'replied', admin_reply = $1, replied_at = NOW() WHERE id = $2",
    [adminReply, id]
  );
}

async function closeTicket(id) {
  await query("UPDATE support_tickets SET status = 'closed' WHERE id = $1", [id]);
}

async function activatePremiumByAdmin(chatId, plan, ticketId, adminChatId) {
  const days = plan === 'yearly' ? 365 : 30;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);

  await query(
    'UPDATE users SET is_premium = true, premium_until = $1 WHERE chat_id = $2',
    [expiresAt, chatId]
  );

  await query(
    `INSERT INTO user_subscriptions (chat_id, feature, plan, expires_at, activated_by, ticket_id)
     VALUES ($1, 'all_access', $2, $3, 'admin', $4)`,
    [chatId, plan, expiresAt, ticketId]
  );

  await closeTicket(ticketId);

  return { days, expiresAt };
}

async function getUserSubscriptions(chatId) {
  const r = await query(
    `SELECT * FROM user_subscriptions
     WHERE chat_id = $1 AND active = true
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY expires_at DESC NULLS LAST`,
    [chatId]
  );
  return r.rows;
}

async function createPaymentOrder(orderRef, chatId, plan, amount) {
  await query(
    'INSERT INTO payment_orders (order_ref, chat_id, plan, amount) VALUES ($1, $2, $3, $4)',
    [orderRef, chatId, plan, amount]
  );
}

async function getPaymentOrderByRef(orderRef) {
  const r = await query('SELECT * FROM payment_orders WHERE order_ref = $1', [orderRef]);
  return r.rows[0] || null;
}

async function getPendingPayments() {
  const r = await query(
    `SELECT p.*, u.first_name, u.username
     FROM payment_orders p
     LEFT JOIN users u ON u.chat_id = p.chat_id
     WHERE p.status = 'pending'
     ORDER BY p.id ASC`
  );
  return r.rows;
}

async function attachScreenshot(orderRef, fileId) {
  await query('UPDATE payment_orders SET screenshot_file_id = $1 WHERE order_ref = $2', [fileId, orderRef]);
}

async function cancelPaymentOrder(orderRef) {
  await query("UPDATE payment_orders SET status = 'cancelled' WHERE order_ref = $1", [orderRef]);
}

async function confirmPaymentOrder(orderRef, plan) {
  const order = await getPaymentOrderByRef(orderRef);
  if (!order) throw new Error('Order not found');
  if (order.status !== 'pending') throw new Error('Order already processed');

  const days = plan === 'yearly' ? 365 : 30;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);

  await query(
    'UPDATE users SET is_premium = true, premium_until = $1 WHERE chat_id = $2',
    [expiresAt, order.chat_id]
  );

  await query(
    `INSERT INTO user_subscriptions (chat_id, feature, plan, expires_at, activated_by)
     VALUES ($1, 'all_access', $2, $3, 'payment')`,
    [order.chat_id, plan, expiresAt]
  );

  await query(
    "UPDATE payment_orders SET status = 'confirmed', confirmed_at = NOW() WHERE order_ref = $1",
    [orderRef]
  );

  return { chat_id: order.chat_id, days, expiresAt, ref: orderRef };
}

init();

module.exports = { upsertUser, getUsage, incrementUsage, logImage, addReferral, getReferralCount, getUserStats, getAllUsers, getTotalStats, getDailyActiveCount, createTicket, getOpenTickets, getTicketById, replyTicket, closeTicket, activatePremiumByAdmin, getUserSubscriptions, createPaymentOrder, getPaymentOrderByRef, getPendingPayments, attachScreenshot, cancelPaymentOrder, confirmPaymentOrder };
