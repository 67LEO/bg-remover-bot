import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getStats } from '../utils/api';

const tools = [
  { to: '/tools/bg-remove', icon: '✂️', label: 'Remove Background', desc: 'Remove background from any photo', color: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  { to: '/tools/upscale', icon: '🔍', label: 'HD Upscale', desc: '4x resolution boost', color: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  { to: '/tools/imagine', icon: '🎨', label: 'AI Imagine', desc: 'Generate images from text', color: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  { to: '/tools/video', icon: '🎬', label: 'AI Video', desc: 'Generate videos from text', color: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  { to: '/tools/voice', icon: '🎤', label: 'Voice Generator', desc: 'Text to speech in 14 languages', color: 'bg-pink-50 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300' },
];

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    getStats().then((d) => setStats(d.stats)).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold dark:text-gray-100">Welcome, {user?.displayName || 'there'} 👋</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">What would you like to create today?</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm">
            <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{stats.dailyUsed}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Used Today</p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm">
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {stats.isPremium ? '∞' : stats.dailyRemaining}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{stats.isPremium ? 'Unlimited' : 'Remaining'}</p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm">
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.isPremium ? '👑' : 'Free'}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Plan</p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm">
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.premiumUntil ? new Date(stats.premiumUntil).toLocaleDateString() : '—'}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Premium Until</p>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold dark:text-gray-100 mb-3">Tools</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tools.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-md dark:hover:border-gray-700 transition-all"
            >
              <div className={`inline-flex w-10 h-10 rounded-lg items-center justify-center text-lg ${t.color} mb-3`}>
                {t.icon}
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t.label}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t.desc}</p>
            </Link>
          ))}
        </div>
      </div>

      {!stats?.isPremium && (
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl p-5 text-white">
          <h3 className="font-bold text-lg">⭐ Go Premium</h3>
          <p className="text-indigo-100 text-sm mt-1">Unlimited everything — remove bg, upscale, AI generate, video & voice!</p>
          <Link to="/premium" className="inline-block mt-3 px-4 py-2 bg-white text-indigo-700 text-sm font-medium rounded-lg hover:bg-indigo-50">
            View Plans
          </Link>
        </div>
      )}
    </div>
  );
}
