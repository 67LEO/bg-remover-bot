const config = require('./config');

const BASE_URL = 'https://api.elevenlabs.io/v1';

const LANGUAGE_MAP = {
  english: 'en', hindi: 'hi', tamil: 'ta', telugu: 'te', bengali: 'bn',
  marathi: 'mr', gujarati: 'gu', punjabi: 'pa', urdu: 'ur',
  kannada: 'kn', malayalam: 'ml', spanish: 'es', french: 'fr', german: 'de',
};

const SUPPORTED_LANGUAGES = [
  { code: 'english',   name: 'English USA',    native: 'English' },
  { code: 'hindi',     name: 'Hindi',          native: 'हिन्दी' },
  { code: 'tamil',     name: 'Tamil',          native: 'தமிழ்' },
  { code: 'telugu',    name: 'Telugu',         native: 'తెలుగు' },
  { code: 'bengali',   name: 'Bengali',        native: 'বাংলা' },
  { code: 'marathi',   name: 'Marathi',        native: 'मराठी' },
  { code: 'gujarati',  name: 'Gujarati',       native: 'ગુજરાતી' },
  { code: 'punjabi',   name: 'Punjabi',        native: 'ਪੰਜਾਬੀ' },
  { code: 'urdu',      name: 'Urdu',           native: 'اردو' },
  { code: 'kannada',   name: 'Kannada',        native: 'ಕನ್ನಡ' },
  { code: 'malayalam', name: 'Malayalam',      native: 'മലയാളം' },
  { code: 'spanish',   name: 'Spanish Spain',  native: 'Español' },
  { code: 'french',    name: 'French France',  native: 'Français' },
  { code: 'german',    name: 'German',         native: 'Deutsch' },
];

async function getVoices() {
  if (!config.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not set');
  const res = await fetch(`${BASE_URL}/voices`, {
    headers: { 'xi-api-key': config.ELEVENLABS_API_KEY },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs voices failed: ${res.status} ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.voices || []).map(v => ({
    voiceId: v.voice_id,
    name: v.name,
    previewUrl: v.preview_url,
  }));
}

async function generateSpeech(voiceId, text, language) {
  if (!config.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not set');

  const isMultilingual = language !== 'english';
  const body = {
    text,
    model_id: isMultilingual ? 'eleven_multilingual_v2' : 'eleven_turbo_v2_5',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      use_speaker_boost: true,
    },
  };

  if (isMultilingual && LANGUAGE_MAP[language]) {
    body.language_code = LANGUAGE_MAP[language];
  }

  const res = await fetch(`${BASE_URL}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': config.ELEVENLABS_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    if (isMultilingual && res.status >= 400) {
      delete body.language_code;
      const retry = await fetch(`${BASE_URL}/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': config.ELEVENLABS_API_KEY,
        },
        body: JSON.stringify(body),
      });
      if (!retry.ok) {
        const retryErr = await retry.text();
        throw new Error(`ElevenLabs TTS failed: ${retry.status} ${retryErr.slice(0, 200)}`);
      }
      return Buffer.from(await retry.arrayBuffer());
    }
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${err.slice(0, 200)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

module.exports = { getVoices, generateSpeech, SUPPORTED_LANGUAGES, LANGUAGE_MAP };
