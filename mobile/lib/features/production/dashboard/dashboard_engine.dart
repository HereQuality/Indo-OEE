// 1:1 port of client/src/utils/processDashboard.js — the engine behind the
// process dashboards: the catalog of KPI tiles and visuals, the cross-filter
// model, and the aggregation every tile, chart and drill-down reads from.
//
// Every figure comes from rowCalc/dayCalc (production_sheet_calc.dart) — the
// same formulas the entry form uses — so the dashboard can never disagree with
// the sheet. OEE is a per-machine-per-day figure, so it is averaged over
// machine-day pairs, never over entries.
//
// Conventions
//  * Naming: SCREAMING_CASE -> lowerCamelCase (STAT_CATALOG -> statCatalog,
//    MAX_RANGE_DAYS -> maxRangeDays).
//  * Data are Map<String, dynamic> with the exact JS keys; numbers inside them
//    are ALWAYS double (or null = JS null/undefined, double.nan = NaN) — so
//    `s['entries']` and `s['machineDays']` are doubles too.
//  * summarize() -> Map with the JS keys (totalQty, okQty, rejectedQty, idealQty,
//    shiftHours, effectiveHours, plannedShiftHours, downtimeMin, unreportedMin,
//    unutilizedDays, entries, okPct, rejectionPct, performance, setupEfficiency,
//    oeeLosses, oeeLunch, oeeLunchCot, machineDays,
//    downtimeByCause: Map<String,double>, rejectByReason: Map<String,double>).
//  * Measures (statMeasure/causeMeasure/reasonMeasure) are maps
//    {'key','label','format','get'} where 'get' is a [MeasureGetter]:
//    `double? Function(Map<String,dynamic> summary)`. Use [measureValue].
//  * Functions with an optional JS argument take it as an optional POSITIONAL
//    argument, exactly like the JS call: applyFilters(rows, filters, dim),
//    compareMachines(ctx, keyOf).
//  * JS Array.sort is stable, Dart's List.sort is not: sort with [stableSort]
//    / [sortedStable] wherever the JS sorted (ties keep their first-seen order).
//  * Dates are 'YYYY-MM-DD' strings built from LOCAL calendar parts.
//  * Tests can pin "today" by assigning [engineClock].
import 'dart:ui' as ui;

import 'package:collection/collection.dart' show mergeSort;

import '../shared/production_sheet_calc.dart' show dayCalc, displayDay, fmtNum, fmtPct, rowCalc, stoppageFields;
import 'charts/chart_props.dart' show DashboardCtx;

// ── Small JS-semantics helpers ─────────────────────────────────────────────

/// JS `n = (v) => Number.isFinite(v) ? v : 0`.
double _n(Object? v) => (v is num && v.isFinite) ? v.toDouble() : 0.0;

/// JS `Number.isFinite`.
bool _isFin(Object? v) => v is num && v.isFinite;

/// JS `mean` of the processDashboard file: null for an empty list.
double? _mean(List<double> arr) => arr.isEmpty ? null : arr.fold<double>(0, (s, v) => s + v) / arr.length;

/// JS truthiness (`v || x`).
bool _truthy(Object? v) {
  if (v == null) return false;
  if (v is bool) return v;
  if (v is num) return !(v == 0 || v.isNaN);
  if (v is String) return v.isNotEmpty;
  return true;
}

/// JS `String(v)` for the values an entry carries.
String _str(Object? v) {
  if (v == null) return '';
  if (v is String) return v;
  if (v is double && v.isFinite && v == v.truncateToDouble() && v.abs() < 1e21) return v.toInt().toString();
  return v.toString();
}

/// `v || ""` as text.
String _orEmpty(Object? v) => _truthy(v) ? _str(v) : '';

final RegExp _hexRe = RegExp(r'^0[xX][0-9a-fA-F]+$');
final RegExp _octRe = RegExp(r'^0[oO][0-7]+$');
final RegExp _binRe = RegExp(r'^0[bB][01]+$');
final RegExp _decRe = RegExp(r'^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$');

double _stringToNumber(String raw) {
  final s = raw.trim();
  if (s.isEmpty) return 0;
  if (s == 'Infinity' || s == '+Infinity') return double.infinity;
  if (s == '-Infinity') return double.negativeInfinity;
  if (_hexRe.hasMatch(s)) return BigInt.parse(s.substring(2), radix: 16).toDouble();
  if (_octRe.hasMatch(s)) return BigInt.parse(s.substring(2), radix: 8).toDouble();
  if (_binRe.hasMatch(s)) return BigInt.parse(s.substring(2), radix: 2).toDouble();
  final m = _decRe.firstMatch(s);
  if (m == null) return double.nan;
  final intPart = m.group(2) ?? '';
  final frac = m.group(3) ?? '';
  if (intPart.isEmpty && frac.isEmpty) return double.nan;
  final exp = m.group(4);
  return double.parse('${m.group(1)}${intPart.isEmpty ? '0' : intPart}.${frac.isEmpty ? '0' : frac}${exp == null ? '' : 'e$exp'}');
}

/// JS `Number(v)`: null and blank text are 0, unparsable text is NaN.
double _toNumber(Object? v) {
  if (v == null) return 0;
  if (v is num) return v.toDouble();
  if (v is bool) return v ? 1 : 0;
  if (v is String) return _stringToNumber(v);
  if (v is List) {
    if (v.isEmpty) return 0;
    if (v.length == 1 && (v[0] is num || v[0] is String || v[0] == null)) return _toNumber(v[0]);
  }
  return double.nan;
}

/// JS `Math.round` (halves round toward +infinity).
double _jsRound(double x) {
  if (x.isNaN || x.isInfinite) return x;
  final f = x.floorToDouble();
  return (x - f >= 0.5) ? f + 1 : f;
}

final RegExp _arrayIndexRe = RegExp(r'^(0|[1-9]\d{0,9})$');

/// JS own-key enumeration order: integer-like keys ascending first, then the
/// rest in insertion order.
List<String> _jsKeyOrder(Iterable<String> keys) {
  final list = keys.toList();
  final index = <String>[];
  final rest = <String>[];
  for (final k in list) {
    if (_arrayIndexRe.hasMatch(k) && int.parse(k) < 4294967295) {
      index.add(k);
    } else {
      rest.add(k);
    }
  }
  if (index.isEmpty) return list;
  index.sort((a, b) => int.parse(a).compareTo(int.parse(b)));
  return [...index, ...rest];
}

/// JS `Object.entries(v || {})` in JS enumeration order (Map or List).
List<MapEntry<String, dynamic>> _entriesOf(Object? v) {
  if (v is Map) {
    final byKey = <String, dynamic>{for (final e in v.entries) '${e.key}': e.value};
    return [for (final k in _jsKeyOrder(byKey.keys)) MapEntry(k, byKey[k])];
  }
  if (v is List) return [for (var i = 0; i < v.length; i++) MapEntry('$i', v[i])];
  return const [];
}

/// JS `s.slice(from, to)` for the ASCII date strings used here.
String _slice(String s, int from, [int? to]) {
  final len = s.length;
  final a = from.clamp(0, len);
  final b = (to ?? len).clamp(0, len);
  return a >= b ? '' : s.substring(a, b);
}

/// Sorted copy that keeps ties in their original order, like JS `Array.sort`.
List<T> sortedStable<T>(Iterable<T> items, Comparator<T> compare) {
  final list = items.toList();
  mergeSort<T>(list, compare: compare);
  return list;
}

/// In-place stable sort (see [sortedStable]).
void stableSort<T>(List<T> list, Comparator<T> compare) => mergeSort<T>(list, compare: compare);

// ── Clock (tests only) ─────────────────────────────────────────────────────
/// "Now" for every period helper. Only tests should reassign it.
DateTime Function() engineClock = DateTime.now;

// ── Formats ────────────────────────────────────────────────────────────────

/// Locale for the compact quantities on the KPI tiles (`1.23L`, `12.35Cr` vs
/// `123.46K`, `1.43M`). The web app formats with `Intl.NumberFormat(undefined)`,
/// i.e. the viewer's locale; null does the same here (device locale). Only the
/// Indian region (lakh / crore) and the Western short scale (K / M / B / T) are
/// modelled; every other locale reads like en-US. Tests set it explicitly
/// ('en-US' / 'en-IN').
String? engineNumberLocale;

bool _indianCompact() {
  final tag = engineNumberLocale;
  if (tag != null) return RegExp(r'[-_]IN$', caseSensitive: false).hasMatch(tag);
  try {
    return ui.PlatformDispatcher.instance.locale.countryCode == 'IN';
  } catch (_) {
    return false;
  }
}

class _CompactUnit {
  const _CompactUnit(this.minExp, this.divExp, this.suffix, this.maxInt);

  /// Smallest decimal magnitude (floor(log10)) this unit serves.
  final int minExp;

  /// The number is divided by 10^divExp.
  final int divExp;
  final String suffix;

  /// Most integer digits the unit shows before the next unit takes over; 0 = unbounded.
  final int maxInt;
}

// CLDR compact-short patterns: en (0K..000K, 0M.., 0B.., 0T..) and en-IN
// (0K, 00K, 0L, 00L, 0Cr, 00Cr, 000Cr, 0KCr, 00KCr, 0LCr, 00LCr, 000LCr).
const List<_CompactUnit> _westUnits = [
  _CompactUnit(-1000, 0, '', 3),
  _CompactUnit(3, 3, 'K', 3),
  _CompactUnit(6, 6, 'M', 3),
  _CompactUnit(9, 9, 'B', 3),
  _CompactUnit(12, 12, 'T', 0),
];
const List<_CompactUnit> _indianUnits = [
  _CompactUnit(-1000, 0, '', 3),
  _CompactUnit(3, 3, 'K', 2),
  _CompactUnit(5, 5, 'L', 2),
  _CompactUnit(7, 7, 'Cr', 3),
  _CompactUnit(10, 10, 'KCr', 2),
  _CompactUnit(12, 12, 'LCr', 0),
];

/// Exact shortest-round-trip decimal of a finite non-negative double:
/// value = digits x 10^exp10.
(BigInt, int) _decimalParts(double x) {
  var s = x.toString();
  var e = 0;
  final ePos = s.indexOf('e');
  if (ePos >= 0) {
    e = int.parse(s.substring(ePos + 1));
    s = s.substring(0, ePos);
  }
  final dot = s.indexOf('.');
  final intPart = dot < 0 ? s : s.substring(0, dot);
  final frac = dot < 0 ? '' : s.substring(dot + 1);
  return (BigInt.parse('$intPart$frac'), e - frac.length);
}

String _group(String digits, bool indian) {
  // Compact notation groups with "min2": 1000T stays 1000T, 12345T reads 12,345T.
  if (digits.length <= 4) return digits;
  final tail = digits.substring(digits.length - 3);
  var head = digits.substring(0, digits.length - 3);
  final parts = <String>[];
  final size = indian ? 2 : 3;
  while (head.length > size) {
    parts.insert(0, head.substring(head.length - size));
    head = head.substring(0, head.length - size);
  }
  parts.insert(0, head);
  return '${parts.join(',')},$tail';
}

/// `Intl.NumberFormat(locale, {notation: 'compact', maximumFractionDigits: 2})`
/// for en-US / en-IN: scaled by the CLDR unit, rounded half away from zero to
/// two decimals on the exact decimal value, trailing zeros dropped, and a
/// rounding carry (999.999K) promoted to the next unit (1M).
String _compact(double v, {required bool indian}) {
  final neg = v < 0;
  var (digits, exp10) = _decimalParts(v.abs());
  if (digits == BigInt.zero) return '0';
  final units = indian ? _indianUnits : _westUnits;
  final ten = BigInt.from(10);
  while (true) {
    final mag = digits.toString().length - 1 + exp10;
    var unit = units.first;
    for (final u in units) {
      if (mag >= u.minExp) unit = u;
    }
    final shift = exp10 - unit.divExp + 2;
    BigInt n;
    if (shift >= 0) {
      n = digits * ten.pow(shift);
    } else {
      final p = ten.pow(-shift);
      n = (digits * BigInt.two + p) ~/ (p * BigInt.two);
    }
    if (unit.maxInt > 0 && n >= ten.pow(unit.maxInt + 2)) {
      digits = n;
      exp10 = unit.divExp - 2;
      continue;
    }
    final whole = (n ~/ BigInt.from(100)).toString();
    final frac = (n % BigInt.from(100)).toString().padLeft(2, '0').replaceFirst(RegExp(r'0+$'), '');
    return '${neg ? '-' : ''}${_group(whole, indian)}${frac.isEmpty ? '' : '.$frac'}${unit.suffix}';
  }
}

String _fmtQty(num? v) => _isFin(v) ? (v!.abs() >= 100000 ? _compact(v.toDouble(), indian: _indianCompact()) : fmtNum(v)) : '—';

String _fmtPctOrDash(num? v) {
  final s = fmtPct(v);
  return s.isEmpty ? '—' : s;
}

/// FORMATS: 'qty' | 'pct' | 'hours' | 'minutes' | 'days' -> formatter. A null,
/// NaN or infinite value reads "—".
final Map<String, String Function(num? v)> formats = {
  'qty': _fmtQty,
  'pct': _fmtPctOrDash,
  'hours': (v) => _isFin(v) ? '${fmtNum(v)} hr' : '—',
  'minutes': (v) => _isFin(v) ? '${fmtNum(v)} min' : '—',
  'days': (v) => _isFin(v) ? fmtNum(v) : '—',
};

/// Full-precision twin of [formats], for tooltips and tables.
String formatExact(String format, num? v) {
  if (format == 'qty') return _isFin(v) ? fmtNum(v) : '—';
  final f = formats[format];
  if (f == null) throw ArgumentError.value(format, 'format', 'unknown dashboard format');
  return f(v);
}

// ── Catalog: KPI tiles ─────────────────────────────────────────────────────
/// Each: {'key','label','hint','format', 'tone'? ('ok'|'reject'|'downtime'), 'example'}.
const List<Map<String, dynamic>> statCatalog = [
  {'key': 'totalQty', 'label': 'Total QTY', 'hint': 'Actual quantity produced', 'format': 'qty', 'example': '1.43M'},
  {'key': 'okQty', 'label': 'OK QTY', 'hint': 'Pieces that passed', 'format': 'qty', 'tone': 'ok', 'example': '269K'},
  {'key': 'rejectedQty', 'label': 'Rejected QTY', 'hint': 'Actual − OK', 'format': 'qty', 'tone': 'reject', 'example': '9,453'},
  {'key': 'okPct', 'label': '% OK Quantity', 'hint': 'OK ÷ (OK + Rejected)', 'format': 'pct', 'tone': 'ok', 'example': '99.97%'},
  {'key': 'rejectionPct', 'label': 'Rejection %', 'hint': 'Rejected ÷ Actual', 'format': 'pct', 'tone': 'reject', 'example': '0.66%'},
  {'key': 'idealQty', 'label': 'Ideal QTY', 'hint': 'Shift time ÷ cycle time', 'format': 'qty', 'example': '1.51M'},
  {'key': 'performance', 'label': 'Actual vs Ideal', 'hint': 'Actual ÷ Ideal quantity', 'format': 'pct', 'example': '94.70%'},
  {'key': 'oeeLosses', 'label': 'OEE Considering Losses', 'hint': 'Averaged per machine-day', 'format': 'pct', 'example': '96.42%'},
  {'key': 'oeeLunch', 'label': 'OEE NOT Considering Losses, But Lunch', 'hint': 'Averaged per machine-day', 'format': 'pct', 'example': '91.10%'},
  // Key kept as oeeLunchCot: it is what a process's saved dashboard stores, so renaming it would drop the tile.
  {'key': 'oeeLunchCot', 'label': 'OEE NOT Considering Losses, But Lunch & Setup Time', 'hint': 'Averaged per machine-day', 'format': 'pct', 'example': '93.85%'},
  {'key': 'effectiveHours', 'label': 'Effective Machine Run Time', 'hint': 'OK × cycle time', 'format': 'hours', 'example': '7,281 hr'},
  {'key': 'shiftHours', 'label': 'Machine Shift Time', 'hint': 'Machine OFF − ON', 'format': 'hours', 'example': '8,120 hr'},
  {'key': 'downtimeMin', 'label': 'Total Downtime', 'hint': 'All stoppage causes', 'format': 'minutes', 'tone': 'downtime', 'example': '5,160 min'},
];

// ── Catalog: graphs ────────────────────────────────────────────────────────
/// Each: {'key','measure'? (a stat key, or 'unreportedMin' which has no tile),
/// 'label','hint','size' ('sm'|'md'|'lg'|'full' = 4/6/8/12 of 12 columns),
/// 'preview', 'tone'?}.
const List<Map<String, dynamic>> chartCatalog = [
  {'key': 'oeeTrend', 'measure': 'oeeLosses', 'label': 'OEE (over time)', 'hint': 'The three OEE figures by date — by month on long ranges.', 'size': 'lg', 'preview': 'lines'},
  {'key': 'runTimeByOperator', 'measure': 'effectiveHours', 'label': 'Effective Machine Run Time (Hour) by Operator', 'hint': 'Hours of effective run time each operator produced.', 'size': 'sm', 'preview': 'hbars', 'tone': 'ok'},
  {'key': 'downtimeByMachine', 'measure': 'downtimeMin', 'label': 'B.D. Backup — Stoppage by MC No.', 'hint': 'Minutes lost per machine: breakdown, setup, lunch/tea, other.', 'size': 'md', 'preview': 'stacked'},
  {'key': 'runTimeByMachine', 'measure': 'effectiveHours', 'label': 'Effective Machine Run Time (Hour) by MC No.', 'hint': "Each machine's share of effective run time.", 'size': 'md', 'preview': 'treemap'},
  {'key': 'unreportedByMachine', 'measure': 'unreportedMin', 'label': 'Unreported Time (Min) by MC No.', 'hint': 'Minutes not accounted for — one small chart per machine.', 'size': 'md', 'preview': 'multiples'},
  {'key': 'okRejectedTrend', 'measure': 'okQty', 'label': 'OK vs Rejected QTY (over time)', 'hint': 'Stacked — the full bar is the actual quantity.', 'size': 'md', 'preview': 'stackedTime'},
  {'key': 'oeeByMachine', 'measure': 'oeeLosses', 'label': 'OEE by MC No.', 'hint': "Considering losses — average of that machine's days.", 'size': 'md', 'preview': 'vbars', 'tone': 'ok'},
  {'key': 'rejectByReason', 'measure': 'rejectedQty', 'label': 'Rejected QTY by Reason', 'hint': 'Rejected quantity grouped by reject reason.', 'size': 'md', 'preview': 'hbars', 'tone': 'reject'},
  {'key': 'okPctByOperator', 'measure': 'okPct', 'label': 'Operator v/s OK QTY %', 'hint': 'OK ÷ Actual for each operator.', 'size': 'md', 'preview': 'hbars', 'tone': 'ok'},
  {'key': 'outputByItem', 'measure': 'okQty', 'label': 'OK QTY by Part', 'hint': 'Parts ranked by OK quantity.', 'size': 'md', 'preview': 'hbars', 'tone': 'ok'},
  {'key': 'machineSummary', 'label': 'MC No. Summary (table)', 'hint': 'One row per machine — quantities, run time, downtime and OEE.', 'size': 'full', 'preview': 'table'},
];

const List<String> defaultStats = ['totalQty', 'okQty', 'rejectedQty', 'okPct', 'oeeLosses', 'oeeLunch', 'effectiveHours', 'downtimeMin'];
const List<String> defaultCharts = ['runTimeByOperator', 'oeeTrend', 'downtimeByMachine', 'runTimeByMachine', 'unreportedByMachine', 'okRejectedTrend', 'rejectByReason', 'machineSummary'];

Map<String, Map<String, dynamic>> _byKey(List<Map<String, dynamic>> catalog) => {for (final w in catalog) w['key'] as String: w};

/// STATS_BY_KEY / CHARTS_BY_KEY.
final Map<String, Map<String, dynamic>> statsByKey = _byKey(statCatalog);
final Map<String, Map<String, dynamic>> chartsByKey = _byKey(chartCatalog);

/// A process's saved keys -> catalog entries, dropping keys this build doesn't
/// know. [saved] that is not a List (never configured) falls back to
/// [defaults]; an empty list is respected as "show none".
List<Map<String, dynamic>> resolveWidgets(Object? saved, Map<String, Map<String, dynamic>> lookup, List<String> defaults) {
  final Iterable<Object?> keys = saved is List ? saved : defaults;
  final out = <Map<String, dynamic>>[];
  for (final k in keys) {
    final w = lookup[k is String ? k : _str(k)];
    if (w != null) out.add(w);
  }
  return out;
}

// ── Stoppage groups (Breakdown & Stoppage by Machine) ──────────────────────
// Ten causes is more series than a stacked bar can carry, so they are folded
// into four fixed groups; Downtime by Cause keeps the full ten.
/// Each: `{'key','label','fields': List<String>}`.
const List<Map<String, dynamic>> stoppageGroups = [
  {'key': 'breakdown', 'label': 'Breakdown (Mech + Ele)', 'fields': ['bdMechMin', 'bdEleMin']},
  {'key': 'setup', 'label': 'Setup', 'fields': ['setupMin']},
  {'key': 'lunch', 'label': 'Lunch / Tea', 'fields': ['lunchMin']},
  {
    'key': 'other',
    'label': 'Other stoppages',
    'fields': ['plannedDownMin', 'noManPowerMin', 'materialShiftingMin', 'noMaterialMin', 'noPowerMin', 'otherMin'],
  },
];

/// Label of a stoppage cause without its " (min)" suffix; the key itself if unknown.
String causeLabel(String key) {
  String? label;
  for (final f in stoppageFields) {
    if (f['key'] == key) {
      label = f['label'] as String?;
      break;
    }
  }
  return (_truthy(label) ? label! : key).replaceFirst(' (min)', '');
}

// ── Dimensions (what a row can be sliced / cross-filtered by) ──────────────
const List<String> _monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "Jan 2026" for "2026-01".
String monthLabel(String yyyymm) {
  final i = _toNumber(_slice(yyyymm, 5, 7)) - 1;
  final name = (i.isFinite && i == i.truncateToDouble() && i >= 0 && i < 12) ? _monthShort[i.toInt()] : 'undefined';
  return '$name ${_slice(yyyymm, 0, 4)}';
}

/// One thing a row can be sliced / cross-filtered by.
class DashboardDimension {
  const DashboardDimension(this.key, this.label, this._value, this._text);

  /// 'machine' | 'operator' | 'item' | 'month' | 'date'
  final String key;

  /// "Machine" / "Operator" / "Part" / "Month" / "Date"
  final String label;
  final String Function(Map<String, dynamic> row) _value;
  final String Function(String value, DashboardCtx? ctx) _text;

  /// The row's bucket for this dimension ('' = no operator / no part).
  String value(Map<String, dynamic> row) => _value(row);

  /// Human text for a bucket value; [ctx] is only needed for 'machine'.
  String text(String value, [DashboardCtx? ctx]) => _text(value, ctx);
}

/// DIMENSIONS, in the JS key order (machine, operator, item, month, date).
final Map<String, DashboardDimension> dimensions = {
  'machine': DashboardDimension('machine', 'Machine', (r) => _str(r['machine']), (v, ctx) {
    final name = ctx?.machineName[v];
    return (name != null && name.isNotEmpty) ? name : '—';
  }),
  'operator': DashboardDimension('operator', 'Operator', (r) => _orEmpty(r['operator']), (v, ctx) => v.isEmpty ? '(no operator)' : v),
  'item': DashboardDimension('item', 'Part', (r) => _orEmpty(r['itemName']), (v, ctx) => v.isEmpty ? '(no part)' : v),
  'month': DashboardDimension('month', 'Month', (r) => _slice(_str(r['date']), 0, 7), (v, ctx) => monthLabel(v)),
  'date': DashboardDimension('date', 'Date', (r) => _str(r['date']), (v, ctx) => displayDay(v)),
};

DashboardDimension _dim(String dim) {
  final d = dimensions[dim];
  if (d == null) throw ArgumentError.value(dim, 'dim', 'unknown dashboard dimension');
  return d;
}

/// EMPTY_FILTERS (unmodifiable). Use [newEmptyFilters] for a mutable copy.
const Map<String, List<String>> emptyFilters = {'machine': [], 'operator': [], 'item': [], 'month': [], 'date': []};

/// A fresh, mutable EMPTY_FILTERS.
Map<String, List<String>> newEmptyFilters() => {'machine': [], 'operator': [], 'item': [], 'month': [], 'date': []};

// Machines sort by sheet order: ctx.machineOrder is {machineId: position} built
// from the Machine list, which the API returns in Sequence order. A machine not
// in it — deactivated since it made entries — ranks after every listed one,
// then by name, numbers compared as numbers. `keyOf` reads the machine id off
// whatever is being sorted (chart rows carry it as 'key', filter options as
// 'value').
/// Comparator for chart rows / filter options carrying a machine id.
int Function(Map<String, dynamic> a, Map<String, dynamic> b) compareMachines(DashboardCtx? ctx, [String? Function(Map<String, dynamic> item)? keyOf]) {
  final key = keyOf ?? (Map<String, dynamic> item) => item['key'] as String?;
  final order = ctx?.machineOrder ?? const <String, int>{};
  double rank(Map<String, dynamic> item) {
    final o = order[key(item)];
    return o == null ? double.infinity : o.toDouble();
  }

  String name(Map<String, dynamic> item) {
    final n = ctx?.machineName[key(item)];
    if (n != null && n.isNotEmpty) return n;
    final l = item['label'];
    return _truthy(l) ? _str(l) : '';
  }

  return (a, b) {
    final ra = rank(a);
    final rb = rank(b);
    if (ra != rb) return ra < rb ? -1 : 1;
    return naturalCompare(name(a), name(b));
  };
}

// ── Natural string compare (ICU collation, numeric) ────────────────────────
// `a.localeCompare(b, undefined, {numeric: true})`: whole strings compare at
// three levels — base characters (whitespace < punctuation < symbols < digits
// < letters, letters case-insensitive, digit runs by numeric value), then
// accents, then case (lower before upper). ASCII follows the CLDR root order
// exactly; Latin-1 / Latin Extended-A accents are folded to their base letter;
// every other letter sorts after Latin by code point.
const String _punctOrder = ' _-‐‑‒–—―,;:!¡?¿.…\'‘’"“”«»()[]{}§¶@*/\\&#%†‡•`´˜^¨°©®+±÷×<=>¬|¦~¤¢\$£¥€';
const int _classPunct = 0;
const int _classDigit = 1;
const int _classLetter = 2;
const int _classBase = 1 << 32;
const int _gap = 1 << 21; // room for any code point between two listed punctuation marks
final int _currencyStart = _punctOrder.indexOf('¤');

// Base letter of the accented Latin letters, and the ICU secondary (accent)
// order of the marks they carry: acute < grave < breve < circumflex < caron <
// ring < diaeresis < double acute < tilde < dot above < cedilla < stroke <
// ogonek < macron.
const Map<String, String> _accentBases = {
  'a': 'àáâãäåāăąǎ', 'c': 'çćĉċč', 'd': 'ďđ', 'e': 'èéêëēĕėęě', 'g': 'ĝğġģ', 'h': 'ĥħ', 'i': 'ìíîïĩīĭįı',
  'j': 'ĵ', 'k': 'ķ', 'l': 'ĺļľŀł', 'n': 'ñńņňŉ', 'o': 'òóôõöøōŏő', 'r': 'ŕŗř', 's': 'śŝşš', 't': 'ţťŧ',
  'u': 'ùúûüũūŭůűų', 'w': 'ŵ', 'y': 'ýÿŷ', 'z': 'źżž',
};
const List<String> _accentMarks = [
  'áćéíĺńóŕśúýź', // acute
  'àèìòù', // grave
  'ăĕĭŏŭ', // breve
  'âĉêĝĥîĵôŝûŵŷ', // circumflex
  'ǎčďěľňřšťž', // caron
  'åů', // ring
  'äëïöüÿ', // diaeresis
  'őű', // double acute
  'ãñĩõũ', // tilde
  'ċėġż', // dot above
  'çģķļņŗşţ', // cedilla
  'đħłŧø', // stroke
  'ŀ', // middle dot
  'ąęįų', // ogonek
  'āēīōū', // macron
];

final Map<int, (int, int)> _accentIndex = () {
  final markRank = <int, int>{};
  for (var i = 0; i < _accentMarks.length; i++) {
    for (final r in _accentMarks[i].runes) {
      markRank[r] = i + 1;
    }
  }
  final m = <int, (int, int)>{};
  _accentBases.forEach((base, variants) {
    final b = base.codeUnitAt(0);
    for (final r in variants.runes) {
      final rank = markRank[r] ?? _accentMarks.length + 1;
      m[r] = (b, rank);
      final upper = String.fromCharCode(r).toUpperCase();
      if (upper.length == 1 && upper.runes.first != r) m[upper.runes.first] = (b, rank);
    }
  });
  return m;
}();

final RegExp _letterRe = RegExp(r'\p{L}', unicode: true);

class _CollationKey {
  final List<int> primary = [];
  final List<int> secondary = [];
  final List<int> tertiary = [];
  void add(int p, int s, int t) {
    primary.add(p);
    secondary.add(s);
    tertiary.add(t);
  }
}

_CollationKey _collationKey(String str) {
  final k = _CollationKey();
  final runes = str.runes.toList();
  var i = 0;
  while (i < runes.length) {
    final c = runes[i];
    if (c >= 0x30 && c <= 0x39) {
      var j = i;
      while (j < runes.length && runes[j] >= 0x30 && runes[j] <= 0x39) {
        j++;
      }
      var z = i;
      while (z < j && runes[z] == 0x30) {
        z++;
      }
      k.add(_classDigit * _classBase + (j - z), 0, 0);
      for (var d = z; d < j; d++) {
        k.add(_classDigit * _classBase + 1 + (runes[d] - 0x30), 0, 0);
      }
      i = j;
      continue;
    }
    i++;
    final punct = _punctOrder.indexOf(String.fromCharCode(c));
    if (punct >= 0) {
      k.add(_classPunct * _classBase + (100 + punct) * _gap, 0, 0);
      continue;
    }
    if (c < 0x20 || c == 0x7f) {
      k.add(_classPunct * _classBase + c, 0, 0);
      continue;
    }
    final isAsciiLetter = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
    if (isAsciiLetter) {
      k.add(_classLetter * _classBase + ((c | 0x20) - 0x61), 0, c <= 0x5a ? 1 : 0);
      continue;
    }
    final accent = _accentIndex[c];
    if (accent != null) {
      final upper = c != String.fromCharCode(c).toLowerCase().runes.first;
      k.add(_classLetter * _classBase + (accent.$1 - 0x61), accent.$2, upper ? 1 : 0);
      continue;
    }
    final ch = String.fromCharCode(c);
    if (_letterRe.hasMatch(ch)) {
      final lower = ch.toLowerCase();
      k.add(_classLetter * _classBase + 1000 + lower.runes.first, 0, lower == ch ? 0 : 1);
    } else {
      // Other symbols (emoji, arrows, ...) sit between the general symbols and the currency signs.
      k.add(_classPunct * _classBase + (99 + _currencyStart) * _gap + 1 + c, 0, 0);
    }
  }
  return k;
}

int _compareLists(List<int> a, List<int> b) {
  final n = a.length < b.length ? a.length : b.length;
  for (var i = 0; i < n; i++) {
    if (a[i] != b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length == b.length ? 0 : (a.length < b.length ? -1 : 1);
}

/// JS `a.localeCompare(b, undefined, {numeric: true})`. Returns -1 / 0 / 1.
int naturalCompare(String a, String b) {
  if (a == b) return 0;
  final ka = _collationKey(a);
  final kb = _collationKey(b);
  final p = _compareLists(ka.primary, kb.primary);
  if (p != 0) return p;
  final s = _compareLists(ka.secondary, kb.secondary);
  if (s != 0) return s;
  return _compareLists(ka.tertiary, kb.tertiary);
}

// ── Filters ────────────────────────────────────────────────────────────────

bool hasFilters(Map<String, List<String>> filters) => filters.values.any((v) => v.isNotEmpty);

/// New filters map with [value] toggled in [dim].
Map<String, List<String>> toggleFilter(Map<String, List<String>> filters, String dim, String value) {
  final cur = filters[dim] ?? const <String>[];
  return {...filters, dim: cur.contains(value) ? cur.where((v) => v != value).toList() : [...cur, value]};
}

/// Rows passing every active filter. [except] leaves one dimension unfiltered —
/// the chart that owns a dimension keeps showing every mark (dimming the
/// unselected) instead of collapsing to the selection, the way a Power BI
/// visual does. Returns [rows] itself when no filter is active.
List<Map<String, dynamic>> applyFilters(List<Map<String, dynamic>> rows, Map<String, List<String>> filters, [String? except]) {
  final active = <(DashboardDimension, Set<String>)>[
    for (final e in filters.entries)
      if (e.key != except && e.value.isNotEmpty) (_dim(e.key), e.value.toSet()),
  ];
  if (active.isEmpty) return rows;
  return rows.where((r) => active.every((a) => a.$2.contains(a.$1.value(r)))).toList();
}

/// Rows by dimension value, in first-seen order.
Map<String, List<Map<String, dynamic>>> groupRows(List<Map<String, dynamic>> rows, String dim) {
  final value = _dim(dim).value;
  final groups = <String, List<Map<String, dynamic>>>{};
  for (final r in rows) {
    (groups[value(r)] ??= []).add(r);
  }
  return groups;
}

/// Day buckets read fine up to about two months; past that, trends roll up to
/// months so the bars stay wide enough to hit. 'month' | 'date'.
String timeBucket(List<Map<String, dynamic>> rows) => rows.map((r) => r['date']).toSet().length > 62 ? 'month' : 'date';

// ── Aggregation ────────────────────────────────────────────────────────────
final Expando<Map<String, dynamic>> _calcCache = Expando<Map<String, dynamic>>('calcOf');

/// rowCalc(row), cached per row map identity (the WeakMap of the web engine).
Map<String, dynamic> calcOf(Map<String, dynamic> row) {
  var c = _calcCache[row];
  if (c == null) {
    c = rowCalc(row);
    _calcCache[row] = c;
  }
  return c;
}

// Rejected pieces by reason for one row: the per-reason split when the entry
// has one, else the whole lot against its single reason (older entries).
List<MapEntry<String, double>> _rejectSplit(Map<String, dynamic> row, double rejected) {
  final split = <MapEntry<String, double>>[];
  for (final e in _entriesOf(row['rejectBreakdown'])) {
    final q = _toNumber(e.value);
    if (_n(q) > 0) split.add(MapEntry(e.key, q));
  }
  if (split.isNotEmpty) return split;
  final reason = row['rejectReason'];
  return [MapEntry(_truthy(reason) ? _str(reason) : 'Not specified', rejected)];
}

/// Every figure the tiles, charts and drill-downs read, for [rows].
Map<String, dynamic> summarize(List<Map<String, dynamic>> rows) {
  var totalQty = 0.0, okQty = 0.0, rejectedQty = 0.0, idealQty = 0.0;
  var shiftHours = 0.0, effectiveHours = 0.0, plannedShiftHours = 0.0;
  var downtimeMin = 0.0, unreportedMin = 0.0, unutilizedDays = 0.0;
  final setupEff = <double>[];
  final downtimeByCause = <String, double>{for (final f in stoppageFields) f['key'] as String: 0.0};
  final rejectByReason = <String, double>{};
  final byMachineDay = <String, List<Map<String, dynamic>>>{};

  for (final row in rows) {
    final c = calcOf(row);
    totalQty += _n(c['actualQty']);
    okQty += _n(_toNumber(row['okQty']));
    rejectedQty += _n(c['rejectedQty']);
    idealQty += _n(c['idealQty']);
    shiftHours += _n(c['shiftHours']);
    effectiveHours += _n(c['effectiveHours']);
    plannedShiftHours += _n(_toNumber(row['plannedOperatorShiftHours']));
    downtimeMin += _n(c['totalStoppageMin']);
    final se = c['setupEfficiency'];
    if (_isFin(se)) setupEff.add((se as num).toDouble());
    for (final f in stoppageFields) {
      final k = f['key'] as String;
      downtimeByCause[k] = downtimeByCause[k]! + _n(_toNumber(row[k]));
    }
    if (_n(c['rejectedQty']) > 0) {
      for (final e in _rejectSplit(row, (c['rejectedQty'] as num).toDouble())) {
        final prev = rejectByReason[e.key];
        rejectByReason[e.key] = ((prev == null || prev.isNaN || prev == 0) ? 0.0 : prev) + e.value;
      }
    }
    (byMachineDay['${_str(row['machine'])}|${_str(row['date'])}'] ??= []).add(row);
  }

  // dayCalc hands back one result per row of the group (a rolling window
  // starting at that row), not one shared value for the whole day — so every
  // row's own figure is added in here, not the day's counted once.
  final oee = <String, List<double>>{'oeeLosses': [], 'oeeLunch': [], 'oeeLunchCot': []};
  for (final group in byMachineDay.values) {
    for (final d in dayCalc(group)) {
      final ur = d['unreportedMin'];
      if (_isFin(ur)) unreportedMin += (ur as num).toDouble();
      final un = d['unutilized'];
      if (_isFin(un)) unutilizedDays += (un as num).toDouble();
      for (final e in oee.entries) {
        final v = d[e.key];
        if (_isFin(v)) e.value.add((v as num).toDouble());
      }
    }
  }

  return <String, dynamic>{
    'totalQty': totalQty,
    'okQty': okQty,
    'rejectedQty': rejectedQty,
    'idealQty': idealQty,
    'shiftHours': shiftHours,
    'effectiveHours': effectiveHours,
    'plannedShiftHours': plannedShiftHours,
    'downtimeMin': downtimeMin,
    'unreportedMin': unreportedMin,
    'unutilizedDays': unutilizedDays,
    'entries': rows.length.toDouble(),
    'okPct': totalQty > 0 ? okQty / totalQty : null,
    'rejectionPct': totalQty > 0 ? rejectedQty / totalQty : null,
    'performance': idealQty > 0 ? totalQty / idealQty : null,
    'setupEfficiency': _mean(setupEff),
    'oeeLosses': _mean(oee['oeeLosses']!),
    'oeeLunch': _mean(oee['oeeLunch']!),
    'oeeLunchCot': _mean(oee['oeeLunchCot']!),
    'machineDays': byMachineDay.length.toDouble(),
    'downtimeByCause': downtimeByCause,
    'rejectByReason': {for (final k in _jsKeyOrder(rejectByReason.keys)) k: rejectByReason[k]!},
  };
}

/// One summary per value of [dim]: [{'key': String, 'label': String, 'summary': Map}].
List<Map<String, dynamic>> summarizeBy(List<Map<String, dynamic>> rows, String dim, DashboardCtx ctx) {
  final d = _dim(dim);
  return [
    for (final e in groupRows(rows, dim).entries)
      <String, dynamic>{'key': e.key, 'label': d.text(e.key, ctx), 'summary': summarize(e.value)},
  ];
}

// ── Measures (what a drill-down breaks apart) ──────────────────────────────
// Every KPI tile is a measure; a stoppage cause or reject reason becomes one
// on the fly when its bar is tapped.
typedef MeasureGetter = double? Function(Map<String, dynamic> summary);

/// {'key','label','format','get'} for a KPI tile (an entry of [statCatalog]).
Map<String, dynamic> statMeasure(Map<String, dynamic> stat) {
  final key = stat['key'];
  double? get(Map<String, dynamic> s) {
    final v = s[key];
    return v is num ? v.toDouble() : null;
  }

  return <String, dynamic>{'key': key, 'label': stat['label'], 'format': stat['format'], 'get': get};
}

/// A stoppage cause ('bdMechMin', ...) as a measure (minutes).
Map<String, dynamic> causeMeasure(String causeKey) {
  double? get(Map<String, dynamic> s) {
    final v = (s['downtimeByCause'] as Map?)?[causeKey];
    return (v is num && v != 0 && !v.isNaN) ? v.toDouble() : 0.0;
  }

  return <String, dynamic>{'key': 'cause:$causeKey', 'label': '${causeLabel(causeKey)} — downtime', 'format': 'minutes', 'get': get};
}

/// A reject reason as a measure (qty).
Map<String, dynamic> reasonMeasure(String reason) {
  double? get(Map<String, dynamic> s) {
    final v = (s['rejectByReason'] as Map?)?[reason];
    return (v is num && v != 0 && !v.isNaN) ? v.toDouble() : 0.0;
  }

  return <String, dynamic>{'key': 'reason:$reason', 'label': 'Rejected — $reason', 'format': 'qty', 'get': get};
}

/// measure['get'](summary) without casting the closure yourself.
double? measureValue(Map<String, dynamic> measure, Map<String, dynamic> summary) {
  final g = measure['get'];
  if (g is MeasureGetter) return g(summary);
  final r = Function.apply(g as Function, [summary]);
  return r is num ? r.toDouble() : null;
}

// ── Period (the date range the dashboard loads) ────────────────────────────
// Dates are 'YYYY-MM-DD' strings throughout — the same form the API takes —
// and are always built from LOCAL calendar parts, never via toUtc /
// toIso8601String, which would shift the day for anyone east or west of UTC.
String _pad(int v) => v.toString().padLeft(2, '0');

/// 'YYYY-MM-DD' from LOCAL calendar parts.
String isoDate(DateTime d) => '${d.year}-${_pad(d.month)}-${_pad(d.day)}';

int _wholeNumber(String part, String source) {
  final v = _toNumber(part);
  if (!v.isFinite) throw FormatException('Not a date: "$source"');
  return v.truncate();
}

/// JS `new Date(y, m, d)` reads a year of 0..99 as 1900..1999.
int _jsYear(int y) => (y >= 0 && y <= 99) ? 1900 + y : y;

/// Local-midnight DateTime of a 'YYYY-MM-DD' string (FormatException if unparsable).
DateTime parseIsoDate(String s) {
  final p = s.split('-');
  if (p.length < 3) throw FormatException('Not a date: "$s"');
  return DateTime(_jsYear(_wholeNumber(p[0], s)), _wholeNumber(p[1], s), _wholeNumber(p[2], s));
}

DateTime _daysAgo(int days) {
  final t = engineClock();
  return DateTime(t.year, t.month, t.day - days);
}

int _lastDayOfMonth(int y, int m) => DateTime(_jsYear(y), m + 1, 0).day; // m is 1-based

/// ['2026-09-01','2026-09-30'] for '2026-09'.
List<String> monthRange(String yyyymm) {
  final p = yyyymm.split('-');
  if (p.length < 2) throw FormatException('Not a month: "$yyyymm"');
  final y = _wholeNumber(p[0], yyyymm);
  final m = _wholeNumber(p[1], yyyymm);
  return ['$y-${_pad(m)}-01', '$y-${_pad(m)}-${_pad(_lastDayOfMonth(y, m))}'];
}

/// ['2026-01-01','2026-12-31'].
List<String> yearRange(int year) => ['$year-01-01', '$year-12-31'];

/// One of the quick ranges offered under the calendar; [range] is computed from
/// [engineClock] each call.
class QuickRange {
  const QuickRange(this.key, this.label, this.range);
  final String key;
  final String label;
  final List<String> Function() range;
}

/// QUICK_RANGES: today, last7, last30, last90, thisMonth, lastMonth, thisYear, lastYear.
final List<QuickRange> quickRanges = [
  QuickRange('today', 'Today', () => [isoDate(engineClock()), isoDate(engineClock())]),
  QuickRange('last7', 'Last 7 days', () => [isoDate(_daysAgo(6)), isoDate(engineClock())]),
  QuickRange('last30', 'Last 30 days', () => [isoDate(_daysAgo(29)), isoDate(engineClock())]),
  QuickRange('last90', 'Last 90 days', () => [isoDate(_daysAgo(89)), isoDate(engineClock())]),
  QuickRange('thisMonth', 'This month', () => monthRange(_slice(isoDate(engineClock()), 0, 7))),
  QuickRange('lastMonth', 'Last month', () {
    final t = engineClock();
    return monthRange(_slice(isoDate(DateTime(t.year, t.month - 1, 1)), 0, 7));
  }),
  QuickRange('thisYear', 'This year', () => yearRange(engineClock().year)),
  QuickRange('lastYear', 'Last year', () => yearRange(engineClock().year - 1)),
];

const String defaultRangeKey = 'thisMonth';

/// The dashboard's default period: this month.
List<String> defaultRange() => quickRanges.firstWhere((q) => q.key == defaultRangeKey).range();

// The Data Entry sheet (unlike a dashboard) is where the actual records live —
// it defaults to a rolling window ending today and going back one year, wide
// enough that real data doesn't look like it "vanished" across a month/year
// rollover. A dashboard's own default stays [defaultRange].
const int _entryRangeDays = 366;

/// Rolling window ending today going back one year (data-entry sheet default).
List<String> defaultEntryRange() => [isoDate(_daysAgo(_entryRangeDays - 1)), isoDate(engineClock())];

/// The API accepts at most this many days in one request (server: MAX_RANGE_DAYS).
const int maxRangeDays = 366 * 5;

/// Inclusive number of days in [from, to] (local calendar days).
int rangeDays(List<String> range) {
  final ms = parseIsoDate(range[1]).difference(parseIsoDate(range[0])).inMilliseconds;
  return _jsRound(ms / 86400000).toInt() + 1;
}

/// MONTH_LABELS: January ... December.
const List<String> monthLabels = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
];

/// How a range reads on the Filters button and chips: a whole year or month is
/// named as one ("2025", "September 2026"); a quick range by its name; anything
/// else as its two dates.
String describeRange(List<String> range) {
  final from = range.isNotEmpty ? range[0] : '';
  final to = range.length > 1 ? range[1] : '';
  if (from.isEmpty || to.isEmpty) return '';
  final parts = from.split('-');
  final fy = parts[0];
  final fm = parts.length > 1 ? parts[1] : 'undefined';
  if (from == '$fy-01-01' && to == '$fy-12-31') return fy;
  List<String>? month;
  try {
    month = monthRange('$fy-$fm');
  } on FormatException {
    month = null;
  }
  if (month != null && from == month[0] && to == month[1]) {
    final i = _toNumber(fm).toInt() - 1;
    return '${i >= 0 && i < 12 ? monthLabels[i] : 'undefined'} $fy';
  }
  if (from == to) return displayDay(from);
  return '${displayDay(from)} to ${displayDay(to)}';
}

/// Key of the quick range equal to [range], or null.
String? quickRangeKey(List<String> range) {
  final joined = range.join(',');
  for (final q in quickRanges) {
    if (q.range().join(',') == joined) return q.key;
  }
  return null;
}

/// Years the process has data for (newest first), from the API's `extent`
/// ({'from','to'} or null); falls back to the current year so the Year tab is
/// never empty.
List<int> yearsOfExtent(Map<String, dynamic>? extent) {
  final thisYear = engineClock().year;
  final first = extent != null ? _toNumber(_slice(_str(extent['from']), 0, 4)) : thisYear.toDouble();
  final lastRaw = extent != null ? _toNumber(_slice(_str(extent['to']), 0, 4)) : thisYear.toDouble();
  final last = lastRaw.isNaN ? lastRaw : (lastRaw > thisYear ? lastRaw : thisYear.toDouble());
  final count = last - first + 1;
  if (!count.isFinite || count <= 0) return const [];
  final l = last.toInt();
  return List<int>.generate(count.toInt(), (i) => l - i);
}
