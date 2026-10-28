// AdsGram bot-ad client: https://docs.adsgram.ai/bots/block-integration
const API_URL = process.env.ADSGRAM_API_URL || 'https://api.adsgram.ai/advbot';

function isConfigured() {
  return !!(process.env.ADSGRAM_BLOCK_ID && process.env.ADSGRAM_TOKEN);
}

// Returns { text_html, click_url, button_name, image_url, button_reward_name, reward_url } or null when no ad is available.
async function fetchAd(tgid, languageCode) {
  const blockId = String(process.env.ADSGRAM_BLOCK_ID).replace(/\D/g, ''); // numeric part only, no "bot-" prefix
  const qs = new URLSearchParams({
    tgid: String(tgid),
    blockid: blockId,
    language: (languageCode || 'en').slice(0, 2).toLowerCase(),
    token: process.env.ADSGRAM_TOKEN,
  });
  const res = await fetch(`${API_URL}?${qs}`);
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 120);
    // 4xx from AdsGram with no ad (no fill) is normal; auth/config problems are logged for the operator
    console.error(`AdsGram advbot ${res.status}: ${body}`);
    return null;
  }
  const ad = await res.json().catch(() => null);
  if (!ad || !ad.click_url || !ad.reward_url) return null;
  return ad;
}

module.exports = { isConfigured, fetchAd };
