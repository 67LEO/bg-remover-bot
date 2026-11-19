// Shared between the bot (issues ads), the Mini App endpoints and the AdsGram reward callback (web-api.js).
// All run in one process. A reward is only granted for an ad that was actually started for that user,
// and each started ad pays out once, whichever path (AdsGram callback or Mini App claim) arrives first.
const AD_DAILY_LIMIT = parseInt(process.env.AD_DAILY_LIMIT || '5'); // rewards per user per day
const AD_REWARD_CREDITS = 3;
const AD_TTL_MS = 60 * 60 * 1000; // AdsGram reward links stay valid for 1 hour
const CREDITED_MEMORY_MS = 2 * 60 * 1000;

const issued = new Map();   // chatId -> { at, kind: 'bot' | 'app' }
const credited = new Map(); // chatId -> ms of the last reward (lets the page tell "already credited" from "never watched")

function prune(map) { if (map.size > 5000) map.clear(); }

// kind 'bot': a CPC bot ad was sent to the chat. kind 'app': the Mini App video was started.
function markIssued(chatId, kind = 'bot', at = Date.now(), ymid = null) {
  prune(issued);
  issued.set(chatId, { at, kind, ymid });
}

// true (and the ad is used up) if an ad of any kind was started for this user within the last hour.
// Used by the AdsGram server callback, which AdsGram only sends after the ad was really completed.
function consumeIssued(chatId) {
  const e = issued.get(chatId);
  if (!e || Date.now() - e.at > AD_TTL_MS) return false;
  issued.delete(chatId);
  return true;
}

// Mini App page claim: 'ok' (used up) | 'early' (video can't be finished yet) | 'none' (nothing started).
// With a ymid (Monetag) the started ad must be that exact one.
function claimApp(chatId, minWatchMs, ymid = null) {
  const e = issued.get(chatId);
  if (!e || e.kind !== 'app' || Date.now() - e.at > AD_TTL_MS) return 'none';
  if (ymid && e.ymid !== ymid) return 'none';
  if (Date.now() - e.at < minWatchMs) return 'early';
  issued.delete(chatId);
  return 'ok';
}

// Monetag's server-to-server postbacks, by ymid. Only Monetag (it knows the secret in the postback URL) can create these.
const postbacks = new Map(); // ymid -> { valued, telegramId, at }

function recordPostback(ymid, { valued, telegramId }) {
  prune(postbacks);
  const prev = postbacks.get(ymid);
  // an ad show sends an impression and maybe a click postback with the same ymid; paid if either was paid
  postbacks.set(ymid, { valued: !!(valued || (prev && prev.valued)), telegramId: telegramId || (prev && prev.telegramId) || '', at: Date.now() });
}

// Resolves with the postback for this ymid, or null if none arrives within `timeoutMs` (the SDK confirms a few seconds late).
async function waitPostback(ymid, timeoutMs = 6000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const p = postbacks.get(ymid);
    if (p) return p;
    if (Date.now() >= end) return null;
    await new Promise(r => setTimeout(r, 300));
  }
}

function dropPostback(ymid) { postbacks.delete(ymid); }

function markCredited(chatId) {
  prune(credited);
  credited.set(chatId, Date.now());
}

function wasCredited(chatId, withinMs = CREDITED_MEMORY_MS) {
  const t = credited.get(chatId);
  return !!t && Date.now() - t <= withinMs;
}

module.exports = {
  AD_DAILY_LIMIT, AD_REWARD_CREDITS, markIssued, consumeIssued, claimApp, markCredited, wasCredited,
  recordPostback, waitPostback, dropPostback,
};
