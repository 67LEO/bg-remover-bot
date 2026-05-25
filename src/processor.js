const config = require('./config');
const { ensureAuth, appStartup } = require('./firebase');
const sharp = require('sharp');

async function getUpscale(imageBuffer, scale = 2) {
  await appStartup();
  const { idToken } = await ensureAuth();

  const meta = await sharp(imageBuffer).metadata();
  const MAX_DIM = 800;
  if ((meta.width || 0) > MAX_DIM || (meta.height || 0) > MAX_DIM) {
    imageBuffer = await sharp(imageBuffer)
      .resize(MAX_DIM, MAX_DIM, { fit: 'inside' })
      .jpeg({ quality: 92 })
      .toBuffer();
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

  addFile('imageFile', 'image.jpg', imageBuffer, 'image/jpeg');
  addField('creativity', '0');
  addField('scale', String(scale));

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
}

async function getMask(imageBuffer) {
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
}

async function generateImage(prompt, style = 'ultra-realistic', size = 'SQUARE_HD') {
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
        throw new Error(`AI gen error: ${event.errorMessage || 'Unknown'}`);
      }
    } catch (e) {
      if (e.message.startsWith('AI gen error')) throw e;
    }
  }

  if (!imageUrl) throw new Error('No image URL in response');

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Download generated image failed: ${imgRes.status}`);
  return Buffer.from(await imgRes.arrayBuffer());
}

module.exports = { getMask, getUpscale, generateImage };
