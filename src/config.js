require('dotenv').config();

const KEY = Buffer.from('bg@2026!secret#key', 'utf8');

function d(s) {
  const b = Buffer.from(s, 'base64');
  const r = Buffer.alloc(b.length);
  for (let i = 0; i < b.length; i++) r[i] = b[i] ^ KEY[i % KEY.length];
  return r.toString('utf8');
}

const E = {
  MASK: process.env.MASK_API_URL,
  STARTUP: process.env.STARTUP_API_URL,
  UPSCALE: process.env.UPSCALE_API_URL,
  AI_GEN: process.env.AI_GEN_API_URL,
};

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_SIGNUP_URL: 'https://identitytoolkit.googleapis.com/v1/accounts:signUp',
  FIREBASE_TOKEN_URL: 'https://securetoken.googleapis.com/v1/token',

  get MASK_API_URL() {
    return E.MASK || d('ChM0QkMIGQ4AAAQfABpXChEQDQltW15UU1MWCwAXSwRLBBEWEAgvXx5RWUxcE1JdCBVQAA==');
  },
  get STARTUP_API_URL() {
    return E.STARTUP || d('ChM0QkMIGQ4SFQpcFRxMHwoLDQgtHFNdWw4FVEwTFQQOGBEYEBM1Qh8=');
  },
  get UPSCALE_API_URL() {
    return E.UPSCALE || d('ChM0QkMIGQ4AABEEAAZPDhYKTwYwWx5CXk4HChEdChkNCAoUTRFyHUVCRUISCQY=');
  },
  get AI_GEN_API_URL() {
    return E.AI_GEN || d('ChM0QkMIGQ4AABEEAAZPDhYKTwYwWx5CXk4HChEdChkNCAoUTRFyHVFbG1UcCg8BShNGBQALAxMlH1lfV0YWFg==');
  },

  PLATFORM_HEADER: process.env.PLATFORM_HEADER || 'android',
  APP_VER_HEADER: process.env.APP_VER_HEADER || '2026.19.02 (2395)',
  ENTITLEMENT_HEADER: process.env.ENTITLEMENT_HEADER || 'none',
  LANG_HEADER: process.env.LANG_HEADER || 'en-GB',
  TELEMETRY_HEADER: process.env.TELEMETRY_HEADER || 'false',
  TZ_HEADER: process.env.TZ_HEADER || 'UTC',

  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID ? Number(process.env.ADMIN_CHAT_ID) : null,
  ADMIN_BOT_TOKEN: process.env.ADMIN_BOT_TOKEN,

  UPI_ID: process.env.UPI_ID || 'abc@fam',
  UPI_NAME: process.env.UPI_NAME || 'Mohit',
  PREMIUM_PLANS: {
    monthly: { label: 'Monthly', price: 49, days: 30 },
    yearly: { label: 'Yearly', price: 499, days: 365 },
  },

  FREE_LIMIT_DAILY: 10,
  REFERRAL_BONUS: 5,
};
