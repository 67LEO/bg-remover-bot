const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const db = require('./db');

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
    '   📊 Referral: /share for unlimited free usage\n' +
    '   💳 Premium: /premium (₹49/mo, ₹499/yr)\n\n' +
    '📋 *Admin Commands:*\n' +
    '   /tickets — Support threads (open/replied)\n' +
    '   /payments [page] — Pending payment orders with screenshot\n' +
    '   /orders [filter] — All orders (pending/confirmed/cancelled/all)\n' +
    '   /delorder `<ref>` — Delete a payment order\n' +
    '   /premiumusers — Active premium users\n' +
    '   /users [page] — List all users\n' +
    '   /users search `<query>` — Search users\n' +
    '   /request `<ref>` `<reason>` — Ask user for new screenshot\n' +
    '   /activate `<id|ref>` `<plan>` — Activate premium\n' +
    '   /deactivate `<chat_id>` — Remove premium\n' +
    '   /reply `<id>` `<msg>` — Reply to ticket\n' +
    '   /close `<id>` — Close ticket\n' +
    '   /send `<chat_id>` `<msg>` — DM any user\n' +
    '   /broadcast `<msg>` — Broadcast to all users\n' +
    '   /admin — Bot analytics\n' +
    '   /debug — System status'
  );
});

bot.command('admin', async (ctx) => {
  const total = await db.getTotalStats();
  const users = await db.getAllUsers();
  const dailyActive = await db.getDailyActiveCount();
  const pending = (await db.getPendingPayments()).length;
  const openTickets = (await db.getOpenTickets()).length;
  const expiring = (await db.getExpiringPremium(5)).length;

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
    msg += `${i + 1}. ${name} — ${u.total_uses} images${u.is_premium ? ' 👑' : ''}\n`;
  });

  msg += `\n⏳ To review: ${pending} payments · ${openTickets} tickets\n`;
  msg += `⚠️ ${expiring} premiums expire in 5 days`;

  await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([
    [Markup.button.callback('📋 Tickets', 'adm_tickets'), Markup.button.callback('💳 Payments', 'adm_payments')],
    [Markup.button.callback('👑 Premium', 'adm_premium'), Markup.button.callback('👥 Users', 'adm_users')],
    [Markup.button.callback('🗑️ Orders', 'adm_orders'), Markup.button.callback('⛔ Banned', 'adm_banned')],
    [Markup.button.callback('📢 Broadcast', 'adm_broadcast'), Markup.button.callback('📤 Send', 'adm_send')],
    [Markup.button.callback('🔧 Debug', 'adm_debug')],
  ]));
});

const adminNav = Markup.inlineKeyboard([
  [Markup.button.callback('📋 Tickets', 'adm_tickets'), Markup.button.callback('💳 Payments', 'adm_payments')],
  [Markup.button.callback('👑 Premium', 'adm_premium'), Markup.button.callback('👥 Users', 'adm_users')],
  [Markup.button.callback('🗑️ Orders', 'adm_orders'), Markup.button.callback('⛔ Banned', 'adm_banned')],
  [Markup.button.callback('📢 Broadcast', 'adm_broadcast'), Markup.button.callback('📤 Send', 'adm_send')],
  [Markup.button.callback('🔧 Debug', 'adm_debug')],
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

async function paymentsText() {
  const orders = await db.getPendingPayments();
  if (!orders.length) return '✅ No pending payments with screenshots.\n\nSee ALL orders with /orders';
  let msg = `📋 *Pending Payments (${orders.length})*\n\n`;
  orders.slice(0, 8).forEach(o => {
    const name = escMd(o.first_name || o.username || `User ${o.chat_id}`);
    msg += `${o.order_ref} — ${name} — ₹${o.amount}\n`;
    msg += `» ${o.plan} | ${new Date(o.created_at).toLocaleDateString()}\n\n`;
  });
  if (orders.length > 8) msg += `...and ${orders.length - 8} more\n`;
  msg += 'Use `/activate <ref> <plan>`';
  return msg;
}

async function premiumText() {
  const usersData = await db.getPremiumUsers();
  if (!usersData.length) return 'No premium users.';
  let msg = `👑 *Premium Users (${usersData.length})*\n\n`;
  usersData.slice(0, 8).forEach((u, i) => {
    const name = escMd(u.first_name || u.username || 'User');
    const plan = u.plan || '—';
    const expired = u.premium_until ? new Date(u.premium_until).toLocaleDateString() : 'Lifetime';
    msg += `${i + 1}. ${name}\n   🆔 \`${u.chat_id}\` — ${plan} | ${expired}\n`;
  });
  if (usersData.length > 8) msg += `...showing first 8\n`;
  msg += 'Use /premiumusers for full list';
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
    const premium = u.is_premium ? ' 👑' : '';
    msg += `${start + i + 1}. ${name}\n   🆔 \`${u.chat_id}\` — ${u.total_uses} uses${premium}\n\n`;
  });
  return msg;
}

async function ordersText(filter) {
  const orders = await db.getOrders(filter);
  if (!orders.length) return `✅ No orders found${filter && filter !== 'all' ? ` (${filter})` : ''}.`;
  const labelMap = { pending: '🟡 Pending', confirmed: '✅ Confirmed', cancelled: '❌ Cancelled' };
  const total = orders.length;
  let msg = `📋 *Orders${filter && filter !== 'all' ? ` (${filter})` : ''}* — Total: ${total}\n\n`;
  orders.slice(0, 8).forEach(o => {
    const name = escMd(o.first_name || o.username || `User ${o.chat_id}`);
    msg += `${o.order_ref} — ${name} — ₹${o.amount}\n`;
    msg += `» ${labelMap[o.status] || o.status} | ${o.plan}\n\n`;
  });
  if (orders.length > 8) msg += `...showing first 8\n`;
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

bot.action('adm_payments', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(await paymentsText(), { reply_markup: { inline_keyboard: navRow() } });
});

bot.action('adm_premium', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(await premiumText(), { reply_markup: { inline_keyboard: navRow() } });
});

bot.action('adm_users', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(await usersText(1), { reply_markup: { inline_keyboard: navRow() } });
});

bot.action('adm_orders', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(await ordersText('all'), { reply_markup: { inline_keyboard: navRow() } });
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

bot.command('payments', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const page = Math.max(1, parseInt(parts[1]) || 1);
  const perPage = 5;

  const allOrders = await db.getPendingPayments();
  if (!allOrders.length) return ctx.reply('✅ No pending payments with screenshots.\n\nSee ALL orders with /orders');

  const total = allOrders.length;
  const totalPages = Math.ceil(total / perPage) || 1;
  const start = (page - 1) * perPage;
  const slice = allOrders.slice(start, start + perPage);

  let msg = `📋 *Pending Payments (Page ${page}/${totalPages})* — Total: ${total}\n\n`;
  const rows = [];
  slice.forEach(o => {
    const name = escMd(o.first_name || o.username || `User ${o.chat_id}`);
    msg += `${o.order_ref} — ${name} — ₹${o.amount}\n`;
    msg += `» ${o.plan} | ${new Date(o.created_at).toLocaleDateString()}\n`;
    msg += `🆔 \`${o.chat_id}\`\n\n`;
    rows.push(
      [Markup.button.callback(`✅ M ${o.order_ref}`, `ord_ap_m_${o.order_ref}`),
       Markup.button.callback(`✅ Y ${o.order_ref}`, `ord_ap_y_${o.order_ref}`),
       Markup.button.callback(`❌ Rej`, `ord_rej_${o.order_ref}`)]
    );
  });

  const navRowBtns = [];
  if (page > 1) navRowBtns.push(Markup.button.callback('⬅️ Prev', `pay_page_${page - 1}`));
  if (page < totalPages) navRowBtns.push(Markup.button.callback('Next ➡️', `pay_page_${page + 1}`));
  if (navRowBtns.length) rows.push(navRowBtns);

  rows.push([Markup.button.callback('🏠 Menu', 'adm_menu')]);
  await ctx.replyWithMarkdown(msg, { reply_markup: { inline_keyboard: rows } });
});

bot.action(/pay_page_(\d+)/, async (ctx) => {
  const page = parseInt(ctx.match[1]);
  const allOrders = await db.getPendingPayments();
  if (!allOrders.length) return ctx.answerCbQuery('No pending payments');

  const perPage = 5;
  const total = allOrders.length;
  const totalPages = Math.ceil(total / perPage) || 1;
  const start = (page - 1) * perPage;
  const slice = allOrders.slice(start, start + perPage);

  let msg = `📋 *Pending Payments (Page ${page}/${totalPages})* — Total: ${total}\n\n`;
  const rows = [];
  slice.forEach(o => {
    const name = escMd(o.first_name || o.username || `User ${o.chat_id}`);
    msg += `${o.order_ref} — ${name} — ₹${o.amount}\n`;
    msg += `» ${o.plan} | ${new Date(o.created_at).toLocaleDateString()}\n`;
    msg += `🆔 \`${o.chat_id}\`\n\n`;
    rows.push(
      [Markup.button.callback(`✅ M ${o.order_ref}`, `ord_ap_m_${o.order_ref}`),
       Markup.button.callback(`✅ Y ${o.order_ref}`, `ord_ap_y_${o.order_ref}`),
       Markup.button.callback(`❌ Rej`, `ord_rej_${o.order_ref}`)]
    );
  });

  const navRowBtns = [];
  if (page > 1) navRowBtns.push(Markup.button.callback('⬅️ Prev', `pay_page_${page - 1}`));
  if (page < totalPages) navRowBtns.push(Markup.button.callback('Next ➡️', `pay_page_${page + 1}`));
  if (navRowBtns.length) rows.push(navRowBtns);
  rows.push([Markup.button.callback('🏠 Menu', 'adm_menu')]);

  await ctx.answerCbQuery();
  await ctx.editMessageText(msg, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
});

bot.action(/ord_ap_m_(.+)/, async (ctx) => {
  const orderRef = ctx.match[1];
  await approveOrder(ctx, orderRef, 'monthly');
});

bot.action(/ord_ap_y_(.+)/, async (ctx) => {
  const orderRef = ctx.match[1];
  await approveOrder(ctx, orderRef, 'yearly');
});

async function approveOrder(ctx, orderRef, plan) {
  try {
    const order = await db.getPaymentOrderByRef(orderRef);
    if (!order) return ctx.answerCbQuery('Order not found');
    if (order.status !== 'pending') return ctx.answerCbQuery('Order already processed');

    const result = await db.confirmPaymentOrder(orderRef, plan);
    const planLabel = plan === 'monthly' ? 'Monthly' : 'Yearly';

    await ctx.answerCbQuery(`✅ Approved ${planLabel}`);

    const name = escMd(order.first_name || order.username || `User ${order.chat_id}`);
    await ctx.answerCbQuery();
    await ctx.replyWithMarkdown(`✅ *Premium Activated!*\n\n📦 Order: ${orderRef}\n👤 ${name}\n📆 Plan: ${planLabel}\n✅ Done.`);

    await mainBot.telegram.sendMessage(
      result.chat_id,
      `🎉 *Congratulations!* 🎉\n\nYour *${planLabel} Premium* plan has been activated!\n📆 Duration: ${plan === 'monthly' ? '30 days' : '365 days'} unlimited\n\n✨ Unlimited background removal\n✨ 4x HD Upscale\n✨ AI Image Generation\n✨ AI Background Replace\n✨ AI Voice Generation\n✨ AI Video Generation\n\n🔹 /stats — Check your status\n🔹 /share — Earn more rewards\n\nThank you for your support! 🙏`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  } catch (err) {
    lastError = err.message;
    await ctx.answerCbQuery('❌ Error');
    await ctx.reply('❌ Error approving. Check order status.');
  }
}

bot.action(/ord_rej_(.+)/, async (ctx) => {
  const orderRef = ctx.match[1];
  try {
    const order = await db.getPaymentOrderByRef(orderRef);
    if (!order) return ctx.answerCbQuery('Order not found');
    await db.resetPaymentScreenshot(orderRef);
    const name = escMd(order.first_name || order.username || `User ${order.chat_id}`);
    await ctx.answerCbQuery('❌ Screenshot rejected');
    await ctx.replyWithMarkdown(`❌ *Screenshot Rejected — ${orderRef}*\n\n👤 ${name}\nScreenshot cleared. Send /request ${orderRef} <reason> to ask user for a new one.`);
  } catch (err) {
    await ctx.answerCbQuery('❌ Error');
  }
});

bot.command('orders', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const filter = (parts[1] || '').toLowerCase();
  const orders = await db.getOrders(filter);
  if (!orders.length) return ctx.reply(`✅ No orders found${filter ? ` (${filter})` : ''}.`);

  const labelMap = { pending: '🟡 Pending', confirmed: '✅ Confirmed', cancelled: '❌ Cancelled' };
  const total = orders.length;

  let msg = `📋 *Orders${filter ? ` (${filter})` : ''}* — Total: ${total}\n\n`;
  orders.slice(0, 20).forEach(o => {
    const name = escMd(o.first_name || o.username || `User ${o.chat_id}`);
    const status = labelMap[o.status] || o.status;
    msg += `${o.order_ref} — ${name} — ₹${o.amount}\n`;
    msg += `» ${status} | ${o.plan} | ${new Date(o.created_at).toLocaleDateString()}\n\n`;
  });
  if (orders.length > 20) msg += `...showing first 20\n`;

  msg += 'Filters: /orders pending | confirmed | cancelled | all\n';
  msg += 'Delete: /delorder <ref>';
  await ctx.replyWithMarkdown(msg);
});

bot.command('delorder', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) return ctx.reply('Usage: /delorder <order_ref>\n\nExample: /delorder BG-A7X3K');

  const orderRef = parts[1].toUpperCase();
  try {
    const deleted = await db.deletePaymentOrder(orderRef);
    if (!deleted) return ctx.reply(`❌ Order \`${orderRef}\` not found.`);
    await ctx.reply(`✅ Order \`${orderRef}\` deleted permanently.`);
  } catch (err) {
    lastError = err.message;
    await ctx.reply('❌ Error deleting order.');
  }
});

bot.command('premiumusers', async (ctx) => {
  const users = await db.getPremiumUsers();
  if (!users.length) return ctx.reply('No premium users.');

  let msg = `👑 *Premium Users (${users.length})*\n\n`;
  users.slice(0, 20).forEach((u, i) => {
    const name = escMd(u.first_name || u.username || 'User');
    const plan = u.plan || '—';
    const expired = u.premium_until ? new Date(u.premium_until).toLocaleDateString() : 'Lifetime';
    const ref = u.order_ref || (u.ticket_id ? `Ticket #${u.ticket_id}` : '—');
    msg += `${i + 1}. ${name}\n`;
    msg += `   🆔 \`${u.chat_id}\`\n`;
    msg += `   📆 ${plan} | Exp: ${expired}\n`;
    msg += `   🔖 ${ref}\n\n`;
  });
  if (users.length > 20) msg += `...showing first 20\n`;
  msg += 'Use `/deactivate <chat_id>` to remove premium';

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
      const premium = u.is_premium ? ' 👑' : '';
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
    const premium = u.is_premium ? ' 👑' : '';
    msg += `${start + i + 1}. ${name}\n   🆔 \`${u.chat_id}\` — ${u.total_uses} uses${premium}\n\n`;
  });

  if (page < totalPages) msg += `Next: /users ${page + 1}\n`;
  msg += 'Search: /users search <query>';
  await ctx.replyWithMarkdown(msg);
});

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

bot.command('deactivate', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) return ctx.reply('Usage: /deactivate <chat_id>\n\nTo find chat_id, use /premiumusers');

  const rawId = parts[1].trim();
  const targetId = parseInt(rawId);
  if (isNaN(targetId)) return ctx.reply(`❌ Invalid chat ID: \`${rawId}\`\n\nUse /premiumusers to see user IDs.`);

  try {
    await db.deactivateUser(targetId);
    await ctx.reply(`✅ Premium deactivated for \`${targetId}\``);

    try {
      await mainBot.telegram.sendMessage(
        targetId,
        `ℹ️ Your premium plan has ended. Thanks for your support!\n\nGet premium again? /premium`,
        { parse_mode: 'Markdown' }
      );
    } catch {}
  } catch (err) {
    lastError = err.message;
    await ctx.reply('❌ Error deactivating premium.');
  }
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
  if (parts.length < 2) return ctx.reply('Usage: /profile <chat_id>\n\nShows full user details, orders, subscription, tickets & recent activity.');

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
  msg += `👑 Premium: *${u.is_premium ? 'Yes' : 'No'}*${u.premium_until ? ` (till ${new Date(u.premium_until).toDateString()})` : ''}\n`;
  msg += u.banned ? `⛔ *BANNED*${u.banned_reason ? ` — ${escMd(u.banned_reason)}` : ''}\n` : '';

  if (u.orders.length) {
    msg += `\n🧾 *Recent Orders:*\n`;
    u.orders.forEach(o => msg += `» ${o.order_ref} — ${o.plan} ₹${o.amount} — ${o.status}\n`);
  }
  if (u.subs.length) {
    msg += `\n📆 *Subscriptions:*\n`;
    u.subs.forEach(s => msg += `» ${s.plan} (${s.activated_by}) — ${s.expires_at ? new Date(s.expires_at).toDateString() : 'lifetime'} — ${s.active ? 'active' : 'inactive'}\n`);
  }
  if (u.tickets.length) {
    msg += `\n🎫 *Tickets:*\n`;
    u.tickets.forEach(t => msg += `» #${t.id} — ${t.status}\n`);
  }
  if (u.images.length) {
    msg += `\n🖼️ *Recent activity:*\n`;
    u.images.forEach(i => msg += `» ${i.type} — ${new Date(i.created_at).toDateString()}\n`);
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

bot.command('request', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply('Usage: /request <order_ref> <reason>\n\nClears the screenshot and asks the user to send a new one.\n\nExample: /request BG-A7X3K Screenshot is blurry, please send clear photo');

  const orderRef = parts[1].toUpperCase();
  const reason = parts.slice(2).join(' ').trim();

  const order = await db.getPaymentOrderByRef(orderRef);
  if (!order) return ctx.reply('❌ Order not found.');

  if (order.status === 'confirmed') {
    await db.deactivateUser(order.chat_id);
    await db.revertPaymentOrder(orderRef);
    await db.resetPaymentScreenshot(orderRef);

    const displayName = escMd(order.first_name || order.username || `User ${order.chat_id}`);
    await ctx.replyWithMarkdown(
      `🔄 *Order Reverted — ${orderRef}*\n\n` +
      `👤 ${displayName}\n` +
      `💬 Reason: ${escMd(reason)}\n\n` +
      `✅ Premium deactivated\n✅ Order reverted to pending\n✅ Screenshot cleared\n\nUser will be asked to send a new screenshot.`
    );

    try {
      await mainBot.telegram.sendMessage(
        order.chat_id,
        `📸 *Payment Screenshot Rejected*\n\n` +
        `Your payment for *${orderRef}* was previously approved but the screenshot was found invalid.\n\n` +
        `📌 *Reason:* ${escMd(reason)}\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `👉 Please send a *new clear payment screenshot* (📸 PHOTO) here to get premium again.\n` +
        `━━━━━━━━━━━━━━━━━━━\n\n` +
        `Have questions? Send /support`,
        { parse_mode: 'Markdown' }
      );
    } catch {
      await ctx.reply('⚠️ Could not notify user (they may have blocked the bot).');
    }
    return;
  }

  if (order.status !== 'pending') return ctx.reply(`❌ Order is already ${order.status}.`);

  await db.resetPaymentScreenshot(orderRef);

  const displayName = escMd(order.first_name || order.username || `User ${order.chat_id}`);
  await ctx.replyWithMarkdown(
    `✅ Screenshot cleared for *${orderRef}*\n\n` +
    `👤 ${displayName}\n💬 Reason: ${escMd(reason)}\n\nUser will be notified to send a new screenshot.`
  );

  try {
    await mainBot.telegram.sendMessage(
      order.chat_id,
      `📸 *Payment Screenshot Rejected*\n\n` +
      `Your payment screenshot for *${orderRef}* was *not accepted*.\n\n` +
      `📌 *Reason:* ${escMd(reason)}\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `👉 Please send a *new clear payment screenshot* (📸 PHOTO) here.\n` +
      `━━━━━━━━━━━━━━━━━━━\n\n` +
      `Have questions? Send /support`,
      { parse_mode: 'Markdown' }
    );
  } catch {
    await ctx.reply('⚠️ Could not notify user (they may have blocked the bot).');
  }
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

bot.command('activate', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply('Usage: /activate <ticket_id|order_ref> <plan>\nPlans: monthly (30d), yearly (365d)\n\nExamples:\n/activate 5 monthly   — via ticket #5\n/activate BG-A7X3K monthly — via payment order');

  const ident = parts[1];
  const plan = parts[2]?.toLowerCase();

  if (plan !== 'monthly' && plan !== 'yearly') return ctx.reply('❌ Invalid plan. Use: monthly or yearly');

  const planLabel = plan === 'monthly' ? 'Monthly' : 'Yearly';
  let userChatId;
  let sourceInfo;

  try {
    if (/^BG-/i.test(ident)) {
      const orderRef = ident.toUpperCase();
      const order = await db.getPaymentOrderByRef(orderRef);
      if (!order) return ctx.reply('❌ Order not found');
      if (order.status !== 'pending') return ctx.reply('❌ Order already processed (' + order.status + ')');

      const result = await db.confirmPaymentOrder(orderRef, plan);
      userChatId = result.chat_id;
      sourceInfo = `📦 Order: ${orderRef}`;
    } else {
      const ticketId = parseInt(ident);
      if (isNaN(ticketId)) return ctx.reply('❌ Invalid ID. Use a ticket number or BG- order ref');

      const ticket = await db.getTicketById(ticketId);
      if (!ticket) return ctx.reply('❌ Ticket not found');
      if (ticket.status === 'closed') return ctx.reply('❌ Ticket is already closed');

      const result = await db.activatePremiumByAdmin(ticket.chat_id, plan, ticketId, ctx.chat.id);
      userChatId = result.chat_id;
      sourceInfo = `🎫 Ticket #${ticketId}`;
    }

    await ctx.replyWithMarkdown(
      `✅ *Premium Activated!*\n\n${sourceInfo}\n📆 Plan: ${planLabel}\n✅ Done.`
    );

    await mainBot.telegram.sendMessage(
      userChatId,
      `🎉 *Congratulations!* 🎉\n\nYour *${planLabel} Premium* plan has been activated!\n📆 Duration: ${plan === 'monthly' ? '30 days' : '365 days'} unlimited\n\n✨ Unlimited background removal\n✨ 4x HD Upscale\n✨ AI Image Generation\n✨ AI Background Replace\n✨ AI Voice Generation\n✨ AI Video Generation\n\n🔹 /stats — Check your status\n🔹 /share — Earn more rewards\n\nThank you for your support! 🙏`,
      { parse_mode: 'Markdown' }
    ).catch(() => {
      ctx.reply('⚠️ Premium activated but user may have blocked the bot.');
    });
  } catch (err) {
    lastError = err.message;
    await ctx.reply('❌ Error activating premium. Check the ID and try again.');
  }
});

bot.command('debug', async (ctx) => {
  await ctx.reply(debugText(), { parse_mode: 'Markdown', reply_markup: { inline_keyboard: navRow() } });
});

bot.telegram.setMyCommands([
  { command: 'tickets', description: '📋 Open/replied support threads' },
  { command: 'orders', description: '💳 All orders (pending/confirmed/cancelled)' },
  { command: 'delorder', description: '🗑️ Delete a payment order by ref' },
  { command: 'premiumusers', description: '👑 Active premium users' },
  { command: 'users', description: '👥 List or search all users' },
  { command: 'profile', description: '👤 User drill-down profile' },
  { command: 'banned', description: '⛔ List banned users' },
  { command: 'ban', description: '⛔ Ban a user' },
  { command: 'unban', description: '✅ Unban a user' },
  { command: 'request', description: '📸 Ask user for new screenshot' },
  { command: 'activate', description: '✅ Activate premium (ticket/order)' },
  { command: 'deactivate', description: '❌ Remove premium from user' },
  { command: 'reply', description: '💬 Reply to support ticket' },
  { command: 'close', description: '🔒 Close support ticket' },
  { command: 'send', description: '📤 DM any user' },
  { command: 'broadcast', description: '📢 Broadcast to all users' },
  { command: 'admin', description: '📊 Bot analytics' },
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
    msg += `🖼️ Operations: *${parseInt(r.ops || 0)}*\n`;
    msg += `📊 Active users: *${parseInt(r.active_users || 0)}*\n`;
    msg += `💳 Confirmed orders: *${parseInt(r.confirmed_orders || 0)}*\n`;
    msg += `💰 Revenue: *₹${parseInt(r.revenue || 0)}*\n`;
    msg += `⏳ Pending reviews: *${parseInt(r.pending_reviews || 0)}*\n`;
    msg += `🎫 New tickets: *${parseInt(r.new_tickets || 0)}*\n`;
    await bot.telegram.sendMessage(ADMIN_ID, msg, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Daily report error:', err.message);
  }
}

async function sendExpiringAlerts() {
  if (!ADMIN_ID) return;
  try {
    const expiring = await db.getExpiringPremium(5);
    if (!expiring.length) return;
    let msg = `⚠️ *Premiums expiring in next 5 days (${expiring.length})*\n\n`;
    expiring.slice(0, 15).forEach(u => {
      const name = escMd(u.first_name || u.username || `User ${u.chat_id}`);
      const days = Math.ceil((new Date(u.premium_until) - Date.now()) / 86400000);
      msg += `• ${name} — \`${u.chat_id}\` — ${days}d left\n`;
    });
    if (expiring.length > 15) msg += `...and ${expiring.length - 15} more\n`;
    msg += '\nRenew with /activate <id>';

    await bot.telegram.sendMessage(ADMIN_ID, msg, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Expiring alert error:', err.message);
  }
}

// Run daily reports at 9 AM server time
(async () => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(9, 15, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(() => {
    sendDailyReport();
    sendExpiringAlerts();
  }, next - now);
  setInterval(() => {
    sendDailyReport();
    sendExpiringAlerts();
  }, 24 * 60 * 60 * 1000);
})();

module.exports = bot;
}