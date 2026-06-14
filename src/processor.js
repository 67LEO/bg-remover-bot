const config = require('./config');
const { ensureAuth, appStartup } = require('./firebase');
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

const apiSem = new Semaphore(5);

async function getUpscale(imageBuffer, scale = 4) {
  return apiSem.run(async () => {
    await appStartup();
    const { idToken, localId } = await ensureAuth();

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
}

async function getMask(imageBuffer) {
  return apiSem.run(async () => {
    await appStartup();
    const { idToken, localId } = await ensureAuth();

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
}

async function generateImage(prompt, style = 'ultra-realistic', size = 'SQUARE_HD') {
  return apiSem.run(async () => {
    await appStartup();
    const { idToken } = await ensureAuth();

    const body = {
      userPrompt: prompt,
      appId: 'expert',
      styleId: style,
      sizeId: size,
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
}

async function getAiBackground(imageBuffer, maskBuffer, prompt) {
  return apiSem.run(async () => {
    await appStartup();
    const { idToken } = await ensureAuth();

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
}

module.exports = { getMask, getUpscale, generateImage, getAiBackground, ContentViolationError };
