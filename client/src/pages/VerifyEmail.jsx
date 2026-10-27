import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { LogoMark } from '../components/icons.jsx'
import { verifyEmailAddress } from '../api.js'

export default function VerifyEmail() {
  const location = useLocation()
  const token = new URLSearchParams(location.search).get('token') || ''
  const [status, setStatus] = useState('ready')
  const [error, setError] = useState('')

  async function handleVerify() {
    setError('')
    setStatus('verifying')
    try {
      await verifyEmailAddress(token)
      setStatus('verified')
    } catch (verificationError) {
      setError(verificationError.message || 'Unable to verify this email address.')
      setStatus('error')
    }
  }

  return (
    <section className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-card sm:p-10">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-brand-700">
        <LogoMark className="h-8 w-8" /> MediGuide
      </Link>
      <h1 className="mt-8 text-2xl font-extrabold text-slate-900">Verify your email address</h1>

      {status === 'verified' ? (
        <div className="mt-5" role="status">
          <p className="text-sm leading-relaxed text-emerald-800">
            Your email address is verified. Your account is now active.
          </p>
          <Link to="/login" className="btn-primary mt-6 inline-flex px-5 py-3">
            Continue to sign in
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Confirm that you own this email address to activate your MediGuide account.
          </p>
          {error && (
            <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </div>
          )}
          {!token ? (
            <p role="alert" className="mt-5 text-sm text-rose-800">
              This verification link is missing its token. Open the complete link from your email.
            </p>
          ) : (
            <button
              type="button"
              onClick={handleVerify}
              disabled={status === 'verifying'}
              className="btn-primary mt-6 w-full py-3"
            >
              {status === 'verifying' ? 'Verifying…' : 'Verify email'}
            </button>
          )}
        </>
      )}
    </section>
  )
}
