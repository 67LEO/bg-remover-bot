import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useEffect, useState } from 'react';

const navLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
  { to: '/tools/bg-remove', label: 'Remove BG', icon: '✂️' },
  { to: '/tools/upscale', label: 'Upscale', icon: '🔍' },
  { to: '/tools/imagine', label: 'Imagine', icon: '🎨' },
  { to: '/tools/video', label: 'Video', icon: '🎬' },
  { to: '/tools/voice', label: 'Voice', icon: '🎤' },
  { to: '/premium', label: 'Premium', icon: '⭐' },
];

export default function Layout() {
  const { user, isAuthenticated, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950 transition-colors">
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-50 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <Link to={isAuthenticated ? '/dashboard' : '/'} className="font-bold text-lg text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
              🎨 AI Editor
            </Link>
            <div className="hidden md:flex items-center gap-1 overflow-x-auto scrollbar-hide">
              {navLinks.filter((l) => isAuthenticated || l.to !== '/dashboard').map((l) => {
                const active = location.pathname === l.to;
                return (
                  <Link
                    key={l.to}
                    to={l.to}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    {l.icon} {l.label}
                  </Link>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDark((d) => !d)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                title={dark ? 'Light mode' : 'Dark mode'}
              >
                {dark ? '☀️' : '🌙'}
              </button>
              {isAuthenticated ? (
                <>
                  <span className="text-sm text-gray-500 dark:text-gray-400 hidden sm:block">{user?.displayName || user?.email}</span>
                  <button onClick={logout} className="text-sm text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium">Logout</button>
                </>
              ) : (
                <>
                  <button onClick={() => navigate('/login')} className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 font-medium">Login</button>
                  <button onClick={() => navigate('/signup')} className="text-sm text-white bg-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-700 font-medium">Sign Up</button>
                </>
              )}
            </div>
          </div>
          {/* Mobile nav */}
          <div className="md:hidden flex gap-1 overflow-x-auto pb-2 scrollbar-hide">
            {navLinks.filter((l) => isAuthenticated || l.to !== '/dashboard').map((l) => {
              const active = location.pathname === l.to;
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${
                    active ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {l.icon} {l.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 sm:px-6">
        <Outlet />
      </main>
      <footer className="text-center text-xs text-gray-400 dark:text-gray-600 py-4 border-t dark:border-gray-800 transition-colors">
        Made with ❤️ in India
      </footer>
    </div>
  );
}
