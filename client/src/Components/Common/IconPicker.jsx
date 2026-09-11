import React, { useState, useRef, useEffect } from 'react';
import DynamicIcon from './DynamicIcon';

const ICONS = [
  // Dashboard / General
  'LayoutGrid', 'Home', 'Gauge', 'Sidebar', 'LayoutList', 'AppWindow', 'Columns3',
  // People / HR
  'Users', 'User', 'UserCheck', 'UserPlus', 'BadgeCheck', 'Briefcase', 'Contact',
  // Charts / Reports
  'BarChart3', 'TrendingUp', 'PieChart', 'Activity', 'ClipboardList', 'FileBarChart',
  // Settings / Admin
  'Settings', 'Sliders', 'ToggleLeft', 'ShieldCheck', 'Key', 'Lock', 'Unlock',
  // Files / Docs
  'Folder', 'FileText', 'FileCode', 'Clipboard', 'BookOpen', 'Archive',
  // Finance
  'Banknote', 'Receipt', 'Wallet', 'CreditCard', 'ShoppingBag', 'Coins',
  // Communication
  'MessageSquare', 'Bell', 'Mail', 'Phone', 'Headphones',
  // Tools
  'Wrench', 'Hammer', 'Cpu', 'Terminal',
  // Calendar / Time
  'Calendar', 'Clock', 'CalendarCheck',
  // Lists / Tables
  'List', 'Table', 'Layout', 'Layers',
  // Stars / Misc
  'Star', 'Bookmark', 'Tag', 'Flag', 'Zap', 'Trophy', 'Award',
  // Location
  'MapPin', 'Map', 'Compass', 'Navigation', 'Building2', 'Building'
];

const IconPicker = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  const filtered = search
    ? ICONS.filter((ic) => ic.toLowerCase().includes(search.toLowerCase()))
    : ICONS;

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const select = (icon) => {
    onChange(icon);
    setOpen(false);
    setSearch('');
  };

  const clear = () => { onChange(''); };

  return (
    <div ref={ref} className="relative">
      <label className="block text-sm font-medium mb-1.5 text-slate-700">
        Icon <span className="text-xs text-slate-400 font-normal">(optional)</span>
      </label>

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm transition-all hover:border-blue-400 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15"
      >
        <span className="flex items-center gap-2.5">
          {value ? (
            <>
              <DynamicIcon name={value} size={18} className="text-slate-700" />
              <span className="text-slate-600 text-xs font-mono">{value}</span>
            </>
          ) : (
            <span className="text-slate-400">Select an icon…</span>
          )}
        </span>
        <span className="flex items-center gap-1">
          {value && (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); clear(); }}
              className="text-slate-400 hover:text-red-500 p-0.5 rounded transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </span>
          )}
          <svg className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search icons…"
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400"
            />
          </div>
          <div className="grid grid-cols-6 gap-1.5 p-2 max-h-48 overflow-y-auto">
            <button
              type="button"
              title="None"
              onClick={() => select('')}
              className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all hover:bg-red-50 hover:border-red-200 ${!value ? 'bg-red-100 border-red-400 text-red-700' : 'border-slate-200 text-slate-400'}`}
            >
              <span className="text-xs font-semibold">None</span>
            </button>
            {filtered.map((icon) => (
              <button
                key={icon}
                type="button"
                title={icon}
                onClick={() => select(icon)}
                className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all hover:bg-blue-50 hover:border-blue-200 ${value === icon ? 'bg-blue-100 border-blue-400 text-blue-700' : 'border-transparent text-slate-600'}`}
              >
                <DynamicIcon name={icon} size={20} />
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-6 py-4 text-center text-xs text-slate-400">No icons found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default IconPicker;