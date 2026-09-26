// Port of client/src/utils/entryValidation.js — every rule the Production Data
// Entry form enforces, in one place, so the Save button, the per-field messages
// and the "scroll to the first thing still missing" behaviour read from the
// same answer. The server re-checks the required fields, the remarks and the
// stoppage cap (entryRuleError in productionSheet.controller.js); keep the two
// in step.
//
//   Required   Date, Machine No., Operator, Part Name, Machine ON/OFF Time,
//              Actual Qty, OK Qty, Planned Operator Shift — and Lunch / Rest, but
//              only when Planned Operator Shift − Machine Shift leaves time over.
//   Quantities Actual ≤ Ideal, OK ≤ Actual, and the Rejection Master split has to
//              account for every rejected piece (Rejected = Actual − OK).
//   Times      Machine OFF Time must be after Machine ON Time, and one machine's
//              entries on a date can't overlap in time (see [overlapErrors]).
//   Downtime   Optional, but whatever is typed must be 0–1440, and the total
//              (Lunch / Rest included) can't exceed Planned Operator Shift −
//              Machine Shift, in minutes.
//   "Other"    Rejecting pieces as "Other", or logging Other downtime, needs its
//              own remark.

import 'production_sheet_calc.dart';

/// The downtime boxes on the form. Lunch / Rest sits with Planned Operator
/// Shift instead, but still counts toward the total (see rowCalc).
const List<String> downtimeKeys = [
  'setupMin',
  'noManPowerMin',
  'materialShiftingMin',
  'noMaterialMin',
  'bdMechMin',
  'bdEleMin',
  'noPowerMin',
  'otherMin',
];

const List<String> _cycleOpKeys = [
  'drillingSec',
  'boringSec',
  'threadingSec',
  'tappingSec',
  'chamferingSec',
  'otherOp1Sec',
  'otherOp2Sec',
  'clampDeclampSec',
];

/// Top to bottom, the way the form reads — the first key with an error is
/// where Save scrolls to.
const List<String> fieldOrder = [
  'date',
  'machine',
  'operator',
  'itemName',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  'okQty',
  'rejectBreakdown',
  'rejectOtherRemark',
  'plannedOperatorShiftHours',
  'lunchMin',
  ...downtimeKeys,
  'stoppageTotal',
  'otherMinRemark',
  ..._cycleOpKeys,
];

/// JS `blank`: null, "" or whitespace-only text (numbers are never blank).
bool isBlank(Object? v) => v == null || jsTrim(jsString(v)).isEmpty;

/// Minutes of the operator's planned shift the machine wasn't running — the
/// most stoppage the entry can account for. null until both numbers exist.
double? stoppageLimitMin(Map<String, dynamic> v) {
  final planned = jsNumber(v['plannedOperatorShiftHours']);
  final shiftMin = spanMinutes(v['machineOnTime'], v['machineOffTime']);
  if (!isNum(planned) || shiftMin == null) return null;
  final rounded = jsRound(planned! * 60 - shiftMin);
  return rounded > 0 ? rounded : 0.0;
}

/// Lunch / Rest has to be entered only when the planned shift leaves minutes
/// over the machine's run (stoppageLimitMin > 0).
bool lunchRequired(Map<String, dynamic> v) {
  final limit = stoppageLimitMin(v);
  return limit != null && limit > 0;
}

/// The Rejection Master boxes as clean numbers: blanks dropped, the rest > 0.
Map<String, double> cleanSplit(Object? split) {
  final out = <String, double>{};
  if (split is Map) {
    split.forEach((reason, v) {
      final n = isBlank(v) ? 0.0 : jsToNumber(v);
      if (n.isFinite && n > 0) out['$reason'] = n;
    });
  }
  return out;
}

bool _finiteAtLeast0(double? n) => n != null && n.isFinite && n >= 0;

// ── Machine ON/OFF times ─────────────────────────────────────────────────────
// Two rules, both also enforced by the server (saveRow): OFF comes after ON (a
// shift through midnight is two entries, one per date), and one machine's
// entries on a date never overlap in time. Keep in step with
// server/utils/machineTimes.js and the web's entryValidation.js.

int? _clock(Object? t) {
  final n = normalizeTime(t);
  return n == null ? null : int.parse(n.substring(0, 2)) * 60 + int.parse(n.substring(3, 5));
}

/// 0..1439 (or a next-day stretch beyond it) → "8:05 AM".
String fmt12Minutes(int minutes) {
  final m = ((minutes % 1440) + 1440) % 1440;
  final h = m ~/ 60;
  final h12 = h % 12 == 0 ? 12 : h % 12;
  return '$h12:${(m % 60).toString().padLeft(2, '0')} ${h >= 12 ? 'PM' : 'AM'}';
}

/// The two time rules speak up as soon as the times are picked, not only after
/// Save is pressed like the other messages ("is required" and the like).
bool isTimeRuleMessage(String? message) =>
    message != null &&
    (message.startsWith('Machine OFF Time must be after') || message.contains('overlaps another entry'));

/// The stretch of the day an entry occupies, in minutes.
class TimeSpan {
  const TimeSpan(this.start, this.end);
  final int start;
  final int end;

  bool overlaps(TimeSpan o) => start < o.end && o.start < end;
  bool containsStart(TimeSpan o) => o.start >= start && o.start < end;

  /// "8:00 AM – 12:00 PM"
  String get text => '${fmt12Minutes(start)} – ${fmt12Minutes(end)}';
}

/// [on, off) as a [TimeSpan], or null when a time is missing. Rows saved before
/// "OFF after ON" may run through midnight (OFF <= ON); they are stretched into
/// the next day so they still block the late hours they really covered.
TimeSpan? timeInterval(Object? on, Object? off) {
  final start = _clock(on);
  final end = _clock(off);
  if (start == null || end == null) return null;
  return TimeSpan(start, end > start ? end : end + 1440);
}

/// The time rules only apply when a row's times are set or changed — an older
/// row that already breaks them stays editable. [saved] is the row's
/// `{machineOnTime, machineOffTime}` as loaded (edit mode), else null.
bool _timesUnchanged(Map<String, dynamic> v, Map<String, dynamic>? saved) =>
    saved != null &&
    normalizeTime(v['machineOnTime']) == normalizeTime(saved['machineOnTime']) &&
    normalizeTime(v['machineOffTime']) == normalizeTime(saved['machineOffTime']);

/// What the machine has saved on a date: `'machine|date'` → the server's
/// `{slot, machineOnTime, machineOffTime}` entries.
typedef OccupiedTimes = Map<String, List<Map<String, dynamic>>>;

List<Map<String, dynamic>> _savedFor(Map<String, dynamic> v, OccupiedTimes occupied, int? editSlot) => [
      for (final o in occupied['${v['machine']}|${v['date']}'] ?? const <Map<String, dynamic>>[])
        if ((o['slot'] as num?)?.toInt() != editSlot) o,
    ];

/// What the machine already has on this entry's date, as readable ranges, for
/// the "already booked" hint. [editSlot] is the row being edited (not "another").
List<String> bookedRanges(Map<String, dynamic> v, OccupiedTimes occupied, {int? editSlot}) => [
      for (final o in _savedFor(v, occupied, editSlot)) ?timeInterval(o['machineOnTime'], o['machineOffTime'])?.text,
    ];

/// Overlap problems for every block: `{machineOnTime | machineOffTime: message}`.
/// Each block is checked against the machine's saved entries on its date AND
/// against the other blocks of the same form (same machine, same date).
List<Map<String, String>> overlapErrors(
  List<Map<String, dynamic>> entries,
  OccupiedTimes occupied, {
  int? editSlot,
  Map<String, dynamic>? saved,
}) {
  Map<String, String> forBlock(int i) {
    final v = entries[i];
    final mine = timeInterval(v['machineOnTime'], v['machineOffTime']);
    if (mine == null || isBlank(v['machine']) || isBlank(v['date']) || _timesUnchanged(v, saved)) return const {};

    final others = <TimeSpan>[];
    for (final o in _savedFor(v, occupied, editSlot)) {
      final span = timeInterval(o['machineOnTime'], o['machineOffTime']);
      if (span != null) others.add(span);
    }
    for (var j = 0; j < entries.length; j++) {
      final e = entries[j];
      if (j == i || '${e['machine']}' != '${v['machine']}' || '${e['date']}' != '${v['date']}') continue;
      final span = timeInterval(e['machineOnTime'], e['machineOffTime']);
      if (span != null) others.add(span);
    }

    final hit = others.where(mine.overlaps).firstOrNull;
    if (hit == null) return const {};
    // Point at the box to change: the start if it lands inside the other entry,
    // otherwise the end that runs into it.
    final startInside = hit.containsStart(mine);
    return {
      startInside ? 'machineOnTime' : 'machineOffTime':
          '${startInside ? 'Machine ON Time' : 'Machine OFF Time'} overlaps another entry for this machine on this date (${hit.text})',
    };
  }

  return [for (var i = 0; i < entries.length; i++) forBlock(i)];
}

/// One block's values → {fieldKey: message}. Empty map = ready to save.
/// Keys are inserted in the same order as the web version. [saved] (edit mode)
/// is the row's times as loaded — see [_timesUnchanged].
Map<String, String> validateEntry(Map<String, dynamic> v, {Map<String, dynamic>? saved}) {
  final errors = <String, String>{};
  final calc = rowCalc(v);

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = 'Machine No. is required';
  if (isBlank(v['operator'])) errors['operator'] = 'Operator is required';
  if (isBlank(v['itemName'])) errors['itemName'] = 'Part Name is required';

  for (final e in const [
    ['machineOnTime', 'Machine ON Time'],
    ['machineOffTime', 'Machine OFF Time'],
  ]) {
    final key = e[0];
    if (isBlank(v[key])) {
      errors[key] = '${e[1]} is required';
    } else if (normalizeTime(v[key]) == null) {
      errors[key] = 'Enter a valid time';
    }
  }
  // The machine runs within one day: OFF must come after ON.
  if (!errors.containsKey('machineOnTime') && !errors.containsKey('machineOffTime') && !_timesUnchanged(v, saved)) {
    final on = _clock(v['machineOnTime']);
    final off = _clock(v['machineOffTime']);
    if (on != null && off != null && off <= on) {
      errors['machineOffTime'] = 'Machine OFF Time must be after Machine ON Time';
    }
  }

  // Actual can't beat what the shift could make; OK can't beat Actual.
  final actual = jsNumber(v['actualQty']);
  final idealQty = calc['idealQty'] as double?;
  if (isBlank(v['actualQty'])) {
    errors['actualQty'] = 'Actual Quantity is required';
  } else if (!_finiteAtLeast0(actual)) {
    errors['actualQty'] = 'Must be 0 or more';
  } else if (isNum(idealQty) && actual! > idealQty!) {
    errors['actualQty'] = "Actual can't be more than Ideal Quantity (${jsNumStr(idealQty)})";
  }

  final ok = jsNumber(v['okQty']);
  if (isBlank(v['okQty'])) {
    errors['okQty'] = 'OK Quantity is required';
  } else if (!_finiteAtLeast0(ok)) {
    errors['okQty'] = 'Must be 0 or more';
  } else if (isNum(actual) && ok! > actual!) {
    errors['okQty'] = "OK can't be more than Actual Quantity (${jsNumStr(actual)})";
  }

  // Rejected = Actual − OK, and every rejected piece needs a reason. Can only
  // be checked once Actual and OK are both usable.
  final rejectedKnown = isNum(actual) && isNum(ok) && ok! <= actual!;
  final rejected = rejectedKnown ? actual - ok : 0.0;
  final split = cleanSplit(v['rejectBreakdown']);
  final splitTotal = split.values.fold<double>(0, (s, n) => s + n);
  final rawBreakdown = v['rejectBreakdown'];
  final hasBadBox = rawBreakdown is Map &&
      rawBreakdown.values.any((n) {
        if (isBlank(n)) return false;
        final x = jsToNumber(n);
        return !x.isFinite || x < 0;
      });
  if (hasBadBox) {
    errors['rejectBreakdown'] = 'Rejected quantities must be 0 or more';
  } else if (rejectedKnown && splitTotal < rejected) {
    errors['rejectBreakdown'] =
        '${jsNumStr(rejected - splitTotal)} of ${jsNumStr(rejected)} rejected piece(s) still have no reason — the boxes must add up to the rejected quantity';
  } else if (rejectedKnown && splitTotal > rejected) {
    errors['rejectBreakdown'] = rejected > 0
        ? 'Split is ${jsNumStr(splitTotal - rejected)} more than the ${jsNumStr(rejected)} rejected — the boxes must add up to the rejected quantity'
        : 'Nothing was rejected (Actual − OK is 0), so these boxes should be empty';
  }
  if ((split['Other'] ?? 0) > 0 && isBlank(v['rejectOtherRemark'])) {
    errors['rejectOtherRemark'] = 'Remark is required when "Other" is a reject reason';
  }

  final planned = jsNumber(v['plannedOperatorShiftHours']);
  if (isBlank(v['plannedOperatorShiftHours'])) {
    errors['plannedOperatorShiftHours'] = 'Planned Operator Shift is required';
  } else if (planned == null || !planned.isFinite || planned <= 0 || planned > 24) {
    errors['plannedOperatorShiftHours'] = 'Must be more than 0 and at most 24 hours';
  }

  final lunch = jsNumber(v['lunchMin']);
  if (isBlank(v['lunchMin'])) {
    if (lunchRequired(v)) errors['lunchMin'] = 'Lunch / Rest is required (enter 0 if none)';
  } else if (lunch == null || !lunch.isFinite || lunch < 0 || lunch > 1440) {
    errors['lunchMin'] = '0–1440';
  }

  for (final key in downtimeKeys) {
    final n = jsNumber(v[key]);
    if (n != null && (!n.isFinite || n < 0 || n > 1440)) errors[key] = '0–1440';
  }
  for (final key in _cycleOpKeys) {
    final n = jsNumber(v[key]);
    if (n != null && (!n.isFinite || n < 0)) errors[key] = 'Must be 0 or more';
  }

  final limit = stoppageLimitMin(v);
  final totalStoppage = calc['totalStoppageMin'] as double;
  if (limit != null && totalStoppage > limit) {
    errors['stoppageTotal'] =
        'Total stoppage is ${jsNumStr(totalStoppage)} min but only ${jsNumStr(limit)} min is allowed (Planned Operator Shift − Machine Shift)';
  }
  if ((jsNumber(v['otherMin']) ?? 0) > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] = 'Remark is required when Other downtime is entered';
  }

  return errors;
}

/// The first field with an error, in form order — `{'index': int, 'field':
/// String}` — or null when every block is valid.
Map<String, dynamic>? firstError(List<Map<String, String>?> errorsList) {
  for (var index = 0; index < errorsList.length; index++) {
    final errors = errorsList[index] ?? const <String, String>{};
    String? field;
    for (final k in fieldOrder) {
      if ((errors[k] ?? '').isNotEmpty) {
        field = k;
        break;
      }
    }
    field ??= errors.keys.isEmpty ? null : errors.keys.first;
    if (field != null) return {'index': index, 'field': field};
  }
  return null;
}
