import '../../shared/production_entry_validation.dart';
import '../../shared/production_sheet_calc.dart';
import '../../shared/quantity_rules.dart';
import '../../shared/shift_hours.dart';
import 'rivet_calc.dart';

// Port of client/src/utils/rivetValidation.js — every rule the RIVET Data Entry
// form enforces. The overlap checks and the stoppage allowance are the shared
// ones; what is RIVET's own is below. The server re-checks these
// (rivetSheet.controller.js — entryRuleError); keep the two in step.
//
//   Required    Date, Machine No., Operator, Process, Part Name (with Operation
//               Times set on the Part and at least one still ticked), Machine
//               ON/OFF Time, Actual Quantity, OK Quantity, Planned Operator
//               Shift (typed as decimal hours, not less than the Machine Shift).
//   Quantities  Actual can't be more than Ideal Quantity and OK can't be more than
//               Actual; Rejected = Actual − OK (shown, not typed) and the Rejection
//               Master split has to add up to it, with a remark when "Other" is
//               used (shared/quantity_rules.dart).
//   Times       Machine OFF after ON.
//   Downtime    Optional (blank counts as 0), 0–1440 each, total within the Machine
//               Shift (ON to OFF). "Others" needs a remark.
//   Non Working The machine did not run: only Date and Machine are asked for.

/// In the order the sheet lists them. Lunch / Rest has its own box beside
/// Planned Operator Shift and isn't in this group, though it counts toward the
/// total.
const List<String> rivetDowntimeKeys = [
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

/// Top to bottom, the way the form reads — the first key with an error is
/// where Save scrolls to.
const List<String> rivetFieldOrder = [
  'date',
  'machine',
  'operator',
  'processType',
  'itemName',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  'okQty',
  'rejectBreakdown',
  'rejectOtherRemark',
  'plannedOperatorShiftHours',
  'lunchMin',
  ...rivetDowntimeKeys,
  'stoppageTotal',
  'otherMinRemark',
];

/// The most stoppage an entry can account for: its whole ON–OFF Machine Shift in
/// minutes (entryValidation.js `stoppageLimitMin` — the web no longer subtracts
/// from Planned Operator Shift; the server checks the same). null until both
/// times are in.
double? rivetStoppageLimit(Map<String, dynamic> v) => spanMinutes(v['machineOnTime'], v['machineOffTime']);

int? _clock(Object? t) {
  final n = normalizeTime(t);
  return n == null || n.isEmpty ? null : int.parse(n.substring(0, 2)) * 60 + int.parse(n.substring(3, 5));
}

bool _timesUnchanged(Map<String, dynamic> v, Map<String, dynamic>? saved) =>
    saved != null &&
    normalizeTime(v['machineOnTime']) == normalizeTime(saved['machineOnTime']) &&
    normalizeTime(v['machineOffTime']) == normalizeTime(saved['machineOffTime']);

/// One block's values -> {fieldKey: message}. Empty map = ready to save.
Map<String, String> validateRivetEntry(Map<String, dynamic> v, {Map<String, dynamic>? saved}) {
  final errors = <String, String>{};
  final calc = rivetRowCalc(v);

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = 'Machine No. is required';
  // Non Working: the machine did not run, so nothing else is asked for.
  if (isNonWorking(v)) return errors;
  if (isBlank(v['operator'])) errors['operator'] = 'Operator is required';
  if (isBlank(v['processType'])) errors['processType'] = 'Process is required';
  if (isBlank(v['itemName'])) {
    errors['itemName'] = 'Part Name is required';
  } else {
    // The Operation Times are set on the Part itself; a part without them, or
    // with every operation unticked, has no cycle time to compute from.
    final cycle = calc['totalCycleSec'] as double?;
    if (!isNum(cycle) || cycle! <= 0) {
      errors['itemName'] = cycle == null
          ? 'This Part has no Operation Times set — edit it in Parts first'
          : 'Total Cycle Time must be more than 0 — untick fewer operations';
    }
  }

  for (final e in const [
    ['machineOnTime', 'Machine ON Time'],
    ['machineOffTime', 'Machine OFF Time'],
  ]) {
    final key = e[0];
    if (isBlank(v[key])) {
      errors[key] = '${e[1]} is required';
    } else if ((normalizeTime(v[key]) ?? '').isEmpty) {
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

  // Actual and OK are typed (Actual within Ideal, OK within Actual); Rejected = Actual − OK
  // and the Rejection Master split has to account for all of it.
  validateQuantities(v, calc, errors);

  // Planned Operator Shift is typed as decimal hours (60 minutes to the hour).
  final plannedParse = parseShiftHours(v['plannedOperatorShiftHours']);
  final planned = plannedParse.hours;
  if (isBlank(v['plannedOperatorShiftHours'])) {
    errors['plannedOperatorShiftHours'] = 'Planned Operator Shift is required';
  } else if (planned == null) {
    errors['plannedOperatorShiftHours'] = 'Enter hours as on the sheet, like 8.5 or 5.33';
  } else if (planned <= 0 || planned > 24) {
    errors['plannedOperatorShiftHours'] = 'Must be more than 0:00 and at most 24:00';
  } else {
    // Not while End isn't after Start: the span would wrap past midnight (23 h and
    // the like), and the End box already says what's wrong.
    final shiftMin = errors.containsKey('machineOffTime') ? null : spanMinutes(v['machineOnTime'], v['machineOffTime']);
    if (shiftMin != null && jsRound(planned * 60) < shiftMin) {
      errors['plannedOperatorShiftHours'] =
          "Planned Operator Shift can't be less than the Machine Shift (${hoursToHm(shiftMin / 60)})";
    }
  }

  // Lunch / Rest is optional, like every other stoppage box: blank counts as 0.
  final lunch = jsNumber(v['lunchMin']);
  if (!isBlank(v['lunchMin']) && (lunch == null || !lunch.isFinite || lunch < 0 || lunch > 1440)) {
    errors['lunchMin'] = '0–1440';
  }

  for (final key in rivetDowntimeKeys) {
    final n = jsNumber(v[key]);
    if (n != null && (!n.isFinite || n < 0 || n > 1440)) errors[key] = '0–1440';
  }
  final limit = rivetStoppageLimit(v);
  final total = calc['totalStoppageMin'] as double;
  if (limit != null && total > limit) {
    errors['stoppageTotal'] = 'Total stoppage is ${jsNumStr(total)} min but the Machine Shift is only ${jsNumStr(limit)} min';
  }
  if ((jsNumber(v['otherMin']) ?? 0) > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] = 'Remark is required when Others downtime is entered';
  }
  return errors;
}
