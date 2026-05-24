const { Telegraf } = require('telegraf');
const config = require('./config');
const { getMask } = require('./processor');
const { applyMask } = require('./image');
const db = require('./db');
const fs = require('fs');

if (!config.BOT_TOKEN) {
  console.error('BOT_TOKEN not set');
  process.exit(1);
}

const bot = new Telegraf(config.BOT_TOKEN);

function parseReferral(ctx) {
  if (ctx.message?.text?.startsWith('/start')) {
    const parts = ctx.message.text.split(' ');
    if (parts.length > 1) {
      const refId = parseInt(parts[1]);
      if (!isNaN(refId) && refId !== ctx.chat.id) return refId;
    }
  }
  return null;
}

bot.start(async (ctx) => {
  const { id: chatId, first_name: name, username } = ctx.chat;
  db.upsertUser(chatId, name, username);

  const referrerId = parseReferral(ctx);
  if (referrerId) {
    db.addReferral(referrerId, chatId);
    try {
      await ctx.telegram.sendMessage(referrerId, 'Someone joined using your referral link! You earned bonus uses!');
    } catch {}
  }

  await ctx.replyWithMarkdown(
    '👋 *Welcome to AI Background Remover* ✨\n\n' +
    '📸 Send me any photo — I\'ll remove the background instantly!\n\n' +
    '🔹 *How to use:*\n   Send a photo → Get result back\n\n' +
    '🔹 *Commands:*\n   /start — This message\n   /help — Instructions\n   /share — Referral link\n   /stats — Your usage\n\n' +
    'Let\'s get started! 🚀'
  );
});

bot.help(async (ctx) => {
  const stats = db.getUserStats(ctx.chat.id);
  await ctx.replyWithMarkdown(
    '📖 *How to use*\n\n' +
    '1️⃣ Send any photo (JPG/PNG/WEBP)\n' +
    '2️⃣ Wait a few seconds\n' +
    '3️⃣ Receive image with background removed!\n\n' +
    '⚡ Max 20MB per photo\n' +
    `🔹 Free uses left today: ${stats?.dailyRemaining ?? config.FREE_LIMIT_DAILY}\n\n` +
    'Type /share to get unlimited!'
  );
});

bot.command('share', async (ctx) => {
  const chatId = ctx.chat.id;
  const botUsername = ctx.botInfo?.username || 'BgRemoverBot';
  const count = db.getReferralCount(chatId);
  await ctx.replyWithMarkdown(
    '🤝 *Share & Earn Unlimited Usage!*\n\n' +
    `You've referred *${count} friends* so far!\n\n` +
    'Share this link:\n' +
    `\`https://t.me/${botUsername}?start=${chatId}\`\n\n` +
    '🎁 *Rewards:*\n' +
    '• 3 friends → +7 days unlimited\n' +
    '• 5 friends → +1 month unlimited\n' +
    '• 10 friends → +3 months unlimited\n\n' +
    'Start sharing! 🚀'
  );
});

bot.command('stats', async (ctx) => {
  const stats = db.getUserStats(ctx.chat.id);
  if (!stats) return ctx.reply('No data yet. Send a photo to get started!');

  await ctx.replyWithMarkdown(
    '📊 *Your Stats*\n\n' +
    `👤 Total processed: *${stats.totalUses}*\n` +
    `📅 Used today: *${stats.dailyUsed}*\n` +
    `🎯 Remaining today: *${stats.dailyRemaining === Infinity ? 'Unlimited' : stats.dailyRemaining}*\n` +
    `👥 Friends referred: *${stats.referrals}*\n` +
    `🏅 Plan: *${stats.isPremium ? 'Premium' : 'Free'}*\n` +
    `📆 Joined: *${stats.joinedAt}*`
  );
});

bot.command('admin', async (ctx) => {
  if (ctx.chat.id !== 961262211) return ctx.reply('Unauthorized');
  const total = db.getTotalStats();
  const users = db.getAllUsers();
  let msg = '📊 *Bot Statistics*\n\n';
  msg += `👥 Total users: *${total.totalUsers}*\n`;
  msg += `🖼️ Total images: *${total.totalImages}*\n`;
  msg += `📸 Today: *${total.todayImages}*\n\n`;
  msg += '*Top Users:*\n';
  users.slice(0, 10).forEach((u, i) => {
    msg += `${i + 1}. ${u.first_name || '?'} — ${u.total_uses} images${u.is_premium ? ' 👑' : ''}\n`;
  });
  await ctx.replyWithMarkdown(msg);
});

let lastError = null;

function escMd(t) {
  return t.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

bot.command('debug', async (ctx) => {
  const vars = [
    ['BOT_TOKEN', !!config.BOT_TOKEN],
    ['FIREBASE_API_KEY', !!config.FIREBASE_API_KEY],
    ['FIREBASE_PROJECT_ID', !!config.FIREBASE_PROJECT_ID],
  ];
  let msg = '*Bot Status*\n';
  vars.forEach(([k, v]) => msg += `${escMd(k)}: ${v ? '✅' : '❌'}\n`);
  msg += `\nNode: ${escMd(process.version)}`;
  if (lastError) msg += `\n\nLast error:\n${escMd(lastError.substring(0, 200))}`;
  await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
});

bot.on('photo', async (ctx) => {
  const chatId = ctx.chat.id;
  const { first_name: name, username } = ctx.chat;
  db.upsertUser(chatId, name, username);

  const userStats = db.getUserStats(chatId);
  const dailyUsed = userStats?.dailyUsed ?? 0;

  if (!userStats?.isPremium && dailyUsed >= config.FREE_LIMIT_DAILY) {
    return ctx.replyWithMarkdown(
      `😅 You've used all *${config.FREE_LIMIT_DAILY}* free tries today!\n\n` +
      '🔹 Type /share to get unlimited\n🔹 Or wait until tomorrow'
    );
  }

  const processingMsg = await ctx.reply('⏳ Processing...');

  try {
    const photo = ctx.message.photo;
    const fileId = photo[photo.length - 1].file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);

    const response = await fetch(fileLink.href);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const imageBuffer = Buffer.from(await response.arrayBuffer());

    const maskBuffer = await getMask(imageBuffer);
    const resultBuffer = await applyMask(imageBuffer, maskBuffer);

    db.logImage(chatId, imageBuffer.length, resultBuffer.length);

    await ctx.replyWithPhoto(
      { source: Buffer.from(resultBuffer) },
      {
        caption: userStats?.isPremium
          ? '✨ Background removed! (Unlimited)\n\nShare & earn rewards! /share'
          : `✨ Background removed! (${dailyUsed + 1}/${config.FREE_LIMIT_DAILY} free today)\n\nUnlimited? /share`,
      }
    );

    db.incrementUsage(chatId);
  } catch (err) {
    lastError = err.message;
    console.error('=== ERROR ===');
    console.error('Message:', err.message);
    await ctx.reply('❌ Error: ' + err.message.substring(0, 100));
  } finally {
    await ctx.deleteMessage(processingMsg.message_id).catch(() => {});
  }
});

bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  if (doc.mime_type?.startsWith('image/')) {
    return bot.emit('photo', ctx);
  }
  await ctx.reply('Please send a photo (JPG/PNG), not a file.');
});

const http = require('http');
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
});
server.listen(PORT, () => {
  console.log(`Server on port ${PORT}`);
});

async function startBot() {
  const webhookUrl = process.env.RENDER_EXTERNAL_URL
    ? process.env.RENDER_EXTERNAL_URL + '/webhook'
    : null;

  if (webhookUrl) {
    await bot.telegram.setWebhook(webhookUrl, { drop_pending_updates: true });
    console.log('Webhook set:', webhookUrl);
    server.removeAllListeners('request');
    server.on('request', async (req, res) => {
      if (req.url === '/webhook') {
        const bufs = [];
        for await (const chunk of req) bufs.push(chunk);
        try {
          await bot.handleUpdate(JSON.parse(Buffer.concat(bufs).toString()));
        } catch (e) {
          console.error('Webhook error:', e.message);
        }
        res.writeHead(200);
        res.end('OK');
      } else {
        res.writeHead(200);
        res.end('OK');
      }
    });
  } else {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.launch();
  }
  console.log('Bot started');
}

startBot().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});

process.once('SIGINT', () => { try { bot.stop('SIGINT'); } catch {} process.exit(0); });
process.once('SIGTERM', () => { try { bot.stop('SIGTERM'); } catch {} process.exit(0); });
