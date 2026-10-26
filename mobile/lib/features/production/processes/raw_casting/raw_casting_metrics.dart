import 'dart:math' as math;

import '../../entry_form/entry_form_logic.dart';
import '../../shared/production_sheet_calc.dart';
import 'raw_casting_calc.dart';

/// What the RAW CASTING form derives from a block's values
/// (RawCastingEntryForm.jsx): Idle Time and Other Activity together within the
/// Inspection Working Hours; TOTAL QTY not capped at Ideal (over-Ideal goes to
/// OEE Review); the three defects can't add up to more than TOTAL QTY.
class RawCastingMetrics extends EntryMetrics {
  RawCastingMetrics(super.values) : super(calcFn: rawCastingRowCalc);

  double _n(Object? v) {
    final d = jsNumber(v);
    return (d == null || d.isNaN) ? 0.0 : d;
  }

  /// Idle Time + Other Activity, in minutes.
  double get away => totalStoppage + _n(values['otherActivityMin']);

  @override
  bool get overStoppage => stoppageLimit != null && away > stoppageLimit!;

  /// What a minutes box (Other Activity, Lunch / Tea, Other idle) may still take,
  /// and the toast for typing past it before the times are in.
  @override
  ({double max, String message}) minutesLimit(String key) {
    final limit = stoppageLimit;
    final room = limit == null ? 1440.0 : math.min(1440.0, math.max(0.0, limit - (away - _n(values[key]))));
    return (
      max: room,
      message: limit == null
          ? "Minutes can't be more than 1440 (a day)."
          : "Stoppage happens within the Inspection Working Hours, so all of it together can't be more than ${jsNumStr(limit)} min.",
    );
  }

  /// TOTAL QTY as typed (0 while blank / junk).
  double get totalQty => _n(values['actualQty']);

  double _defect(String d) {
    final s = values['rejectBreakdown'];
    return _n(s is Map ? s[d] : null);
  }

  double get defectsTyped => rawCastingDefects.fold<double>(0, (s, d) => s + _defect(d));

  /// What a defect box may still take: TOTAL QTY less what the others hold.
  double defectRoom(String d) => math.max(0.0, totalQty - (defectsTyped - _defect(d)));

  /// Whether TOTAL QTY has anything typed (the defect caps apply then).
  bool get totalQtyTyped => !isBlankValue(values['actualQty']);

  /// The Part's own Standard Inspection Time (null when it has none).
  double? partCycle(List<Map<String, dynamic>> items) {
    final n = entryItemFor(values, items)?['totalCycleSec'];
    if (n == null || n == '') return null;
    final d = jsToNumber(n);
    return d.isFinite ? d : null;
  }
}
