import { useState, useRef } from 'react';
import { upscale } from '../utils/api';

export default function Upscale() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef();

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { setError('File too large (max 20MB)'); return; }
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setError('');
  };

  const process = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const blob = await upscale(file);
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
        <h1 className="text-2xl font-bold dark:text-gray-100">🔍 4x HD Upscale</h1>
        <p className="text-gray-500 dark:text-gray-400">Boost your image resolution by 4x with AI.</p>
      </div>

      <div
        className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-10 text-center cursor-pointer hover:border-green-400 dark:hover:border-green-500 transition-colors"
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
        {preview ? (
          <img src={preview} alt="preview" className="max-h-64 mx-auto rounded-lg" />
        ) : (
          <div className="text-gray-400">
            <p className="text-4xl mb-2">🖼️</p>
            <p className="font-medium">Tap to upload a photo</p>
            <p className="text-sm">JPG, PNG, WebP — max 20MB</p>
          </div>
        )}
      </div>

      {file && !result && (
        <button
          onClick={process}
          disabled={loading}
          className="w-full py-3 text-white font-medium bg-green-600 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {loading ? '⏳ Upscaling...' : '🔍 Upscale 4x HD'}
        </button>
      )}

      {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg px-4 py-2">{error}</div>}

      {result && (
        <div className="space-y-3">
          <img src={result} alt="result" className="max-h-80 mx-auto rounded-lg border dark:border-gray-700" />
          <div className="flex gap-3">
            <a href={result} download="hd-result.png" className="flex-1 py-2.5 text-center text-sm font-medium text-white bg-green-600 rounded-xl hover:bg-green-700">
              ⬇ Download PNG
            </a>
            <button onClick={() => { setFile(null); setPreview(null); setResult(null); }} className="px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700">
              Try Another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
