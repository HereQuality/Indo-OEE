// Port of client/src/utils/entryValidation.js — every rule the Production Data
// Entry form enforces, in one place, so the Save button, the per-field messages
// and the "scroll to the first thing still missing" behaviour read from the
// same answer. The server re-checks the required fields, the remarks and the
// stoppage cap (entryRuleError in productionSheet.controller.js); keep the two
// in step.
//
//   Required   Date, Machine No., Operator, Part Name, Machine ON/OFF Time,
//              Actual Qty, OK Qty, Planned Operator Shift (typed decimal hours, never less
//              than the Machine Shift). Lunch / Rest is optional.
//   Quantities Actual ≤ Ideal, OK ≤ Actual, and the Rejection Master split has to
//              account for every rejected piece (Rejected = Actual − OK).
//   Times      Machine OFF Time must be after Machine ON Time, and one machine's
//              entries on a date can't overlap in time (see [overlapErrors]).
//   Downtime   Optional, but whatever is typed must be 0–1440, and the total
//              (Lunch / Rest included) can't exceed the Machine Shift itself, in
//              minutes — stoppage happens inside the machine's own ON–OFF span.
//   "Other"    Rejecting pieces as "Other", or logging Other downtime, needs its
//              own remark.

import 'production_sheet_calc.dart';
import 'quantity_rules.dart' show validateQuantities;
import 'shift_hours.dart';

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

/// The most stoppage (Lunch / Rest included) an entry can account for — the
/// Machine Shift itself, since stoppage happens inside the machine's own ON–OFF
/// span, not in some separate block of time beyond it. null until Machine
/// ON/OFF are both usable.
double? stoppageLimitMin(Map<String, dynamic> v) => spanMinutes(v['machineOnTime'], v['machineOffTime']);

/// The form keeps Planned Operator Shift as typed decimal hours text ("3.5" = 3 h
/// 30 min); the rules work in decimal hours. [v] with that one value converted
/// ('' when it is not a usable time).
Map<String, dynamic> withDecimalPlanned(Map<String, dynamic> v) {
  final planned = parseShiftHours(v['plannedOperatorShiftHours']).hours;
  return {...v, 'plannedOperatorShiftHours': planned ?? ''};
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

// ── Machine ON/OFF times ─────────────────────────────────────────────────────
// Two rules, both also enforced by the server (saveRow): OFF comes after ON (a
// shift through midnight is two entries, one per date), and one machine's
// entries on a date never overlap in time. Keep in step with
// server/utils/machineTimes.js and the web's entryValidation.js.

int? _clock(Object? t) {
  final n = normalizeTime(t);
  return n == null
      ? null
      : int.parse(n.substring(0, 2)) * 60 + int.parse(n.substring(3, 5));
}

/// 0..1439 (or a next-day stretch beyond it) → "08:05" — 24-hour, so there is
/// no AM/PM to mix up (web `fmt12`, still named for its callers).
String fmt12Minutes(int minutes) {
  final m = ((minutes % 1440) + 1440) % 1440;
  return '${(m ~/ 60).toString().padLeft(2, '0')}:${(m % 60).toString().padLeft(2, '0')}';
}

/// The two time rules speak up as soon as the times are picked, not only after
/// Save is pressed like the other messages ("is required" and the like).
/// (The Planned Operator Shift being shorter than the Machine Shift, and an
/// operator already being on another machine then, speak up the same way.)
/// "End before Start" is matched in every sheet's own words ("Machine OFF Time
/// must be after Machine ON Time", "Working End Time must be after Working Start
/// Time", …) — web `isEndBeforeStartMessage`.
bool isTimeRuleMessage(String? message) =>
    message != null &&
    (message.contains(' Time must be after ') ||
        message.contains('overlaps another entry') ||
        message.contains('is already on machine') ||
        message.startsWith("Planned Operator Shift can't be less than"));

final RegExp _slotsFullRe = RegExp(r' already has \d+ entries on ');

/// What a box shows before Save is pressed (web `isLiveMessage`): the time
/// rules above, a typed time that isn't one, and a machine (operator) whose
/// date is already full ([slotsFullErrors]).
bool isLiveMessage(String? message) =>
    isTimeRuleMessage(message) ||
    (message != null && (message == 'Enter a valid time' || _slotsFullRe.hasMatch(message)));

/// Web `slotsFullErrors`: the server's "already has N entries" refusal, said on
/// the box as soon as the machine (operator) and date are picked instead of only
/// after Save. A block counts the machine's saved entries on its date and the
/// blocks above it in the same form. An edited row is moved by its Date (its
/// machine stays locked): the message goes on `date`; a new one on `machine`.
/// [who] names the row key ("This machine" when unknown).
List<Map<String, String>> slotsFullErrors(
  List<Map<String, dynamic>> entries,
  OccupiedTimes occupied, {
  int? editSlot,
  Map<String, dynamic>? saved,
  String Function(String id)? who,
  int max = 3,
}) {
  String dayText(Object? iso) {
    final p = jsString(iso).split('-');
    String at(int i) => i < p.length ? p[i] : 'undefined';
    return '${at(2)}/${at(1)}/${at(0)}';
  }

  return [
    for (var i = 0; i < entries.length; i++)
      () {
        final v = entries[i];
        if (isBlank(v['machine']) || isBlank(v['date'])) return const <String, String>{};
        if (saved != null && v['date'] == saved['date'] && v['machine'] == saved['machine']) return const <String, String>{};
        final mine = occupied['${v['machine']}|${v['date']}'] ?? const <Map<String, dynamic>>[];
        var taken = mine.where((o) => !_isEditedRow(o, v, editSlot, saved)).length;
        for (var j = 0; j < i; j++) {
          if (entries[j]['machine'] == v['machine'] && entries[j]['date'] == v['date']) taken++;
        }
        if (taken < max) return const <String, String>{};
        final name = who == null ? 'This machine' : who('${v['machine']}');
        final full = '$name already has $max entries on ${dayText(v['date'])}';
        return saved != null
            ? {'date': "$full — can't move this entry there"}
            : {'machine': '$full — edit one of them instead'};
      }(),
  ];
}

/// The stretch of the day an entry occupies, in minutes.
class TimeSpan {
  const TimeSpan(this.start, this.end);
  final int start;
  final int end;

  bool overlaps(TimeSpan o) => start < o.end && o.start < end;
  bool containsStart(TimeSpan o) => o.start >= start && o.start < end;

  /// "08:00 – 12:00"
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
/// `{date, machine, machineOnTime, machineOffTime}` as loaded (edit mode), else null.
/// Moving the row to another date or machine is a change too.
bool _timesUnchanged(Map<String, dynamic> v, Map<String, dynamic>? saved) =>
    saved != null &&
    '${v['date'] ?? ''}' == '${saved['date'] ?? ''}' &&
    '${v['machine'] ?? ''}' == '${saved['machine'] ?? ''}' &&
    normalizeTime(v['machineOnTime']) ==
        normalizeTime(saved['machineOnTime']) &&
    normalizeTime(v['machineOffTime']) ==
        normalizeTime(saved['machineOffTime']);

/// What the machine has saved on a date: `'machine|date'` → the server's
/// `{slot, machineOnTime, machineOffTime}` entries.
typedef OccupiedTimes = Map<String, List<Map<String, dynamic>>>;

/// Web `isEditedRow`: the row being edited is not "another" entry — but only on
/// the date and machine it was saved on. Moved elsewhere, whatever holds its
/// slot number there is a different entry. (Without [saved], the slot alone decides.)
bool _isEditedRow(
  Map<String, dynamic> o,
  Map<String, dynamic> v,
  int? editSlot,
  Map<String, dynamic>? saved,
) =>
    editSlot != null &&
    (o['slot'] as num?)?.toInt() == editSlot &&
    (saved == null || (v['date'] == saved['date'] && v['machine'] == saved['machine']));

List<Map<String, dynamic>> _savedFor(
  Map<String, dynamic> v,
  OccupiedTimes occupied,
  int? editSlot,
  Map<String, dynamic>? saved,
) => [
  for (final o
      in occupied['${v['machine']}|${v['date']}'] ??
          const <Map<String, dynamic>>[])
    if (!_isEditedRow(o, v, editSlot, saved)) o,
];

/// What the machine already has on this entry's date, as readable ranges, for
/// the "already booked" hint. [editSlot] / [saved] are the row being edited
/// (not "another").
List<String> bookedRanges(
  Map<String, dynamic> v,
  OccupiedTimes occupied, {
  int? editSlot,
  Map<String, dynamic>? saved,
}) => [
  for (final o in _savedFor(v, occupied, editSlot, saved))
    ?timeInterval(o['machineOnTime'], o['machineOffTime'])?.text,
];

/// How the overlap message names a sheet's two time boxes and its row key
/// (web `MACHINE_TIME_WORDS`; a worker sheet passes its own, e.g.
/// `RUBBER_TIME_WORDS`).
class TimeWords {
  const TimeWords({required this.start, required this.end, required this.owner});
  final String start;
  final String end;
  final String owner;
}

const TimeWords machineTimeWords = TimeWords(start: 'Machine ON Time', end: 'Machine OFF Time', owner: 'this machine');

/// Overlap problems for every block: `{machineOnTime | machineOffTime: message}`.
/// Each block is checked against the machine's saved entries on its date AND
/// against the other blocks of the same form (same machine, same date).
List<Map<String, String>> overlapErrors(
  List<Map<String, dynamic>> entries,
  OccupiedTimes occupied, {
  int? editSlot,
  Map<String, dynamic>? saved,
  TimeWords words = machineTimeWords,
}) {
  Map<String, String> forBlock(int i) {
    final v = entries[i];
    final mine = timeInterval(v['machineOnTime'], v['machineOffTime']);
    if (mine == null ||
        isBlank(v['machine']) ||
        isBlank(v['date']) ||
        _timesUnchanged(v, saved))
      return const {};

    final others = <TimeSpan>[];
    for (final o in _savedFor(v, occupied, editSlot, saved)) {
      final span = timeInterval(o['machineOnTime'], o['machineOffTime']);
      if (span != null) others.add(span);
    }
    for (var j = 0; j < entries.length; j++) {
      final e = entries[j];
      if (j == i ||
          '${e['machine']}' != '${v['machine']}' ||
          '${e['date']}' != '${v['date']}')
        continue;
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
          '${startInside ? words.start : words.end} overlaps another entry for ${words.owner} on this date (${hit.text})',
    };
  }

  return [for (var i = 0; i < entries.length; i++) forBlock(i)];
}

/// What each OPERATOR has saved on a date, on any machine: `'operator|date'` →
/// the server's `{machine, machineName, slot, machineOnTime, machineOffTime}`.
typedef OperatorOccupied = Map<String, List<Map<String, dynamic>>>;

/// One operator runs one machine at a time: on a date, their entries on
/// DIFFERENT machines can't overlap in time. Checked against the operator's saved
/// entries and the other blocks of the same form. [editing] is the saved row being
/// edited (`machine` + `slot`), not "another" entry; [saved] is that row's
/// `{machineOnTime, machineOffTime, operator}` as loaded — with times and operator
/// untouched an older row that already breaks this stays editable. Same-machine
/// clashes are [overlapErrors]' job. Keep in step with the server's saveRow.
List<Map<String, String>> operatorOverlapErrors(
  List<Map<String, dynamic>> entries,
  OperatorOccupied occupied, {
  ({String machine, int slot})? editing,
  Map<String, dynamic>? saved,
  String Function(String machineId)? machineName,
}) {
  Map<String, String> forBlock(int i) {
    final v = entries[i];
    final op = '${v['operator'] ?? ''}'.trim();
    final mine = timeInterval(v['machineOnTime'], v['machineOffTime']);
    if (op.isEmpty ||
        mine == null ||
        isBlank(v['machine']) ||
        isBlank(v['date']))
      return const {};
    if (_timesUnchanged(v, saved) && '${saved?['operator'] ?? ''}'.trim() == op)
      return const {};

    final others = <({String name, TimeSpan span})>[];
    for (final o
        in occupied['$op|${v['date']}'] ?? const <Map<String, dynamic>>[]) {
      if ('${o['machine']}' == '${v['machine']}') continue;
      // The edited row itself only counts as itself on the date it was saved on.
      if (editing != null &&
          '${o['machine']}' == editing.machine &&
          (o['slot'] as num?)?.toInt() == editing.slot &&
          (saved == null || v['date'] == saved['date']))
        continue;
      final span = timeInterval(o['machineOnTime'], o['machineOffTime']);
      if (span != null)
        others.add((name: '${o['machineName'] ?? ''}', span: span));
    }
    for (var j = 0; j < entries.length; j++) {
      final e = entries[j];
      if (j == i ||
          '${e['operator'] ?? ''}'.trim() != op ||
          '${e['date']}' != '${v['date']}' ||
          '${e['machine']}' == '${v['machine']}') {
        continue;
      }
      final span = timeInterval(e['machineOnTime'], e['machineOffTime']);
      if (span != null)
        others.add((
          name: machineName?.call('${e['machine']}') ?? '',
          span: span,
        ));
    }

    final hit = others.where((o) => mine.overlaps(o.span)).firstOrNull;
    if (hit == null) return const {};
    final startInside = hit.span.containsStart(mine);
    return {
      startInside ? 'machineOnTime' : 'machineOffTime':
          "Operator $op is already on machine ${hit.name.isEmpty ? 'another machine' : hit.name} from ${hit.span.text} on this date — an operator can't run two machines at the same time",
    };
  }

  return [for (var i = 0; i < entries.length; i++) forBlock(i)];
}

/// One block's values → {fieldKey: message}. Empty map = ready to save.
/// Keys are inserted in the same order as the web version. [saved] (edit mode)
/// is the row's times as loaded — see [_timesUnchanged].
Map<String, String> validateEntry(
  Map<String, dynamic> v, {
  Map<String, dynamic>? saved,
}) {
  final errors = <String, String>{};
  final calc = rowCalc(v);

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = 'Machine No. is required';
  // Non Working: the machine did not run, so nothing else is asked for.
  if (isNonWorking(v)) return errors;
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
  if (!errors.containsKey('machineOnTime') &&
      !errors.containsKey('machineOffTime') &&
      !_timesUnchanged(v, saved)) {
    final on = _clock(v['machineOnTime']);
    final off = _clock(v['machineOffTime']);
    if (on != null && off != null && off <= on) {
      errors['machineOffTime'] =
          'Machine OFF Time must be after Machine ON Time';
    }
  }

  // Actual can't beat what the shift could make; OK can't beat Actual; the
  // Rejection Master split has to account for Rejected = Actual − OK
  // (shared/quantity_rules.dart, which the other machine sheets use too).
  validateQuantities(v, calc, errors);

  // Planned Operator Shift is typed as decimal hours (60 minutes to the hour).
  final plannedParse = parseShiftHours(v['plannedOperatorShiftHours']);
  final planned = plannedParse.hours;
  if (isBlank(v['plannedOperatorShiftHours'])) {
    errors['plannedOperatorShiftHours'] = 'Planned Operator Shift is required';
  } else if (planned == null) {
    errors['plannedOperatorShiftHours'] = 'Enter hours as on the sheet, like 8.5 or 5.33';
  } else if (planned <= 0 || planned > 24) {
    errors['plannedOperatorShiftHours'] =
        'Must be more than 0:00 and at most 24:00';
  } else {
    // The operator's planned shift has to cover the time the machine ran.
    // — once that time makes sense: with OFF not after ON the OFF box already says what is wrong.
    final shiftMin = errors.containsKey('machineOffTime') ? null : spanMinutes(v['machineOnTime'], v['machineOffTime']);
    if (shiftMin != null && jsRound(planned * 60) < shiftMin) {
      errors['plannedOperatorShiftHours'] =
          "Planned Operator Shift can't be less than the Machine Shift (${hoursToHm(shiftMin / 60)})";
    }
  }
  v = withDecimalPlanned(v);

  // Lunch / Rest is optional, like every other stoppage box: blank counts as 0.
  final lunch = jsNumber(v['lunchMin']);
  if (!isBlank(v['lunchMin']) &&
      (lunch == null || !lunch.isFinite || lunch < 0 || lunch > 1440)) {
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
        'Total stoppage is ${jsNumStr(totalStoppage)} min but the Machine Shift is only ${jsNumStr(limit)} min';
  }
  if ((jsNumber(v['otherMin']) ?? 0) > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] =
        'Remark is required when Other downtime is entered';
  }

  return errors;
}

/// The first field with an error, in form order — `{'index': int, 'field':
/// String}` — or null when every block is valid. [order] is the process's
/// form order (CNC's [fieldOrder] by default).
Map<String, dynamic>? firstError(List<Map<String, String>?> errorsList, {List<String> order = fieldOrder}) {
  for (var index = 0; index < errorsList.length; index++) {
    final errors = errorsList[index] ?? const <String, String>{};
    String? field;
    for (final k in order) {
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
