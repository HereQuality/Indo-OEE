import '../../shared/production_entry_validation.dart' show isBlank, stoppageLimitMin, withDecimalPlanned;
import '../../shared/production_sheet_calc.dart';
import '../../shared/quantity_rules.dart';
import '../../shared/shift_hours.dart';
import 'mfd_calc.dart';

/// Port of client/src/utils/mfdValidation.js — every rule the MODULAR FRAME
/// DRILLING form enforces (the INJECTION MOULDING form's, over this sheet's fields):
///
///   Non Working  only Date and MC No.
///   Required     Date, MC No., Operator, Part Name, Total Cycle Time (> 0),
///                Machine Time ON / OFF, Actual Quantity, ACTUAL OK Quantity,
///                Planned Operator Shift (decimal hours, not less than the Machine Shift).
///   Quantities   Whole numbers, 0 or more; Actual within the IDEAL Quantity (Lunch
///                out) rounded down, OK within Actual. No Rejection Master.
///   Times        OFF after ON; Setting Time ON / OFF optional (a real time when
///                typed). One machine's entries MAY overlap.
///   Downtime     Optional, 0–1440 each, all of it within the Machine Shift;
///                "Others" needs a remark.
///
/// The server re-checks these (mfdSheet.controller.js); keep the three in step.

/// Every downtime box (web `MFD_MINUTE_KEYS`).
final List<String> mfdMinuteKeys = [for (final f in mfdStoppageFields) f.$1];

/// The downtime boxes in their own line — every one but Lunch, which sits
/// beside Planned (web `MFD_DOWNTIME_KEYS`).
final List<String> mfdDowntimeKeys = [
  for (final k in mfdMinuteKeys)
    if (k != 'lunchMin') k,
];

/// Top to bottom, the way the form reads (web `MFD_FIELD_ORDER`) — the
/// first key with an error is where Save scrolls to.
final List<String> mfdFieldOrder = [
  'date',
  'machine',
  'operator',
  'workingMode',
  'machineStatus',
  'itemName',
  'vendor',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'settingOnTime',
  'settingOffTime',
  'actualQty',
  'okQty',
  'plannedOperatorShiftHours',
  'lunchMin',
  ...mfdDowntimeKeys,
  'stoppageTotal',
  'otherMinRemark',
];

int? _clock(Object? t) {
  final n = normalizeTime(t);
  return n == null ? null : int.parse(n.substring(0, 2)) * 60 + int.parse(n.substring(3, 5));
}

// Web `timesUnchanged`: an older row that already breaks a time rule stays
// editable — but moving it to another date or machine is a change.
bool _timesUnchanged(Map<String, dynamic> v, Map<String, dynamic>? saved) =>
    saved != null &&
    jsString(v['date'] ?? '') == jsString(saved['date'] ?? '') &&
    jsString(v['machine'] ?? '') == jsString(saved['machine'] ?? '') &&
    normalizeTime(v['machineOnTime']) == normalizeTime(saved['machineOnTime']) &&
    normalizeTime(v['machineOffTime']) == normalizeTime(saved['machineOffTime']);

/// One block's values -> {fieldKey: message}. Empty = ready to save. [saved]
/// is the row as loaded (edit mode).
Map<String, String> validateMfdEntry(Map<String, dynamic> v, {Map<String, dynamic>? saved}) {
  final errors = <String, String>{};
  final calc = mfdRowCalc(v);

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = 'MC No. is required';
  // Non Working — a day with no production records just its reason.
  if (isNonWorking(v)) return errors;

  if (isBlank(v['operator'])) errors['operator'] = 'Operator is required';
  if (isBlank(v['itemName'])) errors['itemName'] = 'Part Name is required';
  final cycle = jsNumber(v['totalCycleSec']);
  if (isBlank(v['totalCycleSec'])) {
    errors['totalCycleSec'] = 'Total Cycle Time is required';
  } else if (!isNum(cycle) || cycle! <= 0) {
    errors['totalCycleSec'] = 'Must be more than 0';
  }

  for (final (key, label) in const [('machineOnTime', 'Machine Time ON'), ('machineOffTime', 'Machine Time OFF')]) {
    if (isBlank(v[key])) {
      errors[key] = '$label is required';
    } else if (normalizeTime(v[key]) == null) {
      errors[key] = 'Enter a valid time';
    }
  }
  if (!errors.containsKey('machineOnTime') && !errors.containsKey('machineOffTime') && !_timesUnchanged(v, saved)) {
    final on = _clock(v['machineOnTime']);
    final off = _clock(v['machineOffTime']);
    // Worded like every sheet's "… Time must be after …", which the form shows at once.
    if (on != null && off != null && off <= on) errors['machineOffTime'] = 'Machine OFF Time must be after Machine ON Time';
  }
  // Setting Time ON / OFF are optional, informational only — just a real time when typed.
  for (final key in const ['settingOnTime', 'settingOffTime']) {
    if (!isBlank(v[key]) && normalizeTime(v[key]) == null) errors[key] = 'Enter a valid time';
  }

  // Actual and OK are typed; Actual can't beat the IDEAL Quantity rounded down
  // (calc.idealQty). No reject split on this sheet, so the shared rules'
  // split checks don't apply.
  validateQuantities({...v, 'rejectBreakdown': <String, dynamic>{}}, calc, errors);
  errors.remove('rejectBreakdown');
  errors.remove('rejectOtherRemark');
  for (final key in const ['actualQty', 'okQty']) {
    final n = jsNumber(v[key]);
    if (!errors.containsKey(key) && isNum(n) && n! != n.truncateToDouble()) errors[key] = 'Must be a whole number, 0 or more';
  }

  // Planned Operator Shift is typed as decimal hours like the sheet (5.33 = 5 h 20 min).
  final planned = parseShiftHours(v['plannedOperatorShiftHours']).hours;
  if (isBlank(v['plannedOperatorShiftHours'])) {
    errors['plannedOperatorShiftHours'] = 'Planned Operator Shift is required';
  } else if (planned == null) {
    errors['plannedOperatorShiftHours'] = 'Enter hours as on the sheet, like 8.5 or 5.33';
  } else if (planned <= 0 || planned > 24) {
    errors['plannedOperatorShiftHours'] = 'Must be more than 0:00 and at most 24:00';
  } else {
    // Not while OFF isn't after ON: the span would wrap past midnight, and the
    // OFF box already says what's wrong.
    final shiftMin = errors.containsKey('machineOffTime') ? null : spanMinutes(v['machineOnTime'], v['machineOffTime']);
    if (shiftMin != null && jsRound(planned * 60) < shiftMin) {
      errors['plannedOperatorShiftHours'] = "Planned Operator Shift can't be less than the Machine Shift (${hoursToHm(shiftMin / 60)})";
    }
  }

  // Downtime is optional, every box: blank counts as 0.
  for (final key in mfdMinuteKeys) {
    final n = jsNumber(v[key]);
    if (n != null && (!n.isFinite || n < 0 || n > 1440)) errors[key] = '0–1440';
  }
  final limit = stoppageLimitMin(withDecimalPlanned(v));
  final total = calc['totalStoppageMin'];
  // JS `calc.totalStoppageMin || 0`.
  final totalMin = (total is num && !total.isNaN) ? total : 0;
  if (limit != null && totalMin > limit) {
    errors['stoppageTotal'] = 'Total stoppage is ${jsNumStr(total as num)} min but the Machine Shift is only ${jsNumStr(limit)} min';
  }
  final other = jsNumber(v['otherMin']);
  if (other != null && other > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] = 'Remark is required when Others downtime is entered';
  }
  return errors;
}
