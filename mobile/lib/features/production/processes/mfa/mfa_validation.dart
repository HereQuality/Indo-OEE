// Port of client/src/utils/mfaValidation.js — every rule the MODULAR FRAME
// ASSEMBLY form enforces. Messages are the web's, word for word. Verified
// against the REAL JS by golden vectors (test/production/processes/mfa).
//
//   Status-only Any Working Status but PRESENT, or Non Working: Date and Worker only.
//   Required    Date, Worker Name, Item Name, Standard Assembly Time (> 0),
//               Assembly Start / End Time, TOTAL QTY, OK QTY, Planned Operator Shift.
//   Quantities  TOTAL / OK whole numbers, OK ≤ TOTAL; no reason split. TOTAL MAY
//               beat the Ideal Assembly Quantity (goes to OEE Review).
//   Times       End after Start; entries of one worker MAY overlap.
//   Idle / Other Activity  0–1440 each; together within the Working Hours.

import '../../shared/production_entry_validation.dart' show isBlank, stoppageLimitMin;
import '../../shared/production_sheet_calc.dart';
import '../../shared/quantity_rules.dart';
import '../../shared/shift_hours.dart';
import 'mfa_calc.dart';

const List<String> mfaMinuteKeys = ['otherActivityMin', 'lunchMin', 'otherMin'];

/// `MFA_FIELD_ORDER`.
const List<String> mfaFieldOrder = [
  'date',
  'machine',
  'workingStatus',
  'itemName',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  'okQty',
  'otherActivity',
  'otherActivityMin',
  'plannedOperatorShiftHours',
  'lunchMin',
  'otherMin',
  'stoppageTotal',
  'otherMinRemark',
];

double? _num(Object? v) => jsNumber(v);
bool _isNum(double? v) => v != null && v.isFinite;
double _or0(double? v) => (v == null || v.isNaN) ? 0.0 : v;

int? _clock(Object? t) {
  final n = normalizeTime(t);
  return n == null ? null : int.parse(n.substring(0, 2)) * 60 + int.parse(n.substring(3));
}

bool _timesUnchanged(Map<String, dynamic> v, Map<String, dynamic>? saved) =>
    saved != null &&
    '${v['date'] ?? ''}' == '${saved['date'] ?? ''}' &&
    '${v['machine'] ?? ''}' == '${saved['machine'] ?? ''}' &&
    normalizeTime(v['machineOnTime']) == normalizeTime(saved['machineOnTime']) &&
    normalizeTime(v['machineOffTime']) == normalizeTime(saved['machineOffTime']);

/// One block's values → {fieldKey: message}. Empty = ready to save.
Map<String, String> validateMfaEntry(Map<String, dynamic> v, {Map<String, dynamic>? saved}) {
  final errors = <String, String>{};
  final calc = mfaRowCalc(v);

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = 'Worker Name is required';
  if (mfaIsStatusOnly(v) || isNonWorking(v)) return errors;

  if (isBlank(v['itemName'])) errors['itemName'] = 'Item Name is required';
  final cycle = _num(v['totalCycleSec']);
  if (isBlank(v['totalCycleSec'])) {
    errors['totalCycleSec'] = '$mfaCycle is required';
  } else if (!_isNum(cycle) || cycle! <= 0) {
    errors['totalCycleSec'] = 'Must be more than 0';
  }

  for (final (key, label) in const [('machineOnTime', mfaStart), ('machineOffTime', mfaEnd)]) {
    if (isBlank(v[key])) {
      errors[key] = '$label is required';
    } else if (normalizeTime(v[key]) == null) {
      errors[key] = 'Enter a valid time';
    }
  }
  if (!errors.containsKey('machineOnTime') && !errors.containsKey('machineOffTime') && !_timesUnchanged(v, saved)) {
    final on = _clock(v['machineOnTime']);
    final off = _clock(v['machineOffTime']);
    if (on != null && off != null && off <= on) errors['machineOffTime'] = '$mfaEnd must be after $mfaStart';
  }

  // TOTAL and OK typed; not capped at Ideal. No reject split on this sheet.
  validateQuantities({...v, 'rejectBreakdown': <String, dynamic>{}}, calc, errors, capByIdeal: false);
  errors.remove('rejectBreakdown');
  errors.remove('rejectOtherRemark');
  if (errors['actualQty'] == 'Actual Quantity is required') errors['actualQty'] = 'TOTAL QTY is required';
  if (errors['okQty'] == 'OK Quantity is required') errors['okQty'] = 'OK QTY is required';
  if ((errors['okQty'] ?? '').startsWith("OK can't be more than Actual Quantity")) {
    final a = _num(v['actualQty']);
    errors['okQty'] = "OK can't be more than TOTAL QTY (${a == null ? 'null' : jsNumStr(a)})";
  }
  for (final key in const ['actualQty', 'okQty']) {
    final n = _num(v[key]);
    if (!errors.containsKey(key) && _isNum(n) && n != n!.truncateToDouble()) errors[key] = 'Must be a whole number, 0 or more';
  }

  final planned = parseShiftHours(v['plannedOperatorShiftHours']).hours;
  if (isBlank(v['plannedOperatorShiftHours'])) {
    errors['plannedOperatorShiftHours'] = 'Planned Operator Shift is required';
  } else if (planned == null) {
    errors['plannedOperatorShiftHours'] = 'Enter hours as on the sheet, like 9.42 or 2.67';
  } else if (planned <= 0 || planned > 24) {
    errors['plannedOperatorShiftHours'] = 'Must be more than 0:00 and at most 24:00';
  } else {
    final shiftMin = errors.containsKey('machineOffTime') ? null : spanMinutes(v['machineOnTime'], v['machineOffTime']);
    if (shiftMin != null && jsRound(planned * 60) < shiftMin) {
      errors['plannedOperatorShiftHours'] = "Planned Operator Shift can't be less than the $mfaHours (${hoursToHm(shiftMin / 60)})";
    }
  }

  for (final key in mfaMinuteKeys) {
    final n = _num(v[key]);
    if (n != null && (!n.isFinite || n < 0 || n > 1440)) errors[key] = '0–1440';
  }
  final limit = stoppageLimitMin(v);
  final ts = calc['totalStoppageMin'];
  final away = ((ts is num && !ts.isNaN) ? ts.toDouble() : 0.0) + _or0(_num(v['otherActivityMin']));
  if (limit != null && away > limit) {
    errors['stoppageTotal'] = 'Idle Time + Other Activity is ${jsNumStr(away)} min but the $mfaHours are only ${jsNumStr(limit)} min';
  }
  if ((_num(v['otherActivityMin']) ?? 0) > 0 && isBlank(v['otherActivity'])) {
    errors['otherActivity'] = 'Say what the other activity was';
  }
  if ((_num(v['otherMin']) ?? 0) > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] = 'Remark is required when Other idle time is entered';
  }
  return errors;
}
