// Port of client/src/utils/printingValidation.js — every rule the PRINTING form
// enforces. Messages are the web's, word for word; the time rules keep the
// wording `isTimeRuleMessage` matches. Verified against the REAL JS by golden
// vectors (test/production/processes/printing).
//
//   Non Working Only Date and Operator (+ reasons / remarks) — nothing else.
//   Required    Date, Operator, Item Name, Standard Time per Piece (> 0),
//               Machine ON / OFF Time, TOTAL QTY (Actual Quantity), OK QTY,
//               Planned Operator Shift (typed as decimal hours like the sheet,
//               not less than the Machine Shift). MC No. is optional.
//   Quantities  Whole numbers, 0 or more; OK ≤ TOTAL; Rejected = TOTAL − OK.
//               TOTAL can't be more than the Ideal Quantity rounded down. No
//               Rejection Master — only the free-text Reason/Remarks.
//   Times       Machine OFF after ON. NO overlap rule: one operator may run
//               two jobs at the same time (the paper sheet does).
//   Downtime    Optional, 0–1440 each; all 13 columns together within the
//               Machine Shift. "Other" needs a remark.

import '../../shared/production_entry_validation.dart' show isBlank, stoppageLimitMin;
import '../../shared/production_sheet_calc.dart';
import '../../shared/quantity_rules.dart' show validateQuantities;
import '../../shared/shift_hours.dart';
import 'printing_calc.dart';

/// Every downtime box of the form, in the sheet's order.
final List<String> printingMinuteKeys = printingStoppageKeys;

/// Top to bottom, the way the form reads — the first key with an error is
/// where Save scrolls to (PRINTING_FIELD_ORDER).
final List<String> printingFieldOrder = [
  'date',
  'machine',
  'workingMode',
  'mcMachine',
  'itemName',
  'vendor',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  'okQty',
  'plannedOperatorShiftHours',
  ...printingMinuteKeys,
  'stoppageTotal',
  'otherMinRemark',
];

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
Map<String, String> validatePrintingEntry(Map<String, dynamic> v, {Map<String, dynamic>? saved}) {
  final errors = <String, String>{};
  final calc = printingRowCalc(v);

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = 'Operator is required';
  // Non Working (or an older status-only day) records just its status.
  if (isStatusOnly(v) || isNonWorking(v)) return errors;

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
    if (on != null && off != null && off <= on) {
      errors['machineOffTime'] = 'Machine OFF Time must be after Machine ON Time';
    }
  }

  // TOTAL ≤ Ideal (rounded down), OK ≤ TOTAL. This sheet has no Rejection
  // Master, so the split rules of the shared check don't apply.
  validateQuantities(v, calc, errors, capByIdeal: true);
  errors.remove('rejectBreakdown');
  errors.remove('rejectOtherRemark');
  for (final key in const ['actualQty', 'okQty']) {
    final n = jsNumber(v[key]);
    if (!errors.containsKey(key) && _isNum(n) && n != n!.truncateToDouble()) {
      errors[key] = 'Must be a whole number, 0 or more';
    }
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

  // Downtime is optional, like every downtime box: blank counts as 0.
  for (final key in printingMinuteKeys) {
    final n = jsNumber(v[key]);
    if (n != null && (!n.isFinite || n < 0 || n > 1440)) errors[key] = '0–1440';
  }
  final limit = stoppageLimitMin(v);
  final total = calc['totalStoppageMin'];
  final stoppage = (total is num && !total.isNaN) ? total.toDouble() : 0.0;
  if (limit != null && stoppage > limit) {
    errors['stoppageTotal'] = 'Total Idle Time is ${jsNumStr(total as num)} min but the Machine Shift is only ${jsNumStr(limit)} min';
  }
  if ((jsNumber(v['otherMin']) ?? 0) > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] = 'Remark is required when Other downtime is entered';
  }
  return errors;
}
