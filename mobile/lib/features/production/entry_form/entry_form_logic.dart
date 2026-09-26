import 'dart:math' as math;

import '../shared/production_entry_validation.dart';
import '../shared/production_sheet_calc.dart';

/// Widget-free rules of the Production Data Entry form (the derived figures and
/// caps that ProductionEntryForm.jsx computes inline), so they can be unit
/// tested on their own. Values are the JS-keyed maps the page hands the form:
/// typed fields are Strings, but a stored record may still carry numbers.

/// Time-of-day fields, the operation keys and a few shared lists.
final List<String> entryCycleOpKeys = [for (final f in cycleOpFields) f['key'] as String];

/// What a box shows for a stored value: null -> '', 90 -> '90', 12.5 -> '12.5'.
String entryText(Object? v) {
  if (v == null) return '';
  if (v is String) return v;
  if (v is num) return v.isFinite ? jsNumStr(v) : '';
  return jsString(v);
}

/// JS `Number(v)` when it is a real number, else null (blank, NaN, Infinity).
double? entryNum(Object? v) {
  final n = jsNumber(v);
  return (n != null && n.isFinite) ? n : null;
}

/// JS `x || 0`.
double _or0(double? v) => (v == null || v.isNaN || v == 0) ? 0.0 : v;

/// Formats any number-ish value the way the web's fmtNum does ('' when blank).
String entryFmt(Object? v) => fmtNum(v is num ? v.toDouble() : entryNum(v));

/// Everything a machine block derives from its values (rowCalc plus the caps).
class EntryMetrics {
  EntryMetrics(this.values)
      : calc = rowCalc(values),
        splitTotal = cleanSplit(values['rejectBreakdown']).values.fold<double>(0, (s, n) => s + n),
        stoppageLimit = stoppageLimitMin(values),
        lunchNeeded = lunchRequired(values) {
    rejected = _or0(_dbl(calc['rejectedQty']));
    totalStoppage = _dbl(calc['totalStoppageMin']) ?? 0;
  }

  static double? _dbl(Object? v) => (v is num && v.isFinite) ? v.toDouble() : null;

  final Map<String, dynamic> values;
  final Map<String, dynamic> calc;

  /// Sum of the Reject Master boxes (blanks and zeros dropped).
  final double splitTotal;

  /// Minutes of the planned shift the machine did not run (null until known).
  final double? stoppageLimit;
  final bool lunchNeeded;
  late final double rejected;
  late final double totalStoppage;

  double? get idealQty => _dbl(calc['idealQty']);
  bool get splitMismatch => splitTotal != rejected;
  bool get overStoppage => stoppageLimit != null && totalStoppage > stoppageLimit!;

  Object? get _split => values['rejectBreakdown'];
  double _splitBox(String reason) {
    final s = _split;
    return s is Map ? _or0(jsToNumber(s[reason])) : 0;
  }

  bool get rejectOtherUsed => _splitBox('Other') > 0;
  bool get otherDowntimeUsed => jsToNumber(values['otherMin']) > 0;

  /// What a Reject Master box may still take: whatever of Rejected the other
  /// boxes have not used.
  double rejectRoom(String reason) => math.max(0, rejected - (splitTotal - _splitBox(reason)));

  /// The ceiling of a downtime box (Lunch / Rest included) and the toast for
  /// typing past it. Until Planned Operator Shift and the machine times are in
  /// the allowance is unknown, so only the day's 1440 minutes apply.
  ({double max, String message}) minutesLimit(String key) {
    final limit = stoppageLimit;
    final room = limit == null
        ? 1440.0
        : math.min(1440.0, math.max(0.0, limit - (totalStoppage - _or0(jsNumber(values[key])))));
    return (
      max: room,
      message: limit == null
          ? "Downtime can't be more than 1440 minutes (a day)."
          : "Total stoppage can't be more than ${jsNumStr(limit)} min (Planned Operator Shift − Machine Shift) — only ${jsNumStr(room)} min left for this box.",
    );
  }

  /// Whether Actual and OK are both numbers (Rejected is then Actual − OK).
  bool get rejectedKnown => entryNum(values['actualQty']) != null &&
      !isBlankValue(values['actualQty']) &&
      entryNum(values['okQty']) != null &&
      !isBlankValue(values['okQty']);

  /// Why the Reject Master boxes that are shut cannot take digits — shown under
  /// them, so the boxes never just look broken.
  String get rejectLockReason {
    if (!rejectedKnown) return 'Enter Actual and OK Quantity first — the reject boxes open once some pieces are rejected.';
    if (rejected <= 0) return 'Nothing to reject — Actual and OK are equal.';
    return 'All ${jsNumStr(rejected)} rejected piece(s) are already assigned.';
  }

  /// Why the downtime boxes that are shut cannot take digits.
  String get downtimeLockReason {
    final limit = stoppageLimit;
    if (limit == null || limit <= 0) return 'No stoppage time left — the machine ran the whole planned shift.';
    return 'No stoppage time left — all ${jsNumStr(limit)} min allowed are used.';
  }

  /// Ceiling for OK Quantity: the typed Actual when it is a number, else Ideal.
  double? get okMax {
    final actual = entryNum(values['actualQty']);
    if (actual != null && !isBlankValue(values['actualQty'])) return actual;
    return idealQty;
  }
}

/// JS: `v === "" || v === undefined || v === null`.
bool isBlankValue(Object? v) => v == null || v == '';

/// Every key that counts as "something has been typed" — used to tell a
/// collapsed block that holds work from an untouched one.
final List<String> _dataKeys = [
  'operator',
  'itemName',
  'drawingNo',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  'okQty',
  'plannedOperatorShiftHours',
  'remarks',
  ...entryCycleOpKeys,
  'rejectOtherRemark',
  'lunchMin',
  ...downtimeKeys,
  'otherMinRemark',
];

bool entryHasData(Map<String, dynamic> v) {
  if (_dataKeys.any((k) => !isBlankValue(v[k]))) return true;
  final split = v['rejectBreakdown'];
  return split is Map && split.values.any((n) => !isBlankValue(n));
}

/// The Item Master row picked in [values] (by `item` id), or null.
Map<String, dynamic>? entryItemFor(Map<String, dynamic> values, List<Map<String, dynamic>> items) {
  final id = entryText(values['item']);
  if (id.isEmpty) return null;
  for (final it in items) {
    if ('${it['_id']}' == id) return it;
  }
  return null;
}

/// Operation keys unticked on this entry.
Set<String> entryExcludedOps(Map<String, dynamic> values) {
  final raw = values['excludedOps'];
  return raw is Iterable ? {for (final k in raw) '$k'} : <String>{};
}

/// An operation can be ticked only when the picked Part carries it.
bool entryCanTick(Map<String, dynamic>? item, String key) {
  if (item == null) return false;
  final v = item[key];
  return v != null && v != '';
}

/// Number of fields of a block with an error, as the badge reads it.
String incompleteBadgeText(int count) =>
    'Incomplete — $count field${count == 1 ? '' : 's'} need${count == 1 ? 's' : ''} attention';

/// "YYYY-MM-DD" -> local DateTime (no timezone shift), or null.
DateTime? parseIsoDay(Object? v) {
  final m = RegExp(r'^(\d{4})-(\d{1,2})-(\d{1,2})').firstMatch(entryText(v));
  if (m == null) return null;
  final d = DateTime(int.parse(m.group(1)!), int.parse(m.group(2)!), int.parse(m.group(3)!));
  return d;
}

/// "HH:mm" for a time value as the sheet accepts it ("930", "9:30", ...).
String? entryTime(Object? v) => normalizeTime(entryText(v));
