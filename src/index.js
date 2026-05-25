const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const { getMask, getUpscale, generateImage } = require('./processor');
const { applyMask } = require('./image');
const db = require('./db');
const adminBot = require('./admin-bot');
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
    '   🔍 /upscale → 4x HD upscale\n' +
    '   🎨 /imagine → AI image generator\n\n' +
     '🔹 *Commands:*\n' +
     '   /help — Instructions\n' +
     '   /share — Referral link\n' +
     '   /stats — Your usage\n' +
     '   /support — Contact support\n\n' +
     'Let\'s get started! 🚀'
  );
});

bot.help(async (ctx) => {
  const stats = await db.getUserStats(ctx.chat.id);
  await ctx.replyWithMarkdown(
    '📖 *How to use*\n\n' +
    '🖼️ *Remove background:* Send a photo directly\n' +
    '🔍 *Upscale HD:* /upscale then send a photo\n' +
    '🎨 *AI Generate:* /imagine your prompt\n\n' +
     '⚡ Max 20MB per photo\n' +
     `🔹 Free operations left today: ${stats?.dailyRemaining ?? config.FREE_LIMIT_DAILY}\n\n` +
     'Type /share to get unlimited!\n' +
     '💬 Need help? /support'
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

bot.command('imagine', async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text.slice('/imagine'.length).trim();
  if (!text) {
    return await ctx.replyWithMarkdown(
      '🎨 *AI Image Generator*\n\n' +
      'Usage: `/imagine <your prompt>`\n\n' +
      'Example: `/imagine a cute cat on a windowsill, photorealistic`\n\n' +
      `🔹 Free today: */${config.FREE_LIMIT_DAILY} operations*\n\n` +
      'Powered by FLUX Pro 🚀'
    );
  }

  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const userStats = await db.getUserStats(chatId);
  const dailyUsed = userStats?.dailyUsed ?? 0;

  if (!userStats?.isPremium && dailyUsed >= config.FREE_LIMIT_DAILY) {
    return await ctx.replyWithMarkdown(
      `😅 You've used all *${config.FREE_LIMIT_DAILY}* free tries today!\n\n` +
      '🔹 Type /share to get unlimited\n🔹 Or wait until tomorrow'
    );
  }

  const msg = await ctx.reply('🎨 Generating image...');

  try {
    const imgBuf = await generateImage(text);
    await ctx.replyWithPhoto(
      { source: imgBuf },
      { caption: userStats?.isPremium
          ? '✨ AI Generated! (Unlimited)\n\nShare & earn rewards! /share'
          : `✨ AI Generated! (${dailyUsed + 1}/${config.FREE_LIMIT_DAILY} free today)\n\nUnlimited? /share` }
    );
    await db.incrementUsage(chatId);
  } catch (err) {
    console.error('=== ERROR ===');
    console.error('Message:', err.message);
    await ctx.reply('❌ Error: ' + err.message.substring(0, 100));
  } finally {
    await ctx.deleteMessage(msg.message_id).catch(() => {});
  }
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

bot.command('support', async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text.slice('/support'.length).trim();
  if (!text) {
    return await ctx.replyWithMarkdown(
      '💬 *Contact Support*\n\n' +
      'Usage: `/support your message`\n\n' +
      'Example: `/support meri photo process nahi ho rahi hai`\n\n' +
      'Our team will get back to you soon!'
    );
  }

  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  try {
    const ticketId = await db.createTicket(chatId, text);
    await ctx.reply(`✅ *Ticket #${ticketId} submitted!*\n\nOur team will review your query and get back to you soon.`, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply('❌ Error submitting ticket. Please try again later.');
  }
});



function generateOrderRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = 'BG-';
  for (let i = 0; i < 5; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref;
}

bot.command('premium', async (ctx) => {
  const plans = config.PREMIUM_PLANS;
  let msg = '🎯 *Premium Plans*\n\nUnlimited background removal, upscale & AI generation!\n';
  msg += '\n📆 *Monthly* — ₹' + plans.monthly.price + ' (30 days)\n';
  msg += '🎉 *Yearly* — ₹' + plans.yearly.price + ' (365 days)\n\n';
  msg += 'Select a plan below 👇';

  await ctx.replyWithMarkdown(msg, Markup.inlineKeyboard([
    [Markup.button.callback('📆 Monthly — ₹' + plans.monthly.price, 'buy_monthly')],
    [Markup.button.callback('🎉 Yearly — ₹' + plans.yearly.price, 'buy_yearly')],
  ]));
});

bot.action('buy_monthly', async (ctx) => {
  await handleBuyPlan(ctx, 'monthly');
});

bot.action('buy_yearly', async (ctx) => {
  await handleBuyPlan(ctx, 'yearly');
});

async function handleBuyPlan(ctx, plan) {
  const chatId = ctx.chat.id;
  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const planInfo = config.PREMIUM_PLANS[plan];
  const orderRef = generateOrderRef();

  try {
    await db.createPaymentOrder(orderRef, chatId, plan, planInfo.price);
    pendingPayment.set(chatId, { orderRef, plan });

    await ctx.editMessageText(
      `✅ *Order Created!*\n\n` +
      `💰 Plan: *${planInfo.label}* — ₹${planInfo.price}\n` +
      `🔖 Reference: \`${orderRef}\`\n\n` +
      `📲 Pay to UPI:\n\`${config.UPI_ID}\`\n👤 ${config.UPI_NAME}\n\n` +
      `📸 *After payment, send the screenshot here*`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await ctx.editMessageText('❌ Error creating order. Please try /premium again.');
  }
}

const userMode = new Map();
const pendingPayment = new Map();

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
  await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
});

bot.command('debug', async (ctx) => {
  const vars = [
    ['BOT_TOKEN', !!config.BOT_TOKEN],
    ['FIREBASE_API_KEY', !!config.FIREBASE_API_KEY],
    ['FIREBASE_PROJECT_ID', !!config.FIREBASE_PROJECT_ID],
  ];
  let msg = '*Bot Status*\n';
  vars.forEach(([k, v]) => msg += `${escMd(k)}: ${v ? '✅' : '❌'}\n`);
  msg += `\nNode: ${escMd(process.version)}`;
  await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
});

bot.on('photo', async (ctx) => {
  const chatId = ctx.chat.id;
  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  if (pendingPayment.has(chatId)) {
    const order = pendingPayment.get(chatId);
    const photo = ctx.message.photo;
    const fileId = photo[photo.length - 1].file_id;

    await db.attachScreenshot(order.orderRef, fileId);
    pendingPayment.delete(chatId);

    await ctx.reply('✅ Payment screenshot received! Admin will verify soon.\n\nYou can check your status via /stats');
    return;
  }

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
  const baseUrl = process.env.RENDER_EXTERNAL_URL;
  const mainWebhook = baseUrl ? baseUrl + '/webhook' : null;
  const adminWebhook = baseUrl && config.ADMIN_BOT_TOKEN ? baseUrl + '/admin-webhook' : null;

  if (mainWebhook) {
    await bot.telegram.setWebhook(mainWebhook, { drop_pending_updates: true });
    console.log('Main webhook set:', mainWebhook);

    if (adminWebhook && adminBot) {
      await adminBot.telegram.setWebhook(adminWebhook, { drop_pending_updates: true });
      console.log('Admin webhook set:', adminWebhook);
    }

    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      const bufs = [];
      req.on('data', chunk => bufs.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(bufs).toString();
        if (req.url === '/admin-webhook' && adminBot) {
          res.writeHead(200);
          res.end('OK');
          adminBot.handleUpdate(JSON.parse(body)).catch(e => console.error('Admin webhook error:', e.message));
        } else if (req.url === '/webhook') {
          res.writeHead(200);
          res.end('OK');
          bot.handleUpdate(JSON.parse(body)).catch(e => console.error('Main webhook error:', e.message));
        } else {
          res.writeHead(200);
          res.end('OK');
        }
      });
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
