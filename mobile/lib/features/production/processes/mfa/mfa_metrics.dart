import 'dart:math' as math;

import '../../entry_form/entry_form_logic.dart';
import '../../shared/production_sheet_calc.dart';
import 'mfa_calc.dart';

/// What the MODULAR FRAME ASSEMBLY form derives from a block's values
/// (MfaEntryForm.jsx):
///
///  * Idle Time and Other Activity together have to fit in the Assembly
///    Working Hours.
///  * TOTAL QTY is NOT capped at the Ideal Assembly Quantity (over-Ideal goes
///    to OEE Review); OK is capped at TOTAL once TOTAL is typed.
class MfaMetrics extends EntryMetrics {
  MfaMetrics(super.values) : super(calcFn: mfaRowCalc);

  double _n(Object? v) {
    final d = jsNumber(v);
    return (d == null || d.isNaN) ? 0.0 : d;
  }

  /// Idle Time + Other Activity, in minutes.
  double get away => totalStoppage + _n(values['otherActivityMin']);

  @override
  bool get overStoppage => stoppageLimit != null && away > stoppageLimit!;

  @override
  ({double max, String message}) minutesLimit(String key) {
    final limit = stoppageLimit;
    final room = limit == null ? 1440.0 : math.min(1440.0, math.max(0.0, limit - (away - _n(values[key]))));
    return (
      max: room,
      message: limit == null
          ? "Minutes can't be more than 1440 (a day)."
          : "Stoppage happens within the $mfaHours, so all of it together can't be more than ${jsNumStr(limit)} min.",
    );
  }

  @override
  double? get okMax {
    final actual = entryNum(values['actualQty']);
    if (actual != null && !isBlankValue(values['actualQty'])) return actual;
    return null;
  }
}
