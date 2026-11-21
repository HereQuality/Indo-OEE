import googlePlayBadge from '../../assets/google-play-badge.png'
import appStoreBadge from '../../assets/app-store-badge.svg'
import { PLAY_STORE_URL, APP_STORE_URL } from '../../utils/appStoreLinks'

// The stores' own badge artwork, both at the same height as their guidelines ask.
const BADGES = [
  { key: 'android', href: PLAY_STORE_URL, src: googlePlayBadge, alt: 'Get it on Google Play', label: 'Get Indo OEE on Google Play (opens in a new tab)' },
  { key: 'ios', href: APP_STORE_URL, src: appStoreBadge, alt: 'Download on the App Store', label: 'Download Indo OEE on the App Store (opens in a new tab)' },
]

/**
 * "Get the mobile app" — Android and iOS store badges, each opening the app's
 * store page in a new tab.
 *   tone="light" for light backgrounds (Login), "dark" for navy ones.
 *   align="center" | "start" — where the badges sit; the divider label only
 *   shows when centred.
 */
export default function AppStoreBadges({ className = '', tone = 'light', align = 'center', label = 'Get the mobile app' }) {
  const dark = tone === 'dark'
  const centred = align === 'center'
  return (
    <div className={className}>
      {label && (
        <div className={`flex items-center gap-3 ${centred ? '' : 'max-w-xs'}`} aria-hidden="true">
          {centred && <span className={`h-px flex-1 ${dark ? 'bg-white/10' : 'bg-slate-200'}`} />}
          <span className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{label}</span>
          <span className={`h-px flex-1 ${dark ? 'bg-white/10' : 'bg-slate-200'}`} />
        </div>
      )}
      <div className={`${label ? 'mt-4' : ''} flex flex-wrap items-center gap-3 ${centred ? 'justify-center' : 'justify-start'}`}>
        {BADGES.map((badge) => (
          <a
            key={badge.key}
            href={badge.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={badge.label}
            className={`inline-block rounded-lg transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 ${dark ? 'focus-visible:ring-offset-navy-950' : ''}`}
          >
            <img src={badge.src} alt={badge.alt} className="block h-11 w-auto" draggable="false" />
          </a>
        ))}
      </div>
    </div>
  )
}
