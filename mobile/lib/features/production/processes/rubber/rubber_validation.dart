// Port of client/src/utils/rubberValidation.js — every rule the RUBBER form
// enforces (After Powder Coating's rules over this sheet's own fields, with the
// CNC Production Master / Rejection Master quantities). Messages are the web's,
// word for word. Verified against the REAL JS by golden vectors
// (test/production/processes/rubber).
//
//   Status-only Any Working Status but PRESENT (ABSENT, SUNDAY, …), or Non
//               Working: only Date and Worker Name.
//   Required    Date, Worker Name, Part Name, Total Cycle Time (> 0), Working
//               Start / End Time, Actual Quantity, OK Quantity, Planned Operator
//               Shift (decimal hours, not less than the Worker Shift Time).
//   Quantities  Actual and OK typed whole numbers, 0 or more; OK not more than
//               Actual; Rejected = Actual − OK split across the reject reasons
//               (shared/quantity_rules.dart). Actual MAY beat IDEAL Quantity
//               (goes to OEE Review).
//   Times       Working End after Start.
//   Stoppage    Optional, 0–1440 each; all of it within the Worker Shift Time.
//               "Others" needs a remark.

import '../../shared/production_entry_validation.dart' show isBlank, stoppageLimitMin;
import '../../shared/production_sheet_calc.dart';
import '../../shared/quantity_rules.dart';
import '../../shared/shift_hours.dart';
import 'rubber_calc.dart';

/// Top to bottom, the way the form reads — the first key with an error is
/// where Save scrolls to (`RUBBER_FIELD_ORDER`).
final List<String> rubberFieldOrder = [
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
  ...rubberMinuteKeys,
  'stoppageTotal',
  'otherMinRemark',
];

double? _num(Object? v) => jsNumber(v);
bool _isNum(double? v) => v != null && v.isFinite;

int? _clock(Object? t) {
  final n = normalizeTime(t);
  return n == null ? null : int.parse(n.substring(0, 2)) * 60 + int.parse(n.substring(3));
}

// An older row that already breaks a time rule stays editable (web `timesUnchanged`).
bool _timesUnchanged(Map<String, dynamic> v, Map<String, dynamic>? saved) =>
    saved != null &&
    '${v['date'] ?? ''}' == '${saved['date'] ?? ''}' &&
    '${v['machine'] ?? ''}' == '${saved['machine'] ?? ''}' &&
    normalizeTime(v['machineOnTime']) == normalizeTime(saved['machineOnTime']) &&
    normalizeTime(v['machineOffTime']) == normalizeTime(saved['machineOffTime']);

/// One block's values → {fieldKey: message}. Empty = ready to save.
Map<String, String> validateRubberEntry(Map<String, dynamic> v, {Map<String, dynamic>? saved}) {
  final errors = <String, String>{};
  final calc = rubberRowCalc(v);

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = 'Worker Name is required';
  // ABSENT, SUNDAY, … — a day with no work records just its status.
  if (rubberIsStatusOnly(v) || isNonWorking(v)) return errors;

  if (isBlank(v['itemName'])) errors['itemName'] = 'Part Name is required';
  final cycle = _num(v['totalCycleSec']);
  if (isBlank(v['totalCycleSec'])) {
    errors['totalCycleSec'] = 'Total Cycle Time is required';
  } else if (!_isNum(cycle) || cycle! <= 0) {
    errors['totalCycleSec'] = 'Must be more than 0';
  }

  for (final (key, label) in const [
    ('machineOnTime', 'Working Start Time'),
    ('machineOffTime', 'Working End Time'),
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
      errors['machineOffTime'] = 'Working End Time must be after Working Start Time';
    }
  }

  // Not capped at Ideal — over-Ideal goes to OEE Review instead.
  validateQuantities(v, calc, errors, capByIdeal: false);
  for (final key in const ['actualQty', 'okQty']) {
    final n = _num(v[key]);
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
    // Not while End isn't after Start: the span would wrap past midnight, and the
    // End box already says what's wrong.
    final shiftMin = errors.containsKey('machineOffTime') ? null : spanMinutes(v['machineOnTime'], v['machineOffTime']);
    if (shiftMin != null && jsRound(planned * 60) < shiftMin) {
      errors['plannedOperatorShiftHours'] =
          "Planned Operator Shift can't be less than the Worker Shift Time (${hoursToHm(shiftMin / 60)})";
    }
  }

  // Stoppage is optional, like every downtime box: blank counts as 0.
  for (final key in rubberMinuteKeys) {
    final n = _num(v[key]);
    if (n != null && (!n.isFinite || n < 0 || n > 1440)) errors[key] = '0–1440';
  }
  final limit = stoppageLimitMin(v);
  final total = calc['totalStoppageMin'];
  final totalMin = (total is num && !total.isNaN) ? total.toDouble() : 0.0;
  if (limit != null && totalMin > limit) {
    errors['stoppageTotal'] =
        'Total stoppage is ${jsNumStr(totalMin)} min but the Worker Shift Time is only ${jsNumStr(limit)} min';
  }
  if ((_num(v['otherMin']) ?? 0) > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] = 'Remark is required when Others stoppage is entered';
  }
  return errors;
}
