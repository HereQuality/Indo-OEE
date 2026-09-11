import React from 'react';
import * as LucideIcons from 'lucide-react';

const iconKeys = Object.keys(LucideIcons);

const LEGACY_MAP = {
  people: 'Users',
  person: 'User',
  'person-badge': 'BadgeCheck',
  'person-workspace': 'Briefcase',
  'person-vcard': 'Contact',
  'person-check': 'UserCheck',
  'person-plus': 'UserPlus',
  'bar-chart': 'BarChart3',
  'graph-up-arrow': 'TrendingUp',
  'pie-chart': 'PieChart',
  'clipboard2-data': 'ClipboardList',
  'file-earmark-bar-graph': 'FileBarChart',
  gear: 'Settings',
  'sliders2-vertical': 'Sliders',
  toggles: 'ToggleLeft',
  'shield-lock': 'ShieldCheck',
  key: 'Key',
  lock: 'Lock',
  unlock: 'Unlock',
  folder: 'Folder',
  folder2: 'Folder',
  'file-earmark-text': 'FileText',
  'file-earmark-pdf': 'FileText',
  clipboard: 'Clipboard',
  'journal-text': 'BookOpen',
  archive: 'Archive',
  'cash-stack': 'Banknote',
  'currency-rupee': 'Coins',
  'receipt-cutoff': 'Receipt',
  wallet2: 'Wallet',
  'credit-card': 'CreditCard',
  'bag-fill': 'ShoppingBag',
  'chat-dots': 'MessageSquare',
  bell: 'Bell',
  envelope: 'Mail',
  telephone: 'Phone',
  grid: 'LayoutGrid',
  house: 'Home',
  speedometer2: 'Gauge',
  'layout-sidebar': 'Sidebar',
  'list-ul': 'List',
  table: 'Table',
  'card-list': 'LayoutList',
  'geo-alt': 'MapPin',
  building: 'Building',
  buildings: 'Building2'
};

const DynamicIcon = ({ name, defaultIcon = "Folder", className = "", size = 18, style, strokeWidth = 2 }) => {
  if (!name) {
    const Fallback = LucideIcons[defaultIcon] || LucideIcons.Folder;
    return <Fallback size={size} strokeWidth={strokeWidth} className={className} style={style} />;
  }

  if (LucideIcons[name]) {
    const Component = LucideIcons[name];
    return <Component size={size} strokeWidth={strokeWidth} className={className} style={style} />;
  }

  const cleanName = name
    .replace(/^bi bi-/, '')
    .replace(/-fill$/, '')
    .replace(/-/g, '');

  if (LEGACY_MAP[cleanName] && LucideIcons[LEGACY_MAP[cleanName]]) {
    const Component = LucideIcons[LEGACY_MAP[cleanName]];
    return <Component size={size} strokeWidth={strokeWidth} className={className} style={style} />;
  }

  const matchedKey = iconKeys.find(
    (k) => k.toLowerCase() === cleanName.toLowerCase()
  );

  const Component = matchedKey ? LucideIcons[matchedKey] : (LucideIcons[defaultIcon] || LucideIcons.Folder);
  return <Component size={size} strokeWidth={strokeWidth} className={className} style={style} />;
};

export default DynamicIcon;
