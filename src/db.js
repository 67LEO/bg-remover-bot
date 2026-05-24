const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'bot.db');

let db;

function init() {
  const fs = require('fs');
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      chat_id INTEGER PRIMARY KEY,
      first_name TEXT,
      username TEXT,
      joined_at TEXT DEFAULT (datetime('now')),
      total_uses INTEGER DEFAULT 0,
      is_premium INTEGER DEFAULT 0,
      premium_until TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_usage (
      chat_id INTEGER,
      date TEXT,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (chat_id, date)
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER NOT NULL,
      referee_id INTEGER NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (referrer_id) REFERENCES users(chat_id),
      FOREIGN KEY (referee_id) REFERENCES users(chat_id)
    );

    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      original_size INTEGER,
      result_size INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (chat_id) REFERENCES users(chat_id)
    );
  `);
}

function upsertUser(chatId, firstName, username) {
  const stmt = db.prepare(`
    INSERT INTO users (chat_id, first_name, username) 
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      first_name = excluded.first_name,
      username = excluded.username
  `);
  stmt.run(chatId, firstName, username);
}

function getUsage(chatId) {
  const today = new Date().toISOString().split('T')[0];
  const row = db.prepare('SELECT count FROM daily_usage WHERE chat_id = ? AND date = ?').get(chatId, today);
  return row?.count || 0;
}

function incrementUsage(chatId) {
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO daily_usage (chat_id, date, count) VALUES (?, ?, 1)
    ON CONFLICT(chat_id, date) DO UPDATE SET count = count + 1
  `).run(chatId, today);
  db.prepare('UPDATE users SET total_uses = total_uses + 1 WHERE chat_id = ?').run(chatId);
}

function logImage(chatId, originalSize, resultSize) {
  db.prepare('INSERT INTO images (chat_id, original_size, result_size) VALUES (?, ?, ?)').run(chatId, originalSize, resultSize);
}

function addReferral(referrerId, refereeId) {
  db.prepare('INSERT OR IGNORE INTO referrals (referrer_id, referee_id) VALUES (?, ?)').run(referrerId, refereeId);
}

function getReferralCount(chatId) {
  const row = db.prepare('SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?').get(chatId);
  return row?.count || 0;
}

function getUserStats(chatId) {
  const user = db.prepare('SELECT * FROM users WHERE chat_id = ?').get(chatId);
  if (!user) return null;
  const dailyUsed = getUsage(chatId);
  return {
    totalUses: user.total_uses,
    dailyUsed,
    dailyRemaining: Math.max(0, user.is_premium ? Infinity : require('./config').FREE_LIMIT_DAILY - dailyUsed),
    isPremium: !!user.is_premium,
    referrals: getReferralCount(chatId),
    joinedAt: user.joined_at,
  };
}

function getAllUsers() {
  return db.prepare('SELECT chat_id, first_name, username, total_uses, is_premium, joined_at FROM users ORDER BY total_uses DESC').all();
}

function getTotalStats() {
  const users = db.prepare('SELECT COUNT(*) as count FROM users').get();
  const images = db.prepare('SELECT COUNT(*) as count FROM images').get();
  const todayImages = db.prepare("SELECT COUNT(*) as count FROM images WHERE date(created_at) = date('now')").get();
  return {
    totalUsers: users.count,
    totalImages: images.count,
    todayImages: todayImages.count,
  };
}

function getDailyActiveCount() {
  const today = new Date().toISOString().split('T')[0];
  const row = db.prepare('SELECT COUNT(DISTINCT chat_id) as c FROM daily_usage WHERE date=?').get(today);
  return row?.c || 0;
}

init();

module.exports = { upsertUser, getUsage, incrementUsage, logImage, addReferral, getReferralCount, getUserStats, getAllUsers, getTotalStats, getDailyActiveCount };
