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

bot.command('debug', async (ctx) => {
  if (ctx.chat.id !== 961262211) return ctx.reply('Unauthorized');
  const vars = [
    ['BOT_TOKEN', !!config.BOT_TOKEN],
    ['FIREBASE_API_KEY', !!config.FIREBASE_API_KEY],
    ['FIREBASE_PROJECT_ID', !!config.FIREBASE_PROJECT_ID],
    ['MASK_API_URL', !!config.MASK_API_URL],
    ['STARTUP_API_URL', !!config.STARTUP_API_URL],
  ];
  let msg = '🔧 *Debug Info*\n\n';
  vars.forEach(([k, v]) => msg += `${k}: ${v ? '✅ Set' : '❌ MISSING'}\n`);
  msg += `\nNode: ${process.version}`;
  await ctx.replyWithMarkdown(msg);
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
    const outPath = await applyMask(imageBuffer, maskBuffer);

    const resultBuf = fs.readFileSync(outPath);
    db.logImage(chatId, imageBuffer.length, resultBuf.length);

    await ctx.replyWithPhoto(
      { source: fs.createReadStream(outPath) },
      {
        caption: userStats?.isPremium
          ? '✨ Background removed! (Unlimited)\n\nShare & earn rewards! /share'
          : `✨ Background removed! (${dailyUsed + 1}/${config.FREE_LIMIT_DAILY} free today)\n\nUnlimited? /share`,
      }
    );

    db.incrementUsage(chatId);
  } catch (err) {
    console.error('=== ERROR ===');
    console.error('Message:', err.message);
    console.error('Stack:', err.stack?.split('\n').slice(0, 4).join('\n'));
    await ctx.reply('❌ Error: ' + err.message.substring(0, 100));
  } finally {
    await ctx.deleteMessage(processingMsg.message_id).catch(() => {});
    const genDir = require('path').join(__dirname, '..', 'generated');
    try {
      fs.readdirSync(genDir).forEach(f => {
        try { fs.unlinkSync(require('path').join(genDir, f)); } catch {}
      });
    } catch {}
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
http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  }
}).listen(PORT, () => {
  console.log(`Server on port ${PORT}`);
});

bot.launch().then(() => {
  console.log('Bot started');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
