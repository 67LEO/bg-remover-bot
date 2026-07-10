import { useState } from 'react';
import { generateVideo } from '../utils/api';

export default function Video() {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    try {
      const blob = await generateVideo(prompt);
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

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold dark:text-gray-100">🎬 AI Video Generator</h1>
        <p className="text-gray-500 dark:text-gray-400">Generate short videos from text descriptions.</p>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="A cat playing piano in a garden, cinematic style..."
        className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none text-sm"
        rows={3}
        maxLength={500}
      />

      <button
        onClick={generate}
        disabled={loading || !prompt.trim()}
        className="w-full py-3 text-white font-medium bg-orange-600 rounded-xl hover:bg-orange-700 disabled:opacity-50 transition-colors"
      >
        {loading ? '🎬 Generating video... (~1-2 min)' : '🎬 Generate Video'}
      </button>

      {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg px-4 py-2">{error}</div>}

      {result && (
        <div className="space-y-3">
          <video src={result} controls className="w-full max-h-96 rounded-lg border dark:border-gray-700 bg-black" />
          <div className="flex gap-3">
            <a href={result} download="video.mp4" className="flex-1 py-2.5 text-center text-sm font-medium text-white bg-orange-600 rounded-xl hover:bg-orange-700">
              ⬇ Download MP4
            </a>
            <button onClick={() => { setResult(null); }} className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700">
              Generate More
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
