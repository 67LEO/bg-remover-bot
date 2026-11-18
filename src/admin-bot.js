const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const db = require('./db');
const { msUntilNextIST } = require('./schedule');

if (!config.ADMIN_BOT_TOKEN) {
  console.error('ADMIN_BOT_TOKEN not set — admin bot disabled');
  module.exports = null;
} else {

const bot = new Telegraf(config.ADMIN_BOT_TOKEN);
const mainBot = new Telegraf(config.BOT_TOKEN);

// Polyfill getMe to avoid API call on every handleUpdate (Render free tier network issue)
const adminBotId = parseInt(config.ADMIN_BOT_TOKEN.split(':')[0]);
bot.telegram.getMe = async () => ({ id: adminBotId, is_bot: true, first_name: 'Admin', username: 'Ai_bg_adminBot' });

const ADMIN_ID = config.ADMIN_CHAT_ID;
let lastError = null;

const broadcastPending = new Map();

const escMd = config.escMd;

bot.use((ctx, next) => {
  if (ctx.chat.id === ADMIN_ID) return next();
});

bot.start(async (ctx) => {
  await ctx.replyWithMarkdown(
    '🔐 *Admin Bot Ready*\n\n' +
    '🤖 *Main Bot Features:*\n' +
    '   🖼️ Background Remover — send any photo\n' +
    '   🔍 4x HD Upscale — /upscale then send photo\n' +
    '   🎨 AI Image Gen — /imagine your prompt\n' +
    '   🎤 AI Voice Gen — /voice (14 languages)\n' +
    '   🎬 AI Video Gen — /video your prompt\n' +
    '   🖼️ AI Background Replace — 🎨 AI BG after remove\n' +
    '   🎁 Credits: 10 free every day, +3 per ad, +3 per referral (/share)\n\n' +
    '📋 *Admin Commands:*\n' +
    '   /admin — Bot analytics\n' +
    '   /tickets — Support threads (open/replied)\n' +
    '   /reply `<id>` `<msg>` — Reply to ticket\n' +
    '   /close `<id>` — Close ticket\n' +
    '   /users [page] — List all users\n' +
    '   /find `<name | @username | chat_id>` — Search user & get chat_id\n' +
    '   /profile `<chat_id>` — User details\n' +
    '   /ban `<chat_id>` · /unban `<chat_id>` · /banned\n' +
    '   /send `<chat_id>` `<msg>` — DM a user\n' +
    '   /broadcast `<msg>` — Message all users\n' +
    '   /debug — System status\n\n' +
    '⚠️ Feature errors and a summary of yesterday (8 AM IST) arrive here automatically.'
  );
});

bot.command('admin', async (ctx) => {
  const total = await db.getTotalStats();
  const users = await db.getAllUsers();
  const dailyActive = await db.getDailyActiveCount();
  const openTickets = (await db.getOpenTickets()).length;

  const typeLabels = { bg_remove: 'Background', upscale: 'Upscale', imagine: 'AI Image', video: 'AI Video', ai_bg: 'AI BG Replace' };
  const fmtType = (t) => typeLabels[t] || escMd(t);
  const breakdown = (obj) => Object.entries(obj).map(([k, v]) => `${fmtType(k)}: ${v}`).join(', ');

  let msg = '📊 *Bot Analytics*\n\n';
  msg += `👥 Total users: *${total.totalUsers}*\n`;
  msg += `🖼️ Total operations: *${total.totalImages}*\n`;
  msg += `   ${breakdown(total.byType)}\n`;
  msg += `📸 Today: *${total.todayImages}*\n`;
  msg += `   ${breakdown(total.todayByType)}\n`;
  msg += `📊 Today active: *${dailyActive}*\n\n`;

  const top = users.slice(0, 5);
  msg += '*Top 5 Users:*\n';
  top.forEach((u, i) => {
    const name = escMd(u.first_name || u.username || 'User');
    msg += `${i + 1}. ${name} — ${u.total_uses} images\n`;
  });

  msg += `\n🎫 Open tickets: ${openTickets}`;

  await ctx.replyWithMarkdown(msg, adminNav);
});

const adminNav = Markup.inlineKeyboard([
  [Markup.button.callback('📋 Tickets', 'adm_tickets'), Markup.button.callback('👥 Users', 'adm_users')],
  [Markup.button.callback('⛔ Banned', 'adm_banned'), Markup.button.callback('🔧 Debug', 'adm_debug')],
  [Markup.button.callback('📢 Broadcast', 'adm_broadcast'), Markup.button.callback('📤 Send', 'adm_send')],
]);

function navRow() {
  return [[Markup.button.callback('🏠 Menu', 'adm_menu')]];
}

async function ticketsText() {
  const tickets = await db.getOpenTickets();
  if (!tickets.length) return '✅ No open/replied tickets.';
  let msg = `📋 *Support Threads (${tickets.length})*\n\n`;
  tickets.slice(0, 8).forEach(t => {
    const name = escMd(t.first_name || t.username || `User ${t.chat_id}`);
    const flag = t.status === 'open' && t.user_replied ? '🔵 NEW' : (t.status === 'replied' && t.user_replied ? '🟢 WAITING' : (t.status === 'replied' ? '💬 Replied' : '🆕 Open'));
    msg += `#${t.id} — ${name} [${flag}]\n» ${escMd(t.message).split('\n').slice(-1)[0].substring(0, 50)}${t.user_replied ? '…' : ''}\n\n`;
  });
  msg += 'Use `/reply <id> <msg>` or `/close <id>`';
  return msg;
}

async function usersText(page) {
  const allUsers = await db.getAllUsers();
  const total = allUsers.length;
  const perPage = 8;
  const totalPages = Math.ceil(total / perPage) || 1;
  const start = (page - 1) * perPage;
  const slice = allUsers.slice(start, start + perPage);

  let msg = `👥 *Users (Page ${page}/${totalPages})* — Total: ${total}\n\n`;
  slice.forEach((u, i) => {
    const name = escMd(u.first_name || u.username || 'User');
    const premium = '';
    msg += `${start + i + 1}. ${name}\n   🆔 \`${u.chat_id}\` — ${u.total_uses} uses${premium}\n\n`;
  });
  return msg;
}

async function bannedText() {
  const banned = await db.getBannedUsers();
  if (!banned.length) return '✅ No banned users.';
  let msg = `⛔ *Banned Users (${banned.length})*\n\n`;
  banned.slice(0, 10).forEach((u, i) => {
    const name = escMd(u.first_name || u.username || `User ${u.chat_id}`);
    msg += `${i + 1}. ${name}\n   🆔 \`${u.chat_id}\``;
    if (u.banned_reason) msg += `\n   💬 ${escMd(u.banned_reason.substring(0, 50))}`;
    msg += '\n\n';
  });
  if (banned.length > 10) msg += `...and ${banned.length - 10} more\n`;
  msg += 'Unban: /unban <chat_id>';
  return msg;
}

function debugText() {
  const vars = [
    ['ADMIN_BOT_TOKEN', !!config.ADMIN_BOT_TOKEN],
    ['DATABASE_URL', !!process.env.DATABASE_URL],
  ];
  let msg = '*Admin Bot Status*\n';
  vars.forEach(([k, v]) => msg += `${escMd(k)}: ${v ? '✅' : '❌'}\n`);
  msg += `\nNode: ${process.version}`;
  if (lastError) msg += `\n\nLast error:\n${escMd(lastError.substring(0, 200))}`;
  return msg;
}

bot.action('adm_menu', async (ctx) => {
  await ctx.answerCbQuery();
  const total = await db.getTotalStats();
  await ctx.editMessageText(
    `📊 *Bot Analytics*\n\n👥 Users: *${total.totalUsers}*\n🖼️ Ops: *${total.totalImages}*\n📸 Today: *${total.todayImages}*`,
    { parse_mode: 'Markdown', reply_markup: adminNav.reply_markup }
  );
});

bot.action('adm_tickets', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(await ticketsText(), { reply_markup: { inline_keyboard: navRow() } });
});

bot.action('adm_users', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(await usersText(1), { reply_markup: { inline_keyboard: navRow() } });
});

bot.action('adm_banned', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(await bannedText(), { reply_markup: { inline_keyboard: navRow() } });
});

bot.action('adm_broadcast', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📢 Type /broadcast <message> to send to all users.');
});

bot.action('adm_send', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('📤 Type /send <chat_id> <message> to DM a user.');
});

bot.action('adm_debug', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(debugText());
});

bot.command('tickets', async (ctx) => {
  const tickets = await db.getOpenTickets();
  if (!tickets.length) return ctx.reply('✅ No open tickets.');

  let msg = `📋 *Support Threads (${tickets.length})*\n\n`;
  tickets.slice(0, 12).forEach(t => {
    const name = escMd(t.first_name || t.username || `User ${t.chat_id}`);
    const flag = t.status === 'open' && t.user_replied ? '🔵 NEW' : (t.status === 'replied' && t.user_replied ? '🟢 WAITING' : (t.status === 'replied' ? '💬 Replied' : '🆕 Open'));
    msg += `#${t.id} — ${name} [${flag}]\n» ${escMd(t.message).split('\n').slice(-1)[0].substring(0, 60)}${t.user_replied ? '…' : ''}\n\n`;
  });
  if (tickets.length > 12) msg += `...and ${tickets.length - 12} more\n`;
  msg += 'Use `/reply <id> <msg>` or `/close <id>`\n';
  msg += 'Users can keep adding to the same ticket until closed.';

  await ctx.replyWithMarkdown(msg);
});

bot.command('users', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const perPage = 10;

  if (parts[1]?.toLowerCase() === 'search') {
    const q = parts.slice(2).join(' ').trim();
    if (!q) return ctx.reply('Usage: /users search <name | username | chat_id>\n\nExample: /users search mohit');
    const results = await db.searchUsers(q);
    if (!results.length) return ctx.reply(`🔍 No users found matching \`${escMd(q)}\`.`);

    let msg = `🔍 *Search: "${escMd(q)}"* — ${results.length} result(s)\n\n`;
    const rows = [];
    results.slice(0, 10).forEach((u, i) => {
      const name = escMd(u.first_name || u.username || 'User');
      const premium = '';
      const banned = u.is_banned ? ' ⛔' : '';
      msg += `${i + 1}. ${name}\n   🆔 \`${u.chat_id}\` — ${u.total_uses} uses${premium}${banned}\n\n`;
      rows.push([Markup.button.callback(`👤 ${u.first_name || u.username || u.chat_id}`, `user_${u.chat_id}`)]);
    });
    msg += 'Use /profile <chat_id> for details';
    return await ctx.replyWithMarkdown(msg, { reply_markup: { inline_keyboard: rows } });
  }

  const page = Math.max(1, parseInt(parts[1]) || 1);

  const allUsers = await db.getAllUsers();
  const total = allUsers.length;
  const totalPages = Math.ceil(total / perPage) || 1;
  const start = (page - 1) * perPage;
  const slice = allUsers.slice(start, start + perPage);

  let msg = `👥 *Users (Page ${page}/${totalPages})* — Total: ${total}\n\n`;
  slice.forEach((u, i) => {
    const name = escMd(u.first_name || u.username || 'User');
    const premium = '';
    msg += `${start + i + 1}. ${name}\n   🆔 \`${u.chat_id}\` — ${u.total_uses} uses${premium}\n\n`;
  });

  if (page < totalPages) msg += `Next: /users ${page + 1}\n`;
  msg += 'Search: /users search <query>';
  await ctx.replyWithMarkdown(msg);
});

bot.command('find', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const q = parts.slice(1).join(' ').trim();
  if (!q) return ctx.reply('Usage: /find <name | @username | chat_id>\n\nExample: /find mohit');

  const results = await db.searchUsers(q.trim().replace(/^@/, ''));
  if (!results.length) return ctx.reply(`🔍 No users found matching \`${escMd(q)}\`.`);

  let msg = `🔎 *Search: "${escMd(q)}"* — ${results.length} result(s)\n\n`;
  const rows = [];
  results.forEach((u, i) => {
    const name = escMd(u.first_name || u.username || 'User');
    const premium = '';
    const banned = u.is_banned ? ' ⛔' : '';
    msg += `${i + 1}. ${name}${premium}${banned}\n   🆔 \`${u.chat_id}\`\n`;
    if (u.username) msg += `   @${escMd(u.username)} · ${u.total_uses} uses\n\n`;
    else msg += `   ${u.total_uses} uses\n\n`;
    rows.push([Markup.button.callback(`👤 ${u.first_name || u.username || u.chat_id}`, `user_${u.chat_id}`)]);
  });
  msg += 'Tap a button for full profile →';
  return await ctx.replyWithMarkdown(msg, { reply_markup: { inline_keyboard: rows } });
});

async function sendScreenshotToAdmin(fileId, caption) {
  const fileLink = await mainBot.telegram.getFileLink(fileId);
  const res = await fetch(fileLink.href, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return await bot.telegram.sendPhoto(ADMIN_ID, { source: buf }, { caption, parse_mode: 'Markdown' });
}

bot.command('send', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply('Usage: /send <chat_id> <message>');

  const rawId = parts[1].trim();
  const targetId = parseInt(rawId);
  if (isNaN(targetId)) return ctx.reply(`❌ Invalid chat ID: \`${rawId}\``);

  const text = parts.slice(2).join(' ').trim();
  if (!text) return ctx.reply('❌ Message cannot be empty');

  try {
    await mainBot.telegram.sendMessage(targetId, text);
    await ctx.replyWithMarkdown(`✅ Message sent to \`${targetId}\``);
  } catch (err) {
    lastError = err.message;
    await ctx.reply('❌ Failed to send message. User may have blocked the bot.');
  }
});

bot.command('broadcast', async (ctx) => {
  const text = ctx.message.text.slice('/broadcast'.length).trim();
  if (!text) return ctx.reply('Usage: /broadcast <message>');

  const allUsers = await db.getAllUsers();
  const total = allUsers.length;

  broadcastPending.set('message', text);
  broadcastPending.set('userCount', total);

  await ctx.replyWithMarkdown(
    `📢 *Broadcast Preview*\n\nMessage:\n${escMd(text.substring(0, 200))}\n\nWill send to *${total} users*\n\nType \`/confirm_broadcast\` to proceed or \`/cancel_broadcast\` to abort.`
  );
});

bot.command('confirm_broadcast', async (ctx) => {
  if (!broadcastPending.has('message')) {
    return ctx.reply('❌ No pending broadcast. Use /broadcast first.');
  }

  const msg = broadcastPending.get('message');
  const allUsers = await db.getAllUsers();
  const total = allUsers.length;

  await ctx.reply(`📢 Broadcasting to ${total} users...`);

  let sent = 0;
  let failed = 0;
  const failedChatIds = [];

  for (const user of allUsers) {
    try {
      await mainBot.telegram.sendMessage(user.chat_id, msg);
      sent++;
      await new Promise(r => setTimeout(r, 50));
    } catch {
      failed++;
      failedChatIds.push(user.chat_id);
    }
  }

  broadcastPending.delete('message');
  broadcastPending.delete('userCount');

  let result = `✅ *Broadcast complete*\n\n📤 Sent: *${sent}* (${total})\n❌ Failed: *${failed}*`;
  if (failedChatIds.length > 0) {
    result += `\n\n❌ Failed users:\n\`${failedChatIds.join(', ')}\``;
  }
  await ctx.replyWithMarkdown(result);
});

bot.command('cancel_broadcast', async (ctx) => {
  if (!broadcastPending.has('message')) return ctx.reply('No pending broadcast.');
  broadcastPending.delete('message');
  broadcastPending.delete('userCount');
  await ctx.reply('✅ Broadcast cancelled.');
});

bot.command('ban', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) return ctx.reply('Usage: /ban <chat_id> [reason]\n\nExample: /ban 1859416028 Spam abuse');

  const targetId = parseInt(parts[1].trim());
  if (isNaN(targetId)) return ctx.reply('❌ Invalid chat ID.');

  const reason = parts.slice(2).join(' ').trim() || 'No reason';
  try {
    await db.banUser(targetId, reason);
    await ctx.replyWithMarkdown(`⛔ *User banned — \`${targetId}\`*\n\n💬 Reason: ${escMd(reason)}\n\nTo unban: /unban ${targetId}`);

    try {
      await mainBot.telegram.sendMessage(
        targetId,
        `⛔ Your access to AI Image Editor Bot has been *blocked*.\n\nIf you think this is a mistake, contact support: /support`,
        { parse_mode: 'Markdown' }
      );
    } catch {}
  } catch (err) {
    lastError = err.message;
    await ctx.reply('❌ Error banning user.');
  }
});

bot.command('unban', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) return ctx.reply('Usage: /unban <chat_id>\n\nExample: /unban 1859416028');

  const targetId = parseInt(parts[1].trim());
  if (isNaN(targetId)) return ctx.reply('❌ Invalid chat ID.');

  try {
    await db.unbanUser(targetId);
    await ctx.reply(`✅ User \`${targetId}\` unbanned.`);
  } catch (err) {
    await ctx.reply('❌ Error unbanning user.');
  }
});

bot.command('banned', async (ctx) => {
  await ctx.replyWithMarkdown(await bannedText(), { reply_markup: { inline_keyboard: navRow() } });
});

bot.command('profile', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) return ctx.reply('Usage: /profile <chat_id>\n\nShows user details, credits, tickets & recent activity.');

  const targetId = parseInt(parts[1].trim());
  if (isNaN(targetId)) return ctx.reply('❌ Invalid chat ID.');

  const msg = await profileText(targetId);
  await ctx.replyWithMarkdown(msg, { reply_markup: profileNav(targetId).reply_markup });
});

async function profileText(chatId) {
  const u = await db.getUserProfile(chatId);
  if (!u) return `❌ User \`${chatId}\` not found.`;

  const name = escMd(u.first_name || u.username || 'User');
  let msg = `👤 *${name}*\n`;
  msg += `🆔 \`${u.chat_id}\`\n`;
  if (u.username) msg += `@${escMd(u.username)}\n`;
  msg += `📅 Joined: ${u.joined_at ? new Date(u.joined_at).toDateString() : '—'}\n\n`;
  msg += `📊 Total: *${u.total_uses}* | Today: *${u.today_used}*\n`;
  msg += `👥 Referrals: *${u.referrals}*\n`;
  msg += `🎯 Credits left today: *${u.credits ?? '—'}*\n`;
  msg += u.banned ? `⛔ *BANNED*${u.banned_reason ? ` — ${escMd(u.banned_reason)}` : ''}\n` : '';

  if (u.tickets.length) {
    msg += `\n🎫 *Tickets:*\n`;
    u.tickets.forEach(t => msg += `» #${t.id} — ${escMd(t.status)}\n`);
  }
  if (u.images.length) {
    msg += `\n🖼️ *Recent activity:*\n`;
    u.images.forEach(i => msg += `» ${escMd(i.type)} — ${new Date(i.created_at).toDateString()}\n`);
  }
  return msg;
}

function profileNav(chatId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✉️ DM', `send_${chatId}`),
      Markup.button.callback('⛔ Ban', `ban_${chatId}`),
    ],
    [Markup.button.callback('🏠 Menu', 'adm_menu')],
  ]);
}

bot.action(/user_(\d+)/, async (ctx) => {
  const chatId = ctx.match[1];
  const msg = await profileText(chatId);
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(msg, { reply_markup: profileNav(chatId).reply_markup });
});

bot.action(/send_(\d+)/, async (ctx) => {
  const chatId = ctx.match[1];
  await ctx.answerCbQuery('Type message below');
  await ctx.reply(`📤 Send message to \`${chatId}\`:\n\nType: /send ${chatId} <your message>`);
});

bot.action(/ban_(\d+)/, async (ctx) => {
  const chatId = ctx.match[1];
  await ctx.answerCbQuery('Type reason below');
  await ctx.reply(`⛔ Ban \`${chatId}\`:\n\nType: /ban ${chatId} <reason>`);
});

bot.command('reply', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply('Usage: /reply <ticket_id> <your message>');

  const ticketId = parseInt(parts[1]);
  if (isNaN(ticketId)) return ctx.reply('❌ Invalid ticket ID');

  const replyMsg = parts.slice(2).join(' ').trim();
  if (!replyMsg) return ctx.reply('❌ Reply message cannot be empty');

  const ticket = await db.getTicketById(ticketId);
  if (!ticket) return ctx.reply('❌ Ticket not found');
  if (ticket.status === 'closed') return ctx.reply('❌ Ticket is already closed');

  await db.replyTicket(ticketId, replyMsg);
  try {
    await mainBot.telegram.sendMessage(
      ticket.chat_id,
      `📬 *Reply to your ticket #${ticketId}*\n\n${escMd(replyMsg)}\n\nNeed more help? Send /support`,
      { parse_mode: 'Markdown' }
    );
    await ctx.reply(`✅ Reply sent to ticket #${ticketId}`);
  } catch {
    await ctx.reply(`⚠️ Reply saved but couldn't deliver to user (they may have blocked the bot). Ticket #${ticketId}`);
  }
});

bot.command('close', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) return ctx.reply('Usage: /close <ticket_id>');

  const ticketId = parseInt(parts[1]);
  if (isNaN(ticketId)) return ctx.reply('❌ Invalid ticket ID');

  const ticket = await db.getTicketById(ticketId);
  if (!ticket) return ctx.reply('❌ Ticket not found');

  await db.closeTicket(ticketId);
  await ctx.reply(`✅ Ticket #${ticketId} closed.`);

  try {
    await mainBot.telegram.sendMessage(
      ticket.chat_id,
      `✅ *Ticket #${ticketId} has been closed.*\n\nIf you have more questions, send /support anytime!`,
      { parse_mode: 'Markdown' }
    );
  } catch {}
});

bot.command('debug', async (ctx) => {
  await ctx.reply(debugText(), { parse_mode: 'Markdown', reply_markup: { inline_keyboard: navRow() } });
});

bot.telegram.setMyCommands([
  { command: 'admin', description: '📊 Bot analytics' },
  { command: 'tickets', description: '📋 Open/replied support threads' },
  { command: 'reply', description: '💬 Reply to support ticket' },
  { command: 'close', description: '🔒 Close support ticket' },
  { command: 'users', description: '👥 List all users' },
  { command: 'find', description: '🔎 Find user by name & get chat_id' },
  { command: 'profile', description: '👤 User details' },
  { command: 'ban', description: '⛔ Ban a user' },
  { command: 'unban', description: '✅ Unban a user' },
  { command: 'send', description: '📤 DM a user' },
  { command: 'broadcast', description: '📢 Message all users' },
  { command: 'debug', description: '🔧 System status' },
]).catch(err => console.error('Admin bot setMyCommands failed:', err.message));

// ---- Auto reports (daily) ----
async function sendDailyReport() {
  if (!ADMIN_ID) return;
  try {
    const r = await db.getDailyReport();
    if (!r) return;
    let msg = `📊 *Yesterday's Summary*\n\n`;
    msg += `👥 New users: *${parseInt(r.new_users || 0)}*\n`;
    msg += `📊 Active users: *${parseInt(r.active_users || 0)}*\n`;
    msg += `🖼️ Operations: *${parseInt(r.ops || 0)}*\n`;
    msg += `🎬 Ad rewards: *${parseInt(r.ad_rewards || 0)}*\n`;
    msg += `🎫 New tickets: *${parseInt(r.new_tickets || 0)}*\n`;
    await bot.telegram.sendMessage(ADMIN_ID, msg, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Daily report error:', err.message);
  }
}

// One summary of yesterday, every morning at 8:00 India time (not the server's clock, which is UTC on Belmo).
// The next run is computed again after each send, so a long-running process doesn't drift.
function scheduleDailyReport() {
  setTimeout(async () => {
    await sendDailyReport();
    scheduleDailyReport();
  }, msUntilNextIST(8, 0));
}
scheduleDailyReport();

module.exports = bot;
}