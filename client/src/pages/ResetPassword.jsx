import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { LockIcon, LogoMark } from '../components/icons.jsx'
import PasswordRequirements from '../components/PasswordRequirements.jsx'
import { completePasswordReset } from '../api.js'
import { isPasswordValid } from '../utils/passwordRules.js'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    if (password !== confirmation) return setError('The passwords do not match.')
    if (!isPasswordValid(password)) return setError('Meet all password requirements before continuing.')
    if (new TextEncoder().encode(password).length > 72) return setError('Password must contain no more than 72 UTF-8 bytes.')
    setIsSubmitting(true)
    try {
      const result = await completePasswordReset({ token, password })
      setMessage(result.message || 'Password updated. You can now sign in.')
    } catch (err) {
      setError(err.message || 'This reset link is invalid or has expired.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-card lg:grid-cols-[0.9fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-800 via-brand-700 to-brand-500 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <Link to="/" className="inline-flex w-fit items-center gap-3"><LogoMark className="h-11 w-11" /><span className="text-xl font-extrabold">MediGuide</span></Link>
        <div><span className="text-xs font-bold uppercase tracking-[0.2em] text-brand-100">ACCOUNT SECURITY</span><h1 className="mt-4 text-4xl font-extrabold leading-tight">Choose a new password.</h1><p className="mt-5 max-w-sm leading-relaxed text-brand-50/90">Use a strong password that you don’t use elsewhere.</p></div>
        <p className="text-xs leading-relaxed text-brand-100/80">MediGuide is an educational demo. Please use synthetic information only.</p>
      </aside>
      <section className="p-6 sm:p-10 lg:p-12">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-brand-700 lg:hidden"><LogoMark className="h-8 w-8" /> MediGuide</Link>
        <div className="mx-auto max-w-md">
          <span className="mt-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 lg:mt-0"><LockIcon className="h-6 w-6" /></span>
          <p className="mt-6 text-sm font-bold uppercase tracking-widest text-brand-600">Account recovery</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">Reset your password</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-500">Choose a strong new password that meets all the requirements below.</p>
          {error && <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
          {message ? <div role="status" className="mt-7 rounded-xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm text-blue-900">{message}</div> : !token ? (
            <div role="alert" className="mt-7 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">This reset link is missing or invalid. Request a new one below.</div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-7 space-y-5">
              <div><div className="mb-1.5 flex items-center justify-between gap-3"><label htmlFor="new-password" className="text-sm font-semibold text-slate-700">New password</label><button type="button" aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)} className="text-xs font-semibold text-brand-700 hover:text-brand-800">{showPassword ? 'Hide' : 'Show'} password</button></div><input id="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={72} required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" /><PasswordRequirements password={password} /></div>
              <div><label htmlFor="confirm-password" className="mb-1.5 block text-sm font-semibold text-slate-700">Confirm new password</label><input id="confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} maxLength={72} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" /></div>
              <button type="submit" disabled={isSubmitting} className="btn-primary w-full py-3">{isSubmitting ? 'Updating…' : 'Update password'}</button>
            </form>
          )}
          <p className="mt-6 text-center text-sm"><Link to="/login" className="font-bold text-brand-700 hover:text-brand-800">Back to sign in</Link></p>
          {!token && <p className="mt-3 text-center text-sm"><Link to="/forgot-password" className="font-semibold text-brand-700 hover:text-brand-800">Request a new reset link</Link></p>}
        </div>
      </section>
    </div>
  )
}
