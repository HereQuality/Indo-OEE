import 'dart:math' as math;

import '../../entry_form/entry_form_logic.dart';
import '../../shared/production_sheet_calc.dart';
import 'rivet_calc.dart';
import 'rivet_validation.dart';

/// What the RIVET form derives from a block. The shared [EntryMetrics] still
/// allows Planned Operator Shift − Machine Shift of stoppage (the web's old
/// rule); the web (and the server) now allow the whole Machine Shift
/// (entryValidation.js `stoppageLimitMin`), so the allowance, every downtime
/// box's ceiling and the over-stoppage flag follow [rivetStoppageLimit] here.
class RivetMetrics extends EntryMetrics {
  RivetMetrics(super.values) : super(calcFn: rivetRowCalc);

  @override
  double? get stoppageLimit => rivetStoppageLimit(values);

  @override
  ({double max, String message}) minutesLimit(String key) {
    final limit = stoppageLimit;
    final room = limit == null
        ? 1440.0
        : math.min(1440.0, math.max(0.0, limit - (totalStoppage - (jsNumber(values[key]) ?? 0))));
    return (
      max: room,
      message: limit == null
          ? "Downtime can't be more than 1440 minutes (a day)."
          : "Stoppage happens within the Machine Shift, so all of it together can't be more than ${jsNumStr(limit)} min — only ${jsNumStr(room)} min left for this box.",
    );
  }

  @override
  String get downtimeLockReason {
    final limit = stoppageLimit;
    if (limit == null || limit <= 0) return 'No stoppage time left.';
    return 'No stoppage time left — all ${jsNumStr(limit)} min of the Machine Shift are used.';
  }
}
