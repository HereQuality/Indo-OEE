// Port of client/src/utils/finalAssemblyValidation.js — every rule the FINAL
// ASSEMBLY form enforces. Messages are the web's, word for word. Verified
// against the REAL JS by golden vectors (test/production/processes/final_assembly).
//
//   Status-only Any Working Status but PRESENT, or Non Working: only Date and
//               Worker Name.
//   Required    Date, Worker Name, Item Name, Start / End Time, Total QTY,
//               Planned Operator Shift (decimal hours, not less than the
//               Working Hours).
//   Optional    Standard Time per Piece (PACKING has none); a typed one is > 0.
//   Quantities  Types of Defects optional (blank = 0), together not more than
//               Total QTY; "Other" needs a remark. Total QTY MAY beat Ideal
//               (goes to OEE Review).
//   Times       End after Start. Overlapping times ARE allowed.
//   Idle / Other Activity  0–1440 each; Lunch + Other idle + Other Activity
//               within the Working Hours.

import '../../shared/production_entry_validation.dart' show cleanSplit, isBlank, stoppageLimitMin;
import '../../shared/production_sheet_calc.dart';
import '../../shared/shift_hours.dart';
import 'fa_calc.dart';

const List<String> faMinuteKeys = ['otherActivityMin', 'lunchMin', 'otherMin'];

/// Top to bottom, the way the form reads (FA_FIELD_ORDER).
const List<String> faFieldOrder = [
  'date',
  'machine',
  'workingStatus',
  'itemName',
  'vendor',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  'rejectBreakdown',
  'rejectOtherRemark',
  'otherActivity',
  'otherActivityMin',
  'plannedOperatorShiftHours',
  'lunchMin',
  'otherMin',
  'stoppageTotal',
  'otherMinRemark',
];

bool _isNum(double? v) => v != null && v.isFinite;
bool _isInt(double v) => v.isFinite && v == v.truncateToDouble();

int? _clock(Object? t) {
  final n = normalizeTime(t);
  return n == null ? null : int.parse(n.substring(0, 2)) * 60 + int.parse(n.substring(3));
}

bool _timesUnchanged(Map<String, dynamic> v, Map<String, dynamic>? saved) =>
    saved != null &&
    jsString(v['date'] ?? '') == jsString(saved['date'] ?? '') &&
    jsString(v['machine'] ?? '') == jsString(saved['machine'] ?? '') &&
    normalizeTime(v['machineOnTime']) == normalizeTime(saved['machineOnTime']) &&
    normalizeTime(v['machineOffTime']) == normalizeTime(saved['machineOffTime']);

/// JS `Object.values(v.rejectBreakdown || {})`.
Iterable<Object?> _defectValues(Object? rb) => rb is Map ? rb.values : (rb is List ? rb : const <Object?>[]);

/// One block's values → {fieldKey: message}. Empty = ready to save.
Map<String, String> validateFinalAssemblyEntry(Map<String, dynamic> v, {Map<String, dynamic>? saved}) {
  final errors = <String, String>{};
  final calc = faRowCalc(v);

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = '${FaLabels.worker} is required';
  if (isStatusOnly(v) || isNonWorking(v)) return errors;

  if (isBlank(v['itemName'])) errors['itemName'] = '${FaLabels.itemName} is required';
  // Optional — PACKING has none.
  final cycle = jsNumber(v['totalCycleSec']);
  if (!isBlank(v['totalCycleSec']) && (!_isNum(cycle) || cycle! <= 0)) {
    errors['totalCycleSec'] = 'Must be more than 0 — or leave it blank';
  }

  for (final (key, label) in const [
    ('machineOnTime', FaLabels.start),
    ('machineOffTime', FaLabels.end),
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
      errors['machineOffTime'] = '${FaLabels.end} must be after ${FaLabels.start}';
    }
  }

  // Total QTY is typed; the defects are optional and come out of it.
  final total = jsNumber(v['actualQty']);
  if (isBlank(v['actualQty'])) {
    errors['actualQty'] = '${FaLabels.totalQty} is required';
  } else if (!_isNum(total) || total! < 0 || !_isInt(total)) {
    errors['actualQty'] = 'Must be a whole number, 0 or more';
  }
  final bad = _defectValues(v['rejectBreakdown']).any((n) {
    if (isBlank(n)) return false;
    final x = jsToNumber(n);
    return !_isInt(x) || x < 0;
  });
  if (bad) {
    errors['rejectBreakdown'] = 'Defects must be whole numbers, 0 or more';
  } else {
    final d = defectTotal(v);
    final defects = (d == null || d.isNaN || d == 0) ? 0.0 : d;
    if (!errors.containsKey('actualQty') && defects > total!) {
      errors['rejectBreakdown'] =
          "${FaLabels.totalDefects} (${jsNumStr(defects)}) can't be more than ${FaLabels.totalQty} (${jsNumStr(total)})";
    }
  }
  if ((cleanSplit(v['rejectBreakdown'])['Other'] ?? 0) > 0 && isBlank(v['rejectOtherRemark'])) {
    errors['rejectOtherRemark'] = 'Remark is required when "Other" defects are entered';
  }

  // Planned Operator Shift is typed as decimal hours (5.33 = 5 h 20 min).
  final planned = parseShiftHours(v['plannedOperatorShiftHours']).hours;
  if (isBlank(v['plannedOperatorShiftHours'])) {
    errors['plannedOperatorShiftHours'] = 'Planned Operator Shift is required';
  } else if (planned == null) {
    errors['plannedOperatorShiftHours'] = 'Enter hours like 8.5 or 1.00';
  } else if (planned <= 0 || planned > 24) {
    errors['plannedOperatorShiftHours'] = 'Must be more than 0:00 and at most 24:00';
  } else {
    final shiftMin = errors.containsKey('machineOffTime') ? null : spanMinutes(v['machineOnTime'], v['machineOffTime']);
    if (shiftMin != null && jsRound(planned * 60) < shiftMin) {
      errors['plannedOperatorShiftHours'] =
          "Planned Operator Shift can't be less than the ${FaLabels.hours} (${hoursToHm(shiftMin / 60)})";
    }
  }

  // Idle Time and Other Activity are optional, like every downtime box: blank counts as 0.
  for (final key in faMinuteKeys) {
    final n = jsNumber(v[key]);
    if (n != null && (!n.isFinite || n < 0 || n > 1440)) errors[key] = '0–1440';
  }
  final limit = stoppageLimitMin(v);
  final ts = calc['totalStoppageMin'];
  final stop = (ts is num && !ts.isNaN && ts != 0) ? ts.toDouble() : 0.0;
  final act = jsNumber(v['otherActivityMin']);
  final away = stop + ((act == null || act.isNaN || act == 0) ? 0.0 : act);
  if (limit != null && away > limit) {
    errors['stoppageTotal'] = 'Idle Time + Other Activity is ${jsNumStr(away)} min but the ${FaLabels.hours} are only ${jsNumStr(limit)} min';
  }
  if ((jsNumber(v['otherActivityMin']) ?? 0) > 0 && isBlank(v['otherActivity'])) {
    errors['otherActivity'] = 'Say what the other activity was';
  }
  if ((jsNumber(v['otherMin']) ?? 0) > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] = 'Remark is required when Other idle time is entered';
  }
  return errors;
}
