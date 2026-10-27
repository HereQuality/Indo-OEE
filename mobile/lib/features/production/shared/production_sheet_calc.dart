// Port of client/src/utils/productionSheet.js — column definitions and the
// formulas of the Production Data Entry sheet (Indo "Section Wise Eff. — CNC").
//
// The port is 1:1: same names (SCREAMING_CASE -> lowerCamelCase), same JS keys
// in the Map<String, dynamic> inputs/outputs, and the JS number semantics
// (Number()/num()/isNum, Math.floor/round, toFixed, NaN propagation) so a row
// computed here reads exactly like the web sheet. Numbers in results are
// always `double?` (null = JS null/undefined, double.nan = NaN).
//
// Per row (rowCalc), see the web file for the derivation of each formula:
//   shiftHours, idealQty, idealQtyPerHour, pctOk, totalStoppageMin,
//   effectiveHours, setupEfficiency, actualQty, rejectedQty, totalCycleSec,
//   availability, performance, quality, plannedProdMin, operatingMin, idealRunSec.
// Per machine/date (dayCalc): unutilized (clamped 0..1) + unutilizedRaw,
// unreportedMin, oeeLosses, oeeLunch, oeeLunchCot, productivity,
// productivityLunch (day totals shared by every entry of the day), gapMin.

import 'dart:typed_data';

const int slotsPerDay = 3;
const int cycleOps = 5;

/// The named operation-time boxes, in sheet order — Total Cycle Time is their
/// sum. Two operations really are both called "Other Operation (sec)"; they
/// are told apart only by key (see [cycleOpLabel]).
const List<Map<String, dynamic>> cycleOpFields = [
  {'key': 'drillingSec', 'label': 'Drilling (sec)'},
  {'key': 'boringSec', 'label': 'Boring (sec)'},
  {'key': 'threadingSec', 'label': 'Threading (sec)'},
  {'key': 'tappingSec', 'label': 'Tapping (sec)'},
  {'key': 'chamferingSec', 'label': 'Chamfering (sec)'},
  {'key': 'otherOp1Sec', 'label': 'Other Operation (sec)'},
  {'key': 'otherOp2Sec', 'label': 'Other Operation (sec)'},
  {'key': 'clampDeclampSec', 'label': 'Clamp/Declamp (sec)'},
];

/// What to call an operation wherever it is shown; the second "Other
/// Operation" reads "Other Operation 2 (sec)".
String cycleOpLabel(Map<String, dynamic> f) {
  final label = '${f['label']}';
  return f['key'] == 'otherOp2Sec' ? '${label.replaceFirst(' (sec)', '')} 2 (sec)' : label;
}

/// Offered in the entry form's Reject Reason dropdown and grouped on the
/// dashboard. Kept in step with REJECT_REASONS in server/models/ProductionEntry.js.
const List<String> rejectReasons = [
  'Dimension Out',
  'Tool Mark',
  'Surface Finish',
  'Porosity / Blow Hole',
  'Material Defect',
  'Setting Mistake',
  'Operator Mistake',
  'Machine Fault',
  'Broken',
  'Other',
];

/// Machine Working Status: Working (normal entry) or Non Working (the machine did
/// not run — only the day, machine, operator, reason and remarks are recorded).
const List<String> workingModes = ['Working', 'Non Working'];

/// Web `isNonWorking`.
bool isNonWorking(Map<String, dynamic>? v) => v?['workingMode'] == 'Non Working';

const List<String> machineStatuses = ['Machine Breakdown', 'No Manpower', 'No Planning'];

/// Every value the real Contact sheet uses (its typos folded in).
const List<String> workingStatuses = [
  'PRESENT',
  'ABSENT',
  'LEAVE',
  'M/C OFF',
  'M/C STOP',
  'UNDER MAINT.',
  'SUNDAY',
  'W/OFF',
  'HOLIDAY',
  'STOCK COUNTING',
  'REPORT NOT FILLUP',
];

const List<Map<String, dynamic>> stoppageFields = [
  {'key': 'plannedDownMin', 'label': 'Planned Down Time (min)'},
  {'key': 'setupMin', 'label': 'Setup Time (min)'},
  {'key': 'noManPowerMin', 'label': 'No Man Power (min)'},
  {'key': 'materialShiftingMin', 'label': 'Material Shifting (min)'},
  {'key': 'noMaterialMin', 'label': 'No Material (min)'},
  {'key': 'bdMechMin', 'label': 'B.D. Mech. (min)'},
  {'key': 'bdEleMin', 'label': 'B.D. Ele. (min)'},
  {'key': 'noPowerMin', 'label': 'No Power (min)'},
  {'key': 'lunchMin', 'label': 'Lunch/Tea/Wash room etc. (min)'},
  {'key': 'otherMin', 'label': 'Other (min)'},
];

/// Lunch / Tea and Planned Downtime are the planned stops — taken out of the
/// time the machine was meant to produce, so they never lower Availability.
const List<String> plannedStopKeys = ['lunchMin', 'plannedDownMin'];

/// Which figures of a row's calc (with its day's figures merged in, see
/// [withDayFigures]) may be above 100% and hold the entry for Admin review:
/// Availability / Performance / Quality, the three OEE figures and the worker
/// sheets' two Productivity figures. Mirrors the web's OEE_METRIC_LABELS.
const Map<String, String> oeeMetricLabels = {
  'availability': 'Availability',
  'performance': 'Performance',
  'quality': 'Quality',
  'oeeLosses': 'OEE considering losses',
  'oeeLunch': 'OEE not considering losses but lunch',
  'oeeLunchCot': 'OEE not considering losses but lunch & setup time',
  'productivity': 'Productivity without considering Lunch, Tea, etc.',
  'productivityLunch': 'Productivity considering Lunch, Tea, etc.',
};

/// The OEE figure keys a sheet's table has: three on a machine sheet, two on
/// BEFORE POWDER COATING, the two Productivity figures on a worker sheet
/// (web OEE_FIGURE_KEYS). The kinds are 'machine' | 'bpc' | 'worker'.
const Map<String, List<String>> oeeFigureKeys = {
  'machine': ['oeeLosses', 'oeeLunch', 'oeeLunchCot'],
  'bpc': ['oeeLosses', 'oeeLunch'],
  'worker': ['productivity', 'productivityLunch'],
};

// ── JavaScript number semantics ─────────────────────────────────────────────

/// JS `isNum`: a finite number (`v !== null && Number.isFinite(v)`). Strings
/// and other non-numbers are NOT numbers, exactly like Number.isFinite.
bool isNum(Object? v) => v is num && v.isFinite;

/// JS `String(v)` for the values the sheet handles (numbers use the JS
/// Number-to-string format, lists join with commas, maps read
/// "[object Object]").
String jsString(Object? v) {
  if (v == null) return 'null';
  if (v is String) return v;
  if (v is num) return jsNumStr(v);
  if (v is bool) return v ? 'true' : 'false';
  if (v is Iterable) return v.map((e) => e == null ? '' : jsString(e)).join(',');
  return '[object Object]';
}

/// JS truthiness (`if (v)` / `v || x`).
bool jsTruthy(Object? v) {
  if (v == null) return false;
  if (v is bool) return v;
  if (v is num) return !(v == 0 || v.isNaN);
  if (v is String) return v.isNotEmpty;
  return true;
}

bool _isJsSpace(int c) =>
    (c >= 0x09 && c <= 0x0D) ||
    c == 0x20 ||
    c == 0xA0 ||
    c == 0x1680 ||
    (c >= 0x2000 && c <= 0x200A) ||
    c == 0x2028 ||
    c == 0x2029 ||
    c == 0x202F ||
    c == 0x205F ||
    c == 0x3000 ||
    c == 0xFEFF;

/// JS `String.prototype.trim` (Dart's own trim would also strip U+0085).
String jsTrim(String s) {
  var start = 0;
  var end = s.length;
  while (start < end && _isJsSpace(s.codeUnitAt(start))) {
    start++;
  }
  while (end > start && _isJsSpace(s.codeUnitAt(end - 1))) {
    end--;
  }
  return s.substring(start, end);
}

/// `x || 0`: NaN, null and 0 read as 0.
double _or0(double? v) => (v == null || v.isNaN || v == 0) ? 0.0 : v;

final RegExp _hexRe = RegExp(r'^0[xX][0-9a-fA-F]+$');
final RegExp _octRe = RegExp(r'^0[oO][0-7]+$');
final RegExp _binRe = RegExp(r'^0[bB][01]+$');
final RegExp _decRe = RegExp(r'^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$');

double _stringToNumber(String raw) {
  final s = jsTrim(raw);
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

/// JS `Number(v)`: whitespace-only text is 0, unparsable text is NaN, null is 0.
double jsToNumber(Object? v) {
  if (v == null) return 0;
  if (v is num) return v.toDouble();
  if (v is bool) return v ? 1 : 0;
  if (v is String) return _stringToNumber(v);
  if (v is Iterable) return _stringToNumber(jsString(v));
  return double.nan;
}

/// The sheet's `num`: blank ("" / null) is null (no value), anything else is
/// `Number(v)` — which may be NaN for junk text.
double? jsNumber(Object? v) {
  if (v == null) return null;
  if (v is String && v.isEmpty) return null;
  return jsToNumber(v);
}

/// JS `Math.round` (half rounds toward +infinity).
double jsRound(double x) {
  if (x.isNaN || x.isInfinite) return x;
  final f = x.floorToDouble();
  return (x - f >= 0.5) ? f + 1 : f;
}

/// JS `String(number)`.
String jsNumStr(num value) {
  final d = value.toDouble();
  if (d.isNaN) return 'NaN';
  if (d == 0) return '0';
  if (d.isInfinite) return d < 0 ? '-Infinity' : 'Infinity';
  final neg = d < 0;
  // Dart's toString gives the shortest round-trip digits too; re-lay them out
  // the way the ECMAScript Number::toString algorithm does.
  final raw = (neg ? -d : d).toString();
  final ePos = raw.indexOf('e');
  final mant = ePos < 0 ? raw : raw.substring(0, ePos);
  final exp = ePos < 0 ? 0 : int.parse(raw.substring(ePos + 1));
  final dot = mant.indexOf('.');
  var digits = dot < 0 ? mant : mant.substring(0, dot) + mant.substring(dot + 1);
  var n = (dot < 0 ? mant.length : dot) + exp;
  var lead = 0;
  while (lead < digits.length - 1 && digits[lead] == '0') {
    lead++;
  }
  digits = digits.substring(lead);
  n -= lead;
  var end = digits.length;
  while (end > 1 && digits[end - 1] == '0') {
    end--;
  }
  digits = digits.substring(0, end);
  final k = digits.length;
  String body;
  if (k <= n && n <= 21) {
    body = digits + '0' * (n - k);
  } else if (0 < n && n <= 21) {
    body = '${digits.substring(0, n)}.${digits.substring(n)}';
  } else if (-6 < n && n <= 0) {
    body = '0.${'0' * -n}$digits';
  } else {
    final e = n - 1;
    final sign = e < 0 ? '-' : '+';
    body = k == 1
        ? '${digits}e$sign${e.abs()}'
        : '${digits[0]}.${digits.substring(1)}e$sign${e.abs()}';
  }
  return neg ? '-$body' : body;
}

/// JS `Number.prototype.toFixed` — exact decimal expansion of the double,
/// ties rounding up, values of 1e21 and more falling back to `String(x)`.
String jsToFixed(double x, int digits) {
  if (x.isNaN) return 'NaN';
  if (x.isInfinite) return x < 0 ? '-Infinity' : 'Infinity';
  if (x.abs() >= 1e21) return jsNumStr(x);
  final neg = x < 0;
  final a = neg ? -x : x;
  final bits = (ByteData(8)..setFloat64(0, a)).getUint64(0);
  final expBits = (bits >> 52) & 0x7ff;
  var mantissa = BigInt.from(bits & 0xfffffffffffff);
  int exp2;
  if (expBits == 0) {
    exp2 = -1074;
  } else {
    mantissa = mantissa | (BigInt.one << 52);
    exp2 = expBits - 1075;
  }
  final scaled = mantissa * BigInt.from(10).pow(digits);
  BigInt n;
  if (exp2 >= 0) {
    n = scaled << exp2;
  } else {
    final den = BigInt.one << -exp2;
    n = (scaled * BigInt.two + den) ~/ (den * BigInt.two);
  }
  var s = n.toString();
  if (digits > 0) {
    if (s.length <= digits) s = '0' * (digits + 1 - s.length) + s;
    s = '${s.substring(0, s.length - digits)}.${s.substring(s.length - digits)}';
  }
  return neg ? '-$s' : s;
}

// ── Time ────────────────────────────────────────────────────────────────────

final RegExp _colonTimeRe = RegExp(r'^(\d{1,2}):(\d{2})$');
final RegExp _plainTimeRe = RegExp(r'^(\d{1,2})(\d{2})$');
final RegExp _hourOnlyRe = RegExp(r'^\d{1,2}$');

/// Accepts what people type in a time cell — "9", "930", "0930", "9:30",
/// "9.30", "21:30" — and returns "HH:mm", or null if it isn't a valid time.
String? normalizeTime(Object? raw) {
  final s = jsTrim(jsString(raw ?? '')).replaceFirst('.', ':');
  final m = _colonTimeRe.firstMatch(s) ?? _plainTimeRe.firstMatch(s);
  String hh;
  String mm;
  if (m != null) {
    hh = m.group(1)!;
    mm = m.group(2)!;
  } else if (_hourOnlyRe.hasMatch(s)) {
    hh = s;
    mm = '00';
  } else {
    return null;
  }
  final h = int.parse(hh);
  final min = int.parse(mm);
  if (h > 23 || min > 59) return null;
  return '${h.toString().padLeft(2, '0')}:${min.toString().padLeft(2, '0')}';
}

double? _toMinutes(Object? hhmm) {
  final t = normalizeTime(hhmm);
  if (t == null) return null;
  final parts = t.split(':');
  return (int.parse(parts[0]) * 60 + int.parse(parts[1])).toDouble();
}

/// OFF − ON in minutes; an OFF earlier than ON is taken as running past midnight.
double? spanMinutes(Object? on, Object? off) {
  final a = _toMinutes(on);
  final b = _toMinutes(off);
  if (a == null || b == null) return null;
  final diff = b - a;
  return diff < 0 ? diff + 1440 : diff;
}

/// Sum of the finite numbers in [ops] (each read with [jsNumber]); null when
/// none is a number.
double? totalCycleSec(Iterable<Object?>? ops) {
  final vals = (ops ?? const <Object?>[]).map(jsNumber).where(isNum).cast<double>().toList();
  if (vals.isEmpty) return null;
  return vals.fold<double>(0, (s, v) => s + v);
}

double _sumOrZero(Iterable<double?> vals) => vals.fold<double>(0, (s, v) => s + (isNum(v) ? v! : 0));

/// A Part's own Total Cycle Time less the seconds of the operations unticked for this
/// entry. Unticking more than the Part has leaves float noise (7.1e-15) or a negative
/// figure: rounded to the millionth, anything not above zero is no cycle at all (null).
/// Web `cycleAfterExcluded`.
double? cycleAfterExcluded(double ownTotal, double excludedSec) {
  if (excludedSec == 0) return ownTotal;
  final c = jsRound((ownTotal - excludedSec) * 1e6) / 1e6;
  return c > 0 ? c : null;
}

double? _ratio(double? a, double? b) => (isNum(a) && isNum(b) && b != 0) ? a! / b! : null;

// ── Per-row figures ─────────────────────────────────────────────────────────

/// The calculated columns of one entry. `{}` for a null row. Keys: totalCycleSec,
/// actualQty, rejectedQty, shiftHours, idealQty, idealQtyPerHour, pctOk,
/// totalStoppageMin, effectiveHours, setupEfficiency — all `double?`.
Map<String, dynamic> rowCalc(Map<String, dynamic>? row) {
  if (row == null) return <String, dynamic>{};

  // 1) Total cycle time is the item's own Total Cycle Time box; the sum of the
  // named operations is only a fallback for rows that predate it. An operation
  // unticked for this entry (excludedOps) has its own seconds taken back out.
  // Blank without a Part Name.
  final excludedRaw = row['excludedOps'];
  final excluded = excludedRaw is Iterable ? excludedRaw.toSet() : <Object?>{};
  final excludedSec = _sumOrZero([
    for (final f in cycleOpFields)
      if (excluded.contains(f['key'])) jsNumber(row[f['key']]),
  ]);
  final ownTotal = jsNumber(row['totalCycleSec']);
  final opFields = <double?>[
    for (final f in cycleOpFields)
      if (!excluded.contains(f['key'])) jsNumber(row[f['key']]),
  ];
  final hasOpFields = opFields.any(isNum);
  final legacySingle = jsNumber(row['cycleTimeSec']);
  final double? opsTotal;
  if (isNum(ownTotal)) {
    opsTotal = cycleAfterExcluded(ownTotal!, excludedSec);
  } else if (hasOpFields) {
    opsTotal = _sumOrZero(opFields);
  } else if (isNum(legacySingle)) {
    opsTotal = legacySingle;
  } else {
    final ops = row['cycleOpsSec'];
    opsTotal = totalCycleSec(ops is Iterable ? ops : null);
  }
  final itemName = row['itemName'];
  final hasPart = jsTruthy(itemName) && jsTrim(jsString(itemName)).isNotEmpty;
  final double? cycle = hasPart ? opsTotal : null;

  // 2) Machine Shift Time = MOD(OFF − ON, 1) × 24, as soon as both are typed.
  final shiftMin = spanMinutes(row['machineOnTime'], row['machineOffTime']);
  final double? shiftHours = shiftMin == null ? null : shiftMin / 60;

  // 3) Ideal Quantity = FLOOR(shift min × 60 ÷ cycle sec).
  final idealQtyRaw = shiftMin != null ? _ratio(shiftMin * 60, cycle) : null;
  // + 1e-9: a quotient that is a whole number mathematically can land just under it
  // in floating point (9300 / 37.2 = 249.99999999999997) and must not floor one low.
  final double? idealQty = isNum(idealQtyRaw) ? (idealQtyRaw! + 1e-9).floorToDouble() : null;

  final ok = jsNumber(row['okQty']);
  // Actual is typed (never above Ideal); Rejected is whatever of it wasn't OK.
  // A row with no Actual at all falls back to OK + the Rejected it stored.
  final actual = jsNumber(row['actualQty']);
  final double? rej = (isNum(actual) && isNum(ok)) ? _max0(actual! - ok!) : jsNumber(row['rejectedQty']);
  final double totalProduced = isNum(actual) ? actual! : _or0(ok) + _or0(rej);

  // 7) Total Stoppage = sum of the ten stoppage columns, whatever is typed. A sheet
  // with downtime columns of its own beyond these ten (Printing's Ask Query To QC
  // Team / Empty Bag Tugging / Stock Counting) lists their keys in
  // row['extraStoppageKeys'] (set by its adapter), so they count here too.
  final extraRaw = row['extraStoppageKeys'];
  final totalStoppageMin = _sumOrZero([
    for (final f in stoppageFields) jsNumber(row[f['key']]),
    if (extraRaw is Iterable)
      for (final k in extraRaw) jsNumber(row[k]),
  ]);

  // 8) Effective Machine Run Time = OK Quantity × Total Cycle Time ÷ 3600. A sheet
  // whose own rule counts every piece run (SPRING FOR PINS: OK + Rejected) marks
  // its rows runQtyBasis: "total".
  final double runQty = row['runQtyBasis'] == 'total' ? totalProduced : _or0(ok);
  final double? effectiveHours = isNum(cycle) ? (runQty * cycle!) / 3600 : null;

  // 14–16) Availability / Performance / Quality — this entry alone, standard OEE
  // over this sheet's own fields (see [_oeeParts]). Never capped at 100%.
  final double? totalQty = isNum(actual)
      ? actual
      : ((isNum(ok) || isNum(rej)) ? _or0(ok) + _or0(rej) : null);
  final parts = _oeeParts(
    shiftMin: shiftMin,
    totalStoppageMin: totalStoppageMin,
    row: row,
    cycle: cycle,
    ok: ok,
    totalQty: totalQty,
  );

  return <String, dynamic>{
    'totalCycleSec': cycle,
    'actualQty': isNum(actual) ? actual : ((isNum(ok) || isNum(rej)) ? totalProduced : null),
    'rejectedQty': rej,
    'shiftHours': shiftHours,
    'idealQty': idealQty,
    // 4) Ideal Quantity/Hours = Ideal Quantity ÷ Machine Shift Time.
    'idealQtyPerHour': _ratio(idealQty, shiftHours),
    // 5) % OK Quantity = OK ÷ (OK + Rejected).
    'pctOk': isNum(ok) ? _ratio(ok, ok! + _or0(rej)) : null,
    'totalStoppageMin': totalStoppageMin,
    'effectiveHours': effectiveHours,
    // 10) Setup Efficiency = Effective Run Time ÷ Machine Shift Time.
    'setupEfficiency': _ratio(effectiveHours, shiftHours),
    ...parts,
  };
}

/// Availability, Performance and Quality for one entry, plus the sums they are
/// made of (web `oeeParts`):
///   Planned Production Time = Planned Operator Shift − Lunch − Planned Downtime
///   Operating Time          = Machine Shift (ON→OFF) − every stoppage
///                             (− Other Activity, After Powder Coating only)
///   Availability = Operating ÷ Planned Production; Performance = Cycle ×
///   (OK + Rejected) ÷ Operating; Quality = OK ÷ (OK + Rejected).
/// A row with no Planned Operator Shift uses its Machine Shift there.
Map<String, dynamic> _oeeParts({
  required double? shiftMin,
  required double totalStoppageMin,
  required Map<String, dynamic> row,
  required double? cycle,
  required double? ok,
  required double? totalQty,
}) {
  if (shiftMin == null) {
    return <String, dynamic>{
      'availability': null,
      'performance': null,
      'quality': null,
      'plannedProdMin': null,
      'operatingMin': null,
      'idealRunSec': null,
    };
  }
  final plannedMin = _plannedMinOf(row);
  final plannedProdMin =
      (isNum(plannedMin) ? plannedMin! : shiftMin) - _sumOrZero([for (final k in plannedStopKeys) jsNumber(row[k])]);
  final operatingMin = shiftMin - _or0(totalStoppageMin) - _or0(jsNumber(row['otherActivityMin']));
  final double? idealRunSec = (isNum(cycle) && cycle! > 0 && isNum(totalQty)) ? cycle * totalQty! : null;
  return <String, dynamic>{
    'availability': plannedProdMin > 0 ? operatingMin / plannedProdMin : null,
    'performance': (operatingMin > 0 && isNum(idealRunSec)) ? idealRunSec! / 60 / operatingMin : null,
    'quality': (isNum(totalQty) && totalQty! > 0 && isNum(ok)) ? ok! / totalQty : null,
    'plannedProdMin': plannedProdMin,
    'operatingMin': operatingMin,
    'idealRunSec': idealRunSec,
  };
}

/// Whichever of [oeeMetricLabels] is above 100% on a calc map — [] when none (a
/// tiny tolerance keeps floating-point dust out). The OEE / Productivity figures
/// are the day's, so merge them onto the row's calc first ([withDayFigures]).
List<String> metricsOver100(Map<String, dynamic>? calc) => [
      for (final k in oeeMetricLabels.keys)
        if (isNum(calc?[k]) && (calc![k] as num) > 1 + 1e-9) k,
    ];

/// A row's calc with the day's OEE figures added — only the ones [kind]
/// ('machine' | 'bpc' | 'worker') has. Mirrors the web's withDayFigures.
Map<String, dynamic> withDayFigures(Map<String, dynamic> calc, Map<String, dynamic>? day, [String kind = 'machine']) {
  final out = <String, dynamic>{...calc};
  for (final k in oeeFigureKeys[kind] ?? const <String>[]) {
    out[k] = day?[k];
  }
  return out;
}

/// This form entry's day figures among the sheet's already-saved entries: the
/// entry ([values], planned shift already in decimal hours) joins [saved] (the
/// other entries of the same machine / worker and date — the entry's own saved
/// copy, matched by _id, is replaced by [values]) and [dayCalcFn] (the sheet's
/// dayCalc) runs over the group. Mirrors the web's dayFiguresFor.
Map<String, dynamic>? dayFiguresFor(
  List<Map<String, dynamic>> Function(List<Map<String, dynamic>> sortedRows) dayCalcFn,
  Map<String, dynamic> values, [
  Iterable<Map<String, dynamic>?>? saved,
]) {
  final mine = <String, dynamic>{...values};
  final id = values['_id'];
  final others = [
    for (final r in saved ?? const <Map<String, dynamic>?>[])
      if (r != null && !(jsTruthy(id) && '${r['_id']}' == '$id')) r,
  ];
  final sorted = sortByMachineOn([...others, mine]);
  final results = dayCalcFn(sorted);
  final i = sorted.indexWhere((r) => identical(r, mine));
  return (i < 0 || i >= results.length) ? null : results[i];
}

/// `Math.max(0, x)` for a finite x.
double _max0(double x) => x > 0 ? x : 0.0;

/// Rows of one machine's one date in the order "next row" means in every
/// formula — by actual Machine ON Time, not Entry No. A row with no valid
/// time sorts last, by original position among itself. Returns the SAME row
/// instances (so callers can match by identity or _id).
List<Map<String, dynamic>> sortByMachineOn(Iterable<Map<String, dynamic>?>? rows) {
  final items = <_SortRow>[];
  var i = 0;
  for (final r in rows ?? const <Map<String, dynamic>?>[]) {
    if (r == null) continue;
    items.add(_SortRow(r, i++, _toMinutes(r['machineOnTime'])));
  }
  items.sort((a, b) {
    final ao = a.on;
    final bo = b.on;
    if (ao == null && bo == null) return a.i - b.i;
    if (ao == null) return 1;
    if (bo == null) return -1;
    final d = ao - bo;
    return d != 0 ? (d < 0 ? -1 : 1) : a.i - b.i;
  });
  return [for (final x in items) x.row];
}

/// Planned Operator Shift in minutes. It is saved as hours to 6 decimals (6 h 50 min
/// is 6.833333), so it is taken back to the minute it stands for, to 1/1000 min —
/// otherwise that rounding leaves Availability a hair over 100%. Mirrors
/// plannedMinOf in client/src/utils/productionSheet.js.
double? _plannedMinOf(Map<String, dynamic>? row) {
  final h = jsNumber(row?['plannedOperatorShiftHours']);
  return isNum(h) ? jsRound(h! * 60000) / 1000 : null;
}

class _SortRow {
  const _SortRow(this.row, this.i, this.on);
  final Map<String, dynamic> row;
  final int i;
  final double? on;
}

/// The figures that depend on a machine's whole date, one map per row in
/// [sortByMachineOn] order. Keys: unutilized (day-combined, shown within 0–100%)
/// + unutilizedRaw, unreportedMin, oeeLosses, oeeLunch, oeeLunchCot,
/// productivity, productivityLunch (all combined across the day, so every entry
/// of that machine/date shows the same number) and gapMin (clock gap to the next
/// row's Machine ON, never below 0; null for the last row).
///
/// [lossesExceptLunch]: OEE considering losses takes every stoppage off the time
/// available EXCEPT Lunch / Rest (Before Powder Coating's sheet — its other two
/// OEE columns don't exist, and its lunch-only one is oeeLunch).
List<Map<String, dynamic>> dayCalc(Iterable<Map<String, dynamic>?>? rows, {bool lossesExceptLunch = false}) {
  final list = sortByMachineOn(rows);
  final calcs = list.map(rowCalc).toList();

  // Time available for the machine: the operator's Planned Operator Shift (or its
  // Machine Shift, whichever is bigger).
  //
  // A Planned that came from Process Master's lock (plannedLocked, set by the server) is
  // the machine's whole day, not each entry's: it counts once per date however many
  // entries share it (never less than those entries' own runs added up). Hours typed on
  // each entry are that entry's own share and add up.
  final lockedIdx = <int>{
    for (var i = 0; i < list.length; i++)
      if (list[i]['plannedLocked'] == true && isNum(_plannedMinOf(list[i])) && isNum(calcs[i]['shiftHours'])) i,
  };
  var lockedHours = 0.0;
  if (lockedIdx.isNotEmpty) {
    final planned = lockedIdx.map((i) => _plannedMinOf(list[i])! / 60).reduce((a, b) => a > b ? a : b);
    final run = _sumOrZero([for (final i in lockedIdx) calcs[i]['shiftHours'] as double?]);
    lockedHours = planned > run ? planned : run;
  }
  final dayAvailH = _sumOrZero([
        for (var i = 0; i < list.length; i++)
          () {
            if (lockedIdx.contains(i)) return null;
            final shift = calcs[i]['shiftHours'] as double?;
            if (!isNum(shift)) return null;
            final plannedMin = _plannedMinOf(list[i]);
            return isNum(plannedMin) && plannedMin! / 60 > shift! ? plannedMin / 60 : shift;
          }(),
      ]) +
      lockedHours;
  final dayStoppageMin = _sumOrZero(calcs.map((c) => c['totalStoppageMin'] as double?));
  final dayEffectiveH = _sumOrZero(calcs.map((c) => c['effectiveHours'] as double?));
  final dayLunchMin = _sumOrZero(list.map((r) => jsNumber(r['lunchMin'])));
  final daySetupMin = _sumOrZero(list.map((r) => jsNumber(r['setupMin'])));
  // Minutes on other work — only After Powder Coating's rows carry any.
  final dayOtherActivityMin = _sumOrZero(list.map((r) => jsNumber(r['otherActivityMin'])));
  // Blank only when nothing on this machine/date has a Machine Shift Time.
  final dayHasShift = calcs.any((c) => isNum(c['shiftHours']));

  // Unreported Time = Planned Operator Shift − Effective Run Time − Stoppage, in
  // minutes at full precision. A row saved without a Planned shift falls back to
  // its Machine Shift in Planned's place.
  final double? dayUnreportedMin = dayHasShift
      ? _sumOrZero([
            for (var i = 0; i < list.length; i++)
              () {
                final c = calcs[i];
                final stop = _or0(c['totalStoppageMin'] as double?) + _or0(jsNumber(list[i]['otherActivityMin']));
                final effectiveMin = _or0(c['effectiveHours'] as double?) * 60;
                // A locked Planned counts once for the day, as in dayAvailH above.
                if (lockedIdx.contains(i)) return -effectiveMin - stop;
                final plannedMin = _plannedMinOf(list[i]);
                final shiftH = c['shiftHours'] as double?;
                final double? basisMin = isNum(plannedMin) ? plannedMin : (isNum(shiftH) ? shiftH! * 60 : null);
                return basisMin == null ? -stop : basisMin - effectiveMin - stop;
              }(),
          ]) +
          lockedHours * 60
      : null;
  final double? dayOeeLosses = dayHasShift
      ? _ratio(dayEffectiveH, dayAvailH - (lossesExceptLunch ? dayStoppageMin - dayLunchMin : dayStoppageMin) / 60)
      : null;
  final double? dayOeeLunch = dayHasShift ? _ratio(dayEffectiveH, dayAvailH - dayLunchMin / 60) : null;
  // Named …Cot — the key saved dashboards use — though the column reads "Setup Time".
  final double? dayOeeLunchCot =
      dayHasShift ? _ratio(dayEffectiveH, dayAvailH - dayLunchMin / 60 - daySetupMin / 60) : null;
  // After Powder Coating's two Productivity figures (Other Activity is out of both).
  final dayAvailForWorkH = dayAvailH - dayOtherActivityMin / 60;
  final double? dayProductivity = dayHasShift ? _ratio(dayEffectiveH, dayAvailForWorkH) : null;
  final double? dayProductivityLunch =
      dayHasShift ? _ratio(dayEffectiveH, dayAvailForWorkH - dayLunchMin / 60) : null;

  // 6) Unutilized Machine Time = (12 − (Day Shift − Day Lunch/60)) ÷ 11, combined
  // across every entry of this machine's date; shown within 0–100%.
  final dayShiftH = _sumOrZero(calcs.map((c) => c['shiftHours'] as double?));
  final double? dayUnutilized = dayHasShift ? (12 - (dayShiftH - dayLunchMin / 60)) / 11 : null;
  final double? unutilizedShown = dayUnutilized == null
      ? null
      : (dayUnutilized.isNaN ? dayUnutilized : (dayUnutilized < 0 ? 0.0 : (dayUnutilized > 1 ? 1.0 : dayUnutilized)));

  final out = <Map<String, dynamic>>[];
  for (var i = 0; i < list.length; i++) {
    final row = list[i];
    final next = i + 1 < list.length ? list[i + 1] : null;
    final thisOff = _toMinutes(row['machineOffTime']);
    final nextOn = next != null ? _toMinutes(next['machineOnTime']) : null;
    // Plain clock-minute subtraction (no midnight wrap): a negative gap only
    // means an overlap or a typo, which reads as no gap.
    final rawGapMin = (thisOff != null && nextOn != null) ? nextOn - thisOff : null;
    final double? gapMin = rawGapMin == null ? null : _max0(rawGapMin);

    out.add(<String, dynamic>{
      'unutilized': unutilizedShown,
      'unutilizedRaw': dayUnutilized,
      'unreportedMin': dayUnreportedMin,
      'oeeLosses': dayOeeLosses,
      'oeeLunch': dayOeeLunch,
      'oeeLunchCot': dayOeeLunchCot,
      'productivity': dayProductivity,
      'productivityLunch': dayProductivityLunch,
      'gapMin': gapMin,
    });
  }
  return out;
}

/// The sheets that work every entry out on its own — Printing, Injection
/// Moulding and Before Powder Coating. Their paper sheets give each row its own
/// OEE / Unreported Time on that row's Machine Shift; typed as the entry's
/// Planned Operator Shift (= its Machine Shift on the paper), each entry's
/// figures come from that entry alone. A Planned that came from Process
/// Master's lock is the machine's (or worker's) whole day instead, so a day with
/// any locked entry is combined once, as on every other sheet ([dayCalc]). One
/// result per row, in [sortByMachineOn] order, like [dayCalc]. Mirrors the web's
/// entryDayCalc (client/src/utils/productionSheet.js).
List<Map<String, dynamic>> entryDayCalc(Iterable<Map<String, dynamic>?>? rows, {bool lossesExceptLunch = false}) {
  final list = sortByMachineOn(rows);
  final day = dayCalc(list, lossesExceptLunch: lossesExceptLunch);
  if (list.any((r) => r['plannedLocked'] == true)) return day;
  return [
    for (var i = 0; i < list.length; i++)
      {...dayCalc([list[i]], lossesExceptLunch: lossesExceptLunch)[0], 'gapMin': day[i]['gapMin']},
  ];
}

/// Every remark an entry carries, labelled and in form order: the Other-reject
/// and Other-downtime remarks (each with the figure it explains) then the
/// general Remarks. Empty ones are left out. Each item: {key, title, figure, text}.
List<Map<String, dynamic>> remarkParts(Map<String, dynamic>? r) {
  final breakdown = r?['rejectBreakdown'];
  final rejectOther = jsNumber(breakdown is Map ? breakdown['Other'] : null);
  final downtimeOther = jsNumber(r?['otherMin']);
  return [
    if (jsTruthy(r?['rejectOtherRemark']))
      {
        'key': 'reject',
        'title': 'Reject · Other',
        'figure': (isNum(rejectOther) && rejectOther! > 0) ? '${fmtNum(rejectOther)} pcs' : '',
        'text': r!['rejectOtherRemark'],
      },
    if (jsTruthy(r?['otherMinRemark']))
      {
        'key': 'downtime',
        'title': 'Downtime · Other',
        'figure': (isNum(downtimeOther) && downtimeOther! > 0) ? '${fmtNum(downtimeOther)} min' : '',
        'text': r!['otherMinRemark'],
      },
    if (jsTruthy(r?['remarks']))
      {'key': 'general', 'title': 'Remarks', 'figure': '', 'text': r!['remarks']},
  ];
}

// ── Formatting ──────────────────────────────────────────────────────────────

final RegExp _trailingZerosRe = RegExp(r'\.?0+$');

/// 2-decimals (or [digits]) without trailing zeros; "" for null/NaN/Infinity.
/// Keeps the web quirk of stripping zeros from a digit-less toFixed result.
String fmtNum(Object? v, [int digits = 2]) {
  if (!isNum(v)) return '';
  final d = (v as num).toDouble();
  if (d == d.truncateToDouble()) return jsNumStr(d);
  final fixed = jsToFixed(d, digits);
  // Rounds to zero (float noise like -2.8e-14): "0", never "-0".
  return double.parse(fixed) == 0 ? '0' : fixed.replaceFirst(_trailingZerosRe, '');
}

/// A 0–1 ratio as "12.34%"; "" for null/NaN/Infinity.
String fmtPct(Object? v) {
  if (!isNum(v)) return '';
  final fixed = jsToFixed((v as num).toDouble() * 100, 2);
  return double.parse(fixed) == 0 ? '0.00%' : '$fixed%';
}

// ── Dates ───────────────────────────────────────────────────────────────────

String _pad(int n) => n.toString().padLeft(2, '0');

/// Local calendar day of [d] as "YYYY-MM-DD".
String isoDay(DateTime d) => '${d.year}-${_pad(d.month)}-${_pad(d.day)}';

/// JS `new Date(y, m, d)` year handling: 0..99 mean 1900..1999.
int? _jsYear(double y) {
  if (!y.isFinite) return null;
  final t = y.truncate();
  if (t.abs() > 275000) return null;
  return (t >= 0 && t <= 99) ? 1900 + t : t;
}

/// Every "YYYY-MM-DD" in the given "YYYY-MM" month; [] when it isn't one.
List<String> daysOfMonth(String yyyymm) {
  final parts = yyyymm.split('-');
  if (parts.length < 2) return const [];
  final yNum = jsToNumber(parts[0]);
  final mNum = jsToNumber(parts[1]);
  final y = _jsYear(yNum);
  if (y == null || !mNum.isFinite || mNum.truncate().abs() > 1000000) return const [];
  final m = mNum.truncate();
  final last = DateTime.utc(y, m + 1, 0).day;
  final yText = jsNumStr(yNum);
  final mText = jsNumStr(mNum).padLeft(2, '0'); // the raw number, like the web's padStart
  return [for (var i = 1; i <= last; i++) '$yText-$mText-${_pad(i)}'];
}

/// "YYYY-MM-DD" -> "DD/MM/YYYY".
String displayDay(String iso) {
  final p = iso.split('-');
  String at(int i) => i < p.length ? p[i] : 'undefined';
  return '${at(2)}/${at(1)}/${at(0)}';
}

bool isSunday(String iso) {
  final p = iso.split('-').map(jsToNumber).toList();
  if (p.length < 3) return false;
  final y = _jsYear(p[0]);
  if (y == null || !p[1].isFinite || !p[2].isFinite) return false;
  final m = p[1].truncate();
  final d = p[2].truncate();
  if (m.abs() > 1000000 || d.abs() > 1000000) return false;
  return DateTime.utc(y, m, d).weekday == DateTime.sunday;
}

String rowKey(Object? date, Object? machineId, Object? slot) =>
    '${jsString(date)}|${jsString(machineId)}|${jsString(slot)}';
