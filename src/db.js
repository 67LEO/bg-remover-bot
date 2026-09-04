const { Pool } = require('pg');
require('dotenv').config();

const dbSsl = process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: dbSsl,
  max: 5,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

let dbReady = false;
let dbReadyQueue = [];

function whenReady() {
  if (dbReady) return Promise.resolve();
  return new Promise(resolve => dbReadyQueue.push(resolve));
}

async function query(text, params) {
  await whenReady();
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function init() {
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          chat_id BIGINT PRIMARY KEY,
          first_name TEXT,
          username TEXT,
          joined_at TIMESTAMPTZ DEFAULT NOW(),
          total_uses INTEGER DEFAULT 0,
          is_premium BOOLEAN DEFAULT FALSE,
          premium_until TIMESTAMPTZ,
          banned BOOLEAN DEFAULT FALSE,
          banned_reason TEXT
        );
        ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT FALSE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason TEXT;
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
          type TEXT NOT NULL DEFAULT 'bg_remove',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE images ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'bg_remove';
        CREATE TABLE IF NOT EXISTS support_tickets (
          id SERIAL PRIMARY KEY,
          chat_id BIGINT NOT NULL,
          message TEXT NOT NULL,
          status TEXT DEFAULT 'open',
          admin_reply TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          replied_at TIMESTAMPTZ,
          user_replied BOOLEAN DEFAULT FALSE
        );
        ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS user_replied BOOLEAN DEFAULT FALSE;
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
    } finally {
      client.release();
    }
    console.log('Database tables ready');
  } catch (err) {
    console.error('Database init error:', err.message);
  } finally {
    dbReady = true;
    dbReadyQueue.forEach(r => r());
    dbReadyQueue = [];
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

async function logImage(chatId, originalSize, resultSize, type = 'bg_remove') {
  await query(
    'INSERT INTO images (chat_id, original_size, result_size, type) VALUES ($1, $2, $3, $4)',
    [chatId, originalSize, resultSize, type]
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

async function checkPremiumExpiry(user) {
  if (user.is_premium && user.premium_until && new Date(user.premium_until) < new Date()) {
    await deactivateUser(user.chat_id);
    user.is_premium = false;
    user.premium_until = null;
  }
}

async function getUserStats(chatId) {
  const r = await query('SELECT * FROM users WHERE chat_id = $1', [chatId]);
  const user = r.rows[0];
  if (!user) return null;

  await checkPremiumExpiry(user);

  const dailyUsed = await getUsage(chatId);
  return {
    totalUses: user.total_uses,
    dailyUsed,
    dailyRemaining: Math.max(0, user.is_premium ? Infinity : require('./config').FREE_LIMIT_DAILY - dailyUsed),
    isPremium: !!user.is_premium,
    premiumUntil: user.premium_until,
    referrals: await getReferralCount(chatId),
    joinedAt: user.joined_at,
  };
}

async function getAllUsers() {
  const r = await query('SELECT chat_id, first_name, username, total_uses, is_premium, joined_at FROM users ORDER BY total_uses DESC');
  return r.rows;
}

async function searchUsers(query) {
  const q = `%${query}%`;
  const r = await query(
    `SELECT chat_id, first_name, username, total_uses, is_premium, banned AS is_banned, joined_at
     FROM users
     WHERE chat_id::TEXT = $1
        OR LOWER(username) LIKE LOWER($2)
        OR LOWER(first_name) LIKE LOWER($2)
     ORDER BY total_uses DESC
     LIMIT 20`,
    [query, q]
  );
  return r.rows;
}

async function getTotalStats() {
  const users = await query('SELECT COUNT(*) as count FROM users');
  const images = await query('SELECT COUNT(*) as count FROM images');
  const todayImages = await query("SELECT COUNT(*) as count FROM images WHERE created_at::date = CURRENT_DATE");
  const byType = await query('SELECT type, COUNT(*) as count FROM images GROUP BY type');
  const todayByType = await query("SELECT type, COUNT(*) as count FROM images WHERE created_at::date = CURRENT_DATE GROUP BY type");
  const fmt = (rows) => { const o = {}; rows.forEach(r => { o[r.type] = parseInt(r.count); }); return o; };
  return {
    totalUsers: parseInt(users.rows[0]?.count || '0'),
    totalImages: parseInt(images.rows[0]?.count || '0'),
    todayImages: parseInt(todayImages.rows[0]?.count || '0'),
    byType: fmt(byType.rows),
    todayByType: fmt(todayByType.rows),
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
     WHERE t.status IN ('open', 'replied')
     ORDER BY
       (t.status = 'replied' AND t.user_replied = true) DESC,
       CASE WHEN t.status = 'open' THEN 0 ELSE 1 END,
       t.id ASC`
  );
  return r.rows;
}

async function getUserOpenTicket(chatId) {
  const r = await query(
    `SELECT * FROM support_tickets
     WHERE chat_id = $1 AND status IN ('open', 'replied')
     ORDER BY id DESC LIMIT 1`,
    [chatId]
  );
  return r.rows[0] || null;
}

async function appendToTicket(id, message) {
  await query(
    `UPDATE support_tickets
     SET message = message || E'\\n\\n[New message] ' || $1,
         user_replied = true,
         status = 'open',
         replied_at = NULL
     WHERE id = $2`,
    [message, id]
  );
}

async function getUserTickets(chatId) {
  const r = await query(
    'SELECT id, message, status, admin_reply, created_at FROM support_tickets WHERE chat_id = $1 ORDER BY id DESC LIMIT 10',
    [chatId]
  );
  return r.rows;
}

async function getTicketById(id) {
  const r = await query('SELECT * FROM support_tickets WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function replyTicket(id, adminReply) {
  await query(
    "UPDATE support_tickets SET status = 'replied', admin_reply = $1, replied_at = NOW(), user_replied = false WHERE id = $2",
    [adminReply, id]
  );
}

async function closeTicket(id) {
  await query("UPDATE support_tickets SET status = 'closed' WHERE id = $1", [id]);
}

async function activatePremiumByAdmin(chatId, plan, ticketId, adminChatId) {
  const days = plan === 'yearly' ? 365 : 30;

  const userRows = await query('SELECT premium_until FROM users WHERE chat_id = $1', [chatId]);
  const existingUntil = userRows.rows[0]?.premium_until;
  const now = new Date();
  const baseDate = (existingUntil && new Date(existingUntil) > now) ? new Date(existingUntil) : now;
  const expiresAt = new Date(baseDate);
  expiresAt.setDate(expiresAt.getDate() + days);

  await query(
    'UPDATE users SET is_premium = true, premium_until = $1 WHERE chat_id = $2',
    [expiresAt, chatId]
  );

  await query(
    "UPDATE user_subscriptions SET active = false WHERE chat_id = $1 AND active = true",
    [chatId]
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
  const r = await query(
    `SELECT p.*, u.first_name, u.username
     FROM payment_orders p
     LEFT JOIN users u ON u.chat_id = p.chat_id
     WHERE p.order_ref = $1`,
    [orderRef]
  );
  return r.rows[0] || null;
}

async function getPendingPayments() {
  const r = await query(
    `SELECT p.*, u.first_name, u.username
     FROM payment_orders p
     LEFT JOIN users u ON u.chat_id = p.chat_id
     WHERE p.status = 'pending' AND p.screenshot_file_id IS NOT NULL
     ORDER BY p.id ASC`
  );
  return r.rows;
}

async function getOrders(filter) {
  const allowed = ['pending', 'confirmed', 'cancelled'];
  const status = allowed.includes(filter) ? filter : null;
  let sql, params;
  if (status === 'cancelled') {
    sql = `SELECT p.*, u.first_name, u.username FROM payment_orders p
           LEFT JOIN users u ON u.chat_id = p.chat_id
           WHERE p.status = 'cancelled' ORDER BY p.id DESC LIMIT 100`;
    params = [];
  } else if (status === 'confirmed' || status === 'pending') {
    sql = `SELECT p.*, u.first_name, u.username FROM payment_orders p
           LEFT JOIN users u ON u.chat_id = p.chat_id
           WHERE p.status = $1 ORDER BY p.id DESC LIMIT 100`;
    params = [status];
  } else {
    // all
    sql = `SELECT p.*, u.first_name, u.username FROM payment_orders p
           LEFT JOIN users u ON u.chat_id = p.chat_id
           ORDER BY p.id DESC LIMIT 100`;
    params = [];
  }
  const r = await query(sql, params);
  return r.rows;
}

async function deletePaymentOrder(orderRef) {
  const r = await query(
    'DELETE FROM payment_orders WHERE order_ref = $1 RETURNING id',
    [orderRef]
  );
  return r.rows.length > 0;
}

async function attachScreenshot(orderRef, fileId) {
  await query('UPDATE payment_orders SET screenshot_file_id = $1 WHERE order_ref = $2', [fileId, orderRef]);
}

async function resetPaymentScreenshot(orderRef) {
  await query('UPDATE payment_orders SET screenshot_file_id = NULL WHERE order_ref = $1', [orderRef]);
}

async function getUserPendingOrder(chatId) {
  const r = await query(
    `SELECT * FROM payment_orders
     WHERE chat_id = $1 AND status = 'pending' AND screenshot_file_id IS NULL
     ORDER BY id DESC LIMIT 1`,
    [chatId]
  );
  return r.rows[0] || null;
}

async function cancelPaymentOrder(orderRef) {
  await query("UPDATE payment_orders SET status = 'cancelled' WHERE order_ref = $1", [orderRef]);
}

async function revertPaymentOrder(orderRef) {
  await query(
    "UPDATE payment_orders SET status = 'pending', confirmed_at = NULL WHERE order_ref = $1",
    [orderRef]
  );
}

async function confirmPaymentOrder(orderRef, plan) {
  const order = await getPaymentOrderByRef(orderRef);
  if (!order) throw new Error('Order not found');
  if (order.status !== 'pending') throw new Error('Order already processed');

  const days = plan === 'yearly' ? 365 : 30;

  const userRows = await query('SELECT premium_until FROM users WHERE chat_id = $1', [order.chat_id]);
  const existingUntil = userRows.rows[0]?.premium_until;
  const now = new Date();
  const baseDate = (existingUntil && new Date(existingUntil) > now) ? new Date(existingUntil) : now;
  const expiresAt = new Date(baseDate);
  expiresAt.setDate(expiresAt.getDate() + days);

  await query(
    'UPDATE users SET is_premium = true, premium_until = $1 WHERE chat_id = $2',
    [expiresAt, order.chat_id]
  );

  await query(
    "UPDATE user_subscriptions SET active = false WHERE chat_id = $1 AND active = true",
    [order.chat_id]
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

async function deactivateUser(chatId) {
  await query(
    "UPDATE users SET is_premium = false, premium_until = NULL WHERE chat_id = $1",
    [chatId]
  );
  await query(
    "UPDATE user_subscriptions SET active = false WHERE chat_id = $1 AND active = true",
    [chatId]
  );
}

async function getUserCount() {
  const r = await query('SELECT COUNT(*) as count FROM users');
  return parseInt(r.rows[0]?.count || '0');
}

async function getPremiumUsers() {
  const r = await query(
    `SELECT DISTINCT ON (u.chat_id) u.chat_id, u.first_name, u.username, u.premium_until,
            s.plan, s.activated_by, s.ticket_id, p.order_ref, p.screenshot_file_id
     FROM users u
     LEFT JOIN LATERAL (
       SELECT plan, activated_by, ticket_id FROM user_subscriptions
       WHERE chat_id = u.chat_id AND active = true
       ORDER BY expires_at DESC NULLS LAST LIMIT 1
     ) s ON true
     LEFT JOIN LATERAL (
       SELECT order_ref, screenshot_file_id FROM payment_orders
       WHERE chat_id = u.chat_id AND status = 'confirmed'
       ORDER BY confirmed_at DESC LIMIT 1
     ) p ON true
     WHERE u.is_premium = true
     ORDER BY u.chat_id`
  );
  return r.rows;
}

async function banUser(chatId, reason = '') {
  await query(
    'UPDATE users SET banned = true, banned_reason = $2 WHERE chat_id = $1',
    [chatId, reason]
  );
}

async function unbanUser(chatId) {
  await query(
    'UPDATE users SET banned = false, banned_reason = NULL WHERE chat_id = $1',
    [chatId]
  );
}

async function getBannedUsers() {
  const r = await query(
    `SELECT chat_id, first_name, username, banned_reason, total_uses
     FROM users WHERE banned = true ORDER BY total_uses DESC LIMIT 50`
  );
  return r.rows;
}

async function isBanned(chatId) {
  const r = await query('SELECT banned FROM users WHERE chat_id = $1', [chatId]);
  return !!(r.rows[0]?.banned);
}

async function getExpiringPremium(daysAhead) {
  const cutoff = new Date(Date.now() + daysAhead * 86400000);
  const r = await query(
    `SELECT chat_id, first_name, username, premium_until
     FROM users
     WHERE is_premium = true
       AND premium_until IS NOT NULL
       AND premium_until > NOW()
       AND premium_until <= $1
     ORDER BY premium_until ASC`,
    [cutoff]
  );
  return r.rows;
}

async function getDailyReport() {
  const r = await query(
    `SELECT
      (SELECT COUNT(*) FROM users WHERE joined_at::date = CURRENT_DATE - 1) AS new_users,
      (SELECT COUNT(*) FROM images WHERE created_at::date = CURRENT_DATE - 1) AS ops,
      (SELECT COUNT(DISTINCT chat_id) FROM daily_usage WHERE date = CURRENT_DATE - 1) AS active_users,
      (SELECT COUNT(*) FROM payment_orders WHERE status = 'confirmed' AND confirmed_at::date = CURRENT_DATE - 1) AS confirmed_orders,
      (SELECT COALESCE(SUM(amount),0) FROM payment_orders WHERE status = 'confirmed' AND confirmed_at::date = CURRENT_DATE - 1) AS revenue,
      (SELECT COUNT(*) FROM payment_orders WHERE status = 'pending' AND screenshot_file_id IS NOT NULL) AS pending_reviews,
      (SELECT COUNT(*) FROM support_tickets WHERE created_at::date = CURRENT_DATE - 1) AS new_tickets
    `
  );
  return r.rows[0] || null;
}

async function getUserProfile(chatId) {
  const u = await query(
    `SELECT u.*,
            (SELECT COUNT(*) FROM referrals WHERE referrer_id = u.chat_id) AS referrals,
            (SELECT COUNT(*) FROM daily_usage WHERE chat_id = u.chat_id AND date = CURRENT_DATE) AS today_used
     FROM users u WHERE u.chat_id = $1`,
    [chatId]
  );
  if (!u.rows[0]) return null;
  const user = u.rows[0];

  const orders = await query(
    `SELECT order_ref, plan, amount, status, created_at FROM payment_orders
     WHERE chat_id = $1 ORDER BY id DESC LIMIT 5`,
    [chatId]
  );
  const subs = await query(
    `SELECT plan, activated_by, expires_at, active FROM user_subscriptions
     WHERE chat_id = $1 ORDER BY id DESC LIMIT 3`,
    [chatId]
  );
  const tickets = await query(
    `SELECT id, status, created_at FROM support_tickets
     WHERE chat_id = $1 ORDER BY id DESC LIMIT 3`,
    [chatId]
  );
  const images = await query(
    `SELECT type, created_at FROM images WHERE chat_id = $1 ORDER BY id DESC LIMIT 5`,
    [chatId]
  );

  return {
    chat_id: Number(user.chat_id),
    first_name: user.first_name,
    username: user.username,
    total_uses: user.total_uses,
    today_used: parseInt(user.today_used || '0'),
    referrals: parseInt(user.referrals || '0'),
    is_premium: user.is_premium,
    premium_until: user.premium_until,
    banned: user.banned,
    banned_reason: user.banned_reason,
    joined_at: user.joined_at,
    orders: orders.rows,
    subs: subs.rows,
    tickets: tickets.rows,
    images: images.rows,
  };
}

async function initWebTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS web_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        display_name TEXT,
        avatar_url TEXT,
        auth_provider TEXT DEFAULT 'email',
        google_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS web_daily_usage (
        user_id UUID REFERENCES web_users(id) ON DELETE CASCADE,
        date DATE DEFAULT CURRENT_DATE,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, date)
      );
    `);
    await client.query(`
      ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS web_user_id UUID REFERENCES web_users(id) ON DELETE CASCADE
    `);
    await client.query(`
      ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS web_user_id UUID REFERENCES web_users(id) ON DELETE CASCADE
    `);
    await client.query(`
      ALTER TABLE images ADD COLUMN IF NOT EXISTS web_user_id UUID REFERENCES web_users(id) ON DELETE CASCADE
    `);
    await client.query(`
      ALTER TABLE payment_orders ALTER COLUMN chat_id DROP NOT NULL
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS anon_daily_usage (
        anon_id TEXT,
        date DATE DEFAULT CURRENT_DATE,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (anon_id, date)
      );
    `);
    console.log('Web tables ready');
  } catch (err) {
    console.error('Web tables init error:', err.message);
  } finally {
    client.release();
  }
}

async function createWebUser(email, passwordHash, displayName, provider = 'email', googleId = null) {
  const r = await query(
    `INSERT INTO web_users (email, password_hash, display_name, auth_provider, google_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, email, display_name, auth_provider, created_at`,
    [email, passwordHash, displayName, provider, googleId]
  );
  return r.rows[0];
}

async function findWebUserByEmail(email) {
  const r = await query('SELECT * FROM web_users WHERE email = $1', [email]);
  return r.rows[0] || null;
}

async function findWebUserById(id) {
  const r = await query('SELECT * FROM web_users WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function findWebUserByGoogleId(googleId) {
  const r = await query('SELECT * FROM web_users WHERE google_id = $1', [googleId]);
  return r.rows[0] || null;
}

async function updateWebUserLogin(id) {
  await query('UPDATE web_users SET last_login = NOW() WHERE id = $1', [id]);
}

async function getWebUsage(userId) {
  const today = new Date().toISOString().split('T')[0];
  const r = await query('SELECT count FROM web_daily_usage WHERE user_id = $1 AND date = $2', [userId, today]);
  return r.rows[0]?.count || 0;
}

async function incrementWebUsage(userId) {
  const today = new Date().toISOString().split('T')[0];
  await query(
    `INSERT INTO web_daily_usage (user_id, date, count) VALUES ($1, $2, 1)
     ON CONFLICT (user_id, date) DO UPDATE SET count = web_daily_usage.count + 1`,
    [userId, today]
  );
}

async function getWebUserStats(userId) {
  const user = await findWebUserById(userId);
  if (!user) return null;

  const webSubs = await query(
    `SELECT * FROM user_subscriptions
     WHERE web_user_id = $1 AND active = true
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY expires_at DESC NULLS LAST LIMIT 1`,
    [userId]
  );
  const isPremium = webSubs.rows.length > 0;
  const dailyUsed = await getWebUsage(userId);
  const freeLimit = require('./config').FREE_LIMIT_DAILY;
  return {
    totalUses: 0,
    dailyUsed,
    dailyRemaining: isPremium ? Infinity : Math.max(0, freeLimit - dailyUsed),
    isPremium,
    premiumUntil: webSubs.rows[0]?.expires_at || null,
  };
}

async function getAnonUsage(anonId) {
  const today = new Date().toISOString().split('T')[0];
  const r = await query('SELECT count FROM anon_daily_usage WHERE anon_id = $1 AND date = $2', [anonId, today]);
  return r.rows[0]?.count || 0;
}

async function incrementAnonUsage(anonId) {
  const today = new Date().toISOString().split('T')[0];
  await query(
    `INSERT INTO anon_daily_usage (anon_id, date, count) VALUES ($1, $2, 1)
     ON CONFLICT (anon_id, date) DO UPDATE SET count = anon_daily_usage.count + 1`,
    [anonId, today]
  );
}

async function cleanupOldUsage() {
  try {
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    const r1 = await query('DELETE FROM daily_usage WHERE date < $1', [cutoff]);
    const r2 = await query('DELETE FROM web_daily_usage WHERE date < $1', [cutoff]);
    const r3 = await query('DELETE FROM anon_daily_usage WHERE date < $1', [cutoff]);
    if (r1.rowCount > 0 || r2.rowCount > 0 || r3.rowCount > 0) {
      console.log(`Cleanup: removed ${r1.rowCount + r2.rowCount + r3.rowCount} old usage rows`);
    }
  } catch {}
}

init();
initWebTables();
cleanupOldUsage();
setInterval(cleanupOldUsage, 86400000);

module.exports = {
  pool, query,
  upsertUser, getUsage, incrementUsage, logImage, addReferral,
  getReferralCount, getUserStats, getAllUsers, getPremiumUsers,
  searchUsers, getUserCount,
  getTotalStats, getDailyActiveCount, createTicket, getOpenTickets,
  getUserOpenTicket, appendToTicket, getUserTickets,
  getTicketById, replyTicket, closeTicket, activatePremiumByAdmin,
  getUserSubscriptions, createPaymentOrder, getPaymentOrderByRef,
  getPendingPayments, getOrders, deletePaymentOrder, attachScreenshot, resetPaymentScreenshot,
  getUserPendingOrder, cancelPaymentOrder, revertPaymentOrder,
  confirmPaymentOrder, deactivateUser,
  banUser, unbanUser, getBannedUsers, isBanned,
  getExpiringPremium, getDailyReport, getUserProfile,
  createWebUser, findWebUserByEmail, findWebUserById,
  findWebUserByGoogleId, updateWebUserLogin, getWebUsage,
  incrementWebUsage, getWebUserStats,
  getAnonUsage, incrementAnonUsage,
};
