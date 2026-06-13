const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const { getMask, getUpscale, generateImage, ContentViolationError } = require('./processor');
const { applyMask } = require('./image');
const db = require('./db');
const adminBot = require('./admin-bot');
const { getVoices, generateSpeech, SUPPORTED_LANGUAGES } = require('./elevenlabs');
const { generateVideo } = require('./video');
const fs = require('fs');

const __origFetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), 30000);
  const signal = opts.signal;
  if (signal) {
    signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  opts.signal = ctrl.signal;
  return __origFetch(url, opts).finally(() => clearTimeout(id));
};

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

bot.use((ctx, next) => {
  if (ctx.message && ctx.chat && !checkRateLimit(ctx.chat.id)) {
    return ctx.reply('⏳ Too many requests. Please slow down and try again in a minute.');
  }
  return next();
});

bot.start(async (ctx) => {
  const { id: chatId, first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const referrerId = parseReferral(ctx);
  if (referrerId) {
    await db.addReferral(referrerId, chatId);
    try {
      await ctx.telegram.sendMessage(referrerId, '🎉 Someone joined using your referral link! Keep sharing to unlock unlimited premium days!');
    } catch {}
  }

  await ctx.replyWithMarkdown(
    '👋 *Welcome to AI Image Editor Bot* 🇮🇳\n\n' +
    '✨ *Features:*\n' +
    '🎯 Background Remover — one click\n' +
    '🔍 4x HD Upscaler\n' +
    '🎨 AI Image Generator (Flux Pro)\n' +
    '🎤 AI Voice Generator (ElevenLabs)\n' +
    '🎬 AI Video Generator\n\n' +
    '📌 *Commands:*\n' +
    '🖼 Send photo → Remove background\n' +
    '/upscale — 4x HD quality\n' +
    '/imagine — AI image from text\n' +
    '/video — AI video from text\n' +
    '/voice — Text to speech\n\n' +
    '⚡ /help • /share • /stats • /support • /premium\n\n' +
    'Everything free! /share to get unlimited 🚀'
  );
});

bot.help(async (ctx) => {
  const stats = await db.getUserStats(ctx.chat.id);
  await ctx.replyWithMarkdown(
    '📖 *How to use*\n\n' +
    '🖼️ *Remove background:* Send a photo directly\n' +
    '🔍 *Upscale HD:* /upscale then send a photo\n' +
    '🎨 *AI Generate:* /imagine your prompt\n' +
    '🎤 *Voice Gen:* /voice — select language & voice, send text\n' +
    '🎬 *Video Gen:* /video your prompt\n\n' +
    '🤝 *Share:* Use @AiBgRemover\\_Bot in any chat\n\n' +
     '⚡ Max 20MB per photo, max 3 min per video\n' +
     `🔹 Free operations left today: ${stats?.dailyRemaining ?? config.FREE_LIMIT_DAILY}\n\n` +
     'Type /share to get unlimited!\n' +
     '💬 Need help? /support',
     stats?.dailyRemaining !== undefined ? shareButton(ctx.chat.id) : undefined
  );
});

bot.command('share', async (ctx) => {
  const chatId = ctx.chat.id;
  const botUsername = ctx.botInfo?.username || process.env.BOT_USERNAME || 'AiBgRemover_Bot';
  const count = await db.getReferralCount(chatId);
  await ctx.replyWithMarkdown(
    '🤝 *Share & Earn Unlimited Usage!*\n\n' +
    `You've referred *${count} friends* so far!\n\n` +
    '🔗 *Your referral link:*\n' +
    `\`https://t.me/${botUsername}?start=${chatId}\`\n\n` +
    '🎁 *Rewards:*\n' +
    '• 3 friends → +7 days unlimited\n' +
    '• 5 friends → +1 month unlimited\n' +
    '• 10 friends → +3 months unlimited\n\n' +
    'Tap 👇 to share with friends!',
    Markup.inlineKeyboard([
        [Markup.button.switchToChat('📤 Share with Friends', `Try @${botUsername} — AI image editor: remove bg, upscale, generate images, voice & video 🚀`)],
        [Markup.button.callback('⭐ Go Premium', 'buy_monthly')],
      [Markup.button.url('📋 Copy Link', `https://t.me/${botUsername}?start=${chatId}`)],
    ])
  );
});

bot.command('upscale', async (ctx) => {
  userMode.set(ctx.chat.id, 'upscale');
  await ctx.reply('🔍 Send me a photo, I\'ll upscale it 4x HD!');
});

bot.command('voice', async (ctx) => {
  const chatId = ctx.chat.id;
  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const userStats = await db.getUserStats(chatId);
  const dailyUsed = userStats?.dailyUsed ?? 0;
  if (!userStats?.isPremium && dailyUsed >= config.FREE_LIMIT_DAILY) {
    return await ctx.replyWithMarkdown(
      `😅 You've used all *${config.FREE_LIMIT_DAILY}* free tries today!\n\n` +
      '🔹 Type /share to earn unlimited\n🔹 Or go premium for unlimited access',
      Markup.inlineKeyboard([
        [Markup.button.switchToChat('📤 Share with Friends', `Try AI Image Editor Bot — remove bg, upscale, generate images, voice & video 🚀`)],
        [Markup.button.callback('⭐ Go Premium', 'buy_monthly')],
      ])
    );
  }

  const rows = SUPPORTED_LANGUAGES.map(lang =>
    [Markup.button.callback(`${lang.native} (${lang.name})`, `voice_lang_${lang.code}`)]
  );
  voiceSession.set(chatId, { step: 'language', _ts: Date.now() });
  await ctx.replyWithMarkdown(
    `🎤 *Voice Generator*\n\nFree today: *${dailyUsed}/${config.FREE_LIMIT_DAILY}*\n\nSelect a language 👇`,
    Markup.inlineKeyboard(rows)
  );
});

bot.command('imagine', async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text.slice('/imagine'.length).trim();
  if (!text) {
    return await ctx.replyWithMarkdown(
      '🎨 *AI Image Generator*\n\n' +
      'Usage: `/imagine <your prompt>`\n\n' +
      'Example: `/imagine a cute cat on a windowsill, photorealistic`\n\n' +
      `🔹 Free today: *${config.FREE_LIMIT_DAILY} operations*\n\n` +
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
      '🔹 Type /share to earn unlimited\n🔹 Or go premium for unlimited access',
      Markup.inlineKeyboard([
        [Markup.button.switchToChat('📤 Share with Friends', `Try AI Image Editor Bot — remove bg, upscale, generate images, voice & video 🚀`)],
        [Markup.button.callback('⭐ Go Premium', 'buy_monthly')],
      ])
    );
  }

  imagineSession.set(chatId, { prompt: text, _ts: Date.now() });
  await ctx.reply(
    `🎨 Choose aspect ratio for:\n"${text.length > 50 ? text.substring(0, 50) + '...' : text}" 👇`,
    {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('⬛ Square 1:1', 'imagine_size_SQUARE_HD')],
          [Markup.button.callback('📱 Portrait 3:2', 'imagine_size_PORTRAIT_3_2')],
          [Markup.button.callback('📐 Portrait 4:3', 'imagine_size_PORTRAIT_4_3')],
          [Markup.button.callback('❌ Cancel', 'imagine_cancel')],
        ],
      },
    }
  );
});

bot.command('video', async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text.slice('/video'.length).trim();
  if (!text) {
    return await ctx.replyWithMarkdown(
      '🎬 *AI Video Generator*\n\n' +
      'Usage: `/video <your prompt>`\n\n' +
      'Example: `/video a cat playing piano in a garden`\n\n' +
      `🔹 Free today: *${config.FREE_LIMIT_DAILY} operations*\n\n` +
      'Powered by AI 🚀'
    );
  }

  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const userStats = await db.getUserStats(chatId);
  const dailyUsed = userStats?.dailyUsed ?? 0;

  if (!userStats?.isPremium && dailyUsed >= config.FREE_LIMIT_DAILY) {
    return await ctx.replyWithMarkdown(
      `😅 You've used all *${config.FREE_LIMIT_DAILY}* free tries today!\n\n` +
      '🔹 Type /share to earn unlimited\n🔹 Or go premium for unlimited access',
      Markup.inlineKeyboard([
        [Markup.button.switchToChat('📤 Share with Friends', `Try AI Image Editor Bot — remove bg, upscale, generate images, voice & video 🚀`)],
        [Markup.button.callback('⭐ Go Premium', 'buy_monthly')],
      ])
    );
  }

  const msg = await ctx.reply('🎬 Generating AI video... (1-2 min)');

  generateVideoAsync(ctx, chatId, text, userStats, dailyUsed, msg)
    .catch(err => console.error('Background video error:', err.message));
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
      'Example: `/support my photo is not processing`\n\n' +
      'Our team will get back to you soon!'
    );
  }

  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  try {
    const ticketId = await db.createTicket(chatId, text);
    await ctx.reply(`✅ *Ticket #${ticketId} submitted!*\n\nOur team will review your query and get back to you soon.`, { parse_mode: 'Markdown' });

    const displayName = name || username || `User ${chatId}`;
    sendNotification(`📩 *New Support Ticket #${ticketId}*\n\n👤 ${displayName}\n💬 \`${text.substring(0, 200)}\``);
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
  let msg = '🎯 *Premium Plans*\n\nUnlimited background removal, upscale, AI generation, video & voice!\n';
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

bot.action(/voice_lang_(.+)/, async (ctx) => {
  const chatId = ctx.chat.id;
  const langCode = ctx.match[1];
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === langCode);
  if (!lang) return ctx.answerCbQuery('Invalid language');

  await ctx.answerCbQuery('Fetching voices...');
  await ctx.editMessageText(`🎤 Loading voices for ${lang.native}...`);

  try {
    const voices = await getVoices();
    const rows = voices.map(v => [
      Markup.button.callback(`🎧 ${v.name}`, `voice_preview_${v.voiceId}`),
      Markup.button.callback(`✅ Select`, `voice_select_${v.voiceId}`),
    ]);

    voiceSession.set(chatId, { step: 'voice', language: langCode, _ts: Date.now() });
    await ctx.editMessageText(
      `🎤 *${lang.native}* — Select a voice 👇\n\nTap 🎧 to preview, ✅ to select.`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } }
    );
  } catch (err) {
    await ctx.editMessageText('❌ Error fetching voices. Please try again later.');
  }
});

bot.action(/voice_preview_(.+)/, async (ctx) => {
  const voiceId = ctx.match[1];
  const voices = await getVoices().catch(() => []);
  const voice = voices.find(v => v.voiceId === voiceId);
  if (!voice || !voice.previewUrl) return ctx.answerCbQuery('No preview available');

  await ctx.answerCbQuery(`Previewing ${voice.name}...`);
  try {
    const res = await fetch(voice.previewUrl);
    if (!res.ok) throw new Error('Download failed');
    const buf = Buffer.from(await res.arrayBuffer());
    await ctx.replyWithVoice({ source: buf }, { caption: `🎧 ${voice.name} — preview`, reply_to_message_id: ctx.callbackQuery.message.message_id });
  } catch {
    await ctx.reply('❌ Could not load preview.');
  }
});

bot.action(/voice_select_(.+)/, async (ctx) => {
  const chatId = ctx.chat.id;
  const voiceId = ctx.match[1];
  const session = voiceSession.get(chatId);
  if (!session) return ctx.answerCbQuery('Session expired. Use /voice again.');

  const voices = await getVoices().catch(() => []);
  const voice = voices.find(v => v.voiceId === voiceId);
  const voiceName = voice?.name || voiceId;

  voiceSession.set(chatId, { step: 'script', language: session.language, voiceId, voiceName, _ts: Date.now() });
  await ctx.answerCbQuery(`Selected ${voiceName}`);
  await ctx.editMessageText(
    `✅ Voice selected: *${voiceName}*\n\nNow send me the text you want to convert to speech 🎤`,
    { parse_mode: 'Markdown' }
  );
});

bot.action(/imagine_size_(.+)/, async (ctx) => {
  const chatId = ctx.chat.id;
  const sizeId = ctx.match[1];
  const session = imagineSession.get(chatId);
  if (!session?.prompt) return ctx.answerCbQuery('Session expired. Use /imagine again.');

  imagineSession.delete(chatId);

  await ctx.answerCbQuery('Generating...');
  await ctx.editMessageText('🎨 Generating image...');

  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const userStats = await db.getUserStats(chatId);
  const dailyUsed = userStats?.dailyUsed ?? 0;

  if (!userStats?.isPremium && dailyUsed >= config.FREE_LIMIT_DAILY) {
    return await ctx.editMessageText(
      `😅 You've used all *${config.FREE_LIMIT_DAILY}* free tries today!\n\n` +
      '🔹 Type /share to earn unlimited\n🔹 Or go premium for unlimited access',
      { parse_mode: 'Markdown', reply_markup: {
        inline_keyboard: [
          [Markup.button.switchToChat('📤 Share with Friends', `Try AI Image Editor Bot — remove bg, upscale, generate images, voice & video 🚀`)],
          [Markup.button.callback('⭐ Go Premium', 'buy_monthly')],
        ],
      }}
    );
  }

  const msg = ctx.callbackQuery.message;
  generateImageAsync(ctx, chatId, session.prompt, userStats, dailyUsed, msg, sizeId)
    .catch(err => console.error('Background imagine error:', err.message));
});

bot.action('imagine_cancel', async (ctx) => {
  const chatId = ctx.chat.id;
  imagineSession.delete(chatId);
  await ctx.answerCbQuery('Cancelled');
  await ctx.editMessageText('❌ Cancelled. Use /imagine to try again.');
});

async function processGeneratedImage(ctx, chatId, action) {
  const entry = lastGenImage.get(chatId);
  if (!entry) return ctx.answerCbQuery('No recent image found. Generate one with /imagine first.');

  await ctx.answerCbQuery('Processing...');

  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const userStats = await db.getUserStats(chatId);
  const dailyUsed = userStats?.dailyUsed ?? 0;

  if (!userStats?.isPremium && dailyUsed >= config.FREE_LIMIT_DAILY) {
    return await ctx.replyWithMarkdown(
      `😅 You've used all *${config.FREE_LIMIT_DAILY}* free tries today!\n\n` +
      '🔹 Type /share to earn unlimited\n🔹 Or go premium for unlimited access',
      Markup.inlineKeyboard([
        [Markup.button.switchToChat('📤 Share with Friends', `Try AI Image Editor Bot — remove bg, upscale, generate images, voice & video 🚀`)],
        [Markup.button.callback('⭐ Go Premium', 'buy_monthly')],
      ])
    );
  }

  const msg = await ctx.reply(action === 'upscale' ? '🔄 Upscaling 4x HD...' : '✂️ Removing background...');

  try {
    const imageBuffer = entry.buffer;
    if (!imageBuffer) throw new Error('No cached image');

    let resultBuffer, type, filename, label;
    if (action === 'upscale') {
      resultBuffer = await getUpscale(imageBuffer);
      type = 'upscale';
      filename = 'hd-result.png';
      label = userStats?.isPremium
        ? '🔄 4x HD Upscale done! (Unlimited)'
        : `🔄 4x HD Upscale done! (${dailyUsed + 1}/${config.FREE_LIMIT_DAILY} free today)`;
    } else {
      const maskBuffer = await getMask(imageBuffer);
      resultBuffer = await applyMask(imageBuffer, maskBuffer);
      type = 'bg_remove';
      filename = 'result.png';
      label = userStats?.isPremium
        ? '✂️ Background removed! (Unlimited)'
        : `✂️ Background removed! (${dailyUsed + 1}/${config.FREE_LIMIT_DAILY} free today)`;
    }

    await ctx.telegram.sendDocument(
      chatId,
      { source: resultBuffer, filename },
      { caption: label, reply_markup: shareButton(chatId).reply_markup }
    );
    await db.incrementUsage(chatId);
    await db.logImage(chatId, imageBuffer.length, resultBuffer.length, type);
  } catch (err) {
    console.error('=== ERROR ===');
    console.error('Message:', err.message);
    await ctx.telegram.sendMessage(chatId, '❌ Something went wrong. Please try again later.');
  } finally {
    await ctx.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});
  }
}

bot.action('gen_upscale', async (ctx) => {
  await processGeneratedImage(ctx, ctx.chat.id, 'upscale');
});

bot.action('gen_bgremove', async (ctx) => {
  await processGeneratedImage(ctx, ctx.chat.id, 'bg_remove');
});

async function handleBuyPlan(ctx, plan) {
  const chatId = ctx.chat.id;
  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const planInfo = config.PREMIUM_PLANS[plan];
  const orderRef = generateOrderRef();

  try {
    await db.createPaymentOrder(orderRef, chatId, plan, planInfo.price);
    pendingPayment.set(chatId, { orderRef, plan, _ts: Date.now() });

    await ctx.editMessageText(
      `✅ *Order Created!* 🔖 \`${orderRef}\``,
      { parse_mode: 'Markdown' }
    );

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=upi://pay?pa=${encodeURIComponent(config.UPI_ID)}&pn=${encodeURIComponent(config.UPI_NAME)}&am=${planInfo.price}&tn=${orderRef}`;

    await ctx.replyWithPhoto(
      qrUrl,
      {
        caption:
          `✨ *${planInfo.label} Premium — ₹${planInfo.price}* ✨\n\n` +
          `━━━━━━━━━━━━━━━━━━━\n` +
          `📌 *HOW TO PAY:*\n\n` +
          `1️⃣ Scan the QR above & pay ₹${planInfo.price}\n\n` +
          `2️⃣ Send the *payment screenshot* as a 📸 PHOTO\n` +
          `   ⚠️ Do NOT send text messages\n` +
          `━━━━━━━━━━━━━━━━━━━\n\n` +
          `Cancel? /cancel`,
        parse_mode: 'Markdown'
      }
    );

    const displayName = name || username || `User ${chatId}`;
    sendNotification(`🆕 *New Payment Order*\n\n👤 ${displayName}\n💰 ${planInfo.label} — ₹${planInfo.price}\n🔖 ${orderRef}`);
  } catch (err) {
    await ctx.editMessageText('❌ Error creating order. Please try /premium again.');
  }
}

bot.command('cancel', async (ctx) => {
  const chatId = ctx.chat.id;
  if (pendingPayment.has(chatId)) {
    const order = pendingPayment.get(chatId);
    await db.cancelPaymentOrder(order.orderRef);
    pendingPayment.delete(chatId);
    await ctx.reply('✅ Payment cancelled. Type /premium anytime to buy again.');

    const displayName = ctx.chat.first_name || ctx.chat.username || `User ${chatId}`;
    sendNotification(`❌ *Order Cancelled*\n\n👤 ${displayName}\n🔖 ${order.orderRef}\n💰 ${order.plan}`);
    return;
  }
  if (voiceSession.has(chatId)) {
    voiceSession.delete(chatId);
    await ctx.reply('✅ Voice generation cancelled. Use /voice to start again.');
    return;
  }
  if (imagineSession.has(chatId)) {
    imagineSession.delete(chatId);
    await ctx.reply('✅ Image generation cancelled. Use /imagine to start again.');
    return;
  }
  await ctx.reply('No pending operation to cancel.');
});

const userMode = new Map();
const pendingPayment = new Map();
const voiceSession = new Map();
const imagineSession = new Map();
const lastGenImage = new Map();

const SESSION_TTL = 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingPayment) { if (now - (v._ts || 0) > SESSION_TTL) pendingPayment.delete(k); }
  for (const [k, v] of voiceSession) { if (now - (v._ts || 0) > SESSION_TTL) voiceSession.delete(k); }
  for (const [k, v] of imagineSession) { if (now - (v._ts || 0) > SESSION_TTL) imagineSession.delete(k); }
  for (const [k, v] of lastGenImage) { if (now - (v.timestamp || 0) > SESSION_TTL) lastGenImage.delete(k); }
  for (const [k, v] of rateLimitMap) { if (now - v > 60000) rateLimitMap.delete(k); }
}, 60000);

const RATE_LIMIT = 5;
const RATE_WINDOW = 60000;
const rateLimitMap = new Map();

function checkRateLimit(chatId) {
  const now = Date.now();
  const ts = rateLimitMap.get(chatId);
  if (ts && now - ts < RATE_WINDOW) {
    const count = rateLimitMap.get(chatId + '_count') || 1;
    if (count >= RATE_LIMIT) return false;
    rateLimitMap.set(chatId + '_count', count + 1);
  } else {
    rateLimitMap.set(chatId, now);
    rateLimitMap.set(chatId + '_count', 1);
  }
  return true;
}

function sendNotification(msg) {
  if (adminBot && config.ADMIN_CHAT_ID) {
    adminBot.telegram.sendMessage(config.ADMIN_CHAT_ID, msg, { parse_mode: 'Markdown' }).catch(() => {});
  }
}

const escMd = config.escMd;

function shareButton(chatId) {
  const botUsername = process.env.BOT_USERNAME || 'AiBgRemover_Bot';
  return Markup.inlineKeyboard([
    [Markup.button.switchToChat('📤 Share with Friends', `Try @${botUsername} — AI image editor bot 🚀`)],
    [Markup.button.callback('⭐ Go Premium', 'buy_monthly')],
  ]);
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

bot.on('my_chat_member', async (ctx) => {
  if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
    const status = ctx.myChatMember.new_chat_member.status;
    if (status === 'member' || status === 'administrator') {
      await ctx.replyWithMarkdown(
        '👋 *Thanks for adding me!*\n\n' +
        'Send any photo to remove background 🖼️\n' +
        'Or type /help to see all features\n\n' +
        'Made with ❤️ in India',
        shareButton(ctx.chat.id)
      );
    }
  }
});

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;

  if (pendingPayment.has(chatId)) {
    return await ctx.replyWithMarkdown(
      '📸 *INVALID INPUT — Send a PHOTO, not text*\n\n' +
      '━━━━━━━━━━━━━━━━━━━\n' +
      '⚠️ You have a *pending payment*.\n\n' +
      '✅ Already paid?: Send the *payment screenshot* photo here\n' +
      '❌ Not yet paid?: Check the QR code above and pay first\n\n' +
      'Cancel this order? → /cancel\n' +
      '━━━━━━━━━━━━━━━━━━━'
    );
  }

  const session = voiceSession.get(chatId);
  if (session?.step === 'script') {
    const text = ctx.message.text.trim();
    if (!text || text.length > 1000) {
      return await ctx.reply('❌ Text must be 1-1000 characters. Send again or /cancel');
    }

    const { first_name: name, username } = ctx.chat;
    await db.upsertUser(chatId, name, username);

    const userStats = await db.getUserStats(chatId);
    const dailyUsed = userStats?.dailyUsed ?? 0;
    if (!userStats?.isPremium && dailyUsed >= config.FREE_LIMIT_DAILY) {
      voiceSession.delete(chatId);
      return await ctx.replyWithMarkdown(
        `😅 You've used all *${config.FREE_LIMIT_DAILY}* free tries today!\n\n` +
        '🔹 Type /share to earn unlimited\n🔹 Or go premium for unlimited access',
        Markup.inlineKeyboard([
          [Markup.button.switchToChat('📤 Share with Friends', `Try AI Image Editor Bot — remove bg, upscale, generate images, voice & video 🚀`)],
          [Markup.button.callback('⭐ Go Premium', 'buy_monthly')],
        ])
      );
    }

    await ctx.reply(`🎤 Generating voice... (${text.length} chars)`);

    try {
      const audioBuf = await generateSpeech(session.voiceId, text, session.language);
      await db.incrementUsage(chatId);
      await ctx.replyWithVoice(
        { source: audioBuf },
        { caption: userStats?.isPremium
          ? `🔊 ${session.voiceName} (Unlimited)`
          : `🔊 ${session.voiceName} (${dailyUsed + 1}/${config.FREE_LIMIT_DAILY} free today)`,
          reply_markup: shareButton(chatId).reply_markup }
      );
      voiceSession.delete(chatId);
    } catch (err) {
      await ctx.reply('❌ Something went wrong. Please try again later.');
    }
    return;
  }
});

async function processPhotoAsync(ctx, chatId, doUpscale, userStats, dailyUsed, processingMsg) {
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
      await db.logImage(chatId, imageBuffer.length, resultBuffer.length, 'upscale');
      await ctx.telegram.sendDocument(
        chatId,
        { source: resultBuffer, filename: 'hd-result.png' },
        {
          caption: userStats?.isPremium
            ? '✨ 4x HD Upscale done! (Unlimited)'
            : `✨ 4x HD Upscale done! (${dailyUsed + 1}/${config.FREE_LIMIT_DAILY} free today)`,
          reply_markup: shareButton(chatId).reply_markup,
        }
      );
    } else {
      const maskBuffer = await getMask(imageBuffer);
      resultBuffer = await applyMask(imageBuffer, maskBuffer);
      await db.logImage(chatId, imageBuffer.length, resultBuffer.length, 'bg_remove');
      await ctx.telegram.sendDocument(
        chatId,
        { source: resultBuffer, filename: 'result.png' },
        {
          caption: userStats?.isPremium
            ? '✨ Background removed! (Unlimited)'
            : `✨ Background removed! (${dailyUsed + 1}/${config.FREE_LIMIT_DAILY} free today)`,
          reply_markup: shareButton(chatId).reply_markup,
        }
      );
    }

    await db.incrementUsage(chatId);
  } catch (err) {
    console.error('=== ERROR ===');
    console.error('Message:', err.message);
    await ctx.telegram.sendMessage(chatId, '❌ Something went wrong. Please try again later.');
  } finally {
    await ctx.telegram.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
  }
}

async function generateImageAsync(ctx, chatId, text, userStats, dailyUsed, msg, size = 'SQUARE_HD') {
  try {
    const imgBuf = await generateImage(text, 'ultra-realistic', size);
    const sent = await ctx.telegram.sendPhoto(
      chatId,
      { source: imgBuf },
      { caption: userStats?.isPremium
          ? '✨ AI Generated! (Unlimited)'
          : `✨ AI Generated! (${dailyUsed + 1}/${config.FREE_LIMIT_DAILY} free today)`,
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Upscale 4x', 'gen_upscale'),
             Markup.button.callback('✂️ Remove BG', 'gen_bgremove')],
            ...shareButton(chatId).reply_markup.inline_keyboard,
          ],
        },
      }
    );
    lastGenImage.set(chatId, { buffer: imgBuf, timestamp: Date.now() });
    await db.incrementUsage(chatId);
    await db.logImage(chatId, imgBuf.length, imgBuf.length, 'imagine');
  } catch (err) {
    console.error('=== ERROR ===');
    console.error('Message:', err.message);
    if (err instanceof ContentViolationError) {
      await ctx.telegram.sendMessage(chatId, '🚫 Your prompt was rejected by the AI content filter. Please try a different, family-friendly description.');
    } else {
      await ctx.telegram.sendMessage(chatId, '❌ Something went wrong. Please try again later.');
    }
  } finally {
    await ctx.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});
  }
}

async function generateVideoAsync(ctx, chatId, text, userStats, dailyUsed, msg) {
  try {
    const result = await generateVideo(text);
    const res = await fetch(result.url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    await ctx.telegram.sendVideo(
      chatId,
      { source: buf, filename: 'video.mp4' },
      { caption: userStats?.isPremium
          ? '🎬 AI Video Generated! (Unlimited)'
          : `🎬 AI Video Generated! (${dailyUsed + 1}/${config.FREE_LIMIT_DAILY} free today)`,
        reply_markup: shareButton(chatId).reply_markup }
    );
    await db.incrementUsage(chatId);
    await db.logImage(chatId, buf.length, buf.length, 'video');
  } catch (err) {
    console.error('=== VIDEO ERROR ===');
    console.error('Message:', err.message);
    await ctx.telegram.sendMessage(chatId, '❌ Something went wrong. Please try again later.');
  } finally {
    await ctx.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});
  }
}

bot.on('inline_query', async (ctx) => {
  const query = ctx.inlineQuery.query.trim();
  const results = [
    {
      type: 'article',
      id: 'share',
      title: '📤 Share this bot with friends',
      description: 'AI Background Remover, Upscaler, Image, Voice & Video Generator',
      input_message_content: {
        message_text: '🤖 *AI Image Editor Bot* — Remove bg, upscale, generate images, voice & video!\n\nSend me a photo or type /help to start 👇',
        parse_mode: 'Markdown',
      },
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 Open Bot', url: 'https://t.me/' + (process.env.BOT_USERNAME || 'AiBgRemover_Bot') }
        ]]
      }
    },
    {
      type: 'article',
      id: 'features',
      title: '✨ Features',
      description: 'Background removal • 4x HD Upscale • AI Image • Voice • Video Gen',
      input_message_content: {
        message_text: '🎯 *AI Image Editor Bot Features*\n\n🖼️ Send photo → Remove background instantly\n🔍 /upscale — 4x HD quality boost\n🎨 /imagine — Generate AI images\n🎤 /voice — Text to speech\n🎬 /video — AI video generation\n📊 /stats — Check usage\n\n🇮🇳 Made in India',
        parse_mode: 'Markdown',
      },
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 Open Bot', url: 'https://t.me/' + (process.env.BOT_USERNAME || 'AiBgRemover_Bot') }
        ]]
      }
    },
    {
      type: 'article',
      id: 'premium',
      title: '⭐ Premium Plans',
      description: 'Unlimited everything — ₹49/month, ₹499/year',
      input_message_content: {
        message_text: '⭐ *Premium Plans*\n\n📆 Monthly — ₹49 (30 days)\n🎉 Yearly — ₹499 (365 days)\n\nUnlimited background removal, upscale, AI generation, video & voice!\n\nType /premium in the bot to buy 👇',
        parse_mode: 'Markdown',
      },
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 Open Bot', url: 'https://t.me/' + (process.env.BOT_USERNAME || 'AiBgRemover_Bot') }
        ]]
      }
    },
  ];

  if (query) {
    const filtered = results.filter(r =>
      r.title.toLowerCase().includes(query.toLowerCase()) ||
      r.description.toLowerCase().includes(query.toLowerCase())
    );
    await ctx.answerInlineQuery(filtered.length ? filtered : results, { cache_time: 10 });
  } else {
    await ctx.answerInlineQuery(results, { cache_time: 10 });
  }
});

bot.on('photo', async (ctx) => {
  const chatId = ctx.chat.id;
  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const sizes = ctx.message.photo;
  const maxPhoto = sizes[sizes.length - 1];

  if (maxPhoto.file_size > 20 * 1024 * 1024) {
    return await ctx.reply('❌ Photo is too large. Maximum size is 20MB.');
  }

  if (pendingPayment.has(chatId)) {
    const order = pendingPayment.get(chatId);
    const fileId = maxPhoto.file_id;

    await db.attachScreenshot(order.orderRef, fileId);
    pendingPayment.delete(chatId);

    await ctx.reply('✅ Payment screenshot received! Admin will verify soon.\n\nYou can check your status via /stats');

    const displayName = name || username || `User ${chatId}`;
    sendNotification(`📸 *New Payment Screenshot*\n\n👤 ${displayName}\n🔖 Ref: ${order.orderRef}\n💰 ${order.plan}\n\nUse \`/activate ${order.orderRef} ${order.plan}\` to confirm.`);
    if (config.ADMIN_CHAT_ID && adminBot) {
      try {
        const fileLink = await ctx.telegram.getFileLink(fileId);
        const res = await fetch(fileLink.href);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          adminBot.telegram.sendPhoto(config.ADMIN_CHAT_ID, { source: buf }, {
            caption: `📸 *New Payment Screenshot*\n\n👤 ${displayName}\n🔖 Ref: ${order.orderRef}\n💰 ${order.plan}`,
            parse_mode: 'Markdown',
          }).catch(() => {});
        }
      } catch {}
    }
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
      '🔹 Type /share to earn unlimited\n🔹 Or go premium for unlimited access',
      Markup.inlineKeyboard([
        [Markup.button.switchToChat('📤 Share with Friends', `Try AI Image Editor Bot — remove bg, upscale, generate images, voice & video 🚀`)],
        [Markup.button.callback('⭐ Go Premium', 'buy_monthly')],
      ])
    );
  }

  const processingMsg = await ctx.reply('⏳ Processing...');

  // Fire-and-forget: process in background so handleUpdate resolves immediately
  processPhotoAsync(ctx, chatId, doUpscale, userStats, dailyUsed, processingMsg)
    .catch(err => console.error('Background process error:', err.message));
});

bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  if (doc.file_size > 20 * 1024 * 1024) {
    return await ctx.reply('❌ File is too large. Maximum size is 20MB.');
  }
  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (doc.mime_type && validTypes.includes(doc.mime_type)) {
    return bot.emit('photo', ctx);
  }
  await ctx.reply('Please send a photo (JPG/PNG/WebP), not a file.');
});

const http = require('http');
const PORT = process.env.PORT || 3000;
const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    try {
      await db.getUserCount();
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    } catch {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('DB DOWN');
    }
    return;
  }
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
