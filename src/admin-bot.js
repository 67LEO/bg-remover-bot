const { Telegraf } = require('telegraf');
const config = require('./config');
const db = require('./db');

if (!config.ADMIN_BOT_TOKEN) {
  console.error('ADMIN_BOT_TOKEN not set — admin bot disabled');
  module.exports = null;
} else {

const bot = new Telegraf(config.ADMIN_BOT_TOKEN);
const mainBot = new Telegraf(config.BOT_TOKEN);

const adminAuth = new Set();
const passwordFails = new Map();
const MEME_URL = 'https://res.cloudinary.com/dm2hjn5wp/image/upload/q_auto/f_auto/v1779618463/memme_uq0haa.jpg';

let lastError = null;

bot.start(async (ctx) => {
  await ctx.replyWithMarkdown(
    '🔐 *Admin Bot Ready*\n\n' +
    'Send /password to login\n\n' +
    '📋 *Commands:*\n' +
    '   /tickets — Open support tickets\n' +
    '   /payments — Pending payment orders\n' +
    '   /reply <id> <msg> — Reply to ticket\n' +
    '   /close <id> — Close ticket\n' +
    '   /activate <id|ref> <plan> — Activate premium\n' +
    '   /admin — Bot analytics\n' +
    '   /debug — System status'
  );
});

bot.command('password', async (ctx) => {
  const chatId = ctx.chat.id;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) return ctx.reply('Usage: /password YOUR_PASSWORD');

  if (parts.slice(1).join(' ') === config.ADMIN_PASSWORD) {
    adminAuth.add(chatId);
    passwordFails.delete(chatId);
    await ctx.reply('✅ Access granted! Use /tickets or /payments to manage.');
  } else {
    const fails = (passwordFails.get(chatId) || 0) + 1;
    passwordFails.set(chatId, fails);

    if (fails >= 3) {
      passwordFails.delete(chatId);
      await ctx.replyWithPhoto(MEME_URL, { caption: '📸💀' });
    } else {
      await ctx.reply(`❌ Wrong password (${fails}/3 attempts)`);
    }
  }
});

bot.command('admin', async (ctx) => {
  const chatId = ctx.chat.id;
  if (!adminAuth.has(chatId)) return ctx.reply('🔒 Admin access required. Use /password first.');

  const total = await db.getTotalStats();
  const users = await db.getAllUsers();
  const dailyActive = await db.getDailyActiveCount();

  let msg = '📊 *Bot Analytics*\n\n';
  msg += `👥 Total users: *${total.totalUsers}*\n`;
  msg += `🖼️ Total images: *${total.totalImages}*\n`;
  msg += `📸 Today active: *${dailyActive}*\n`;
  msg += `📸 Today images: *${total.todayImages}*\n\n`;

  const top = users.slice(0, 5);
  msg += '*Top 5 Users:*\n';
  top.forEach((u, i) => {
    const name = u.first_name || u.username || 'User';
    msg += `${i + 1}. ${name} — ${u.total_uses} images${u.is_premium ? ' 👑' : ''}\n`;
  });
  await ctx.replyWithMarkdown(msg);
});

bot.command('tickets', async (ctx) => {
  const chatId = ctx.chat.id;
  if (!adminAuth.has(chatId)) return ctx.reply('🔒 Admin access required. Use /password first.');

  const tickets = await db.getOpenTickets();
  if (!tickets.length) return ctx.reply('✅ No open tickets.');

  let msg = `📋 *Open Tickets (${tickets.length})*\n\n`;
  tickets.slice(0, 10).forEach(t => {
    const name = t.first_name || t.username || `User ${t.chat_id}`;
    msg += `#${t.id} — ${name}\n» ${t.message.substring(0, 80)}${t.message.length > 80 ? '...' : ''}\n\n`;
  });
  if (tickets.length > 10) msg += `...and ${tickets.length - 10} more\n`;
  msg += 'Use `/reply <id> <msg>` or `/close <id>`';

  await ctx.replyWithMarkdown(msg);
});

bot.command('payments', async (ctx) => {
  const chatId = ctx.chat.id;
  if (!adminAuth.has(chatId)) return ctx.reply('🔒 Admin access required. Use /password first.');

  const orders = await db.getPendingPayments();
  if (!orders.length) return ctx.reply('✅ No pending payments.');

  let msg = `📋 *Pending Payments (${orders.length})*\n\n`;
  orders.slice(0, 10).forEach(o => {
    const name = o.first_name || o.username || `User ${o.chat_id}`;
    const hasSS = o.screenshot_file_id ? '📸' : '❌';
    msg += `${o.order_ref} — ${name} — ₹${o.amount} ${hasSS}\n`;
    msg += `» ${o.plan} | ${new Date(o.created_at).toLocaleDateString()}\n\n`;
  });
  if (orders.length > 10) msg += `...and ${orders.length - 10} more\n`;
  msg += 'Use `/activate <ref> <plan>` to confirm';

  await ctx.replyWithMarkdown(msg);
});

bot.command('reply', async (ctx) => {
  const chatId = ctx.chat.id;
  if (!adminAuth.has(chatId)) return ctx.reply('🔒 Admin access required. Use /password first.');

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
      `📬 *Reply to your ticket #${ticketId}*\n\n${replyMsg}\n\nNeed more help? Send /support`,
      { parse_mode: 'Markdown' }
    );
    await ctx.reply(`✅ Reply sent to ticket #${ticketId}`);
  } catch {
    await ctx.reply(`⚠️ Reply saved but couldn't deliver to user (they may have blocked the bot). Ticket #${ticketId}`);
  }
});

bot.command('close', async (ctx) => {
  const chatId = ctx.chat.id;
  if (!adminAuth.has(chatId)) return ctx.reply('🔒 Admin access required. Use /password first.');

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
  const adminId = ctx.chat.id;
  if (!adminAuth.has(adminId)) return ctx.reply('🔒 Admin access required. Use /password first.');

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

      const result = await db.activatePremiumByAdmin(ticket.chat_id, plan, ticketId, adminId);
      userChatId = result.chat_id;
      sourceInfo = `🎫 Ticket #${ticketId}`;
    }

    await ctx.replyWithMarkdown(
      `✅ *Premium Activated!*\n\n${sourceInfo}\n📆 Plan: ${planLabel}\n✅ Done.`
    );

    await mainBot.telegram.sendMessage(
      userChatId,
      `🎉 *Congratulations!* 🎉\n\nYour *${planLabel} Premium* plan has been activated!\n📆 Duration: ${plan === 'monthly' ? '30 days' : '365 days'} unlimited\n\n✨ No daily limits anymore!\n🔹 /stats — Check your status\n🔹 /share — Earn more rewards\n\nThank you for your support! 🙏`,
      { parse_mode: 'Markdown' }
    ).catch(() => {
      ctx.reply('⚠️ Premium activated but user may have blocked the bot.');
    });
  } catch (err) {
    lastError = err.message;
    await ctx.reply('❌ Error activating premium: ' + err.message.substring(0, 100));
  }
});

bot.command('debug', async (ctx) => {
  if (!adminAuth.has(ctx.chat.id)) return ctx.reply('🔒 /password first');

  const vars = [
    ['ADMIN_BOT_TOKEN', !!config.ADMIN_BOT_TOKEN],
    ['DATABASE_URL', !!process.env.DATABASE_URL],
  ];
  let msg = '*Admin Bot Status*\n';
  vars.forEach(([k, v]) => msg += `${k}: ${v ? '✅' : '❌'}\n`);
  msg += `\nNode: ${process.version}`;
  if (lastError) msg += `\n\nLast error:\n${lastError.substring(0, 200)}`;
  await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
});

module.exports = bot;
}
