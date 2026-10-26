import 'dart:math' as math;

import '../../entry_form/entry_form_logic.dart';
import '../../shared/production_sheet_calc.dart';
import 'bpc_calc.dart';

/// What the BEFORE POWDER COATING form derives from a block's values: the shared
/// figures over [bpcRowCalc] (unrounded Ideal Quantity, Effective on TOTAL QTY),
/// with the idle boxes' caps worded as BpcEntryForm.jsx words them.
///
///  * Setup + B.D. + Lunch / Tea + Other together have to fit in the Machine
///    Shift Time (the allowance is the shift itself).
///  * TOTAL QTY is NOT capped at Ideal Quantity — an operator can beat the
///    standard time; such an entry goes to OEE Review.
class BpcMetrics extends EntryMetrics {
  BpcMetrics(super.values) : super(calcFn: bpcRowCalc);

  /// What an idle box may still take: whatever of the Machine Shift Time the
  /// others haven't used (web `minutesBox`), and the toast for typing past it
  /// before the times are in (afterwards the stoppage popup speaks instead).
  @override
  ({double max, String message}) minutesLimit(String key) {
    final limit = stoppageLimit;
    final own = jsNumber(values[key]);
    final ownMin = (own == null || own.isNaN) ? 0.0 : own;
    final room = limit == null ? 1440.0 : math.min(1440.0, math.max(0.0, limit - (totalStoppage - ownMin)));
    return (
      max: room,
      message: limit == null
          ? "Minutes can't be more than 1440 (a day)."
          : "Stoppage happens within the Machine Shift Time, so all of it together can't be more than ${jsNumStr(limit)} min.",
    );
  }

  /// The Part's own Standard Time per Piece (null when it has none) — shown as a
  /// hint once this entry's box differs from it.
  double? partCycle(List<Map<String, dynamic>> items) {
    final it = entryItemFor(values, items);
    final n = it?['totalCycleSec'];
    if (n == null || n == '') return null;
    final d = jsToNumber(n);
    return d.isFinite ? d : null;
  }

  /// Other idle time is in use (its remark is then required).
  bool get otherIdleUsed => jsToNumber(values['otherMin']) > 0;
}
