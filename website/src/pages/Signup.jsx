import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email || !password) { setError('Email and password required'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setBusy(true);
    try {
      await signup(email, password, displayName || email.split('@')[0]);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Signup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-white dark:from-gray-900 dark:to-gray-950 px-4 transition-colors">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link to="/" className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">🎨 AI Editor</Link>
          <p className="text-gray-500 dark:text-gray-400 mt-2">Create your free account</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-6 space-y-4">
          {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              placeholder="Your name (optional)"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              placeholder="At least 6 characters"
              autoComplete="new-password"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Creating account...' : 'Create Account'}
          </button>
          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            Already have an account? <Link to="/login" className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
