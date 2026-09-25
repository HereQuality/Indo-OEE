import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../utils/lucide_icon_map.dart';

/// Renders an icon by the name stored in Menu Master / Menu Group
/// (lucide-react names such as "LayoutDashboard"; older rows may hold
/// Bootstrap-style names such as "bi bi-people"). Unknown names fall back to a
/// folder.
class DynamicIcon extends StatelessWidget {
  const DynamicIcon(this.name, {super.key, this.size = 20, this.color, this.fallback});

  final String? name;
  final double size;
  final Color? color;
  final IconData? fallback;

  static const Map<String, String> _legacy = {
    'people': 'Users',
    'person': 'User',
    'personbadge': 'BadgeCheck',
    'personworkspace': 'Briefcase',
    'personvcard': 'Contact',
    'personcheck': 'UserCheck',
    'personplus': 'UserPlus',
    'barchart': 'BarChart3',
    'graphuparrow': 'TrendingUp',
    'piechart': 'PieChart',
    'clipboard2data': 'ClipboardList',
    'fileearmarkbargraph': 'FileBarChart',
    'gear': 'Settings',
    'sliders2vertical': 'Sliders',
    'toggles': 'ToggleLeft',
    'shieldlock': 'ShieldCheck',
    'key': 'Key',
    'lock': 'Lock',
    'unlock': 'Unlock',
    'folder': 'Folder',
    'folder2': 'Folder',
    'fileearmarktext': 'FileText',
    'fileearmarkpdf': 'FileText',
    'clipboard': 'Clipboard',
    'journaltext': 'BookOpen',
    'archive': 'Archive',
    'cashstack': 'Banknote',
    'currencyrupee': 'Coins',
    'receiptcutoff': 'Receipt',
    'wallet2': 'Wallet',
    'creditcard': 'CreditCard',
    'bagfill': 'ShoppingBag',
    'chatdots': 'MessageSquare',
    'bell': 'Bell',
    'envelope': 'Mail',
    'telephone': 'Phone',
    'grid': 'LayoutGrid',
    'house': 'House',
    'speedometer2': 'Gauge',
    'layoutsidebar': 'PanelLeft',
    'listul': 'List',
    'table': 'Table',
    'cardlist': 'LayoutList',
    'geoalt': 'MapPin',
    'building': 'Building',
    'buildings': 'Building2',
    'home': 'House',
  };

  /// Resolves [name] to an icon (public so pickers can reuse it).
  static IconData resolve(String? name, {IconData? fallback}) {
    final dflt = fallback ?? LucideIcons.folder;
    if (name == null || name.trim().isEmpty) return dflt;
    final n = name.trim();
    final direct = kLucideIcons[n];
    if (direct != null) return direct;
    final clean = n.replaceFirst(RegExp(r'^bi bi-'), '').replaceAll(RegExp(r'-fill$'), '').replaceAll('-', '');
    final legacy = _legacy[clean.toLowerCase()];
    if (legacy != null && kLucideIcons[legacy] != null) return kLucideIcons[legacy]!;
    final lower = clean.toLowerCase();
    for (final e in kLucideIcons.entries) {
      if (e.key.toLowerCase() == lower) return e.value;
    }
    return dflt;
  }

  @override
  Widget build(BuildContext context) => Icon(resolve(name, fallback: fallback), size: size, color: color);
}
