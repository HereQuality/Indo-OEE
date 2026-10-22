import 'dart:math' as math;

import '../entry_form/entry_form_logic.dart' show EntryMetrics;
import '../shared/production_entry_validation.dart' show isBlank, stoppageLimitMin;
import '../shared/production_sheet_calc.dart';
import '../shared/shift_hours.dart';
import 'cnc_twin_calc.dart';

/// Port of client/src/utils/{contact,trobe,spring}Validation.js — the CNC
/// sheet's rules minus Actual Quantity and the reject-reason split (OK and
/// Rejected are both typed), plus Working Status and Setting ON/OFF Time as
/// plain optional fields. The three files are identical but for the Part /
/// cycle wording, which [TwinWording] carries.

/// The downtime boxes (web `…_DOWNTIME_KEYS`): the stoppage fields but Lunch /
/// Rest, which sits with Planned Operator Shift.
const List<String> twinDowntimeKeys = [
  'plannedDownMin',
  'setupMin',
  'noManPowerMin',
  'materialShiftingMin',
  'noMaterialMin',
  'bdMechMin',
  'bdEleMin',
  'noPowerMin',
  'otherMin',
];

/// Top to bottom, the way the form reads (web `…_FIELD_ORDER`).
const List<String> twinFieldOrder = [
  'date',
  'machine',
  'operator',
  'workingStatus',
  'itemName',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'settingOnTime',
  'settingOffTime',
  'okQty',
  'rejectedQty',
  'plannedOperatorShiftHours',
  'lunchMin',
  ...twinDowntimeKeys,
  'stoppageTotal',
  'otherMinRemark',
];

/// What each process calls the part and its cycle time in its messages.
class TwinWording {
  const TwinWording({required this.itemRequired, required this.cycleRequired});
  final String itemRequired;
  final String cycleRequired;

  /// Contact / Trobe.
  static const part = TwinWording(
    itemRequired: 'Part Name is required',
    cycleRequired: 'Total Cycle Time is required',
  );

  /// Spring: "Item Name" and "Standard Time per Piece".
  static const item = TwinWording(
    itemRequired: 'Item Name is required',
    cycleRequired: 'Standard Time per Piece is required',
  );
}

double? _num(Object? v) => (v == null || v == '') ? null : jsToNumber(v);

int? _clock(Object? t) {
  final n = normalizeTime(t);
  return n == null
      ? null
      : int.parse(n.substring(0, 2)) * 60 + int.parse(n.substring(3, 5));
}

// Same only-when-changed rule as the CNC sheet: an older row that already
// breaks a time rule stays editable.
bool _timesUnchanged(Map<String, dynamic> v, Map<String, dynamic>? saved) =>
    saved != null &&
    normalizeTime(v['machineOnTime']) ==
        normalizeTime(saved['machineOnTime']) &&
    normalizeTime(v['machineOffTime']) ==
        normalizeTime(saved['machineOffTime']);

/// One block's values -> {fieldKey: message}. Empty = ready to save.
/// [rowCalcFn] is the process's own calc (Spring counts Rejected in Effective
/// Run Time, which can move the figures the rules read).
Map<String, String> twinValidate(
  Map<String, dynamic> v, {
  Map<String, dynamic>? saved,
  required Map<String, dynamic> Function(Map<String, dynamic>) rowCalcFn,
  TwinWording wording = TwinWording.part,
}) {
  final errors = <String, String>{};
  final c = rowCalcFn(v);

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = 'Machine No. is required';
  // ABSENT, SUNDAY, M/C OFF, … — a day with no production records just its status.
  if (twinIsStatusOnly(v) || twinIsNonWorking(v)) return errors;

  if (isBlank(v['operator'])) errors['operator'] = 'Operator is required';
  if (isBlank(v['itemName'])) errors['itemName'] = wording.itemRequired;
  final cycle = _num(v['totalCycleSec']);
  if (isBlank(v['totalCycleSec'])) {
    errors['totalCycleSec'] = wording.cycleRequired;
  } else if (!isNum(cycle) || cycle! <= 0) {
    errors['totalCycleSec'] = 'Must be more than 0';
  }

  for (final (key, label) in const [
    ('machineOnTime', 'Machine ON Time'),
    ('machineOffTime', 'Machine OFF Time'),
  ]) {
    if (isBlank(v[key])) {
      errors[key] = '$label is required';
    } else if (normalizeTime(v[key]) == null) {
      errors[key] = 'Enter a valid time';
    }
  }
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

  // Setting ON/OFF Time are optional, informational only — just needs to be a
  // real time when something is typed.
  for (final (key, label) in const [
    ('settingOnTime', 'Setting ON Time'),
    ('settingOffTime', 'Setting OFF Time'),
  ]) {
    if (!isBlank(v[key]) && normalizeTime(v[key]) == null) {
      errors[key] = 'Enter a valid ${label.toLowerCase()}';
    }
  }

  // OK and Rejected are both typed; together they can't beat what the shift could make.
  final ok = _num(v['okQty']);
  final rej = _num(v['rejectedQty']);
  if (isBlank(v['okQty'])) {
    errors['okQty'] = 'Actual OK Quantity is required';
  } else if (!isNum(ok) || ok! < 0) {
    errors['okQty'] = 'Must be 0 or more';
  }
  if (isBlank(v['rejectedQty'])) {
    errors['rejectedQty'] = 'Rejected Quantity is required';
  } else if (!isNum(rej) || rej! < 0) {
    errors['rejectedQty'] = 'Must be 0 or more';
  }
  final ideal = c['idealQty'];
  if (!errors.containsKey('okQty') &&
      !errors.containsKey('rejectedQty') &&
      isNum(ideal) &&
      ok! + rej! > (ideal as num)) {
    errors['okQty'] =
        "OK + Rejected (${jsNumStr(ok + rej)}) can't be more than Ideal Quantity (${jsNumStr(ideal)})";
  }

  // Planned Operator Shift is typed as H.MM (60 minutes to the hour).
  final plannedParse = parseHm(v['plannedOperatorShiftHours']);
  final planned = plannedParse.hours;
  if (isBlank(v['plannedOperatorShiftHours'])) {
    errors['plannedOperatorShiftHours'] = 'Planned Operator Shift is required';
  } else if (plannedParse.minutesTooBig) {
    errors['plannedOperatorShiftHours'] =
        'Minutes must be 00–59 (3.30 means 3 h 30 min)';
  } else if (planned == null) {
    errors['plannedOperatorShiftHours'] = 'Enter hours and minutes like 8.30';
  } else if (planned <= 0 || planned > 24) {
    errors['plannedOperatorShiftHours'] =
        'Must be more than 0:00 and at most 24:00';
  } else {
    final shiftMin = spanMinutes(v['machineOnTime'], v['machineOffTime']);
    if (shiftMin != null && jsRound(planned * 60) < shiftMin) {
      errors['plannedOperatorShiftHours'] =
          "Planned Operator Shift can't be less than the Machine Shift (${hoursToHm(shiftMin / 60)})";
    }
  }

  // Lunch / Rest is optional, like every other stoppage box: blank counts as 0.
  final lunch = _num(v['lunchMin']);
  if (!isBlank(v['lunchMin']) &&
      (lunch == null || !lunch.isFinite || lunch < 0 || lunch > 1440)) {
    errors['lunchMin'] = '0–1440';
  }

  for (final key in twinDowntimeKeys) {
    final n = _num(v[key]);
    if (n != null && (!n.isFinite || n < 0 || n > 1440)) errors[key] = '0–1440';
  }
  final limit = twinStoppageLimit(v);
  final stoppage = c['totalStoppageMin'];
  if (limit != null && stoppage is num && stoppage > limit) {
    errors['stoppageTotal'] =
        'Total stoppage is ${jsNumStr(stoppage)} min but the Machine Shift is only ${jsNumStr(limit)} min';
  }
  final other = _num(v['otherMin']);
  if (other != null && other > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] =
        'Remark is required when Others downtime is entered';
  }
  return errors;
}

/// The most stoppage (Lunch / Rest included) an entry can account for: the
/// Machine Shift itself, since stoppage happens inside the machine's own ON-OFF
/// span (web `stoppageLimitMin`). null until both times are usable.
double? twinStoppageLimit(Map<String, dynamic> v) => stoppageLimitMin(v);

/// [EntryMetrics] with the current web stoppage allowance (the Machine Shift;
/// the phone's CNC metrics still use Planned Shift - Machine Shift).
class TwinMetrics extends EntryMetrics {
  TwinMetrics(super.values, {super.calcFn});

  @override
  double? get stoppageLimit => twinStoppageLimit(values);

  @override
  ({double max, String message}) minutesLimit(String key) {
    final limit = stoppageLimit;
    final own = jsNumber(values[key]);
    final ownMin = (own == null || own.isNaN) ? 0.0 : own;
    final room = limit == null
        ? 1440.0
        : math.min(1440.0, math.max(0.0, limit - (totalStoppage - ownMin)));
    return (
      max: room,
      message: limit == null
          ? "Downtime can't be more than 1440 minutes (a day)."
          : "Stoppage happens within the Machine Shift, so all of it together can't be more than ${jsNumStr(limit)} min — only ${jsNumStr(room)} min left for this box.",
    );
  }
}
