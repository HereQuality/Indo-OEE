import '../../entry_form/entry_form_logic.dart';
import '../../shared/production_sheet_calc.dart' show jsNumStr;
import 'mfd_calc.dart';

/// What the MODULAR FRAME DRILLING form derives from a block: the shared caps
/// (Actual within the IDEAL Quantity — Lunch / Tea out — rounded down, OK
/// within Actual, every downtime box within what the Machine Shift has left)
/// over [mfdRowCalc], plus this sheet's own grey figures.
class MfdMetrics extends EntryMetrics {
  MfdMetrics(super.values) : super(calcFn: mfdRowCalc);

  /// IDEAL Quantity as the sheet keeps it — unrounded (`idealQty`, the cap, is
  /// the whole number under it).
  Object? get idealQtyExact => calc['idealQtyExact'];

  /// IDEAL Quantity/Hour = IDEAL Quantity ÷ Machine Shift hours.
  Object? get idealQtyPerHour => calc['idealQtyPerHour'];

  /// Efficiency (%) = Effective Machine Run Time ÷ Machine Shift hours.
  Object? get efficiency => calc['efficiency'];

  @override
  String get downtimeLockReason {
    final limit = stoppageLimit;
    if (limit == null || limit <= 0) return 'No downtime left — the Machine Shift is 0 min.';
    return 'No downtime left — all ${jsNumStr(limit)} min of the Machine Shift are used.';
  }
}
