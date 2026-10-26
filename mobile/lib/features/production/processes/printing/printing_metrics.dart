import 'dart:math' as math;

import '../../entry_form/entry_form_logic.dart';
import '../../shared/production_sheet_calc.dart';
import 'printing_calc.dart';

/// What the PRINTING form derives from a block's values (PrintingEntryForm.jsx):
/// the shared caps over this sheet's own figures (printingRowCalc — all 13
/// downtime columns in Total Idle Time, Ideal Quantity unrounded beside the
/// rounded-down cap). Only the downtime boxes' one-day toast is worded the
/// sheet's way.
class PrintingMetrics extends EntryMetrics {
  PrintingMetrics(super.values) : super(calcFn: printingRowCalc);

  /// What a downtime box may still take: whatever of the Machine Shift Time
  /// the others haven't used (web `minutesBox`), and the toast for typing past
  /// 1440 before the times are in. Past the Machine Shift the form raises the
  /// stoppage popup instead (printing_lines.dart).
  @override
  ({double max, String message}) minutesLimit(String key) {
    final limit = stoppageLimit;
    final own = jsNumber(values[key]);
    final room = limit == null
        ? 1440.0
        : math.min(1440.0, math.max(0.0, limit - (totalStoppage - ((own == null || own.isNaN) ? 0.0 : own))));
    return (
      max: room,
      message: limit == null
          ? "Minutes can't be more than 1440 (a day)."
          : "Stoppage happens within the Machine Shift Time, so all of it together can't be more than ${jsNumStr(limit)} min.",
    );
  }

  /// The Machine Shift Time in decimal hours (null until ON / OFF are in).
  double? get shiftHours {
    final h = calc['shiftHours'];
    return isNum(h) ? (h as num).toDouble() : null;
  }
}
