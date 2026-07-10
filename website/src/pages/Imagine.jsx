import { useState } from 'react';
import { imagine } from '../utils/api';

const sizes = [
  { id: 'SQUARE_HD', label: '⬛ Square 1:1' },
  { id: 'PORTRAIT_3_2', label: '📱 Portrait 3:2' },
  { id: 'PORTRAIT_4_3', label: '📐 Portrait 4:3' },
];

export default function Imagine() {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('SQUARE_HD');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    try {
      const blob = await imagine(prompt, size);
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
        <h1 className="text-2xl font-bold dark:text-gray-100">🎨 AI Image Generator</h1>
        <p className="text-gray-500 dark:text-gray-400">Describe what you want to see — powered by FLUX Pro.</p>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="A cute cat sitting on a windowsill, photorealistic, sunset lighting..."
        className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none text-sm"
        rows={3}
        maxLength={500}
      />

      <div className="flex flex-wrap gap-2">
        {sizes.map((s) => (
          <button
            key={s.id}
            onClick={() => setSize(s.id)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              size === s.id
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <button
        onClick={generate}
        disabled={loading || !prompt.trim()}
        className="w-full py-3 text-white font-medium bg-purple-600 rounded-xl hover:bg-purple-700 disabled:opacity-50 transition-colors"
      >
        {loading ? '🎨 Generating...' : '🎨 Generate Image'}
      </button>

      {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg px-4 py-2">{error}</div>}

      {result && (
        <div className="space-y-3">
          <img src={result} alt="generated" className="max-h-96 mx-auto rounded-lg border dark:border-gray-700" />
          <div className="flex gap-3">
            <a href={result} download="ai-image.jpg" className="flex-1 py-2.5 text-center text-sm font-medium text-white bg-purple-600 rounded-xl hover:bg-purple-700">
              ⬇ Download JPG
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
