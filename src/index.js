const { Telegraf, Markup } = require('telegraf');
const config = require('./config');
const { getMask, getUpscale, generateImage, getAiBackground, ContentViolationError } = require('./processor');
const { applyMask } = require('./image');
const db = require('./db');
const adminBot = require('./admin-bot');
const { getVoices, generateSpeech, SUPPORTED_LANGUAGES } = require('./elevenlabs');
const { generateVideo } = require('./video');
const { initPool } = require('./firebase');
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

// ---- Credits helpers ----
function earnKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('🎬 Watch Ad & Earn Credits', 'earn_credits')]]);
}

const NO_CREDITS_TEXT = '😅 You have *0* credits left!\n\n🎬 Watch ad to earn +3 credits';

async function sendNoCredits(ctx) {
  return ctx.replyWithMarkdown(NO_CREDITS_TEXT, earnKeyboard());
}

// Atomically deducts 1 credit. If none are left, shows the earn prompt and returns false.
async function takeCredit(ctx, chatId) {
  const ok = await db.deductCredit(chatId).catch(() => false);
  if (!ok) await sendNoCredits(ctx).catch(() => {});
  return ok;
}

function refundCredit(chatId) {
  return db.addCreditsBot(chatId, 1).catch(err => console.error('Credit refund failed:', err.message));
}

bot.action('earn_credits', async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    const baseWeb = process.env.WEB_INTERNAL_URL || 'http://localhost:3001';
    const site = process.env.SITE_URL || 'https://tg-bot-1395.onbelmo.uk';
    const r = await fetch(baseWeb + '/api/earn/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId })
    });
    const j = await r.json();
    if (j.limitReached || !(j.url || j.token)) {
      await ctx.answerCbQuery().catch(() => {});
      return await ctx.reply(j.error || '❌ Could not start the ad right now. Please try again in a moment.');
    }
    const url = j.url || (site + '/earn?token=' + j.token);
    await ctx.reply('🎬 Watch ad to earn +3 credits', Markup.inlineKeyboard([
      [Markup.button.webApp('Open Ad Page', url)]
    ]));
    await ctx.answerCbQuery();
  } catch (e) {
    await ctx.answerCbQuery('Error');
  }
});

bot.use(async (ctx, next) => {
  if (ctx.message && ctx.chat) {
    const chatId = ctx.chat.id;

    // Banned user check — allow only /start & /support so they can appeal
    const txt = ctx.message.text || '';
    const isAllowedCmd = /^\/start/.test(txt) || /^\/support/.test(txt);
    if (!isAllowedCmd && config.ADMIN_CHAT_ID && String(chatId) !== String(config.ADMIN_CHAT_ID)) {
      if (banCheckCache.has(chatId)) {
        return ctx.reply('⛔ Your access has been blocked. Contact support if you think this is a mistake.');
      }
      try {
        const banned = await db.isBanned(chatId);
        if (banned) {
          banCheckCache.add(chatId);
          return ctx.reply('⛔ Your access has been blocked. Contact support if you think this is a mistake.');
        }
      } catch {}
    }

    const result = checkRateLimit(chatId);
    if (!result.ok) {
      const waitSec = Math.ceil(result.remaining / 1000);
      return await ctx.replyWithMarkdown(
        `⏳ *Too many requests!*\n\nPlease wait *~${waitSec}s* before sending the next request.`
      );
    }
  }
  return next();
});

bot.start(async (ctx) => {
  const { id: chatId, first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const referrerId = parseReferral(ctx);
  if (referrerId) {
    const isNew = await db.addReferral(referrerId, chatId);
    if (isNew) {
      await db.addCreditsBot(referrerId, 3).catch(() => {});
      try {
        await ctx.telegram.sendMessage(referrerId, '🎉 Someone joined using your referral link! You earned +3 credits. Keep sharing!');
      } catch {}
    }
  }

  await ctx.replyWithMarkdown(
    '👋 *Welcome to AI Image Editor Bot* 🇮🇳\n\n' +
    '✨ *Features:*\n' +
    '🎯 Background Remover — one click\n' +
    '🔍 4x HD Upscaler\n' +
    '🎨 AI Image Generator (Flux Pro)\n' +
    '🎤 AI Voice Generator (ElevenLabs)\n' +
    '🎬 AI Video Generator\n' +
    '🖼️ AI Background Replace — custom bg after remove\n\n' +
    '📌 *Commands:*\n' +
    '🖼 Send photo → Remove background\n' +
    '/upscale — 4x HD quality\n' +
    '/imagine — AI image from text\n' +
    '/video — AI video from text\n' +
    '/voice — Text to speech\n\n' +
    '⚡ /help • /share • /stats • /support • /premium\n\n' +
    '🎁 10 free credits every day — watch an ad or /share for more 🚀'
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
    '🎬 *Video Gen:* /video your prompt\n' +
    '🖼️ *AI Background:* Tap 🎨 AI BG after removing background\n\n' +
    '🤝 *Share:* Use @AiBgRemover\\_Bot in any chat\n\n' +
     '⚡ Max 20MB per photo, max 3 min per video\n' +
      `🔹 Credits left: *${stats?.dailyRemaining ?? 10}*\n\n` +
      '🎬 Watch ad to earn +3 credits\n' +
      '💬 Need help? /support',
     Markup.inlineKeyboard([[Markup.button.callback('🎬 Watch Ad & Earn Credits', 'earn_credits')]])
  );
});

bot.command('share', async (ctx) => {
  const chatId = ctx.chat.id;
  const botUsername = ctx.botInfo?.username || process.env.BOT_USERNAME || 'AiBgRemover_Bot';
  const count = await db.getReferralCount(chatId);
  await ctx.replyWithMarkdown(
    '🤝 *Share & Earn Credits!*\n\n' +
    `You've referred *${count} friends* so far!\n\n` +
    '🔗 *Your referral link:*\n' +
    `\`https://t.me/${botUsername}?start=${chatId}\`\n\n` +
    '🎁 *Reward:* +3 credits for every friend who joins with your link\n\n' +
    'Tap 👇 to share with friends!',
    Markup.inlineKeyboard([
        [Markup.button.switchToChat('📤 Share with Friends', `Try @${botUsername} — AI image editor: remove bg, upscale, AI bg, images, voice & video 🚀`)],
        [Markup.button.callback('🎬 Watch Ad & Earn Credits', 'earn_credits')],
      [Markup.button.url('📋 Copy Link', `https://t.me/${botUsername}?start=${chatId}`)],
    ])
  );
});

bot.command('upscale', async (ctx) => {
  userMode.set(ctx.chat.id, { mode: 'upscale', _ts: Date.now() });
  await ctx.reply('🔍 Send me a photo, I\'ll upscale it 4x HD!');
});

bot.command('voice', async (ctx) => {
  const chatId = ctx.chat.id;
  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const userStats = await db.getUserStats(chatId);
  const credits = userStats?.dailyRemaining ?? 10;
  if (credits <= 0) return await sendNoCredits(ctx);

  const rows = SUPPORTED_LANGUAGES.map(lang =>
    [Markup.button.callback(`${lang.native} (${lang.name})`, `voice_lang_${lang.code}`)]
  );
  voiceSession.set(chatId, { step: 'language', _ts: Date.now() });
  await ctx.replyWithMarkdown(
    `🎤 *Voice Generator*\n\nCredits left: *${credits}*\n\nSelect a language 👇`,
    Markup.inlineKeyboard(rows)
  );
});

bot.command('imagine', async (ctx) => {
  const chatId = ctx.chat.id;
  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const userStats = await db.getUserStats(chatId);
  const text = ctx.message.text.slice('/imagine'.length).trim();
  if (!text) {
    return await ctx.replyWithMarkdown(
      '🎨 *AI Image Generator*\n\n' +
      'Usage: `/imagine <your prompt>`\n\n' +
      'Example: `/imagine a cute cat on a windowsill, photorealistic`\n\n' +
      `🔹 Credits left: *${userStats?.dailyRemaining ?? 10}*\n\n` +
      'Powered by FLUX Pro 🚀'
    );
  }

  if ((userStats?.dailyRemaining ?? 10) <= 0) return await sendNoCredits(ctx);

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
  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const userStats = await db.getUserStats(chatId);
  const text = ctx.message.text.slice('/video'.length).trim();
  if (!text) {
    return await ctx.replyWithMarkdown(
      '🎬 *AI Video Generator*\n\n' +
      'Usage: `/video <your prompt>`\n\n' +
      'Example: `/video a cat playing piano in a garden`\n\n' +
      `🔹 Credits left: *${userStats?.dailyRemaining ?? 10}*\n\n` +
      'Powered by AI 🚀'
    );
  }

  if (!(await takeCredit(ctx, chatId))) return;

  const msg = await ctx.reply('🎬 Generating AI video... (1-2 min)');

  generateVideoAsync(ctx, chatId, text, msg)
    .catch(err => console.error('Background video error:', err.message));
});

bot.command('stats', async (ctx) => {
  const stats = await db.getUserStats(ctx.chat.id);
  if (!stats) return ctx.reply('No data yet. Send a photo to get started!');

  await ctx.replyWithMarkdown(
    '📊 *Your Stats*\n\n' +
    `👤 Total processed: *${stats.totalUses}*\n` +
    `📅 Used today: *${stats.dailyUsed}*\n` +
    `🎯 Credits left: *${stats.dailyRemaining}*\n` +
    `👥 Friends referred: *${stats.referrals}*\n` +
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
    const openTicket = await db.getUserOpenTicket(chatId);
    let ticketId;
    if (openTicket) {
      await db.appendToTicket(openTicket.id, text);
      ticketId = openTicket.id;
      await ctx.reply(
        `✅ *Message added to Ticket #${ticketId}!*\n\nOur team will continue your existing conversation and get back to you soon.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      ticketId = await db.createTicket(chatId, text);
      await ctx.reply(
        `✅ *Ticket #${ticketId} submitted!*\n\nOur team will review your query and get back to you soon.`,
        { parse_mode: 'Markdown' }
      );
    }

    const displayName = name || username || `User ${chatId}`;
    sendNotification(`📩 *Support Message — Ticket #${ticketId}*\n\n👤 ${displayName}\n💬 \`${text.substring(0, 200)}\``);
  } catch (err) {
    await ctx.reply('❌ Error submitting ticket. Please try again later.');
  }
});



bot.command('premium', async (ctx) => {
  const credits = await db.getCredits(ctx.chat.id).catch(() => 10);
  await ctx.replyWithMarkdown(
    '🎬 *Free Credits*\n\n' +
    `Credits left today: *${credits}*\n\n` +
    '• 10 free credits every day\n' +
    '• Watch a short ad → +3 credits\n' +
    '• Invite a friend with /share → +3 credits each',
    earnKeyboard()
  );
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

  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  if (!(await db.deductCredit(chatId).catch(() => false))) {
    return await ctx.editMessageText(NO_CREDITS_TEXT, { parse_mode: 'Markdown', reply_markup: earnKeyboard().reply_markup });
  }

  await ctx.editMessageText('🎨 Generating image...').catch(() => {});

  const msg = ctx.callbackQuery.message;
  generateImageAsync(ctx, chatId, session.prompt, msg, sizeId)
    .catch(err => console.error('Background imagine error:', err.message));
});

bot.action('imagine_cancel', async (ctx) => {
  const chatId = ctx.chat.id;
  imagineSession.delete(chatId);
  await ctx.answerCbQuery('Cancelled');
  await ctx.editMessageText('❌ Cancelled. Use /imagine to try again.');
});

bot.action('ai_bg', async (ctx) => {
  const chatId = ctx.chat.id;
  const cached = recentImage.get(chatId);
  if (!cached?.imageBuffer) {
    return ctx.answerCbQuery('Send a photo first!');
  }

  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const userStats = await db.getUserStats(chatId);
  if ((userStats?.dailyRemaining ?? 10) <= 0) {
    await ctx.answerCbQuery();
    return await sendNoCredits(ctx);
  }

  await ctx.answerCbQuery();
  const rows = Object.entries(AI_BG_TEMPLATES).map(([key, t]) =>
    [Markup.button.callback(t.label, `ai_bg_tpl_${key}`)]
  );
  rows.push([Markup.button.callback('✏️ Custom Prompt', 'ai_bg_custom')]);
  rows.push([Markup.button.callback('❌ Cancel', 'ai_bg_cancel')]);

  await ctx.reply('🎨 *Choose a background style or describe your own:*', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: rows },
  });
});

bot.action(/ai_bg_tpl_(.+)/, async (ctx) => {
  const chatId = ctx.chat.id;
  const templateKey = ctx.match[1];
  const template = AI_BG_TEMPLATES[templateKey];
  if (!template) return ctx.answerCbQuery('Invalid template');

  await ctx.answerCbQuery(`Generating: ${template.label}`);
  await processAiBackground(ctx, chatId, template.prompt);
});

bot.action('ai_bg_custom', async (ctx) => {
  const chatId = ctx.chat.id;
  aiBgSession.set(chatId, { step: 'prompt', _ts: Date.now() });
  await ctx.answerCbQuery();
  await ctx.reply('✏️ *Describe the background you want:*\n\nExample: `a sunny beach with palm trees and ocean waves`\n\nSend /cancel to abort.', {
    parse_mode: 'Markdown',
  });
});

bot.action('ai_bg_cancel', async (ctx) => {
  const chatId = ctx.chat.id;
  aiBgSession.delete(chatId);
  await ctx.answerCbQuery('Cancelled');
  await ctx.editMessageText('❌ Cancelled.');
});

async function processAiBackground(ctx, chatId, prompt) {
  const cached = recentImage.get(chatId);
  if (!cached?.imageBuffer) {
    return ctx.reply('❌ No image found. Send a photo first.');
  }

  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  if (!(await takeCredit(ctx, chatId))) return;

  const msg = await ctx.reply('🎨 Generating AI background...');

  try {
    let maskBuffer = cached.maskBuffer;
    if (!maskBuffer && cached.imageBuffer) {
      maskBuffer = await getMask(cached.imageBuffer);
      cached.maskBuffer = maskBuffer;
    }

    const resultBuffer = await getAiBackground(cached.imageBuffer, maskBuffer, prompt);
    recentImage.set(chatId, { imageBuffer: cached.imageBuffer, maskBuffer, _ts: Date.now() });

    await ctx.telegram.sendDocument(
      chatId,
      { source: resultBuffer, filename: 'ai-bg-result.jpg' },
      {
        caption: '🎨 Background replaced!',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Try Again', 'ai_bg_retry'), Markup.button.callback('✏️ New Prompt', 'ai_bg_custom')],
          ],
        },
      }
    );
    await db.incrementUsage(chatId).catch(e => console.error('usage log failed:', e.message));
    await db.logImage(chatId, cached.imageBuffer.length, resultBuffer.length, 'ai_bg').catch(e => console.error('usage log failed:', e.message));
  } catch (err) {
    console.error('AI BG error:', err.message);
    await refundCredit(chatId);
    if (/failed: 429|entitlement|rate.limit/i.test(err.message || '')) {
      await ctx.telegram.sendMessage(chatId, '⚡ AI background credits are temporarily exhausted on our side. Please try again in a few minutes — background removal & upscale still work!');
    } else {
      await ctx.telegram.sendMessage(chatId, '❌ Something went wrong. Please try again later.');
    }
  } finally {
    await ctx.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});
  }
}

bot.action('ai_bg_retry', async (ctx) => {
  const chatId = ctx.chat.id;
  const cached = recentImage.get(chatId);
  if (!cached?.imageBuffer || !cached?.maskBuffer) {
    return ctx.answerCbQuery('No cached image. Send a photo first.');
  }

  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const userStats = await db.getUserStats(chatId);
  if ((userStats?.dailyRemaining ?? 10) <= 0) {
    return ctx.answerCbQuery('No credits left! Use /help to earn more.', { show_alert: true });
  }

  await ctx.answerCbQuery();
  const rows = Object.entries(AI_BG_TEMPLATES).map(([key, t]) =>
    [Markup.button.callback(t.label, `ai_bg_tpl_${key}`)]
  );
  rows.push([Markup.button.callback('✏️ Custom Prompt', 'ai_bg_custom')]);
  rows.push([Markup.button.callback('❌ Cancel', 'ai_bg_cancel')]);

  await ctx.reply('🎨 *Try a different background:*', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: rows },
  });
});

async function processGeneratedImage(ctx, chatId, action) {
  const entry = lastGenImage.get(chatId);
  if (!entry) return ctx.answerCbQuery('No recent image found. Generate one with /imagine first.');
  lastGenImage.delete(chatId);

  await ctx.answerCbQuery('Processing...');

  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  if (!(await takeCredit(ctx, chatId))) return;

  const msg = await ctx.reply(action === 'upscale' ? '🔄 Upscaling 4x HD...' : '✂️ Removing background...');

  try {
    const imageBuffer = entry.buffer;
    if (!imageBuffer) throw new Error('No cached image');

    let resultBuffer, type, filename, label;
    if (action === 'upscale') {
      resultBuffer = await getUpscale(imageBuffer);
      type = 'upscale';
      filename = 'hd-result.png';
      label = '✨ 4x HD Upscale done!';
    } else {
      const maskBuffer = await getMask(imageBuffer);
      resultBuffer = await applyMask(imageBuffer, maskBuffer);
      type = 'bg_remove';
      filename = 'result.png';
      label = '✨ Background removed!';
    }

    await ctx.telegram.sendDocument(
      chatId,
      { source: resultBuffer, filename },
      { caption: label, reply_markup: resultButtons(chatId).reply_markup }
    );
    await db.incrementUsage(chatId).catch(e => console.error('usage log failed:', e.message));
    await db.logImage(chatId, imageBuffer.length, resultBuffer.length, type).catch(e => console.error('usage log failed:', e.message));
  } catch (err) {
    console.error('=== ERROR ===');
    console.error('Message:', err.message);
    await refundCredit(chatId);
    await ctx.telegram.sendMessage(chatId, '❌ Something went wrong. Credit refunded.');
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

bot.command('cancel', async (ctx) => {
  const chatId = ctx.chat.id;
  const displayName = ctx.chat.first_name || ctx.chat.username || `User ${chatId}`;

  if (pendingPayment.has(chatId)) {
    const order = pendingPayment.get(chatId);
    await db.cancelPaymentOrder(order.orderRef);
    pendingPayment.delete(chatId);
    await ctx.reply('✅ Payment cancelled. Type /premium anytime to buy again.');
    sendNotification(`❌ *Order Cancelled*\n\n👤 ${displayName}\n🔖 ${order.orderRef}\n💰 ${order.plan}`);
    return;
  }

  const dbOrder = await db.getUserPendingOrder(chatId);
  if (dbOrder) {
    await db.cancelPaymentOrder(dbOrder.order_ref);
    await ctx.reply('✅ Payment cancelled. Type /premium anytime to buy again.');
    sendNotification(`❌ *Order Cancelled*\n\n👤 ${displayName}\n🔖 ${dbOrder.order_ref}\n💰 ${dbOrder.plan}`);
    return;
  }

  if (userMode.has(chatId)) {
    userMode.delete(chatId);
    await ctx.reply('✅ Upscale mode cancelled.');
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
  if (aiBgSession.has(chatId)) {
    aiBgSession.delete(chatId);
    await ctx.reply('✅ AI background cancelled. Send a photo to try again.');
    return;
  }
  await ctx.reply('No pending operation to cancel.');
});

const userMode = new Map();
const pendingPayment = new Map();
const voiceSession = new Map();
const imagineSession = new Map();
const lastGenImage = new Map();
const aiBgSession = new Map();
const recentImage = new Map();

const AI_BG_TEMPLATES = {
  beach: { label: '🏖️ Beach', prompt: 'Sunny tropical beach with ocean waves and palm trees, natural golden hour lighting' },
  office: { label: '🏢 Office', prompt: 'Modern professional office interior with desk, plants and bookshelf, bright natural lighting' },
  nature: { label: '🌿 Nature', prompt: 'Lush forest with sun rays filtering through trees, peaceful natural setting' },
  city: { label: '🌃 City', prompt: 'Night city skyline with bokeh lights, urban atmosphere, cinematic mood' },
  mountains: { label: '⛰️ Mountains', prompt: 'Snow-capped mountains with blue sky and clouds, majestic landscape' },
  studio: { label: '⚪ Studio', prompt: 'Clean white studio background with soft gradient lighting, professional look' },
};

const SESSION_TTL = 60 * 60 * 1000;
const USERMODE_TTL = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingPayment) {
    if (now - (v._ts || 0) > SESSION_TTL) {
      db.cancelPaymentOrder(v.orderRef).catch(() => {});
      pendingPayment.delete(k);
    }
  }
  for (const [k, v] of voiceSession) { if (now - (v._ts || 0) > SESSION_TTL) voiceSession.delete(k); }
  for (const [k, v] of imagineSession) { if (now - (v._ts || 0) > SESSION_TTL) imagineSession.delete(k); }
  for (const [k, v] of lastGenImage) { if (now - (v.timestamp || 0) > SESSION_TTL) lastGenImage.delete(k); }
  for (const [k, v] of aiBgSession) { if (now - (v._ts || 0) > SESSION_TTL) aiBgSession.delete(k); }
  for (const [k, v] of recentImage) { if (now - (v._ts || 0) > SESSION_TTL) recentImage.delete(k); }
  for (const [k, v] of rateLimitMap) { if (now - v.ts > 60000) rateLimitMap.delete(k); }
  for (const [k, v] of userMode) { if (now - (v._ts || 0) > USERMODE_TTL) userMode.delete(k); }
  for (const [k, v] of processedPhotos) { if (now - v > 60000) processedPhotos.delete(k); }
}, 60000);

const banCheckCache = new Set();

setInterval(() => banCheckCache.clear(), 300000);

const RATE_LIMIT = 5;
const RATE_WINDOW = 60000;
const rateLimitMap = new Map();

function checkRateLimit(chatId) {
  const now = Date.now();
  const entry = rateLimitMap.get(chatId);
  if (entry && now - entry.ts < RATE_WINDOW) {
    if (entry.count >= RATE_LIMIT) return { ok: false, remaining: RATE_WINDOW - (now - entry.ts) };
    entry.count++;
  } else {
    rateLimitMap.set(chatId, { ts: now, count: 1 });
  }
  return { ok: true };
}

function sendNotification(msg) {
  if (adminBot && config.ADMIN_CHAT_ID) {
    adminBot.telegram.sendMessage(config.ADMIN_CHAT_ID, msg, { parse_mode: 'Markdown' })
      .catch(err => console.error('Admin notification failed:', err.message));
  } else {
    console.warn('sendNotification skipped — adminBot:', !!adminBot, 'ADMIN_CHAT_ID:', config.ADMIN_CHAT_ID);
  }
}

const escMd = config.escMd;

function shareButton(chatId) {
  const botUsername = process.env.BOT_USERNAME || 'AiBgRemover_Bot';
  return Markup.inlineKeyboard([
    [Markup.button.switchToChat('📤 Share with Friends', `Try @${botUsername} — AI image editor bot 🚀`)],
    [Markup.button.callback('🎬 Watch Ad & Earn Credits', 'earn_credits')],
  ]);
}

async function handlePaymentScreenshot(ctx, chatId, name, username, order, fileId) {
  await db.attachScreenshot(order.orderRef, fileId);
  try {
    await db.saveScreenshotHistory(order.orderRef, chatId, fileId);
  } catch (err) {
    console.error('Screenshot history save failed:', err.message);
  }
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
        await adminBot.telegram.sendPhoto(config.ADMIN_CHAT_ID, { source: buf }, {
          caption: `📸 *New Payment Screenshot*\n\n👤 ${displayName}\n🔖 Ref: ${order.orderRef}\n💰 ${order.plan}`,
          parse_mode: 'Markdown',
        });
      } else {
        console.error('Admin photo forward: fetch failed', res.status);
      }
    } catch (err) {
      console.error('Admin photo forward failed:', err.message);
    }
  }
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
        '🎨 AI Background Replace also available!\n' +
        'Or type /help to see all features\n\n' +
        'Made with ❤️ in India',
        shareButton(ctx.chat.id)
      );
    }
  }
});

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;

  const aiBg = aiBgSession.get(chatId);
  if (aiBg?.step === 'prompt') {
    const text = ctx.message.text.trim();
    if (!text || text.length > 500) {
      return await ctx.reply('❌ Text must be 1-500 characters. Send again or /cancel');
    }
    aiBgSession.delete(chatId);
    await processAiBackground(ctx, chatId, text);
    return;
  }

  const session = voiceSession.get(chatId);
  if (session?.step === 'script') {
    const text = ctx.message.text.trim();
    if (!text || text.length > 1000) {
      return await ctx.reply('❌ Text must be 1-1000 characters. Send again or /cancel');
    }

    const { first_name: name, username } = ctx.chat;
    await db.upsertUser(chatId, name, username);

    if (!(await takeCredit(ctx, chatId))) return;

    await ctx.reply(`🎤 Generating voice... (${text.length} chars)`);

    try {
      const audioBuf = await generateSpeech(session.voiceId, text, session.language);
      const creditsLeft = await db.getCredits(chatId).catch(() => 0);
      await ctx.replyWithVoice(
        { source: audioBuf },
        { caption: `🔊 ${session.voiceName} | Credits left: ${creditsLeft}`, reply_markup: shareButton(chatId).reply_markup }
      );
      voiceSession.delete(chatId);
    } catch (err) {
      console.error('voice err:', err.message);
      await refundCredit(chatId);
      voiceSession.delete(chatId);
      await ctx.reply('❌ Something went wrong. Credit refunded.');
    }
    return;
  }

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
});

async function processPhotoAsync(ctx, chatId, doUpscale, processingMsg) {
  try {
    const photo = ctx.message.photo;
    const fileId = photo[photo.length - 1].file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);

    const response = await fetch(fileLink.href);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    const imageBuffer = Buffer.from(await response.arrayBuffer());

    let resultBuffer, maskBuffer;
    if (doUpscale) {
      resultBuffer = await getUpscale(imageBuffer);
      await db.logImage(chatId, imageBuffer.length, resultBuffer.length, 'upscale').catch(e => console.error('usage log failed:', e.message));
        await ctx.telegram.sendDocument(
          chatId,
          { source: resultBuffer, filename: 'hd-result.png' },
          {
            caption: '✨ 4x HD Upscale done!',
            reply_markup: resultButtons(chatId).reply_markup,
          }
        );
      recentImage.set(chatId, { imageBuffer, _ts: Date.now() });
    } else {
      maskBuffer = await getMask(imageBuffer);
      resultBuffer = await applyMask(imageBuffer, maskBuffer);
      await db.logImage(chatId, imageBuffer.length, resultBuffer.length, 'bg_remove').catch(e => console.error('usage log failed:', e.message));
        await ctx.telegram.sendDocument(
          chatId,
          { source: resultBuffer },
          {
            caption: doUpscale
              ? `✨ 4x HD Upscale done!`
              : `✨ Background removed!`,
            reply_markup: resultButtons(chatId).reply_markup
          }
        );
      recentImage.set(chatId, { imageBuffer, maskBuffer, _ts: Date.now() });
    }

    await db.incrementUsage(chatId).catch(e => console.error('usage log failed:', e.message));
  } catch (err) {
    console.error('=== ERROR ===');
    console.error('Message:', err.message);
    await refundCredit(chatId);
    await ctx.telegram.sendMessage(chatId, '❌ Something went wrong. Credit refunded.');
  } finally {
    await ctx.telegram.deleteMessage(chatId, processingMsg.message_id).catch(() => {});
  }
}

function resultButtons(chatId) {
  const sb = shareButton(chatId);
  return Markup.inlineKeyboard([
    [Markup.button.switchToChat('📤 Share with Friends', `Try @${process.env.BOT_USERNAME || 'AiBgRemover_Bot'} — AI image editor bot 🚀`)],
    [Markup.button.callback('🎨 AI Background', 'ai_bg')],
    [Markup.button.callback('🎬 Watch Ad & Earn Credits', 'earn_credits')],
  ]);
}

async function generateImageAsync(ctx, chatId, text, msg, size = 'SQUARE_HD') {
  try {
    const imgBuf = await generateImage(text, 'ultra-realistic', size);
    const sent = await ctx.telegram.sendPhoto(
      chatId,
      { source: imgBuf },
      { caption: '✨ AI Generated!',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 Upscale 4x', 'gen_upscale'),
             Markup.button.callback('✂️ Remove BG', 'gen_bgremove'),
             Markup.button.callback('🎨 AI BG', 'ai_bg')],
            ...shareButton(chatId).reply_markup.inline_keyboard,
          ],
        },
      }
    );
    lastGenImage.set(chatId, { buffer: imgBuf, timestamp: Date.now() });
    recentImage.set(chatId, { imageBuffer: imgBuf, _ts: Date.now() });
    await db.incrementUsage(chatId).catch(e => console.error('usage log failed:', e.message));
    await db.logImage(chatId, imgBuf.length, imgBuf.length, 'imagine').catch(e => console.error('usage log failed:', e.message));
  } catch (err) {
    console.error('=== ERROR ===');
    console.error('Message:', err.message);
    // Content-filter rejections are the user's fault (no refund); everything else is on our side
    if (!(err instanceof ContentViolationError)) await refundCredit(chatId);
    if (err instanceof ContentViolationError) {
      await ctx.telegram.sendMessage(chatId, '🚫 Your prompt was rejected by the AI content filter. Please try a different, family-friendly description.');
    } else if (/failed: 429|entitlement|rate.limit/i.test(err.message || '')) {
      await ctx.telegram.sendMessage(chatId, '⚡ AI image credits are temporarily exhausted on our side. Please try again in a few minutes — background removal & upscale still work!');
    } else {
      await ctx.telegram.sendMessage(chatId, '❌ Something went wrong. Credit refunded.');
    }
  } finally {
    await ctx.telegram.deleteMessage(chatId, msg.message_id).catch(() => {});
  }
}

async function generateVideoAsync(ctx, chatId, text, msg) {
  try {
    const result = await generateVideo(text);
    const res = await fetch(result.url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    await ctx.telegram.sendVideo(
      chatId,
      { source: buf, filename: 'video.mp4' },
      { caption: '🎬 AI Video Generated!',
        reply_markup: shareButton(chatId).reply_markup }
    );
    await db.incrementUsage(chatId).catch(e => console.error('usage log failed:', e.message));
    await db.logImage(chatId, buf.length, buf.length, 'video').catch(e => console.error('usage log failed:', e.message));
  } catch (err) {
    console.error('=== VIDEO ERROR ===');
    console.error('Message:', err.message);
    await refundCredit(chatId);
    await ctx.telegram.sendMessage(chatId, '❌ Something went wrong. Credit refunded.');
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
      description: 'AI Background Remover, Upscaler, AI BG, Image, Voice & Video Generator',
      input_message_content: {
        message_text: '🤖 *AI Image Editor Bot* — Remove bg, upscale, AI bg, generate images, voice & video!\n\nSend me a photo or type /help to start 👇',
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
      description: 'Background removal • 4x HD Upscale • AI BG • AI Image • Voice • Video Gen',
      input_message_content: {
        message_text: '🎯 *AI Image Editor Bot Features*\n\n🖼️ Send photo → Remove background instantly\n🔍 /upscale — 4x HD quality boost\n🎨 /imagine — Generate AI images\n🖼️ AI Background Replace after remove\n🎤 /voice — Text to speech\n🎬 /video — AI video generation\n📊 /stats — Check usage\n\n🇮🇳 Made in India',
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
      id: 'credits',
      title: '🎬 Free Daily Credits',
      description: '10 free credits every day — watch an ad for +3 more',
      input_message_content: {
        message_text: '🎬 *Free Daily Credits*\n\nGet 10 free credits every day, and watch a short ad to earn +3 more anytime!\n\nUse background removal, upscale, AI bg, AI generation, video & voice 👇',
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

const processedPhotos = new Map();

async function handlePhoto(ctx) {
  const chatId = ctx.chat.id;

  const msgKey = ctx.message?.message_id;
  if (msgKey && processedPhotos.has(msgKey)) return;
  if (msgKey) processedPhotos.set(msgKey, Date.now());

  const { first_name: name, username } = ctx.chat;
  await db.upsertUser(chatId, name, username);

  const sizes = ctx.message.photo;
  const maxPhoto = sizes[sizes.length - 1];

  if (maxPhoto.file_size > 20 * 1024 * 1024) {
    return await ctx.reply('❌ Photo is too large. Maximum size is 20MB.');
  }

  if (pendingPayment.has(chatId)) {
    const order = pendingPayment.get(chatId);
    await handlePaymentScreenshot(ctx, chatId, name, username, order, maxPhoto.file_id);
    return;
  }

  const caption = ctx.message.caption || '';
  const userModeEntry = userMode.get(chatId);
  const isUpscaleCmd = userModeEntry?.mode === 'upscale';
  const isUpscaleCaption = /^(\/upscale|upscale)/i.test(caption.trim());
  const doUpscale = isUpscaleCmd || isUpscaleCaption;
  if (isUpscaleCmd) userMode.delete(chatId);

  if (!(await takeCredit(ctx, chatId))) return;

  const processingMsg = await ctx.reply('⏳ Processing...');

  await processPhotoAsync(ctx, chatId, doUpscale, processingMsg)
    .catch(err => console.error('Background process error:', err.message));
}

bot.on('photo', handlePhoto);

bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  if (doc.file_size > 20 * 1024 * 1024) {
    return await ctx.reply('❌ File is too large. Maximum size is 20MB.');
  }
  const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (doc.mime_type && validTypes.includes(doc.mime_type)) {
    ctx.message.photo = [{ file_id: doc.file_id, file_size: doc.file_size }];
    return handlePhoto(ctx);
  }
  await ctx.reply('Please send a photo (JPG/PNG/WebP), not a file.');
});

const http = require('http');
const PORT = process.env.PORT || 3000;

function handleWithTimeout(botInstance, json) {
  return Promise.race([
    botInstance.handleUpdate(json),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Handler timed out after 60s')), 60000)),
  ]);
}

const server = http.createServer((req, res) => {
  if (req.url === '/webhook' || req.url === '/admin-webhook') {
    const bufs = [];
    req.on('data', chunk => bufs.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(bufs).toString();
      let json;
      try { json = JSON.parse(body); } catch {
        res.writeHead(400);
        res.end('Bad Request');
        return;
      }
      res.writeHead(200);
      res.end('OK');
      if (req.url === '/admin-webhook' && adminBot) {
        handleWithTimeout(adminBot, json).catch(e => console.error('Admin webhook error:', e.message));
      } else if (req.url === '/webhook') {
        handleWithTimeout(bot, json).catch(e => console.error('Main webhook error:', e.message));
      }
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot running');
});
server.timeout = 60000;

server.listen(PORT, () => {
  console.log(`Bot server on port ${PORT}`);
});

async function startBot() {
  await initPool();
  console.log('Admin bot:', adminBot ? 'enabled' : 'DISABLED (ADMIN_BOT_TOKEN not set)');
  console.log('ADMIN_CHAT_ID:', config.ADMIN_CHAT_ID || 'NOT SET');

  const baseUrl = process.env.RENDER_EXTERNAL_URL;
  const mainWebhook = baseUrl ? baseUrl + '/webhook' : null;
  const adminWebhook = baseUrl && config.ADMIN_BOT_TOKEN ? baseUrl + '/admin-webhook' : null;

  await bot.telegram.setMyCommands([
    { command: 'start', description: '👋 Welcome' },
    { command: 'help', description: '📖 How to use' },
    { command: 'imagine', description: '🎨 AI image from text' },
    { command: 'upscale', description: '🔍 4x HD upscale' },
    { command: 'video', description: '🎬 AI video from text' },
    { command: 'voice', description: '🎤 Text to speech' },
    { command: 'share', description: '🤝 Invite friends, earn credits' },
    { command: 'stats', description: '📊 Your usage stats' },
    { command: 'support', description: '💬 Contact support' },
    { command: 'premium', description: '🎬 Earn free credits' },
    { command: 'cancel', description: '❌ Cancel pending operation' },
  ]).catch(() => {});

  if (mainWebhook) {
    await bot.telegram.setWebhook(mainWebhook, { drop_pending_updates: true });
    console.log('Main webhook set:', mainWebhook);

    if (adminWebhook && adminBot) {
      adminBot.telegram.setWebhook(adminWebhook, { drop_pending_updates: true })
        .then(() => console.log('Admin webhook set:', adminWebhook))
        .catch(err => console.warn('Admin webhook setup failed (non-fatal):', err.message));
    }
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
