import 'dart:math' as math;

import '../../entry_form/entry_form_logic.dart';
import '../../shared/production_entry_validation.dart' show withDecimalPlanned;
import '../../shared/production_sheet_calc.dart';
import 'powder_calc.dart';
import 'powder_validation.dart';

/// What the After Powder Coating form derives from a block's values: the
/// shared caps, re-pointed at this sheet's rules (PowderCoatingEntryForm.jsx).
///
///  * Idle Time and Other Activity together have to fit in the Inspection
///    Working Hours (the allowance is the working hours themselves, not
///    Planned − working like CNC's stoppage).
///  * Total Qty is NOT capped at Ideal Inspection Quantity — a person can beat
///    the standard time; such an entry goes to OEE Review.
///  * The four defect counts can't add up to more than Total Qty.
class PowderMetrics extends EntryMetrics {
  PowderMetrics(super.values) : super(calcFn: powderRowCalc);

  double _n(Object? v) {
    final d = jsNumber(v);
    return (d == null || d.isNaN) ? 0.0 : d;
  }

  /// Idle Time + Other Activity, in minutes.
  double get away => totalStoppage + _n(values['otherActivityMin']);

  /// Minutes the Inspection Working Hours allow (null until Start / End are in).
  @override
  double? get stoppageLimit => powderStoppageLimit(values);

  @override
  bool get overStoppage => stoppageLimit != null && away > stoppageLimit!;

  /// What a minutes box (Other Activity, Lunch / Tea, Other idle) may still
  /// take: whatever of the working hours the other two haven't used, and the
  /// toast for typing past it.
  @override
  ({double max, String message}) minutesLimit(String key) {
    final limit = stoppageLimit;
    final room = limit == null ? 1440.0 : math.min(1440.0, math.max(0.0, limit - (away - _n(values[key]))));
    return (
      max: room,
      message: limit == null
          ? "Minutes can't be more than 1440 (a day)."
          : "Stoppage happens within the Inspection Working Hours, so all of it together can't be more than ${jsNumStr(limit)} min — only ${jsNumStr(room)} min left for this box.",
    );
  }

  /// Total Qty as typed (0 while blank / junk).
  double get totalQty => _n(values['actualQty']);

  double get defectsTyped => powderDefectKeys.fold<double>(0, (s, k) => s + _n(values[k]));

  /// What a defect box may still take: Total Qty less what the others hold.
  double defectRoom(String key) => math.max(0.0, totalQty - (defectsTyped - _n(values[key])));

  /// Whether the Total Qty box has anything typed (the defect caps apply then).
  bool get totalQtyTyped => !isBlankValue(values['actualQty']);

  /// Availability / Performance / Quality "as Save will work them out" — planned
  /// shift converted from its typed hours first — above 100% sends the entry to
  /// Admin review, so the form flags it.
  List<String> get metricsOver100 {
    final c = powderRowCalc(withDecimalPlanned(values));
    return [
      for (final (k, label) in const [('availability', 'Availability'), ('performance', 'Performance'), ('quality', 'Quality')])
        if (isNum(c[k]) && (c[k] as double) > 1 + 1e-9) label,
    ];
  }
}
