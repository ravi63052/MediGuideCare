import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { LogoMark, ShieldCheckIcon } from '../components/icons.jsx'
import { verifyRegistrationEmail } from '../api.js'

export default function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const [status, setStatus] = useState({
    loading: false,
    message: '',
    error: token ? '' : 'This verification link is missing or invalid.',
  })

  async function handleVerify() {
    setStatus({ loading: true, message: '', error: '' })
    try {
      const result = await verifyRegistrationEmail(token)
      setStatus({ loading: false, message: result.message, error: '' })
    } catch (error) {
      setStatus({
        loading: false,
        message: '',
        error: error.message || 'This verification link is invalid or has expired.',
      })
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-card lg:grid-cols-[0.9fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-800 via-brand-700 to-brand-500 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <Link to="/" className="inline-flex w-fit items-center gap-3">
          <LogoMark className="h-11 w-11" />
          <span className="text-xl font-extrabold">MediGuide</span>
        </Link>
        <div>
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-brand-100">ACCOUNT SECURITY</span>
          <h1 className="mt-4 text-4xl font-extrabold leading-tight">Verify your email address.</h1>
          <p className="mt-5 max-w-sm leading-relaxed text-brand-50/90">Confirm your email to activate your MediGuide account.</p>
        </div>
        <p className="text-xs leading-relaxed text-brand-100/80">MediGuide is an educational demo. Please use synthetic information only.</p>
      </aside>
      <section className="p-6 sm:p-10 lg:p-12">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-brand-700 lg:hidden">
          <LogoMark className="h-8 w-8" /> MediGuide
        </Link>
        <div className="mx-auto max-w-md">
          <span className="mt-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 lg:mt-0">
            <ShieldCheckIcon className="h-6 w-6" />
          </span>
          <p className="mt-6 text-sm font-bold uppercase tracking-widest text-brand-600">Email verification</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">Activate your account</h2>
          {token && !status.message && !status.error && (
            <div className="mt-7 space-y-4">
              <p className="text-sm leading-relaxed text-slate-600">Confirm that you want to verify this email address and activate your account.</p>
              <button type="button" onClick={handleVerify} disabled={status.loading} className="btn-primary w-full py-3">
                {status.loading ? 'Verifying…' : 'Verify email address'}
              </button>
            </div>
          )}
          {status.message && (
            <div role="status" className="mt-7 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-relaxed text-emerald-900">
              <p className="font-semibold">{status.message}</p>
              <Link to="/login" className="mt-4 inline-flex font-bold text-brand-700 hover:text-brand-800">
                Continue to sign in
              </Link>
            </div>
          )}
          {status.error && (
            <div role="alert" className="mt-7 rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm leading-relaxed text-rose-800">
              <p>{status.error}</p>
              <Link to="/register" className="mt-4 inline-flex font-bold text-brand-700 hover:text-brand-800">
                Return to registration
              </Link>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
