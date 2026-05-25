const { Telegraf } = require('telegraf');
const config = require('./config');
const { getMask, getUpscale } = require('./processor');
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
  await db.upsertUser(chatId, name, username);

  const referrerId = parseReferral(ctx);
  if (referrerId) {
    await db.addReferral(referrerId, chatId);
    try {
      await ctx.telegram.sendMessage(referrerId, 'Someone joined using your referral link! You earned bonus uses!');
    } catch {}
  }

  await ctx.replyWithMarkdown(
    '👋 *Welcome!* ✨\n\n' +
    '📸 Send me any photo — I\'ll edit it instantly!\n\n' +
    '🛠️ *Available Tools:*\n' +
    '   📤 Send photo → Remove background\n' +
    '   🔍 /upscale → 4x HD upscale\n\n' +
    '🔹 *Commands:*\n' +
    '   /help — Instructions\n' +
    '   /share — Referral link\n' +
    '   /stats — Your usage\n\n' +
    'Let\'s get started! 🚀'
  );
});

bot.help(async (ctx) => {
  const stats = await db.getUserStats(ctx.chat.id);
  await ctx.replyWithMarkdown(
    '📖 *How to use*\n\n' +
    '🖼️ *Remove background:* Send a photo directly\n' +
    '🔍 *Upscale HD:* /upscale then send a photo\n\n' +
    '⚡ Max 20MB per photo\n' +
    `🔹 Free operations left today: ${stats?.dailyRemaining ?? config.FREE_LIMIT_DAILY}\n\n` +
    'Type /share to get unlimited!'
  );
});

bot.command('share', async (ctx) => {
  const chatId = ctx.chat.id;
  const botUsername = ctx.botInfo?.username || 'BgRemoverBot';
  const count = await db.getReferralCount(chatId);
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

bot.command('upscale', async (ctx) => {
  userMode.set(ctx.chat.id, 'upscale');
  await ctx.reply('🔍 Send me a photo, I\'ll upscale it 4x HD!');
});

bot.command('stats', async (ctx) => {
  const stats = await db.getUserStats(ctx.chat.id);
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

const userMode = new Map();
const adminAuth = new Set();
const passwordFails = new Map();
const MEME_URL = 'https://res.cloudinary.com/dm2hjn5wp/image/upload/q_auto/f_auto/v1779618463/memme_uq0haa.jpg';

bot.command('admin', async (ctx) => {
  const chatId = ctx.chat.id;
  const password = config.ADMIN_PASSWORD;

  if (!password) return ctx.reply('Admin password not configured');

  if (!adminAuth.has(chatId)) {
    adminAuth.add(chatId);
    return ctx.reply('🔑 Send /password YOUR_PASSWORD to access admin panel');
  }

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

bot.command('password', async (ctx) => {
  const chatId = ctx.chat.id;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) return ctx.reply('Usage: /password YOUR_PASSWORD');

  if (parts.slice(1).join(' ') === config.ADMIN_PASSWORD) {
    adminAuth.add(chatId);
    passwordFails.delete(chatId);
    await ctx.reply('✅ Access granted! Now send /admin to see analytics.');
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
  await db.upsertUser(chatId, name, username);

  const caption = ctx.message.caption || '';
  const isUpscaleCmd = userMode.get(chatId) === 'upscale';
  const isUpscaleCaption = /^(\/upscale|upscale)/i.test(caption.trim());
  const doUpscale = isUpscaleCmd || isUpscaleCaption;
  if (isUpscaleCmd) userMode.delete(chatId);

  const userStats = await db.getUserStats(chatId);
  const dailyUsed = userStats?.dailyUsed ?? 0;

  if (!userStats?.isPremium && dailyUsed >= config.FREE_LIMIT_DAILY) {
    return await ctx.replyWithMarkdown(
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

    let resultBuffer;
    if (doUpscale) {
      resultBuffer = await getUpscale(imageBuffer);
      await db.logImage(chatId, imageBuffer.length, resultBuffer.length);
      await ctx.replyWithDocument(
        { source: resultBuffer, filename: 'hd-result.png' },
        {
          caption: userStats?.isPremium
            ? '✨ 4x HD Upscale done! (Unlimited)\n\nShare & earn rewards! /share'
            : `✨ 4x HD Upscale done! (${dailyUsed + 1}/${config.FREE_LIMIT_DAILY} free today)\n\nUnlimited? /share`,
        }
      );
    } else {
      const maskBuffer = await getMask(imageBuffer);
      resultBuffer = await applyMask(imageBuffer, maskBuffer);
      await db.logImage(chatId, imageBuffer.length, resultBuffer.length);
      await ctx.replyWithDocument(
        { source: resultBuffer, filename: 'result.png' },
        {
          caption: userStats?.isPremium
            ? '✨ Background removed! (Unlimited)\n\nShare & earn rewards! /share'
            : `✨ Background removed! (${dailyUsed + 1}/${config.FREE_LIMIT_DAILY} free today)\n\nUnlimited? /share`,
        }
      );
    }

    await db.incrementUsage(chatId);
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
