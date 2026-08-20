import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAlert } from '../context/AlertContext'
import { login as loginRequest, setCookie } from '../api/auth.api'
import { useCompany } from '../hooks/useCompany'

// ─── Brand mark (text-based — swap for <img src={logo} /> once the client logo is supplied) ──
function BrandMark({ theme = 'dark', className = '' }) {
  const { data: companyDetails } = useCompany();
  const logo = companyDetails?.logo;
  const light = theme === 'light'

  return (
    <Link to="/" className={`inline-flex items-center gap-3 ${className}`}>
      {logo ? (
        <img src={logo} alt="Company Logo" className="h-12 w-auto object-contain" />
      ) : (
        <>
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display text-sm font-bold shadow-lg ${light ? 'bg-navy-950 text-white' : 'bg-white/95 text-navy-950'}`}>
            IN
          </div>
          <p className={`font-display text-[15px] font-semibold ${light ? 'text-navy-950' : 'text-white'}`}>
            Indo
          </p>
        </>
      )}
    </Link>
  )
}

function IconUser(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  )
}
function IconLock(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
      <path d="M8 10.5V7.75a4 4 0 0 1 8 0V10.5" />
    </svg>
  )
}
function IconEye(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function IconEyeOff(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.2 0 10 7 10 7a15.6 15.6 0 0 1-4.2 4.9M6.6 6.6C3.9 8.3 2 12 2 12s3.8 7 10 7c1.4 0 2.7-.3 3.9-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}
function IconShield(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

export default function Login() {
  // Remove dark-mode class on this page so white/light styles render correctly
  useEffect(() => {
    document.documentElement.classList.remove('dark')
    return () => document.documentElement.classList.add('dark')
  }, [])

  const toast = useAlert();
  const navigate = useNavigate();

  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    if (!username || !password) {
      setError('Enter your username and password to continue.')
      return
    }

    setSubmitting(true)
    try {
      const res = await loginRequest({ username, password, remember });

      if (res.status === 423) {
        setError(`Account locked. ${res.data.remainingTime ? `${res.data.remainingTime} min(s) remaining.` : res.data.message || ''}`)
      } else if (res.status === 403) {
        setError(res.data?.message || 'Access denied. Your account may be blocked or inactive.')
      } else if (res.status === 401) {
        if (res.data.attemptsRemaining !== undefined) {
          setError(`Invalid credentials. ${res.data.attemptsRemaining} attempt(s) left.`)
        } else {
          setError(res.data.message || 'Authentication failed')
        }
      } else if (res.status === 200 || res.data?.status === 'success') {
        toast.success('Logged in successfully!')
        setCookie('token', res.data.token, remember ? 30 : 1)
        setCookie('role', res.data.data?.user?.roleType || '', remember ? 30 : 1)
        window.location.href = res.data.redirectUrl || '/home'
      } else {
        setError(res.data?.message || 'Authentication failed')
      }
    } catch (err) {
      setError('A network error occurred. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen w-full font-body bg-slate-50 flex flex-col lg:flex-row">

      {/* ── LEFT — Brand Panel ── */}
      <div className="relative hidden lg:flex lg:w-[46%] xl:w-[42%] flex-col justify-between overflow-hidden bg-navy-950">
        {/* Ambient blobs */}
        <div className="pointer-events-none absolute -top-40 -left-32 h-[28rem] w-[28rem] rounded-full bg-brand-600/20 blur-[80px]" />
        <div className="pointer-events-none absolute bottom-10 right-0 h-72 w-72 rounded-full bg-brand-500/10 blur-[60px]" />
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full bg-brand-700/5 blur-[100px]" />

        {/* Logo */}
        <div className="relative z-10 px-10 pt-10">
          <BrandMark theme="dark" />
        </div>

        {/* Hero copy */}
        <div className="relative z-10 px-10 pb-4">
          <div className="mb-8">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-400 mb-6">
              <span className="h-1.5 w-1.5 animate-pulse2 rounded-full bg-stock-in" />
              OEE &amp; Production Monitoring
            </span>
            <h1 className="font-display text-[2.1rem] font-semibold leading-[1.18] text-white">
              Every machine,<br />measured every minute.
            </h1>
            <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-slate-400">
              Real-time Availability, Performance &amp; Quality tracking across every line, furnace, and shift.
            </p>
          </div>

          {/* Live OEE card */}
          <div className="animate-floatSlow rounded-2xl border border-white/10 bg-white/5 p-4 shadow-glow backdrop-blur-sm">
            {/* Card header */}
            <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Line 2 · Toughening Furnace</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Shift B &middot; 06:00 – 14:00</p>
              </div>
              <span className="flex items-center gap-1.5 rounded-full bg-stock-in/15 px-2.5 py-1 text-[10px] font-semibold text-stock-in">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-stock-in" />
                Live
              </span>
            </div>

            {/* Metrics */}
            <div className="space-y-2.5">
              {[
                { label: 'Availability', value: 92, color: 'bg-stock-in' },
                { label: 'Performance', value: 87, color: 'bg-brand-500' },
                { label: 'Quality', value: 98, color: 'bg-stock-in' },
              ].map((m) => (
                <div key={m.label}>
                  <div className="mb-1 flex items-center justify-between text-[10.5px]">
                    <span className="font-semibold text-slate-300">{m.label}</span>
                    <span className="font-display font-semibold text-white">{m.value}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div className={`h-full rounded-full ${m.color}`} style={{ width: `${m.value}%` }} />
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-between rounded-lg border border-brand-500/25 bg-brand-600/15 px-3 py-2 mt-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-brand-300">Overall OEE</span>
                <span className="font-display text-base font-bold text-white">78.4%</span>
              </div>
            </div>
          </div>

          {/* Trust indicators */}
          <div className="mt-6 flex flex-wrap items-center gap-4 pb-10">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <IconShield className="h-3.5 w-3.5 text-brand-400" />
              Enterprise-grade security
            </div>
            <span className="h-3 w-px bg-white/10" />
            <div className="text-[11px] text-slate-500">Role-based access</div>
            <span className="h-3 w-px bg-white/10" />
            <div className="text-[11px] text-slate-500">Shift-wise accuracy</div>
          </div>
        </div>

        {/* Footer */}
        <p className="relative z-10 px-10 pb-6 text-[11px] text-slate-600">
          © {new Date().getFullYear()} Indo Pvt Ltd. All rights reserved.
        </p>
      </div>

      {/* ── RIGHT — Login Form ── */}
      <div className="flex flex-1 flex-col items-center justify-center px-5 py-12 sm:px-10 lg:px-16 xl:px-20 min-h-screen lg:min-h-0 bg-slate-50">

        {/* Mobile logo */}
        <div className="mb-10 flex flex-col items-center lg:hidden">
          <BrandMark theme="light" />
        </div>

        <div className="w-full max-w-[400px]">
          {/* Form header */}
          <div className="mb-8">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-600">Welcome back</span>
            <h2 className="mt-2 font-display text-[1.75rem] font-semibold leading-tight text-slate-900">
              Sign in to your workspace
            </h2>
            <p className="mt-2 text-sm text-slate-500">Enter your credentials to access the OEE platform.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5" noValidate>
            {/* Username */}
            <div>
              <label htmlFor="login-username" className="mb-1.5 block text-sm font-medium text-slate-700">
                Username
              </label>
              <div className="relative">
                <IconUser className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400" />
                <input
                  id="login-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your.username"
                  autoComplete="username"
                  className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-800 shadow-card outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/12 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="login-password" className="text-sm font-medium text-slate-700">Password</label>
              </div>
              <div className="relative">
                <IconLock className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-slate-400" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-11 text-sm text-slate-800 shadow-card outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/12 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <IconEyeOff className="h-[17px] w-[17px]" /> : <IconEye className="h-[17px] w-[17px]" />}
                </button>
              </div>
            </div>

            {/* Remember me */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30 cursor-pointer"
                />
                <span className="text-sm text-slate-600">Remember me</span>
              </label>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2.5 rounded-xl border border-stock-critical/20 bg-stock-critical/8 px-3.5 py-3">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-stock-critical" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p className="text-xs font-medium text-stock-critical">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting || !username || !password}
              className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-navy-950 py-3.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-600 hover:shadow-glow disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-navy-950 disabled:hover:shadow-none"
            >
              {submitting ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Authenticating…
                </>
              ) : (
                <>
                  Sign in
                  <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </>
              )}
            </button>
          </form>

          {/* Footer note */}
          <p className="mt-8 text-center text-[11px] text-slate-400">
            Protected by end-to-end encryption. &nbsp;
            <Link to="/" className="font-medium text-slate-500 hover:text-brand-600">Back to home</Link>
          </p>
        </div>
      </div>
    </div>
  )
}