import '../../shared/production_entry_validation.dart' show isBlank, withDecimalPlanned;
import '../../shared/production_sheet_calc.dart' show isNum, jsNumStr, jsNumber, jsRound, normalizeTime, spanMinutes;
import '../../shared/shift_hours.dart';
import 'press_calc.dart';

/// Port of client/src/utils/pressValidation.js — every rule the PRESS Data Entry
/// form enforces, in one place (the server re-checks them in
/// pressSheet.controller.js `entryRuleError`).
///
///   Required   Date, Machine No., Operator, Part Name (and that Part needs its own
///              Standard Time Taken / No. Piece in Standard Time), Machine ON/OFF
///              Time, Actual OK Quantity, Rejected Quantity, Planned Operator Shift
///              (typed H.MM, not less than the Machine Shift).
///   Optional   Operation, Drawing No., Setup No.
///   Quantities OK + Rejected can't be more than Ideal Quantity.
///   Times      Machine OFF after ON.
///   Downtime   Optional (blank = 0), 0–1440 each, total within the Machine Shift.
///              "Others" needs a remark.

/// The downtime boxes in sheet order (Lunch / Rest has its own box beside
/// Planned Operator Shift but still counts toward the total).
const List<String> pressDowntimeKeys = [
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
const List<String> pressFieldOrder = [
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
  ...pressDowntimeKeys,
  'stoppageTotal',
  'otherMinRemark',
];

int? _clock(Object? t) {
  final n = normalizeTime(t);
  return n == null ? null : int.parse(n.substring(0, 2)) * 60 + int.parse(n.substring(3, 5));
}

bool _timesUnchanged(Map<String, dynamic> v, Map<String, dynamic>? saved) =>
    saved != null &&
    normalizeTime(v['machineOnTime']) == normalizeTime(saved['machineOnTime']) &&
    normalizeTime(v['machineOffTime']) == normalizeTime(saved['machineOffTime']);

/// JS `Number(v)` for a possibly-blank typed value: null when blank.
double? _num(Object? v) => jsNumber(v);

bool _badMinutes(double? n) => n != null && (!n.isFinite || n < 0 || n > 1440);

/// One block's values -> {fieldKey: message}. Empty map = ready to save. [saved]
/// (edit mode) is the row's times as loaded: an older row that already breaks a
/// time rule stays editable.
Map<String, String> validatePressEntry(Map<String, dynamic> v, {Map<String, dynamic>? saved}) {
  final errors = <String, String>{};
  final calc = pressRowCalc(v);

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = 'Machine No. is required';
  // Non Working: the machine did not run, so nothing else is asked for.
  if (v['workingMode'] == 'Non Working') return errors;
  if (isBlank(v['operator'])) errors['operator'] = 'Operator is required';
  if (isBlank(v['itemName'])) {
    errors['itemName'] = 'Part Name is required';
  } else if (!isNum(calc['totalCycleSec'] as double?)) {
    errors['itemName'] = 'This Part has no Standard Time Taken / No. Piece in Standard Time set — edit it in Parts first';
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
  final lunch = _num(v['lunchMin']);
  if (!isBlank(v['lunchMin']) && (lunch == null || _badMinutes(lunch))) errors['lunchMin'] = '0–1440';

  for (final key in pressDowntimeKeys) {
    if (_badMinutes(_num(v[key]))) errors[key] = '0–1440';
  }
  final limit = pressStoppageLimitMin(decimal);
  final total = calc['totalStoppageMin'] as double;
  if (limit != null && total > limit) {
    errors['stoppageTotal'] = 'Total stoppage is ${jsNumStr(total)} min but the Machine Shift is only ${jsNumStr(limit)} min';
  }
  if ((_num(v['otherMin']) ?? 0) > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] = 'Remark is required when Others downtime is entered';
  }
  return errors;
}
