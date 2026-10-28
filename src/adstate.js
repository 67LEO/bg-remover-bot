// Shared between the bot (issues ads) and the reward callback (web-api.js). Both run in one process.
// A reward is only granted for an ad the bot actually sent to that user, and each ad pays out once.
const AD_DAILY_LIMIT = parseInt(process.env.AD_DAILY_LIMIT || '5'); // rewards per user per day
const AD_REWARD_CREDITS = 3;
const AD_TTL_MS = 60 * 60 * 1000; // AdsGram reward links stay valid for 1 hour

const issued = new Map(); // chatId -> ms timestamp of the last ad sent

function markIssued(chatId) {
  if (issued.size > 5000) issued.clear();
  issued.set(chatId, Date.now());
}

// true (and the ad is used up) if this user was sent an ad within the last hour
function consumeIssued(chatId) {
  const at = issued.get(chatId);
  if (!at || Date.now() - at > AD_TTL_MS) return false;
  issued.delete(chatId);
  return true;
}

module.exports = { AD_DAILY_LIMIT, AD_REWARD_CREDITS, markIssued, consumeIssued };
