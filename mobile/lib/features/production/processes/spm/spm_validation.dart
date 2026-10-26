import '../../shared/production_entry_validation.dart' show isBlank, withDecimalPlanned;
import '../../shared/production_sheet_calc.dart';
import '../../shared/quantity_rules.dart';
import '../../shared/shift_hours.dart';
import '../../sheet/sheet_model.dart' show Json;
import 'spm_calc.dart';

/// Port of client/src/utils/spmValidation.js — every rule the SPM Data Entry
/// form enforces: the CNC sheet's rules over SPM's fields. (The machine /
/// operator overlap checks are the shared ones in `production_entry_validation.dart`.)
///
///   Required   Date, Machine No., Operator, Part Name (whose own operation times
///              and reference figures must be set in Parts, with at least one
///              operation still ticked), Machine ON/OFF Time, Actual Quantity,
///              OK Quantity, Planned Operator Shift (decimal hours, not less than the
///              Machine Shift). A Non Working entry only needs Date and Machine.
///   Quantities Actual and OK are typed (Rejected = Actual − OK): Actual can't be more
///              than Ideal Quantity, OK can't be more than Actual, and the Rejection
///              Master split has to add up to Rejected ("Other" needs a remark).
///   Times      Machine OFF after ON.
///   Downtime   Optional, 0–1440 each, the total within the Machine Shift. "Others"
///              needs a remark.

/// In the order the sheet lists them. Lunch / Rest has its own box beside
/// Planned Operator Shift and is not in this group, though it counts too.
const List<String> spmDowntimeKeys = [
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
const List<String> spmFieldOrder = [
  'date',
  'machine',
  'operator',
  'itemName',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  'okQty',
  'rejectBreakdown',
  'rejectOtherRemark',
  'plannedOperatorShiftHours',
  'lunchMin',
  ...spmDowntimeKeys,
  'stoppageTotal',
  'otherMinRemark',
];

/// Web `isNonWorking`: the machine did not run, so nothing else is asked for.
bool spmIsNonWorking(Json? v) => v?['workingMode'] == 'Non Working';

/// Web `stoppageLimitMin`: the most stoppage an entry can account for — the
/// Machine Shift itself (stoppage happens inside the machine's own ON–OFF span).
/// null until both times are usable. [v] may hold the typed or the decimal planned
/// shift; it is not read.
double? spmStoppageLimit(Json v) => spanMinutes(v['machineOnTime'], v['machineOffTime']);

int? _clock(Object? t) {
  final n = normalizeTime(t);
  return n == null ? null : int.parse(n.substring(0, 2)) * 60 + int.parse(n.substring(3, 5));
}

// Same only-when-changed rule as the CNC sheet: an older row that already breaks
// a time rule stays editable.
bool _timesUnchanged(Json v, Json? saved) =>
    saved != null &&
    jsString(v['date'] ?? '') == jsString(saved['date'] ?? '') &&
    jsString(v['machine'] ?? '') == jsString(saved['machine'] ?? '') &&
    normalizeTime(v['machineOnTime']) == normalizeTime(saved['machineOnTime']) &&
    normalizeTime(v['machineOffTime']) == normalizeTime(saved['machineOffTime']);

/// One block's values -> {fieldKey: message}. Empty map = ready to save. Keys are
/// inserted in the web's order. [saved] (edit mode) is the row's times as loaded.
Map<String, String> validateSpmEntry(Json v, {Json? saved}) {
  final errors = <String, String>{};
  final c = spmRowCalc(v);
  final cycle = c['totalCycleSec'] as double?;

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = 'Machine No. is required';
  // Non Working: the machine did not run, so nothing else is asked for.
  if (spmIsNonWorking(v)) return errors;
  if (isBlank(v['operator'])) errors['operator'] = 'Operator is required';
  if (isBlank(v['itemName'])) {
    errors['itemName'] = 'Part Name is required';
  } else if (!isNum(cycle) || cycle! <= 0) {
    // The operations are set on the Part itself; an older part may lack them, or
    // every operation here has been unticked — no cycle time to compute from.
    errors['itemName'] = cycle == null
        ? 'This Part has no Operation Times set — edit it in Parts first'
        : 'Total Cycle Time must be more than 0 — untick fewer operations';
  } else if (!errors.containsKey('itemName') && [v['noOfHoles'], v['piecesPerCycle'], v['strokeRequired']].any(isBlank)) {
    errors['itemName'] =
        'This Part is missing No. of Holes / No. of Piece in One Cycle / Stroke Required — edit it in Parts first';
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

  // Actual and OK are typed; Rejected = Actual − OK is split across the Rejection Master.
  validateQuantities(v, c, errors);

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
    // Not while End isn't after Start: the span would wrap past midnight (23 h and the
    // like), and the End box already says what's wrong.
    final shiftMin = errors.containsKey('machineOffTime') ? null : spanMinutes(v['machineOnTime'], v['machineOffTime']);
    if (shiftMin != null && jsRound(planned * 60) < shiftMin) {
      errors['plannedOperatorShiftHours'] = "Planned Operator Shift can't be less than the Machine Shift (${hoursToHm(shiftMin / 60)})";
    }
  }
  final decimal = withDecimalPlanned(v);

  // Lunch / Rest is optional, like every other stoppage box: blank counts as 0.
  final lunch = jsNumber(v['lunchMin']);
  if (!isBlank(v['lunchMin']) && (lunch == null || !lunch.isFinite || lunch < 0 || lunch > 1440)) errors['lunchMin'] = '0–1440';

  for (final key in spmDowntimeKeys) {
    final n = jsNumber(v[key]);
    if (n != null && (!n.isFinite || n < 0 || n > 1440)) errors[key] = '0–1440';
  }
  final limit = spmStoppageLimit(decimal);
  final totalStoppage = c['totalStoppageMin'] as double;
  if (limit != null && totalStoppage > limit) {
    errors['stoppageTotal'] = 'Total stoppage is ${jsNumStr(totalStoppage)} min but the Machine Shift is only ${jsNumStr(limit)} min';
  }
  if ((jsNumber(v['otherMin']) ?? 0) > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] = 'Remark is required when Others downtime is entered';
  }
  return errors;
}
