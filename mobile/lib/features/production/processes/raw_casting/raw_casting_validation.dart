// Port of client/src/utils/rawCastingValidation.js — every rule the RAW CASTING
// form enforces (After Powder Coating's rules over this sheet's own fields).
// Messages are the web's, word for word. Verified against the REAL JS by golden
// vectors (test/production/processes/raw_casting).
//
//   Status-only Any Working Status but PRESENT, or Non Working: only Date and
//               Worker Name.
//   Required    Item Name, Standard Inspection Time (> 0), Inspection Start /
//               End Time, TOTAL QTY, Planned Operator Shift (decimal hours, not
//               less than the Working Hours). Vendor Name / Challan No. optional.
//   Quantities  TOTAL QTY and the three defects whole numbers, 0 or more; the
//               defects together not more than TOTAL. TOTAL MAY beat Ideal
//               (goes to OEE Review).
//   Times       End after Start; one worker's entries MAY overlap.
//   Idle / Other Activity  0–1440 each; together within the Working Hours.

import '../../shared/production_entry_validation.dart' show isBlank, stoppageLimitMin;
import '../../shared/production_sheet_calc.dart';
import '../../shared/shift_hours.dart';
import 'raw_casting_calc.dart';

const List<String> rawCastingMinuteKeys = ['otherActivityMin', 'lunchMin', 'otherMin'];

/// Top to bottom, the way the form reads (web `RAW_CASTING_FIELD_ORDER`).
const List<String> rawCastingFieldOrder = [
  'date',
  'machine',
  'workingStatus',
  'itemName',
  'vendor',
  'challanNo',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  'rejectBreakdown',
  'otherActivity',
  'otherActivityMin',
  'plannedOperatorShiftHours',
  'lunchMin',
  'otherMin',
  'stoppageTotal',
  'otherMinRemark',
];

bool _isNum(double? v) => v != null && v.isFinite;
bool _isInt(double v) => v == v.truncateToDouble();

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

/// One block's values → {fieldKey: message}. Empty = ready to save.
Map<String, String> validateRawCastingEntry(Map<String, dynamic> v, {Map<String, dynamic>? saved}) {
  final errors = <String, String>{};
  final calc = rawCastingRowCalc(v);

  if (isBlank(v['date'])) errors['date'] = 'Date is required';
  if (isBlank(v['machine'])) errors['machine'] = 'Worker Name is required';
  if (rawCastingIsStatusOnly(v) || isNonWorking(v)) return errors;

  if (isBlank(v['itemName'])) errors['itemName'] = 'Item Name is required';
  final cycle = jsNumber(v['totalCycleSec']);
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
    if (on != null && off != null && off <= on) errors['machineOffTime'] = 'Inspection End Time must be after Inspection Start Time';
  }

  // TOTAL QTY is typed; the defect counts are optional and come out of it.
  final total = jsNumber(v['actualQty']);
  if (isBlank(v['actualQty'])) {
    errors['actualQty'] = 'TOTAL QTY is required';
  } else if (!_isNum(total) || total! < 0 || !_isInt(total)) {
    errors['actualQty'] = 'Must be a whole number, 0 or more';
  }
  final split = v['rejectBreakdown'];
  if (rawCastingDefects.any((d) {
    final n = jsNumber(split is Map ? split[d] : null);
    return n != null && (!_isNum(n) || n < 0 || !_isInt(n));
  })) {
    errors['rejectBreakdown'] = 'Defects must be whole numbers, 0 or more';
  }
  final dt = rawCastingDefectTotal(v);
  final defects = (dt == null || dt.isNaN) ? 0.0 : dt;
  // JS `defects > total` with total null → 0; NaN → false.
  final totalCmp = total ?? 0;
  if (!errors.containsKey('actualQty') && !errors.containsKey('rejectBreakdown') && defects > totalCmp) {
    errors['rejectBreakdown'] = "Total Defects (${jsNumStr(defects)}) can't be more than TOTAL QTY (${jsString(total)})";
  }

  // Planned Operator Shift is typed as decimal hours like the sheet.
  final planned = parseShiftHours(v['plannedOperatorShiftHours']).hours;
  if (isBlank(v['plannedOperatorShiftHours'])) {
    errors['plannedOperatorShiftHours'] = 'Planned Operator Shift is required';
  } else if (planned == null) {
    errors['plannedOperatorShiftHours'] = 'Enter hours as on the sheet, like 7.75 or 2.67';
  } else if (planned <= 0 || planned > 24) {
    errors['plannedOperatorShiftHours'] = 'Must be more than 0:00 and at most 24:00';
  } else {
    final shiftMin = errors.containsKey('machineOffTime') ? null : spanMinutes(v['machineOnTime'], v['machineOffTime']);
    if (shiftMin != null && jsRound(planned * 60) < shiftMin) {
      errors['plannedOperatorShiftHours'] =
          "Planned Operator Shift can't be less than the Inspection Working Hours (${hoursToHm(shiftMin / 60)})";
    }
  }

  for (final key in rawCastingMinuteKeys) {
    final n = jsNumber(v[key]);
    if (n != null && (!n.isFinite || n < 0 || n > 1440)) errors[key] = '0–1440';
  }
  final limit = stoppageLimitMin(v);
  final ts = calc['totalStoppageMin'];
  final oa = jsNumber(v['otherActivityMin']);
  final away = ((ts is num && !ts.isNaN && ts != 0) ? ts.toDouble() : 0.0) + ((oa == null || oa.isNaN) ? 0.0 : oa);
  if (limit != null && away > limit) {
    errors['stoppageTotal'] =
        'Idle Time + Other Activity is ${jsNumStr(away)} min but the Inspection Working Hours are only ${jsNumStr(limit)} min';
  }
  if ((oa ?? 0) > 0 && isBlank(v['otherActivity'])) errors['otherActivity'] = 'Say what the other activity was';
  if ((jsNumber(v['otherMin']) ?? 0) > 0 && isBlank(v['otherMinRemark'])) {
    errors['otherMinRemark'] = 'Remark is required when Other idle time is entered';
  }
  return errors;
}
