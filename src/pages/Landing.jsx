import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '../hooks/useCompany'

// Remove dark-mode override on this page (html has class="dark" globally)
function useLightMode() {
  useEffect(() => {
    document.documentElement.classList.remove('dark')
    return () => document.documentElement.classList.add('dark')
  }, [])
}

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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-navy-950 font-display text-sm font-bold text-white shadow-sm">
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

// ─── Data ────────────────────────────────────────────────────────────────────
const modules = [
  {
    title: 'Plant & Machine Hierarchy',
    desc: 'Plant, shop floor, production line, and machine — every OEE score rolls up cleanly at each level.',
    icon: (p) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
        <path d="M3 7.5 12 3l9 4.5M3 7.5v9L12 21m-9-4.5L12 21m0-13.5 9 4.5M12 7.5V21m9-13.5v9L12 21" />
      </svg>
    ),
  },
  {
    title: 'Shift-wise Production Capture',
    desc: 'Planned run time, actual output, and rejections logged per shift, per machine — as it happens.',
    icon: (p) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </svg>
    ),
  },
  {
    title: 'Downtime & Reason Tracking',
    desc: 'Every stoppage tagged with a reason code — breakdown, changeover, or material wait — until resolved.',
    icon: (p) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
        <path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4A9 9 0 0 1 8 19l-5 1 1-4.5A8.4 8.4 0 1 1 21 11.5Z" />
      </svg>
    ),
  },
  {
    title: 'Reports & Dashboards',
    desc: 'Live OEE dials, loss breakdowns, and line/machine comparisons for every level of the plant.',
    icon: (p) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
        <path d="M14 3v5h5M9 13h6M9 17h4" />
      </svg>
    ),
  },
]

const workflow = [
  { n: '01', title: 'Machine Setup', body: 'Define plants, lines, and machines. Set ideal cycle time, planned production time, and shift patterns for each.' },
  { n: '02', title: 'Production Planning', body: 'Assign shift-wise production targets to every line and machine before the shift starts.' },
  { n: '03', title: 'Real-time Capture', body: 'Operators log run/stop status, output count, and rejections on the shop floor — no end-of-day guesswork.' },
  { n: '04', title: 'Downtime Logging', body: 'Every stoppage is tagged with a reason code — breakdown, changeover, material wait — visible instantly to maintenance.' },
  { n: '05', title: 'Auto OEE Calculation', body: 'Availability × Performance × Quality is computed automatically, per machine, per shift, in real time.' },
  { n: '06', title: 'Reports & Trends', body: 'Loss breakdown, shift comparison, and machine-wise OEE trend rolls into one dashboard — plant to line to machine.' },
]

const stats = [
  { value: 'Real-time', label: 'Machine OEE tracking' },
  { value: 'A × P × Q', label: 'Availability · Performance · Quality' },
  { value: 'Shift-wise', label: 'Downtime & rejection logs' },
  { value: 'Live', label: 'Dashboards, every line' },
]

export default function Landing() {
  useLightMode()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="min-h-screen w-full bg-white font-body text-slate-800">

      {/* ── NAV ── */}
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 sm:px-8 lg:px-10">
          <BrandMark theme="light" />

          <div className="hidden items-center gap-3 sm:flex">
            <Link
              to="/login"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-all hover:border-brand-400 hover:text-brand-600"
            >
              Login
            </Link>
            <button className="rounded-lg bg-navy-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-600">
              Request a demo
            </button>
          </div>

          <button
            onClick={() => setMobileMenuOpen(v => !v)}
            className="flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-600 sm:hidden"
            aria-label="Toggle menu"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {mobileMenuOpen
                ? <path d="M6 18L18 6M6 6l12 12" />
                : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-slate-100 bg-white px-5 py-4 space-y-2 sm:hidden">
            <Link to="/login" onClick={() => setMobileMenuOpen(false)} className="block rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 text-center">Login</Link>
            <button className="w-full rounded-lg bg-navy-950 px-4 py-2.5 text-sm font-semibold text-white">Request a demo</button>
          </div>
        )}
      </header>

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-navy-950">
        <div className="pointer-events-none absolute -top-32 left-1/4 h-[30rem] w-[30rem] rounded-full bg-brand-600/15 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full bg-brand-500/10 blur-[80px]" />
        <div className="pointer-events-none absolute top-0 left-0 h-64 w-64 rounded-full bg-indigo-900/20 blur-[80px]" />

        <div className="relative mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:items-center lg:px-10 lg:py-28">
          {/* Left copy */}
          <div className="animate-fadeIn">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-400">
              <span className="h-1.5 w-1.5 rounded-full bg-stock-in animate-pulse2" />
              OEE &amp; Production Monitoring Platform
            </span>
            <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.13] text-white sm:text-5xl lg:text-[3.2rem]">
              Every machine,<br className="hidden sm:block" /> measured every minute.
            </h1>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-slate-400">
              Real-time Availability, Performance &amp; Quality tracking across every furnace, line, and cutting table at Indo.
            </p>
            <div className="mt-8 flex flex-wrap gap-3.5">
              <Link
                to="/login"
                className="group inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3.5 text-sm font-semibold text-white shadow-glow transition-all hover:bg-brand-700 hover:shadow-lg"
              >
                Sign in to your workspace
                <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
              <button className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-6 py-3.5 text-sm font-semibold text-white transition-all hover:bg-white/8">
                Request a demo
              </button>
            </div>
            <p className="mt-5 flex items-center gap-2 text-xs text-slate-500">
              <svg className="h-3.5 w-3.5 text-stock-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Trusted by production, maintenance, and plant operations teams.
            </p>
          </div>

          {/* Right — Live OEE card */}
          <div className="relative flex justify-center lg:justify-end animate-slideUp">
            <div className="w-full animate-floatSlow rounded-2xl border border-white/10 bg-white/6 p-5 shadow-2xl backdrop-blur-sm">
              {/* Card header */}
              <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Line 2 · Toughening Furnace</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Shift B &middot; 06:00 – 14:00</p>
                </div>
                <span className="flex items-center gap-1.5 rounded-full bg-stock-in/15 px-2.5 py-1 text-[10px] font-semibold text-stock-in">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-stock-in" />Live
                </span>
              </div>

              <div className="space-y-3.5">
                {[
                  { label: 'Availability', value: 92, color: 'bg-stock-in' },
                  { label: 'Performance', value: 87, color: 'bg-brand-500' },
                  { label: 'Quality', value: 98, color: 'bg-stock-in' },
                ].map((m) => (
                  <div key={m.label}>
                    <div className="mb-1.5 flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-slate-300">{m.label}</span>
                      <span className="font-display font-semibold text-white">{m.value}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div className={`h-full rounded-full ${m.color}`} style={{ width: `${m.value}%` }} />
                    </div>
                  </div>
                ))}

                <div className="flex items-center justify-between rounded-xl border border-brand-500/25 bg-brand-600/15 px-3.5 py-3 mt-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-brand-300">Overall OEE</span>
                  <span className="font-display text-lg font-bold text-white">78.4%</span>
                </div>
              </div>

              <Link
                to="/login"
                className="mt-4 flex items-center justify-center gap-1.5 rounded-xl bg-white/6 py-2.5 text-xs font-semibold text-white transition-all hover:bg-white/12"
              >
                Open full report
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS STRIP ── */}
      <section className="border-b border-slate-100 bg-slate-50">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-5 py-10 sm:grid-cols-4 sm:px-8 lg:px-10">
          {stats.map((s) => (
            <div key={s.label} className="text-center sm:text-left">
              <p className="font-display text-2xl font-semibold text-navy-950">{s.value}</p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── LIFECYCLE ── */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10">
        <div className="mb-12">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-600">The OEE cycle</span>
          <h2 className="mt-2 font-display text-3xl font-semibold text-navy-950 sm:text-4xl">
            From machine setup to trend report —<br className="hidden sm:block" /> one continuous flow.
          </h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-500">
            Every shift follows a structured path: machine setup, production planning, real-time capture, downtime logging, automatic OEE calculation, and a final trend report.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {workflow.map((step, idx) => (
            <div
              key={step.n}
              className="group relative rounded-2xl border border-slate-100 bg-white p-6 shadow-card transition-all hover:-translate-y-1 hover:border-brand-200 hover:shadow-card-hover"
            >
              <div className="absolute top-5 right-5 font-display text-[11px] font-bold tracking-widest text-slate-200 group-hover:text-brand-200 transition-colors">
                {step.n}
              </div>
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600/8 text-brand-600 transition-all group-hover:bg-brand-600 group-hover:text-white group-hover:shadow-glow">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {idx === 0 && <><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>}
                  {idx === 1 && <><path d="M16 3h5v5M8 21H3v-5" /><path d="M21 3 9 15M3 21l5-5" /></>}
                  {idx === 2 && <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>}
                  {idx === 3 && <path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4A9 9 0 0 1 8 19l-5 1 1-4.5A8.4 8.4 0 1 1 21 11.5Z" />}
                  {idx === 4 && <><path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /><circle cx="12" cy="12" r="3.5" /></>}
                  {idx === 5 && <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>}
                </svg>
              </div>
              <h3 className="font-display text-base font-semibold text-navy-950">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── MODULES ── */}
      <section className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10">
          <div className="mb-12 max-w-xl">
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-600">What's inside</span>
            <h2 className="mt-2 font-display text-3xl font-semibold text-navy-950 sm:text-4xl">
              Everything your production team needs, one workspace.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-500">
              Built around how a real shift actually runs — from machine setup to a closed-out OEE report, without switching tools.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {modules.map((m) => (
              <div
                key={m.title}
                className="group rounded-2xl border border-slate-100 bg-white p-6 shadow-card transition-all hover:-translate-y-1 hover:border-slate-200 hover:shadow-card-hover"
              >
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600/8 text-brand-600 transition-transform group-hover:scale-110">
                  <m.icon className="h-5 w-5" />
                </div>
                <h3 className="font-display text-base font-semibold text-navy-950">{m.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BAND ── */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10">
        <div className="relative overflow-hidden rounded-3xl bg-navy-950 px-8 py-16 text-center sm:px-14">
          <div className="pointer-events-none absolute -top-20 left-10 h-72 w-72 rounded-full bg-brand-600/20 blur-[80px]" />
          <div className="pointer-events-none absolute -bottom-10 right-10 h-56 w-56 rounded-full bg-brand-500/10 blur-[60px]" />
          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-400 mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-stock-in animate-pulse2" />
              Get started today
            </span>
            <h2 className="font-display text-3xl font-semibold text-white sm:text-4xl">
              Bring every machine into one view.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[15px] text-slate-400">
              Sign in to reach your OEE dashboard, or talk to us about rolling this out across the plant.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3.5">
              <Link
                to="/login"
                className="group inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3.5 text-sm font-semibold text-white shadow-glow transition-all hover:bg-brand-700 hover:shadow-lg"
              >
                Login to workspace
                <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
              <button className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-6 py-3.5 text-sm font-semibold text-white transition-all hover:bg-white/8">
                Talk to sales
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-navy-950">
        <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8 lg:px-10">
          <div className="flex flex-col gap-10 border-b border-white/8 pb-10 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-xs">
              <BrandMark theme="dark" />
              <p className="mt-4 text-sm leading-relaxed text-slate-400">
                Real-time OEE tracking, downtime capture, and production reporting for Indo Pvt Ltd.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-14 gap-y-4 text-sm sm:grid-cols-3">
              <div className="space-y-3">
                <p className="font-semibold text-white">Product</p>
                <p className="text-slate-400">OEE Dashboard</p>
                <p className="text-slate-400">Downtime Analysis</p>
                <p className="text-slate-400">Reports</p>
              </div>
              <div className="space-y-3">
                <p className="font-semibold text-white">Company</p>
                <p className="text-slate-400">About</p>
                <p className="text-slate-400">Contact</p>
              </div>
              <div className="space-y-3">
                <p className="font-semibold text-white">Access</p>
                <Link to="/login" className="block text-brand-400 hover:text-brand-300 transition-colors">Login</Link>
                <p className="text-slate-400">Request a demo</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-start justify-between gap-4 pt-6 sm:flex-row sm:items-center">
            <p className="text-xs text-slate-500">
              © {new Date().getFullYear()} Indo Pvt Ltd. All rights reserved.
            </p>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="cursor-pointer hover:text-slate-400 transition-colors">Privacy Policy</span>
              <span className="h-3 w-px bg-white/10" />
              <span className="cursor-pointer hover:text-slate-400 transition-colors">Terms of Service</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}