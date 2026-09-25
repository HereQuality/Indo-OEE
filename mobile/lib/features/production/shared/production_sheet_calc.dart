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
//   effectiveHours, setupEfficiency, actualQty, rejectedQty, totalCycleSec.
// Per machine/date (dayCalc): unutilized (own row), unreportedMin, oeeLosses,
// oeeLunch, oeeLunchCot (day totals shared by every entry of the day), gapMin.

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
  'Other',
];

const List<String> workingStatuses = [
  'M/C OFF',
  'ABSENT',
  'SUNDAY',
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
    opsTotal = ownTotal! - excludedSec;
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
  final double? idealQty = isNum(idealQtyRaw) ? idealQtyRaw!.floorToDouble() : null;

  final ok = jsNumber(row['okQty']);
  // Actual is typed (never above Ideal); Rejected is whatever of it wasn't OK.
  // A row with no Actual at all falls back to OK + the Rejected it stored.
  final actual = jsNumber(row['actualQty']);
  final double? rej = (isNum(actual) && isNum(ok)) ? _max0(actual! - ok!) : jsNumber(row['rejectedQty']);
  final double totalProduced = isNum(actual) ? actual! : _or0(ok) + _or0(rej);

  // 7) Total Stoppage = sum of the ten stoppage columns, whatever is typed.
  final totalStoppageMin = _sumOrZero([for (final f in stoppageFields) jsNumber(row[f['key']])]);

  // 8) Effective Machine Run Time = OK Quantity × Total Cycle Time ÷ 3600.
  final double? effectiveHours = isNum(cycle) ? (_or0(ok) * cycle!) / 3600 : null;

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
  };
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

class _SortRow {
  const _SortRow(this.row, this.i, this.on);
  final Map<String, dynamic> row;
  final int i;
  final double? on;
}

/// The figures that depend on a machine's whole date, one map per row in
/// [sortByMachineOn] order. Keys: unutilized (this row's own shift/lunch),
/// unreportedMin, oeeLosses, oeeLunch, oeeLunchCot (combined across the day, so
/// every entry of that machine/date shows the same number) and gapMin (clock
/// gap to the next row's Machine ON, never below 0; null for the last row).
List<Map<String, dynamic>> dayCalc(Iterable<Map<String, dynamic>?>? rows) {
  final list = sortByMachineOn(rows);
  final calcs = list.map(rowCalc).toList();

  final dayShiftH = _sumOrZero(calcs.map((c) => c['shiftHours'] as double?));
  final dayStoppageMin = _sumOrZero(calcs.map((c) => c['totalStoppageMin'] as double?));
  final dayEffectiveH = _sumOrZero(calcs.map((c) => c['effectiveHours'] as double?));
  final dayLunchMin = _sumOrZero(list.map((r) => jsNumber(r['lunchMin'])));
  final daySetupMin = _sumOrZero(list.map((r) => jsNumber(r['setupMin'])));
  // Blank only when nothing on this machine/date has a Machine Shift Time.
  final dayHasShift = calcs.any((c) => isNum(c['shiftHours']));

  final double? dayUnreportedMin = dayHasShift ? dayShiftH * 60 - dayEffectiveH * 60 - dayStoppageMin : null;
  final double? dayOeeLosses = dayHasShift ? _ratio(dayEffectiveH, dayShiftH - dayStoppageMin / 60) : null;
  final double? dayOeeLunch = dayHasShift ? _ratio(dayEffectiveH, dayShiftH - dayLunchMin / 60) : null;
  // Named …Cot — the key saved dashboards use — though the column reads "Setup Time".
  final double? dayOeeLunchCot =
      dayHasShift ? _ratio(dayEffectiveH, dayShiftH - dayLunchMin / 60 - daySetupMin / 60) : null;

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

    final shiftHi = calcs[i]['shiftHours'] as double?;
    final lunchMinI = jsNumber(row['lunchMin']);
    out.add(<String, dynamic>{
      // 6) Unutilized Machine Time = (12 − (Shift h − Lunch min ÷ 60)) ÷ 11.
      'unutilized': isNum(shiftHi) ? (12 - (shiftHi! - (lunchMinI ?? 0) / 60)) / 11 : null,
      'unreportedMin': dayUnreportedMin,
      'oeeLosses': dayOeeLosses,
      'oeeLunch': dayOeeLunch,
      'oeeLunchCot': dayOeeLunchCot,
      'gapMin': gapMin,
    });
  }
  return out;
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
  return jsToFixed(d, digits).replaceFirst(_trailingZerosRe, '');
}

/// A 0–1 ratio as "12.34%"; "" for null/NaN/Infinity.
String fmtPct(Object? v) => isNum(v) ? '${jsToFixed((v as num).toDouble() * 100, 2)}%' : '';

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
