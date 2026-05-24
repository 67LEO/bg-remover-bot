const config = require('./config');
const { ensureAuth, appStartup } = require('./firebase');

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

module.exports = { getMask };
