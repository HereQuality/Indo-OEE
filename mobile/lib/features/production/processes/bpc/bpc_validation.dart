// Port of client/src/utils/bpcValidation.js — every rule the BEFORE POWDER
// COATING form enforces. Messages are the web's, word for word; the time rules
// keep the wording `isTimeRuleMessage` matches. Verified against the REAL JS by
// golden vectors (test/production/processes/bpc).
//
//   Status-only Any Working Status but PRESENT (ABSENT, SUNDAY, …), or Non
//               Working: only Date and Operator — nothing else is asked for.
//   Required    Date, Operator, Item Name, Standard Time per Piece (> 0),
//               Machine ON / OFF Time, TOTAL QTY, OK QTY, Planned Operator Shift
//               (typed as decimal hours, not less than the Machine Shift Time;
//               fixed by Process Master while locked).
//   Quantities  TOTAL and OK are typed whole numbers, 0 or more; OK can't be more
//               than TOTAL; Rejected = TOTAL − OK, split across this sheet's own
//               reasons (the boxes must add up, "Other" needs a remark). TOTAL
//               MAY be more than Ideal Quantity — such an entry goes to OEE Review.
//   Times       Machine OFF after ON; one operator's entries on a date can't
//               overlap (the shared overlapErrors, in the editor).
//   Idle Time   Optional, 0–1440 each; Setup + B.D. + Lunch + Other together
//               within the Machine Shift Time. "Other" needs a remark.

import '../../shared/production_entry_validation.dart' show TimeWords, isBlank, stoppageLimitMin;
import '../../shared/production_sheet_calc.dart';
import '../../shared/quantity_rules.dart';
import '../../shared/shift_hours.dart';
import 'bpc_calc.dart';

/// The four idle-time boxes (web `BPC_MINUTE_KEYS`).
final List<String> bpcMinuteKeys = [for (final f in bpcStoppageFields) f.$1];

/// Top to bottom, the way the form reads — the first key with an error is where
/// Save scrolls to (web `BPC_FIELD_ORDER`).
final List<String> bpcFieldOrder = [
  'date',
  'machine',
  'workingStatus',
  'itemName',
  'vendor',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  'okQty',
  'rejectBreakdown',
  'rejectOtherRemark',
  'plannedOperatorShiftHours',
  ...bpcMinuteKeys,
  'stoppageTotal',
  'otherMinRemark',
];

/// The overlap message in this sheet's words (web `BPC_TIME_WORDS`): the sheet
/// calls them Machine ON / OFF Time, kept per operator.
const TimeWords bpcTimeWords = TimeWords(start: 'Machine ON Time', end: 'Machine OFF Time', owner: 'this operator');

bool _isNum(double? v) => v != null && v.isFinite;

int? _clock(Object? t) {
  final n = normalizeTime(t);
  return n == null ? null : int.parse(n.substring(0, 2)) * 60 + int.parse(n.substring(3));
}

// Web `timesUnchanged`: an older row that already breaks a time rule stays editable.
bool _timesUnchanged(Map<String, dynamic> v, Map<String, dynamic>? saved) =>
    saved != null &&
    jsString(v['date'] ?? '') == jsString(saved['date'] ?? '') &&
    jsString(v['machine'] ?? '') == jsString(saved['machine'] ?? '') &&
    normalizeTime(v['machineOnTime']) == normalizeTime(saved['machineOnTime']) &&
    normalizeTime(v['machineOffTime']) == normalizeTime(saved['machineOffTime']);

/// One block's values → {fieldKey: message}. Empty = ready to save.
Map<String, String> validateBpcEntry(Map<String, dynamic> v, {Map<String, dynamic>? saved}) {
  final errors = <String, String>{};
  final calc = bpcRowCalc(v);

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = 'Operator is required';
  // ABSENT, SUNDAY, … or Non Working — a day with no work records just its status.
  if (bpcIsStatusOnly(v) || isNonWorking(v)) return errors;

  if (isBlank(v['itemName'])) errors['itemName'] = 'Item Name is required';
  final cycle = jsNumber(v['totalCycleSec']);
  if (isBlank(v['totalCycleSec'])) {
    errors['totalCycleSec'] = 'Standard Time per Piece is required';
  } else if (!_isNum(cycle) || cycle! <= 0) {
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
  if (!errors.containsKey('machineOnTime') && !errors.containsKey('machineOffTime') && !_timesUnchanged(v, saved)) {
    final on = _clock(v['machineOnTime']);
    final off = _clock(v['machineOffTime']);
    if (on != null && off != null && off <= on) errors['machineOffTime'] = 'Machine OFF Time must be after Machine ON Time';
  }

  // Not capped at Ideal — over-Ideal goes to OEE Review instead.
  validateQuantities(v, calc, errors, capByIdeal: false);
  if (errors['actualQty'] == 'Actual Quantity is required') errors['actualQty'] = 'TOTAL QTY is required';
  if (errors['okQty'] == 'OK Quantity is required') errors['okQty'] = 'OK QTY is required';
  if ((errors['okQty'] ?? '').startsWith("OK can't be more than Actual Quantity")) {
    errors['okQty'] = "OK can't be more than TOTAL QTY (${jsNumStr(jsToNumber(v['actualQty']))})";
  }
  for (final key in const ['actualQty', 'okQty']) {
    final n = jsNumber(v[key]);
    if (!errors.containsKey(key) && _isNum(n) && n != n!.truncateToDouble()) errors[key] = 'Must be a whole number, 0 or more';
  }

  // Planned Operator Shift is typed as decimal hours (5.33 = 5 h 20 min).
  final planned = parseShiftHours(v['plannedOperatorShiftHours']).hours;
  if (isBlank(v['plannedOperatorShiftHours'])) {
    errors['plannedOperatorShiftHours'] = 'Planned Operator Shift is required';
  } else if (planned == null) {
    errors['plannedOperatorShiftHours'] = 'Enter hours like 8.5 or 6.75';
  } else if (planned <= 0 || planned > 24) {
    errors['plannedOperatorShiftHours'] = 'Must be more than 0:00 and at most 24:00';
  } else {
    // Not while OFF isn't after ON: the span would wrap past midnight (23 h and
    // the like), and the OFF box already says what's wrong.
    final shiftMin = errors.containsKey('machineOffTime') ? null : spanMinutes(v['machineOnTime'], v['machineOffTime']);
    if (shiftMin != null && jsRound(planned * 60) < shiftMin) {
      errors['plannedOperatorShiftHours'] =
          "Planned Operator Shift can't be less than the Machine Shift Time (${hoursToHm(shiftMin / 60)})";
    }
  }

  // Idle time is optional, like every downtime box: blank counts as 0.
  for (final key in bpcMinuteKeys) {
    final n = jsNumber(v[key]);
    if (n != null && (!n.isFinite || n < 0 || n > 1440)) errors[key] = '0–1440';
  }
  final limit = stoppageLimitMin(v);
  final total = calc['totalStoppageMin'];
  final totalMin = (total is num && !total.isNaN) ? total.toDouble() : 0.0;
  if (limit != null && totalMin > limit) {
    errors['stoppageTotal'] =
        'Total Idle Time is ${jsString(calc['totalStoppageMin'])} min but the Machine Shift Time is only ${jsNumStr(limit)} min';
  }
  if ((jsNumber(v['otherMin']) ?? 0) > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] = 'Remark is required when Other idle time is entered';
  }
  return errors;
}
