import '../../shared/production_entry_validation.dart' show isBlank, stoppageLimitMin, withDecimalPlanned;
import '../../shared/production_sheet_calc.dart';
import '../../shared/quantity_rules.dart';
import '../../shared/shift_hours.dart';
import 'embossing_calc.dart';

/// Port of client/src/utils/embossingValidation.js — every rule the EMBOSSING
/// form enforces (the INJECTION MOULDING form's, over this sheet's fields, but
/// with TOTAL QTY. allowed past Ideal Quantity — such an entry goes to OEE Review):
///
///   Non Working  Working Status "Non Working" (or a status-only Working Status:
///                ABSENT, SUNDAY, …): only Date and MC No.
///   Required     Date, MC No., Operator, Item Name, Standard Time per Piece (> 0),
///                Machine ON / OFF Time, TOTAL QTY (actualQty), OK QTY, Planned
///                Operator Shift (decimal hours, not less than the Machine Shift).
///   Quantities   Whole numbers, 0 or more; OK within TOTAL. TOTAL MAY be more
///                than Ideal Quantity (OEE Review). No Rejection Master.
///   Downtime     Optional, 0–1440 each, all of it within the Machine Shift;
///                "Other" needs a remark.
///
/// The server re-checks these (embossingSheet.controller.js); keep the three in step.

/// Every downtime box (web `INJECTION_MINUTE_KEYS`).
final List<String> embossingMinuteKeys = [for (final f in embossingStoppageFields) f.$1];

/// The downtime boxes in their own line — every one but Lunch, which sits
/// beside Planned (web `INJECTION_DOWNTIME_KEYS`).
final List<String> embossingDowntimeKeys = [
  for (final k in embossingMinuteKeys)
    if (k != 'lunchMin') k,
];

/// Top to bottom, the way the form reads (web `INJECTION_FIELD_ORDER`) — the
/// first key with an error is where Save scrolls to.
final List<String> embossingFieldOrder = [
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
  'actualQty',
  'okQty',
  'plannedOperatorShiftHours',
  'lunchMin',
  ...embossingDowntimeKeys,
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
Map<String, String> validateEmbossingEntry(Map<String, dynamic> v, {Map<String, dynamic>? saved}) {
  final errors = <String, String>{};
  final calc = embossingRowCalc(v);

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = 'MC No. is required';
  // Non Working (or ABSENT, SUNDAY, …) — a day with no production records just its reason.
  if (embossingIsStatusOnly(v) || isNonWorking(v)) return errors;

  if (isBlank(v['operator'])) errors['operator'] = 'Operator is required';
  if (isBlank(v['itemName'])) errors['itemName'] = 'Item Name is required';
  final std = jsNumber(v['totalCycleSec']);
  if (isBlank(v['totalCycleSec'])) {
    errors['totalCycleSec'] = 'Standard Time per Piece is required';
  } else if (!isNum(std) || std! <= 0) {
    errors['totalCycleSec'] = 'Must be more than 0';
  }

  for (final (key, label) in const [('machineOnTime', 'Machine ON Time'), ('machineOffTime', 'Machine OFF Time')]) {
    if (isBlank(v[key])) {
      errors[key] = '$label is required';
    } else if (normalizeTime(v[key]) == null) {
      errors[key] = 'Enter a valid time';
    }
  }
  if (!errors.containsKey('machineOnTime') && !errors.containsKey('machineOffTime') && !_timesUnchanged(v, saved)) {
    final on = _clock(v['machineOnTime']);
    final off = _clock(v['machineOffTime']);
    if (on != null && off != null && off <= on) errors['machineOffTime'] = 'Machine OFF Time must be after Machine ON Time';
  }

  // TOTAL and OK are typed; not capped at Ideal — over-Ideal goes to OEE Review
  // instead. No reject split on this sheet, so the shared rules' split checks
  // don't apply; their messages are put in the sheet's words.
  validateQuantities({...v, 'rejectBreakdown': <String, dynamic>{}}, calc, errors, capByIdeal: false);
  errors.remove('rejectBreakdown');
  errors.remove('rejectOtherRemark');
  if (errors['actualQty'] == 'Actual Quantity is required') errors['actualQty'] = 'TOTAL QTY is required';
  if (errors['okQty'] == 'OK Quantity is required') errors['okQty'] = 'OK QTY is required';
  final okErr = errors['okQty'];
  if (okErr != null && okErr.startsWith("OK can't be more than Actual Quantity")) {
    final total = jsNumber(v['actualQty']);
    errors['okQty'] = "OK can't be more than TOTAL QTY (${total == null ? 'null' : jsNumStr(total)})";
  }
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
  for (final key in embossingMinuteKeys) {
    final n = jsNumber(v[key]);
    if (n != null && (!n.isFinite || n < 0 || n > 1440)) errors[key] = '0–1440';
  }
  final limit = stoppageLimitMin(withDecimalPlanned(v));
  final total = calc['totalStoppageMin'];
  // JS `calc.totalStoppageMin || 0`.
  final totalMin = (total is num && !total.isNaN) ? total : 0;
  if (limit != null && totalMin > limit) {
    errors['stoppageTotal'] = 'Total Idle Time is ${jsNumStr(total as num)} min but the Machine Shift is only ${jsNumStr(limit)} min';
  }
  final other = jsNumber(v['otherMin']);
  if (other != null && other > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] = 'Remark is required when Other downtime is entered';
  }
  return errors;
}
