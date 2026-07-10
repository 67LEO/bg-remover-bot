import { useState } from 'react';
import { getVoices, generateVoice } from '../utils/api';

const LANGUAGES = [
  { code: 'english', name: 'English', native: 'English' },
  { code: 'hindi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'tamil', name: 'Tamil', native: 'தமிழ்' },
  { code: 'telugu', name: 'Telugu', native: 'తెలుగు' },
  { code: 'bengali', name: 'Bengali', native: 'বাংলা' },
  { code: 'marathi', name: 'Marathi', native: 'मराठी' },
  { code: 'gujarati', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'punjabi', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'urdu', name: 'Urdu', native: 'اردو' },
  { code: 'kannada', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'malayalam', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'spanish', name: 'Spanish', native: 'Español' },
  { code: 'french', name: 'French', native: 'Français' },
  { code: 'german', name: 'German', native: 'Deutsch' },
];

export default function Voice() {
  const [step, setStep] = useState('language');
  const [language, setLanguage] = useState('');
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectLanguage = async (code) => {
    setLanguage(code);
    setLoading(true);
    setError('');
    try {
      const data = await getVoices();
      setVoices(data.voices || []);
      setStep('voice');
    } catch (err) {
      if (err.code === 'ERR_NETWORK' || err.message?.includes('Network Error') || !err.response) {
        setError('Server not reachable. Make sure the backend is running (npm run dev).');
        return;
      }
      const data = err.response?.data;
      if (data?.needsLogin) {
        window.location.href = '/login';
        return;
      }
      setError('Failed to load voices');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedVoice || !text.trim()) return;
    setLoading(true);
    setError('');
    try {
      const blob = await generateVoice(selectedVoice.voiceId, text, language);
      setResult(URL.createObjectURL(blob));
    } catch (err) {
      if (err.code === 'ERR_NETWORK' || err.message?.includes('Network Error') || !err.response) {
        setError('Server not reachable. Make sure the backend is running (npm run dev).');
        return;
      }
      const data = err.response?.data;
      if (data?.needsLogin) {
        window.location.href = '/login';
        return;
      }
      setError(data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'language') {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-gray-100">🎤 Voice Generator</h1>
          <p className="text-gray-500 dark:text-gray-400">Select a language to get started.</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => selectLanguage(l.code)}
              disabled={loading}
              className="px-4 py-3 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-xl hover:border-pink-400 dark:hover:border-pink-500 hover:bg-pink-50 dark:hover:bg-pink-900/20 transition-colors text-left dark:text-gray-200"
            >
              <span className="text-base">{l.native}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500 block">{l.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold dark:text-gray-100">🎤 Voice Generator</h1>
        <p className="text-gray-500 dark:text-gray-400">Select a voice, type text, and generate speech.</p>
        <button onClick={() => { setStep('language'); setSelectedVoice(null); setResult(null); }} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline mt-1">
          ← Change language
        </button>
      </div>

      {!selectedVoice && (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {voices.map((v) => (
            <button
              key={v.voiceId}
              onClick={() => setSelectedVoice(v)}
              className="w-full text-left px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-pink-400 dark:hover:border-pink-500 hover:bg-pink-50 dark:hover:bg-pink-900/20 transition-colors dark:text-gray-200"
            >
              <span className="font-medium">{v.name}</span>
              {v.previewUrl && (
                <audio src={v.previewUrl} controls className="mt-1 h-8 w-full" onClick={(e) => e.stopPropagation()} />
              )}
            </button>
          ))}
        </div>
      )}

      {selectedVoice && (
        <>
          <div className="bg-pink-50 dark:bg-pink-900/30 rounded-xl px-4 py-3 text-sm dark:text-gray-200">
            <span className="font-medium">Voice selected:</span> {selectedVoice.name} ({LANGUAGES.find((l) => l.code === language)?.native})
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type the text you want to convert to speech..."
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 resize-none text-sm"
            rows={4}
            maxLength={1000}
          />

          <button
            onClick={handleGenerate}
            disabled={loading || !text.trim()}
            className="w-full py-3 text-white font-medium bg-pink-600 rounded-xl hover:bg-pink-700 disabled:opacity-50 transition-colors"
          >
            {loading ? '🔊 Generating...' : '🔊 Generate Speech'}
          </button>
        </>
      )}

      {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg px-4 py-2">{error}</div>}

      {result && (
        <div className="space-y-3">
          <audio src={result} controls className="w-full" />
          <div className="flex gap-3">
            <a href={result} download={`voice-${selectedVoice?.name || 'speech'}.ogg`} className="flex-1 py-2.5 text-center text-sm font-medium text-white bg-pink-600 rounded-xl hover:bg-pink-700">
              ⬇ Download
            </a>
            <button onClick={() => setResult(null)} className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700">Generate Again</button>
          </div>
        </div>
      )}
    </div>
  );
}
