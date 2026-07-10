require('dotenv').config();

function reqEnv(name) {
  const v = process.env[name];
  if (v) return v;
  throw new Error(`Missing required env var: ${name}`);
}

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_SIGNUP_URL: 'https://identitytoolkit.googleapis.com/v1/accounts:signUp',
  FIREBASE_TOKEN_URL: 'https://securetoken.googleapis.com/v1/token',

  get MASK_API_URL() { return reqEnv('MASK_API_URL'); },
  get STARTUP_API_URL() { return reqEnv('STARTUP_API_URL'); },
  get UPSCALE_API_URL() { return reqEnv('UPSCALE_API_URL'); },
  get AI_GEN_API_URL() { return reqEnv('AI_GEN_API_URL'); },
  get AI_BG_API_URL() { return reqEnv('AI_BG_API_URL'); },

  PLATFORM_HEADER: process.env.PLATFORM_HEADER || 'android',
  APP_VER_HEADER: process.env.APP_VER_HEADER || '2026.19.02 (2395)',
  ENTITLEMENT_HEADER: process.env.ENTITLEMENT_HEADER || 'none',
  LANG_HEADER: process.env.LANG_HEADER || 'en-GB',
  TELEMETRY_HEADER: process.env.TELEMETRY_HEADER || 'false',
  TZ_HEADER: process.env.TZ_HEADER || 'UTC',

  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID ? Number(process.env.ADMIN_CHAT_ID) : null,
  ADMIN_BOT_TOKEN: process.env.ADMIN_BOT_TOKEN,

  UPI_ID: process.env.UPI_ID || '7435012637.wallet@phonepe',
  UPI_NAME: process.env.UPI_NAME || 'Mohit',
  PREMIUM_PLANS: {
    monthly: { label: 'Monthly', price: 49, days: 30 },
    yearly: { label: 'Yearly', price: 499, days: 365 },
  },

  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,

  get T2V_SIGN() { return reqEnv('T2V_SIGN'); },
  get T2V_API_BASE() { return process.env.T2V_API_BASE || 'https://t2v.aritek.app'; },

  FREE_LIMIT_DAILY: 10,
  REFERRAL_BONUS: 5,

  escMd: (t) => String(t).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&'),
};
