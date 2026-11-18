const config = require('./config');
const { ensureAuth, rotateToken, appStartup } = require('./firebase');
const sharp = require('sharp');
const crypto = require('crypto');
class ContentViolationError extends Error {
  constructor(msg) { super(msg); this.name = 'ContentViolationError'; }
}

class Semaphore {
  constructor(max) { this.max = max; this.current = 0; this.queue = []; }
  async acquire() {
    if (this.current < this.max) { this.current++; return; }
    return new Promise(resolve => this.queue.push(resolve));
  }
  release() {
    if (this.queue.length > 0) { const next = this.queue.shift(); next(); }
    else { this.current--; }
  }
  async run(fn) {
    await this.acquire();
    try { return await fn(); }
    finally { this.release(); }
  }
}

const MAX_ROTATIONS = 6;

const apiSem = new Semaphore(5);

// Photoroom's per-account limits: 429 "entitlement-rate-limited", or 403 "entitlement-blocked / requires Pro"
function isEntitlementError(msg) {
  return msg.includes('failed: 429') ||
    (msg.includes('failed: 403') && /entitlement|upgrade to pro|requires pro/i.test(msg));
}

async function withRetry(fn) {
  await appStartup();
  const token = await ensureAuth();
  try {
    return await fn(token);
  } catch (err) {
    if (err instanceof ContentViolationError) throw err;
    const msg = err.message || '';
    const retryable = isEntitlementError(msg) || msg.includes('failed: 401') ||
                      msg.includes('failed: 403') || msg.includes('failed: 5');
    if (!retryable) throw err;

    const isEntitlement = isEntitlementError(msg);
    // 429 = temporary per-account rate limit: worth many fresh accounts.
    // 403 "requires Pro" = a feature/size gated for free accounts (measured: PORTRAIT sizes) - one fresh account is
    // enough to rule out a single blocked account; more would only burn Firebase sign-ups.
    const attempts = msg.includes('failed: 429') ? MAX_ROTATIONS : 1;
    let lastErr = err;
    let lastMsg = msg;
    for (let i = 0; i < attempts; i++) {
      console.warn(`[api] Token rotation (${i + 1}/${attempts})${isEntitlement ? ' [entitlement]' : ''}: ${lastMsg.slice(0, 100)}`);
      // 429 = temporary rate limit (cool-down, reusable later); 403 entitlement = this account is blocked (discard).
      // After the first rotation go straight to brand-new accounts: pooled ones may be blocked the same way.
      await rotateToken(lastMsg.includes('failed: 429'), { fresh: isEntitlement && (i > 0 || lastMsg.includes('failed: 403')) });
      await appStartup();
      const freshToken = await ensureAuth();
      try {
        return await fn(freshToken);
      } catch (e) {
        if (e instanceof ContentViolationError) throw e;
        lastErr = e;
        lastMsg = e.message || '';
        // keep rotating while the failure is an entitlement problem; stop early on anything else
        if (isEntitlement && isEntitlementError(lastMsg)) continue;
        break;
      }
    }
    throw lastErr;
  }
}

async function getUpscale(imageBuffer, scale = 4) {
  return apiSem.run(async () => {
    return withRetry(async ({ idToken, localId }) => {
      const img = sharp(imageBuffer);
      const meta = await img.metadata();
      const maxDim = Math.max(meta.width, meta.height);
      let sendBuf = imageBuffer;
      if (maxDim > 512) {
        const ratio = 512 / maxDim;
        const w = Math.round(meta.width * ratio);
        const h = Math.round(meta.height * ratio);
        sendBuf = await img.resize(w, h).jpeg().toBuffer();
      }

      const boundary = '----boundary' + Date.now();
      const enc = Buffer.from;
      const parts = [];

      const addField = (name, value) => {
        parts.push(enc('--' + boundary + '\r\n'));
        parts.push(enc('Content-Disposition: form-data; name="' + name + '"\r\n\r\n'));
        parts.push(enc(value + '\r\n'));
      };

      const addFile = (name, filename, buf, contentType) => {
        parts.push(enc('--' + boundary + '\r\n'));
        parts.push(enc('Content-Disposition: form-data; name="' + name + '"; filename="' + filename + '"\r\n'));
        parts.push(enc('Content-Type: ' + contentType + '\r\n\r\n'));
        parts.push(buf);
        parts.push(enc('\r\n'));
      };

      addFile('imageFile', 'image.jpg', sendBuf, 'image/jpeg');
      addField('creativity', '0');
      addField('scale', String(scale));
      addField('user_id', localId);

      parts.push(enc('--' + boundary + '--\r\n'));
      const body = Buffer.concat(parts);

      const res = await fetch(config.UPSCALE_API_URL, {
        method: 'POST',
        headers: {
          authorization: idToken,
          'pr-platform': config.PLATFORM_HEADER,
          'pr-app-version': config.APP_VER_HEADER,
          'pr-current-space-entitlement': config.ENTITLEMENT_HEADER,
          'pr-user-bcp-language': config.LANG_HEADER,
          'pr-telemetry-enabled': config.TELEMETRY_HEADER,
          'pr-main-subject-id': 'not_set',
          'pr-user-timezone': config.TZ_HEADER,
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
        },
        body,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Upscale failed: ${res.status} ${err.slice(0, 300)}`);
      }

      return Buffer.from(await res.arrayBuffer());
    });
  });
}

async function getMask(imageBuffer) {
  return apiSem.run(async () => {
    return withRetry(async ({ idToken, localId }) => {
      const formData = new FormData();
      const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
      formData.append('sourceImage', blob, 'image.jpg');
      formData.append('user_id', localId);
      formData.append('resize_mask', 'true');
      formData.append('model_type', 'u2net');
      formData.append('experiment_flag', 'default');

      const res = await fetch(config.MASK_API_URL, {
        method: 'POST',
        headers: {
          authorization: idToken,
          'pr-platform': config.PLATFORM_HEADER,
          'pr-app-version': config.APP_VER_HEADER,
          'pr-current-space-entitlement': config.ENTITLEMENT_HEADER,
          'pr-user-bcp-language': config.LANG_HEADER,
          'pr-telemetry-enabled': config.TELEMETRY_HEADER,
          'pr-user-timezone': config.TZ_HEADER,
        },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Mask failed: ${res.status} ${err.slice(0, 300)}`);
      }

      const data = await res.json();
      if (!data.b64_mask) throw new Error('No mask in response');
      return Buffer.from(data.b64_mask, 'base64');
    });
  });
}

// Photoroom only serves SQUARE_HD to free accounts: every other sizeId (SQUARE, PORTRAIT_*, LANDSCAPE_*) answers
// 403 "entitlement-blocked: requires Pro" (measured Nov 2026). Other ratios are therefore made by generating the
// free square image and cropping it to the requested ratio.
const FREE_SIZE = 'SQUARE_HD';
const CROP_RATIO = {
  PORTRAIT_3_2: [2, 3], PORTRAIT_4_3: [3, 4], PORTRAIT_16_9: [9, 16],
  LANDSCAPE_3_2: [3, 2], LANDSCAPE_4_3: [4, 3], LANDSCAPE_16_9: [16, 9],
};

async function cropToRatio(buf, rw, rh) {
  const { width, height } = await sharp(buf).metadata();
  let w = width, h = height;
  // largest rw:rh rectangle that fits inside the image
  if (w * rh > h * rw) w = Math.round(h * rw / rh); else h = Math.round(w * rh / rw);
  return sharp(buf).resize(w, h, { fit: 'cover', position: sharp.strategy.attention }).jpeg({ quality: 92 }).toBuffer();
}

async function generateImage(prompt, style = 'ultra-realistic', size = FREE_SIZE) {
  const square = await generateSquareImage(prompt, style);
  const ratio = CROP_RATIO[size];
  return ratio ? cropToRatio(square, ratio[0], ratio[1]) : square;
}

async function generateSquareImage(prompt, style = 'ultra-realistic') {
  return apiSem.run(async () => {
    return withRetry(async ({ idToken }) => {
      const body = {
        userPrompt: prompt,
        appId: 'expert',
        styleId: style,
        sizeId: FREE_SIZE,
        numberOfImages: 1,
      };

      const res = await fetch(config.AI_GEN_API_URL, {
        method: 'POST',
        headers: {
          authorization: idToken,
          'pr-app-version': config.APP_VER_HEADER,
          'pr-platform': config.PLATFORM_HEADER,
          'pr-current-space-entitlement': config.ENTITLEMENT_HEADER,
          'pr-user-bcp-language': config.LANG_HEADER,
          'pr-telemetry-enabled': config.TELEMETRY_HEADER,
          'pr-main-subject-id': 'not_set',
          'pr-user-timezone': config.TZ_HEADER,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`AI generate failed: ${res.status} ${err.slice(0, 300)}`);
      }

      const text = await res.text();
      let imageUrl = null;

      for (const part of text.split('\n\n')) {
        const dataLine = part.split('\n').find(l => l.startsWith('data:'));
        if (!dataLine) continue;
        try {
          const event = JSON.parse(dataLine.replace('data:', '').trim());
          if (event.eventType === 'aiImageResult' && event.imageUrl) {
            imageUrl = event.imageUrl;
            break;
          }
          if (event.eventType === 'error') {
            const errMsg = event.errorMessage || 'Unknown';
            if (errMsg.toLowerCase().includes('content polic')) {
              throw new ContentViolationError(errMsg);
            }
            throw new Error(`AI gen error: ${errMsg}`);
          }
        } catch (e) {
          if (e.message.startsWith('AI gen error')) throw e;
        }
      }

      if (!imageUrl) throw new Error('No image URL in response');

      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error(`Download generated image failed: ${imgRes.status}`);
      return Buffer.from(await imgRes.arrayBuffer());
    });
  });
}

async function getAiBackground(imageBuffer, maskBuffer, prompt) {
  return apiSem.run(async () => {
    return withRetry(async ({ idToken }) => {
      const formData = new FormData();
      formData.append('imageFile', new Blob([imageBuffer], { type: 'image/jpeg' }), 'image.png');
      formData.append('maskFile', new Blob([maskBuffer], { type: 'image/png' }), 'mask.png');
      formData.append('experimentFlag', 'default');
      formData.append('filterPrompt', '');
      formData.append('prompt', prompt);
      formData.append('negativePrompt', '');
      formData.append('sceneUuid', crypto.randomUUID());
      formData.append('seed', String(Math.floor(Math.random() * 1000000)));
      formData.append('aspectRatio', '1:1');
      formData.append('expandPrompt', 'true');

      const res = await fetch(config.AI_BG_API_URL, {
        method: 'POST',
        headers: {
          authorization: idToken,
          'pr-app-version': config.APP_VER_HEADER,
          'pr-platform': config.PLATFORM_HEADER,
          'pr-current-space-entitlement': config.ENTITLEMENT_HEADER,
          'pr-user-bcp-language': config.LANG_HEADER,
          'pr-telemetry-enabled': config.TELEMETRY_HEADER,
          'pr-main-subject-id': 'not_set',
          'pr-user-timezone': config.TZ_HEADER,
          'pr-feature-name': 'ai_background',
        },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`AI bg failed: ${res.status} ${err.slice(0, 300)}`);
      }

      return Buffer.from(await res.arrayBuffer());
    });
  });
}

module.exports = { getMask, getUpscale, generateImage, getAiBackground, ContentViolationError, withRetry, isEntitlementError, cropToRatio };
