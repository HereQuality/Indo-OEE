import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';

/// The tones the web sheet colours its columns with: a soft indigo for
/// calculated figures, teal for the day-window ones, blue for the three OEE
/// percentages, orange for rejects. [readable] lifts them on the dark surfaces
/// the same way [AppColors.readable] does.
class SheetTones {
  SheetTones._();

  static const Color calc = Color(0xFF4F46E5);
  static const Color day = Color(0xFF0D9488);
  static const Color oee = AppColors.brand600;
  static const Color reject = Color(0xFFEA580C);
  static const Color downtime = Color(0xFF0D9488);
  static const Color lock = AppColors.warn;

  static Color text(BuildContext context, Color tone) => AppColors.readable(context, tone);

  static Color wash(BuildContext context, Color tone) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return tone.withValues(alpha: dark ? 0.20 : 0.10);
  }
}

/// A stable colour per machine: the machine's own `color` when it is a valid
/// hex / CSS-style colour, else a palette pick from its place in the sheet order.
class MachineColors {
  MachineColors._();

  static const List<Color> _palette = [
    Color(0xFF2563EB),
    Color(0xFF0D9488),
    Color(0xFFD97706),
    Color(0xFF7C3AED),
    Color(0xFFDB2777),
    Color(0xFF059669),
    Color(0xFFEA580C),
    Color(0xFF0891B2),
  ];

  static const Map<String, Color> _named = {
    'red': Color(0xFFDC2626),
    'orange': Color(0xFFEA580C),
    'yellow': Color(0xFFCA8A04),
    'green': Color(0xFF16A34A),
    'teal': Color(0xFF0D9488),
    'blue': Color(0xFF2563EB),
    'indigo': Color(0xFF4F46E5),
    'purple': Color(0xFF7C3AED),
    'pink': Color(0xFFDB2777),
    'brown': Color(0xFF92400E),
    'grey': Color(0xFF64748B),
    'gray': Color(0xFF64748B),
  };

  static Color of(Map<String, dynamic>? machine, int rank) {
    final parsed = _parse('${machine?['color'] ?? ''}');
    if (parsed != null) return parsed;
    return _palette[(rank < 0 ? 0 : rank) % _palette.length];
  }

  static Color? _parse(String raw) {
    final s = raw.trim().toLowerCase();
    if (s.isEmpty) return null;
    if (_named.containsKey(s)) return _named[s];
    final m = RegExp(r'^#?([0-9a-f]{6}|[0-9a-f]{3})$').firstMatch(s);
    if (m == null) return null;
    var hex = m.group(1)!;
    if (hex.length == 3) hex = hex.split('').map((c) => '$c$c').join();
    final v = int.tryParse(hex, radix: 16);
    if (v == null) return null;
    final c = Color(0xFF000000 | v);
    // Near-white / near-black tints vanish on one of the two themes.
    final l = c.computeLuminance();
    return (l > 0.9 || l < 0.02) ? null : c;
  }
}

/// The plain-English formula behind every calculated figure — shown from the
/// info tap beside its label, the phone's version of the web header's eye icon.
const Map<String, String> sheetFormulas = {
  'cycle': "The Part's own Total Cycle Time, minus any operation unticked for this entry.",
  'shift': 'Machine Shift Time = MOD(Machine OFF Time − Machine ON Time, 1) × 24',
  'idealQty':
      "Ideal Quantity = FLOOR(Machine Shift Time × 3600 ÷ Total Cycle Time) — the most the shift could make, so Actual Quantity can't be more than this.",
  'rejectedQty':
      'Rejected Quantity = Actual Quantity − OK Quantity, so OK + Rejected = Actual. The breakdown shows how that total splits across the reasons entered on the form.',
  'pctOk': '% OK Quantity = OK Quantity ÷ (OK Quantity + Rejected Quantity)',
  'unutilized': 'Unutilized Machine Time = (12 − (Shift Hours − Lunch ÷ 60)) ÷ 11, for this entry alone.',
  'totalStoppage':
      'Total Stoppage = Lunch / Rest (open Planned Operator Shift Time) + the downtime columns opened here: Setup Time … Other.',
  'stoppageAllowed':
      'Stoppage Allowed = Planned Operator Shift (min) − Machine Shift (min): the most Lunch / Rest plus every downtime can add up to. 0 when the machine ran the whole planned shift.',
  'effective': 'Effective Machine Run Time = OK Quantity × Total Cycle Time ÷ 3600',
  'unreported':
      "Unreported Time = (Shift Hours × 60) − (Effective Runtime × 60) − Total Downtime, combined across every entry of this machine's date — so every entry of that machine/date shows the same figure.",
  'setupEff': 'Setup Efficiency = Effective Machine Run Time ÷ Machine Shift Time',
  'oeeLosses':
      "OEE considering losses = Effective Run Time ÷ (Shift Hours − Total Downtime ÷ 60), combined across every entry of this machine's date.",
  'oeeLunch':
      "OEE not considering losses but lunch = Effective Run Time ÷ (Shift Hours − Lunch ÷ 60), combined across every entry of this machine's date.",
  'oeeLunchCot':
      "OEE not considering losses but lunch and setup time = Effective Run Time ÷ (Shift Hours − Lunch ÷ 60 − Setup Time ÷ 60), combined across every entry of this machine's date.",
  'gap':
      "Gap to next shift = the next entry's Machine ON Time − this entry's Machine OFF Time, on the same machine and date — a blind spot with no entry, not a downtime. Blank for the day's last entry.",
};

/// The downtime columns are headed with the wording of the form, not the
/// longer labels of the old Excel grid.
const Map<String, String> downtimeLabels = {
  'setupMin': 'Setup Time',
  'noManPowerMin': 'No Man Power',
  'materialShiftingMin': 'Material Shifting',
  'noMaterialMin': 'No Material',
  'bdMechMin': 'Breakdown Mechanical',
  'bdEleMin': 'BD Electricity',
  'noPowerMin': 'No Power',
  'otherMin': 'Other',
  'plannedDownMin': 'Planned Down Time',
};

/// Scales a design-time pixel size by the user's text scale (for the few
/// fixed extents a pinned sliver header needs).
double scaledExtent(BuildContext context, double base, {double max = 1.8}) {
  final s = MediaQuery.textScalerOf(context).scale(16) / 16;
  return base * s.clamp(1.0, max);
}
