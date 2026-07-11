const { Telegraf } = require('telegraf');
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
    '   /tickets — Open support tickets\n' +
    '   /payments [page] — Pending payment orders with screenshot\n' +
    '   /premiumusers — Active premium users\n' +
    '   /users [page] — List all users\n' +
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
  await ctx.replyWithMarkdown(msg);
});

bot.command('tickets', async (ctx) => {
  const tickets = await db.getOpenTickets();
  if (!tickets.length) return ctx.reply('✅ No open tickets.');

  let msg = `📋 *Open Tickets (${tickets.length})*\n\n`;
  tickets.slice(0, 10).forEach(t => {
    const name = escMd(t.first_name || t.username || `User ${t.chat_id}`);
    msg += `#${t.id} — ${name}\n» ${escMd(t.message).substring(0, 80)}${t.message.length > 80 ? '...' : ''}\n\n`;
  });
  if (tickets.length > 10) msg += `...and ${tickets.length - 10} more\n`;
  msg += 'Use `/reply <id> <msg>` or `/close <id>`';

  await ctx.replyWithMarkdown(msg);
});

bot.command('payments', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const page = Math.max(1, parseInt(parts[1]) || 1);
  const perPage = 10;

  const allOrders = await db.getPendingPayments();
  if (!allOrders.length) return ctx.reply('✅ No pending payments with screenshots.');

  const total = allOrders.length;
  const totalPages = Math.ceil(total / perPage) || 1;
  const start = (page - 1) * perPage;
  const slice = allOrders.slice(start, start + perPage);

  let msg = `📋 *Pending Payments (Page ${page}/${totalPages})* — Total: ${total}\n\n`;
  slice.forEach(o => {
    const name = escMd(o.first_name || o.username || `User ${o.chat_id}`);
    msg += `${o.order_ref} — ${name} — ₹${o.amount}\n`;
    msg += `» ${o.plan} | ${new Date(o.created_at).toLocaleDateString()}\n\n`;
  });

  if (page < totalPages) msg += `Next: /payments ${page + 1}\n`;
  msg += 'Use `/activate <ref> <plan>` to confirm';

  await ctx.replyWithMarkdown(msg);
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
  const page = Math.max(1, parseInt(parts[1]) || 1);
  const perPage = 10;

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

  if (page < totalPages) msg += `Next: /users ${page + 1}`;
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
  const vars = [
    ['ADMIN_BOT_TOKEN', !!config.ADMIN_BOT_TOKEN],
    ['DATABASE_URL', !!process.env.DATABASE_URL],
  ];
  let msg = '*Admin Bot Status*\n';
  vars.forEach(([k, v]) => msg += `${escMd(k)}: ${v ? '✅' : '❌'}\n`);
  msg += `\nNode: ${process.version}`;
  if (lastError) msg += `\n\nLast error:\n${escMd(lastError.substring(0, 200))}`;
  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.telegram.setMyCommands([
  { command: 'tickets', description: '📋 Open support tickets' },
  { command: 'payments', description: '💳 Pending payment orders' },
  { command: 'premiumusers', description: '👑 Active premium users' },
  { command: 'users', description: '👥 List all users' },
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

module.exports = bot;
}