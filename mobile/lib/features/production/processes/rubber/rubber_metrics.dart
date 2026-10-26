import 'dart:math' as math;

import '../../entry_form/entry_form_logic.dart';
import '../../shared/production_sheet_calc.dart';
import 'rubber_calc.dart';

/// What the RUBBER form derives from a block's values: the shared caps,
/// re-pointed at this sheet's rules (RubberEntryForm.jsx).
///
///  * All stoppage together (Lunch / Tea included) has to fit in the Worker
///    Shift Time — the shared allowance, worded for a worker.
///  * Actual Quantity is NOT capped at IDEAL Quantity — a person can beat the
///    standard time; such an entry goes to OEE Review. OK is capped at Actual
///    once Actual is typed, and not at all before (ProductionMasterFields with
///    `capByIdeal={false}`).
class RubberMetrics extends EntryMetrics {
  RubberMetrics(super.values) : super(calcFn: rubberRowCalc);

  double _n(Object? v) {
    final d = jsNumber(v);
    return (d == null || d.isNaN) ? 0.0 : d;
  }

  /// What a stoppage box may still take: whatever of the Worker Shift Time the
  /// others haven't used, and the toast for typing past it.
  @override
  ({double max, String message}) minutesLimit(String key) {
    final limit = stoppageLimit;
    final room = limit == null ? 1440.0 : math.min(1440.0, math.max(0.0, limit - (totalStoppage - _n(values[key]))));
    return (
      max: room,
      message: limit == null
          ? "Minutes can't be more than 1440 (a day)."
          : "Stoppage happens within the Worker Shift Time, so all of it together can't be more than ${jsNumStr(limit)} min.",
    );
  }

  /// Ceiling for OK Quantity: the typed Actual when it is a number — and no
  /// ceiling before that (Actual itself has none on this sheet).
  @override
  double? get okMax {
    final actual = entryNum(values['actualQty']);
    if (actual != null && !isBlankValue(values['actualQty'])) return actual;
    return null;
  }
}
