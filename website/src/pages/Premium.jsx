import { useState } from 'react';
import { createPremiumOrder, uploadScreenshot, getStats } from '../utils/api';

const plans = [
  { id: 'monthly', label: 'Monthly', price: 49, days: 30, popular: true },
  { id: 'yearly', label: 'Yearly', price: 499, days: 365, popular: false },
];

export default function Premium() {
  const [step, setStep] = useState('plans');
  const [order, setOrder] = useState(null);
  const [screenshot, setScreenshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selectPlan = async (planId) => {
    setLoading(true);
    setError('');
    try {
      const data = await createPremiumOrder(planId);
      setOrder(data);
      setStep('payment');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create order');
    } finally {
      setLoading(false);
    }
  };

  const handleScreenshot = async () => {
    if (!screenshot || !order) return;
    setLoading(true);
    setError('');
    try {
      await uploadScreenshot(order.orderRef, screenshot);
      setSuccess('✅ Screenshot received! Admin will verify and activate premium soon.');
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const plan = plans.find((p) => p.id === order?.plan);

  if (step === 'payment' && order) {
    return (
      <div className="max-w-lg mx-auto space-y-5">
        <h1 className="text-2xl font-bold dark:text-gray-100">⭐ Complete Payment</h1>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5 shadow-sm space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Plan</span>
            <span className="font-medium dark:text-gray-200">{plan?.label} Premium</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Amount</span>
            <span className="font-bold text-lg dark:text-gray-100">₹{plan?.price}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Order Ref</span>
            <code className="text-indigo-600 dark:text-indigo-400 font-mono">{order.orderRef}</code>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5 shadow-sm">
          <h3 className="font-semibold dark:text-gray-100 mb-3">📲 How to Pay</h3>
          <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-2 list-decimal list-inside">
            <li>Open any UPI app (Google Pay, PhonePe, Paytm)</li>
            <li>Scan the QR code below or pay to <strong>{order.upiId}</strong></li>
            <li>Send exactly <strong>₹{plan?.price}</strong> with reference <code className="text-indigo-600 dark:text-indigo-400">{order.orderRef}</code></li>
            <li>Take a screenshot of the payment confirmation</li>
            <li>Upload it below</li>
          </ol>
        </div>

        <div className="flex justify-center">
          <img src={order.qrUrl} alt="UPI QR" className="w-56 h-56 rounded-xl border dark:border-gray-700" />
        </div>

        <div
          className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
          onClick={() => document.getElementById('screenshot-input')?.click()}
        >
          <input id="screenshot-input" type="file" accept="image/*" className="hidden"
            onChange={(e) => setScreenshot(e.target.files?.[0] || null)} />
          {screenshot ? (
            <div>
              <p className="text-green-600 dark:text-green-400 font-medium">✅ Screenshot selected</p>
              <p className="text-xs text-gray-400">{screenshot.name}</p>
            </div>
          ) : (
            <div className="text-gray-400">
              <p className="text-3xl mb-1">📸</p>
              <p className="font-medium">Tap to upload payment screenshot</p>
            </div>
          )}
        </div>

        <button
          onClick={handleScreenshot}
          disabled={loading || !screenshot}
          className="w-full py-3 text-white font-medium bg-indigo-600 rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Uploading...' : '📤 Submit Screenshot'}
        </button>

        {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg px-4 py-2">{error}</div>}
        {success && <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 rounded-lg px-4 py-2">{success}</div>}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold dark:text-gray-100">⭐ Premium Plans</h1>
        <p className="text-gray-500 dark:text-gray-400">Unlock unlimited everything.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {plans.map((p) => (
          <div key={p.id} className={`bg-white dark:bg-gray-900 rounded-xl p-6 border shadow-sm relative ${p.popular ? 'border-indigo-300 dark:border-indigo-600 shadow-indigo-100 dark:shadow-none' : 'border-gray-200 dark:border-gray-800'}`}>
            {p.popular && <span className="absolute top-3 right-3 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-xs font-bold px-2 py-0.5 rounded-full">POPULAR</span>}
            <h3 className="font-semibold text-lg dark:text-gray-100">{p.label}</h3>
            <p className="text-3xl font-bold mt-2 dark:text-gray-100">₹{p.price}<span className="text-sm font-normal text-gray-400 dark:text-gray-500">/{p.id === 'monthly' ? 'mo' : 'yr'}</span></p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{p.days} days unlimited access</p>
            <ul className="mt-4 text-sm text-gray-600 dark:text-gray-400 space-y-1.5">
              <li>✓ Unlimited background removal</li>
              <li>✓ Unlimited HD upscale</li>
              <li>✓ Unlimited AI image generation</li>
              <li>✓ Unlimited AI video</li>
              <li>✓ Unlimited voice generation</li>
              <li>✓ Priority support</li>
            </ul>
            <button
              onClick={() => selectPlan(p.id)}
              disabled={loading}
              className={`mt-5 w-full py-2.5 text-sm font-medium rounded-lg transition-colors ${
                p.popular
                  ? 'text-white bg-indigo-600 hover:bg-indigo-700'
                  : 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'
              } disabled:opacity-50`}
            >
              {loading ? 'Processing...' : `Buy ₹${p.price}`}
            </button>
          </div>
        ))}
      </div>

      {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-lg px-4 py-2">{error}</div>}
    </div>
  );
}
