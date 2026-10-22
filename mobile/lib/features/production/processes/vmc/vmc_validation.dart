// Port of client/src/utils/vmcValidation.js — every rule the VMC Data Entry form
// enforces. The machine / operator overlap checks are CNC's own (shared); the
// stoppage allowance is the Machine Shift itself (the web's stoppageLimitMin).
//
//   Required    Date, Machine No., Operator, Part Name (the Part needs its own
//               Program Time / No. of Piece In One Program), Machine ON/OFF Time,
//               Actual OK Quantity, Rejected Quantity, Planned Operator Shift.
//   Quantities  OK + Rejected can't be more than Ideal Quantity.
//   Downtime    Optional (blank = 0), 0-1440 each, total within the Machine Shift.
//               "Others" needs a remark.
//   Non Working The machine did not run: only Date and Machine No. are asked for.

import '../../shared/production_entry_validation.dart' show isBlank, withDecimalPlanned;
import '../../shared/production_sheet_calc.dart' show isNonWorking, isNum, jsNumStr, jsNumber, jsRound, normalizeTime, spanMinutes;
import '../../shared/shift_hours.dart';
import '../../sheet/sheet_model.dart';
import 'vmc_calc.dart';

/// In the order the sheet lists them (Lunch / Rest has its own box beside Planned
/// Operator Shift but still counts toward the total).
const List<String> vmcDowntimeKeys = [
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

/// Top to bottom, the way the form reads — the first key with an error is where
/// Save scrolls to.
const List<String> vmcFieldOrder = [
  'date',
  'machine',
  'operator',
  'itemName',
  'machineOnTime',
  'machineOffTime',
  'okQty',
  'rejectedQty',
  'plannedOperatorShiftHours',
  'lunchMin',
  ...vmcDowntimeKeys,
  'stoppageTotal',
  'otherMinRemark',
];

int? _clock(Object? t) {
  final n = normalizeTime(t);
  return n == null ? null : int.parse(n.substring(0, 2)) * 60 + int.parse(n.substring(3, 5));
}

/// Machine Shift in minutes — the most stoppage an entry can account for (web
/// `stoppageLimitMin`). null until both times are usable.
double? vmcStoppageLimitMin(Json v) => spanMinutes(v['machineOnTime'], v['machineOffTime']);

bool _timesUnchanged(Json v, Json? saved) =>
    saved != null &&
    normalizeTime(v['machineOnTime']) == normalizeTime(saved['machineOnTime']) &&
    normalizeTime(v['machineOffTime']) == normalizeTime(saved['machineOffTime']);

/// One block's values -> {fieldKey: message}. Empty = ready to save. [saved]
/// (edit mode) is the row's times as loaded: an older row that already breaks a
/// time rule stays editable.
Map<String, String> validateVmcEntry(Json v, {Json? saved}) {
  final errors = <String, String>{};
  final calc = vmcRowCalc(v);

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = 'Machine No. is required';
  // Non Working: the machine did not run, so nothing else is asked for.
  if (isNonWorking(v)) return errors;
  if (isBlank(v['operator'])) errors['operator'] = 'Operator is required';
  if (isBlank(v['itemName'])) {
    errors['itemName'] = 'Part Name is required';
  } else if (!isNum(calc['totalCycleSec'] as double?)) {
    errors['itemName'] = 'This Part has no Program Time / No. of Piece In One Program set — edit it in Parts first';
  }

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
  if (!errors.containsKey('machineOnTime') && !errors.containsKey('machineOffTime') && !_timesUnchanged(v, saved)) {
    final on = _clock(v['machineOnTime']);
    final off = _clock(v['machineOffTime']);
    if (on != null && off != null && off <= on) errors['machineOffTime'] = 'Machine OFF Time must be after Machine ON Time';
  }

  // OK and Rejected are both typed; together they can't beat what the shift could make.
  final ok = jsNumber(v['okQty']);
  final rej = jsNumber(v['rejectedQty']);
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
  final ideal = calc['idealQty'] as double?;
  if (!errors.containsKey('okQty') && !errors.containsKey('rejectedQty') && isNum(ideal) && ok! + rej! > ideal!) {
    errors['okQty'] = "OK + Rejected (${jsNumStr(ok + rej)}) can't be more than Ideal Quantity (${jsNumStr(ideal)})";
  }

  // Planned Operator Shift is typed as H.MM (60 minutes to the hour).
  final plannedParse = parseHm(v['plannedOperatorShiftHours']);
  final planned = plannedParse.hours;
  if (isBlank(v['plannedOperatorShiftHours'])) {
    errors['plannedOperatorShiftHours'] = 'Planned Operator Shift is required';
  } else if (plannedParse.minutesTooBig) {
    errors['plannedOperatorShiftHours'] = 'Minutes must be 00–59 (3.30 means 3 h 30 min)';
  } else if (planned == null) {
    errors['plannedOperatorShiftHours'] = 'Enter hours and minutes like 8.30';
  } else if (planned <= 0 || planned > 24) {
    errors['plannedOperatorShiftHours'] = 'Must be more than 0:00 and at most 24:00';
  } else {
    final shiftMin = spanMinutes(v['machineOnTime'], v['machineOffTime']);
    if (shiftMin != null && jsRound(planned * 60) < shiftMin) {
      errors['plannedOperatorShiftHours'] = "Planned Operator Shift can't be less than the Machine Shift (${hoursToHm(shiftMin / 60)})";
    }
  }
  final decimal = withDecimalPlanned(v);

  // Lunch / Rest is optional, like every other stoppage box: blank counts as 0.
  final lunch = jsNumber(v['lunchMin']);
  if (!isBlank(v['lunchMin']) && (lunch == null || !lunch.isFinite || lunch < 0 || lunch > 1440)) errors['lunchMin'] = '0–1440';

  for (final key in vmcDowntimeKeys) {
    final n = jsNumber(v[key]);
    if (n != null && (!n.isFinite || n < 0 || n > 1440)) errors[key] = '0–1440';
  }
  final limit = vmcStoppageLimitMin(decimal);
  final total = calc['totalStoppageMin'] as double;
  if (limit != null && total > limit) {
    errors['stoppageTotal'] = 'Total stoppage is ${jsNumStr(total)} min but the Machine Shift is only ${jsNumStr(limit)} min';
  }
  if ((jsNumber(v['otherMin']) ?? 0) > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] = 'Remark is required when Others downtime is entered';
  }
  return errors;
}
