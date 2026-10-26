import 'dart:math' as math;

import '../../entry_form/entry_form_logic.dart';
import '../../shared/production_sheet_calc.dart';
import 'fa_calc.dart';

/// What the FINAL ASSEMBLY form derives from a block's values
/// (FinalAssemblyEntryForm.jsx): Idle Time and Other Activity together within
/// the Working Hours; Total QTY NOT capped at Ideal (over-Ideal goes to OEE
/// Review); the four defect boxes together not more than Total QTY.
class FaMetrics extends EntryMetrics {
  FaMetrics(super.values) : super(calcFn: faRowCalc);

  double _n(Object? v) {
    final d = jsNumber(v);
    return (d == null || d.isNaN) ? 0.0 : d;
  }

  /// Idle Time + Other Activity, in minutes (web `awayMin`).
  double get away => totalStoppage + _n(values['otherActivityMin']);

  @override
  bool get overStoppage => stoppageLimit != null && away > stoppageLimit!;

  /// What an idle / other-activity box may still take, and the one-day toast.
  @override
  ({double max, String message}) minutesLimit(String key) {
    final limit = stoppageLimit;
    final room = limit == null ? 1440.0 : math.min(1440.0, math.max(0.0, limit - (away - _n(values[key]))));
    return (max: room, message: "Minutes can't be more than 1440 (a day).");
  }

  /// Total QTY as typed (0 while blank / junk).
  double get totalQty => _n(values['actualQty']);

  double _defect(String reason) {
    final rb = values['rejectBreakdown'];
    return _n(rb is Map ? rb[reason] : null);
  }

  /// What a defect box may still take: Total QTY less what the others hold.
  double defectRoom(String reason) {
    final d = calc['totalDefect'];
    final typed = (d is num && !d.isNaN) ? d.toDouble() : 0.0;
    return math.max(0.0, totalQty - (typed - _defect(reason)));
  }

  /// Whether the Total QTY box holds anything (the defect caps apply then).
  bool get totalQtyTyped => !isBlankValue(values['actualQty']);

  /// The "Other" defects are in use (their remark is asked for).
  bool get otherDefectUsed => _defect('Other') > 0;

  double? get shiftHours {
    final h = calc['shiftHours'];
    return isNum(h) ? (h as num).toDouble() : null;
  }
}
