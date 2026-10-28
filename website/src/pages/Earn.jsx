import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../utils/api'

export default function Earn() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [status, setStatus] = useState('loading')
  const [msg, setMsg] = useState('Loading ad...')

  useEffect(() => {
    let done = false
    async function run() {
      try {
        if (typeof window.show_12137794 !== 'function') {
          setStatus('error')
          setMsg('Ad SDK not ready. Try again in a moment.')
          return
        }
        await api.post('/api/earn/start', { token })
        setMsg('Showing ad...')
        await window.show_12137794()
        if (done) return
        setMsg('Verifying reward...')
        const res = await api.post('/api/earn/claim', { token })
        done = true
        setStatus('success')
        setMsg(res.data?.message || `+${res.data?.credits || 3} credits added!`)
      } catch (e) {
        if (done) return
        done = true
        setStatus('error')
        setMsg(e?.response?.data?.error || 'Ad not completed. No credits added.')
      }
    }
    run()
    return () => { done = true }
  }, [token])

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white dark:bg-gray-900 rounded-xl shadow text-center">
      <h1 className="text-xl font-semibold mb-3">Earn Credits</h1>
      <p className="text-gray-600 dark:text-gray-300 mb-4">{msg}</p>
      {status === 'success' && <p className="text-green-600 font-medium">You can close this window and use the bot/app again.</p>}
      {status === 'error' && <p className="text-red-600">Close this window and try again later.</p>}
    </div>
  )
}
