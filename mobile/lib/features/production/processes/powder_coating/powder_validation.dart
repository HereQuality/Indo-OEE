// Port of client/src/utils/powderCoatingValidation.js — every rule the After
// Powder Coating form enforces (the Spring form's rules over this sheet's own
// fields). Messages are the web's, word for word; the time rules keep the
// wording `isTimeRuleMessage` matches. Verified against the REAL JS by golden
// vectors (test/production/processes/powder_coating).
//
//   Status-only Any Working Status but PRESENT (ABSENT, SUNDAY, …), or Non
//               Working: only Date and Worker Name.
//   Required    Date, Worker Name, Item Name, Standard Inspection Time per
//               Piece (> 0), Inspection Start / End Time, Total Qty, Planned
//               Operator Shift (typed H.MM, not less than the Working Hours).
//   Quantities  Defect counts optional, together not more than Total Qty. Total
//               Qty MAY beat Ideal Inspection Quantity (goes to OEE Review).
//   Times       Inspection End after Start.
//   Idle / Other Activity  0–1440 each; Lunch + Other idle + Other Activity
//               within the Inspection Working Hours.

import '../../shared/production_entry_validation.dart' show isBlank;
import '../../shared/production_sheet_calc.dart';
import '../../shared/shift_hours.dart';
import 'powder_calc.dart';

const List<String> powderMinuteKeys = ['otherActivityMin', 'lunchMin', 'otherMin'];

/// Top to bottom, the way the form reads — the first key with an error is
/// where Save scrolls to.
final List<String> powderFieldOrder = [
  'date',
  'machine',
  'workingStatus',
  'itemName',
  'vendor',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  ...powderDefectKeys,
  'otherActivity',
  'otherActivityMin',
  'plannedOperatorShiftHours',
  'lunchMin',
  'otherMin',
  'stoppageTotal',
  'otherMinRemark',
];

/// The most Idle Time + Other Activity can add up to: the Inspection Working
/// Hours in minutes (the web's `stoppageLimitMin`). null until both times are usable.
double? powderStoppageLimit(Map<String, dynamic> v) => spanMinutes(v['machineOnTime'], v['machineOffTime']);

double? _num(Object? v) => jsNumber(v);
bool _isNum(double? v) => v != null && v.isFinite;

int? _clock(Object? t) {
  final n = normalizeTime(t);
  return n == null ? null : int.parse(n.substring(0, 2)) * 60 + int.parse(n.substring(3));
}

// An older row that already breaks a time rule stays editable.
bool _timesUnchanged(Map<String, dynamic> v, Map<String, dynamic>? saved) =>
    saved != null &&
    normalizeTime(v['machineOnTime']) == normalizeTime(saved['machineOnTime']) &&
    normalizeTime(v['machineOffTime']) == normalizeTime(saved['machineOffTime']);

/// One block's values → {fieldKey: message}. Empty = ready to save.
Map<String, String> validatePowderEntry(Map<String, dynamic> v, {Map<String, dynamic>? saved}) {
  final errors = <String, String>{};
  final calc = powderRowCalc(v);

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = 'Worker Name is required';
  // ABSENT, SUNDAY, … — a day with no inspection records just its status.
  if (isStatusOnly(v) || isNonWorking(v)) return errors;

  if (isBlank(v['itemName'])) errors['itemName'] = 'Item Name is required';
  final cycle = _num(v['totalCycleSec']);
  if (isBlank(v['totalCycleSec'])) {
    errors['totalCycleSec'] = 'Standard Inspection Time per Piece is required';
  } else if (!_isNum(cycle) || cycle! <= 0) {
    errors['totalCycleSec'] = 'Must be more than 0';
  }

  for (final (key, label) in const [
    ('machineOnTime', 'Inspection Start Time'),
    ('machineOffTime', 'Inspection End Time'),
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
      errors['machineOffTime'] = 'Inspection End Time must be after Inspection Start Time';
    }
  }

  // Total Qty is typed; the defect counts are optional and come out of it.
  final total = _num(v['actualQty']);
  if (isBlank(v['actualQty'])) {
    errors['actualQty'] = 'Total Qty is required';
  } else if (!_isNum(total) || total! < 0) {
    errors['actualQty'] = 'Must be 0 or more';
  }
  for (final k in powderDefectKeys) {
    final n = _num(v[k]);
    if (n != null && (!_isNum(n) || n < 0)) errors[k] = 'Must be 0 or more';
  }
  final defects = defectTotal(v) ?? 0;
  if (!errors.containsKey('actualQty') && defects > total!) {
    errors['actualQty'] =
        "Total Defect / Rework (${jsNumStr(defects)}) can't be more than Total Qty (${jsNumStr(total)})";
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
      errors['plannedOperatorShiftHours'] =
          "Planned Operator Shift can't be less than the Inspection Working Hours (${hoursToHm(shiftMin / 60)})";
    }
  }

  // Idle Time and Other Activity are optional, like every downtime box: blank counts as 0.
  for (final key in powderMinuteKeys) {
    final n = _num(v[key]);
    if (n != null && (!n.isFinite || n < 0 || n > 1440)) errors[key] = '0–1440';
  }
  final limit = powderStoppageLimit(v);
  final totalStoppage = calc['totalStoppageMin'] as double? ?? 0;
  final away = (totalStoppage == 0 || totalStoppage.isNaN ? 0.0 : totalStoppage) + _or0(_num(v['otherActivityMin']));
  if (limit != null && away > limit) {
    errors['stoppageTotal'] =
        'Idle Time + Other Activity is ${jsNumStr(away)} min but the Inspection Working Hours are only ${jsNumStr(limit)} min';
  }
  if ((_num(v['otherActivityMin']) ?? 0) > 0 && isBlank(v['otherActivity'])) {
    errors['otherActivity'] = 'Say what the other activity was';
  }
  if ((_num(v['otherMin']) ?? 0) > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] = 'Remark is required when Other idle time is entered';
  }
  return errors;
}

double _or0(double? v) => (v == null || v.isNaN) ? 0.0 : v;
