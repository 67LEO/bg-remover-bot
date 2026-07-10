import { Link } from 'react-router-dom';

const features = [
  { icon: '✂️', title: 'Background Remover', desc: 'Remove backgrounds from any photo instantly with AI.', to: '/tools/bg-remove' },
  { icon: '🔍', title: '4x HD Upscaler', desc: 'Upscale images to 4x resolution without quality loss.', to: '/tools/upscale' },
  { icon: '🎨', title: 'AI Image Generator', desc: 'Create stunning images from text prompts with FLUX Pro.', to: '/tools/imagine' },
  { icon: '🎬', title: 'AI Video Generator', desc: 'Generate short videos from text descriptions.', to: '/tools/video' },
  { icon: '🎤', title: 'Voice Generator', desc: 'Convert text to speech in 14 languages with ElevenLabs.', to: '/tools/voice' },
  { icon: '🖼️', title: 'AI Background Replace', desc: 'Replace photo backgrounds with AI-generated scenes.', to: '/tools/bg-remove' },
];

const toolLinks = [
  { icon: '✂️', label: 'Remove BG', to: '/tools/bg-remove', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  { icon: '🔍', label: 'HD Upscale', to: '/tools/upscale', color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  { icon: '🎨', label: 'AI Imagine', to: '/tools/imagine', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
  { icon: '🎬', label: 'AI Video', to: '/tools/video', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  { icon: '🎤', label: 'AI Voice', to: '/tools/voice', color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300' },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-950 dark:to-gray-900 transition-colors">
      <header className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
        <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">🎨 AI Editor</span>
        <div className="flex gap-3">
          <Link to="/login" className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200">
            Login
          </Link>
          <Link to="/signup" className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors">
            Sign Up Free
          </Link>
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-4 pt-20 pb-16 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
          AI Image Editing, <span className="text-indigo-600 dark:text-indigo-400">Supercharged</span>
        </h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
          Remove backgrounds, upscale HD, generate images & videos from text — all free, right in your browser.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <Link to="/tools/bg-remove" className="px-8 py-3 text-lg font-medium text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 dark:shadow-none">
            ✂️ Try Background Remover
          </Link>
          <Link to="/signup" className="px-8 py-3 text-lg font-medium text-indigo-600 dark:text-indigo-400 bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-800 rounded-xl hover:bg-indigo-50 dark:hover:bg-gray-800 transition-colors">
            Sign Up Free
          </Link>
        </div>
        <p className="mt-3 text-sm text-gray-400 dark:text-gray-500">No login required. 10 free operations daily.</p>
      </section>

      {/* Quick tool links */}
      <section className="max-w-3xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {toolLinks.map((t) => (
            <Link key={t.to} to={t.to} className={`${t.color} rounded-xl p-4 text-center hover:scale-105 transition-transform`}>
              <div className="text-2xl mb-1">{t.icon}</div>
              <div className="text-xs font-medium">{t.label}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 pb-16">
        <h2 className="text-2xl font-bold text-center mb-8 dark:text-gray-100">Everything You Need</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f) => (
            <Link
              key={f.title} to={f.to}
              className="bg-white dark:bg-gray-900 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md dark:hover:border-gray-700 transition-all group"
            >
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{f.title}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{f.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 pb-20 text-center">
        <h2 className="text-2xl font-bold mb-6 dark:text-gray-100">Pricing</h2>
        <div className="grid sm:grid-cols-2 gap-5">
          <div className="bg-white dark:bg-gray-900 rounded-xl p-8 border border-gray-200 dark:border-gray-800 shadow-sm">
            <h3 className="text-lg font-semibold dark:text-gray-100">Free</h3>
            <p className="text-3xl font-bold mt-2 dark:text-gray-100">₹0</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">10 operations daily, no login</p>
            <ul className="mt-4 text-sm text-gray-600 dark:text-gray-400 space-y-2">
              <li>✓ Background Removal</li>
              <li>✓ 4x HD Upscale</li>
              <li>✓ AI Image Generation</li>
              <li>✓ AI Video (limited)</li>
              <li>✓ Voice Generation</li>
            </ul>
            <Link to="/tools/bg-remove" className="mt-6 block w-full py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
              Try Free — No Login
            </Link>
          </div>
          <div className="bg-indigo-600 rounded-xl p-8 text-white shadow-lg shadow-indigo-200 dark:shadow-none relative">
            <span className="absolute top-3 right-3 bg-yellow-400 text-indigo-900 text-xs font-bold px-2 py-0.5 rounded-full">POPULAR</span>
            <h3 className="text-lg font-semibold">Premium</h3>
            <p className="text-3xl font-bold mt-2">₹49<span className="text-base font-normal text-indigo-200">/mo</span></p>
            <p className="text-sm text-indigo-200 mt-1">Unlimited everything</p>
            <ul className="mt-4 text-sm text-indigo-100 space-y-2">
              <li>✓ Unlimited Background Removal</li>
              <li>✓ Unlimited HD Upscale</li>
              <li>✓ Unlimited AI Generation</li>
              <li>✓ Unlimited AI Video</li>
              <li>✓ Unlimited Voice Generation</li>
              <li>✓ Priority Support</li>
            </ul>
            <Link to="/signup" className="mt-6 block w-full py-2.5 text-sm font-medium text-indigo-700 bg-white rounded-lg hover:bg-indigo-50">
              Go Premium
            </Link>
          </div>
        </div>
      </section>

      <footer className="text-center text-xs text-gray-400 dark:text-gray-600 pb-6">
        Made with ❤️ in India
      </footer>
    </div>
  );
}
