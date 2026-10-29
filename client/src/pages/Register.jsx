import { useState } from 'react'
import { Link } from 'react-router-dom'

import { LogoMark, ShieldCheckIcon, UserIcon } from '../components/icons.jsx'
import PasswordRequirements from '../components/PasswordRequirements.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { isPasswordValid } from '../utils/passwordRules.js'

export default function Register() {
  const { register } = useAuth()
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [verificationSent, setVerificationSent] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    setIsSubmitting(true)
    try {
      if (form.password !== form.confirmPassword) {
        setError('Your passwords do not match.')
        return
      }
      if (!isPasswordValid(form.password)) {
        setError('Meet all password requirements before creating your account.')
        return
      }

      const result = await register({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
      })
      setVerificationSent(true)
      setError('')
      setSuccessMessage(result.message)
    } catch (err) {
      setError(err.message || 'Unable to create your account right now.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function resendVerificationLink() {
    setError('')
    setIsSubmitting(true)
    try {
      const result = await register({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
      })
      setSuccessMessage(result.message)
      setVerificationSent(true)
    } catch (err) {
      setError(err.message || 'Unable to resend the verification link.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-card">
      <div className="grid lg:grid-cols-[0.8fr_1.2fr]">
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-800 via-brand-700 to-brand-500 p-10 text-white lg:flex">
          <div aria-hidden="true" className="absolute -bottom-16 -left-12 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <Link to="/" className="relative inline-flex w-fit items-center gap-3 rounded-xl">
            <LogoMark className="h-11 w-11" />
            <span className="text-xl font-extrabold tracking-tight">MediGuide</span>
          </Link>
          <div className="relative py-12">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-brand-100">
              Get started
            </span>
            <h1 className="mt-4 text-4xl font-extrabold leading-tight">
              Make room for a more organized care journey.
            </h1>
            <p className="mt-5 leading-relaxed text-brand-50/90">
              Create an account to explore appointments, medicine information and healthcare guidance in one place.
            </p>
          </div>
          <div className="relative flex items-start gap-3 rounded-2xl border border-white/20 bg-white/10 p-4">
            <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-xs leading-relaxed text-brand-50">
              Your password is hashed before storage. This demo should only be used with synthetic information.
            </p>
          </div>
        </aside>

        <section className="p-6 sm:p-10 lg:p-12">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-brand-700 lg:hidden">
            <LogoMark className="h-8 w-8" /> MediGuide
          </Link>
          <div className="mx-auto max-w-md">
            <span className="mt-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 lg:mt-0">
              <UserIcon className="h-6 w-6" />
            </span>
            <p className="mt-6 text-sm font-bold uppercase tracking-widest text-brand-600">
              Create your account
            </p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">
              Join MediGuide
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              Start with your name, email address and a strong password.
            </p>

            {error && (
              <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {error}
              </div>
            )}

            {verificationSent ? (
              <div className="mt-7 space-y-4">
                <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-relaxed text-emerald-900">
                  <p className="font-semibold">{successMessage}</p>
                  <p className="mt-2">Check your inbox and open the verification link to activate your account. The link expires in 24 hours.</p>
                  <p className="mt-2">If you don’t see it, check your spam folder.</p>
                </div>
                <button type="button" disabled={isSubmitting} onClick={resendVerificationLink} className="btn-primary w-full py-3">
                  {isSubmitting ? 'Sending…' : 'Resend verification link'}
                </button>
                <button type="button" disabled={isSubmitting} onClick={() => setVerificationSent(false)} className="w-full py-2 text-sm font-semibold text-brand-700 hover:text-brand-800">
                  Back to registration
                </button>
              </div>
            ) : (
            <form onSubmit={handleSubmit} className="mt-7 space-y-4">
              <div>
                <label htmlFor="fullName" className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Full name
                </label>
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={80}
                  value={form.fullName}
                  onChange={update}
                  placeholder="Your full name"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={form.email}
                  onChange={update}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label htmlFor="password" className="block text-sm font-semibold text-slate-700">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="text-xs font-semibold text-brand-700 hover:text-brand-800"
                  >
                    {showPassword ? 'Hide' : 'Show'} password
                  </button>
                </div>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  maxLength={72}
                  value={form.password}
                  onChange={update}
                  placeholder="At least 8 characters"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
                <PasswordRequirements password={form.password} />
              </div>
              <div>
                <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-semibold text-slate-700">
                  Confirm password
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  maxLength={72}
                  value={form.confirmPassword}
                  onChange={update}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <button type="submit" disabled={isSubmitting} className="btn-primary mt-2 w-full py-3">
                {isSubmitting ? 'Creating account…' : 'Create account'}
              </button>
            </form>
            )}

            <p className="mt-6 text-center text-sm text-slate-600">
              Already have an account?{' '}
              <Link to="/login" className="font-bold text-brand-700 hover:text-brand-800">
                Sign in
              </Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
