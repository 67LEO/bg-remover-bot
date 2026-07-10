import { useState, useRef, useCallback } from 'react';
import { bgRemove } from '../utils/api';

function BeforeAfter({ before, after }) {
  const [pos, setPos] = useState(50);
  const containerRef = useRef(null);
  const dragging = useRef(false);

  const onMove = useCallback((e) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left;
    setPos(Math.max(0, Math.min(100, (x / rect.width) * 100)));
  }, []);

  const onStart = () => { dragging.current = true; };
  const onEnd = () => { dragging.current = false; };

  return (
    <div
      ref={containerRef}
      className="relative select-none overflow-hidden rounded-lg border"
      style={{ aspectRatio: 'auto' }}
      onMouseMove={onMove}
      onTouchMove={onMove}
      onMouseUp={onEnd}
      onTouchEnd={onEnd}
      onMouseLeave={onEnd}
    >
      <img src={after} alt="after" className="block w-full" draggable={false} />
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      >
        <img src={before} alt="before" className="block w-full" draggable={false} />
      </div>
      <div
        className="absolute inset-y-0 w-1 bg-white cursor-ew-resize"
        style={{ left: `${pos}%` }}
        onMouseDown={onStart}
        onTouchStart={onStart}
      >
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-md flex items-center justify-center text-xs font-bold text-gray-700">
          ⟷
        </div>
      </div>
      <span className="absolute top-2 left-2 text-xs font-medium text-white bg-black/50 px-2 py-0.5 rounded">Original</span>
      <span className="absolute top-2 right-2 text-xs font-medium text-white bg-black/50 px-2 py-0.5 rounded">Processed</span>
    </div>
  );
}

export default function BgRemove() {
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
      const { blob } = await bgRemove(file);
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
        <h1 className="text-2xl font-bold">✂️ Remove Background</h1>
        <p className="text-gray-500">Upload a photo and remove its background instantly.</p>
      </div>

      <div
        className="border-2 border-dashed border-gray-200 rounded-xl p-10 text-center cursor-pointer hover:border-indigo-400 transition-colors"
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
        {preview ? (
          <img src={preview} alt="preview" className="max-h-64 mx-auto rounded-lg" />
        ) : (
          <div className="text-gray-400">
            <p className="text-4xl mb-2">📸</p>
            <p className="font-medium">Tap to upload a photo</p>
            <p className="text-sm">JPG, PNG, WebP — max 20MB</p>
          </div>
        )}
      </div>

      {file && !result && (
        <button
          onClick={process}
          disabled={loading}
          className="w-full py-3 text-white font-medium bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? '⏳ Processing...' : '✂️ Remove Background'}
        </button>
      )}

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</div>}

      {result && preview && (
        <div className="space-y-3">
          <BeforeAfter before={preview} after={result} />
          <div className="grid grid-cols-2 gap-3">
            <a
              href={result}
              download="result.png"
              className="py-2.5 text-center text-sm font-medium text-white bg-green-600 rounded-xl hover:bg-green-700"
            >
              ⬇ Download PNG
            </a>
            <button
              onClick={() => { setFile(null); setPreview(null); setResult(null); }}
              className="py-2.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200"
            >
              Try Another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
