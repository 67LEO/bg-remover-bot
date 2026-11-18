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
function markIssued(chatId, kind = 'bot', at = Date.now()) {
  prune(issued);
  issued.set(chatId, { at, kind });
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
function claimApp(chatId, minWatchMs) {
  const e = issued.get(chatId);
  if (!e || e.kind !== 'app' || Date.now() - e.at > AD_TTL_MS) return 'none';
  if (Date.now() - e.at < minWatchMs) return 'early';
  issued.delete(chatId);
  return 'ok';
}

function markCredited(chatId) {
  prune(credited);
  credited.set(chatId, Date.now());
}

function wasCredited(chatId, withinMs = CREDITED_MEMORY_MS) {
  const t = credited.get(chatId);
  return !!t && Date.now() - t <= withinMs;
}

module.exports = { AD_DAILY_LIMIT, AD_REWARD_CREDITS, markIssued, consumeIssued, claimApp, markCredited, wasCredited };
