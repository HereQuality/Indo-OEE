import '../../entry_form/entry_form_logic.dart';
import '../../shared/production_sheet_calc.dart' show jsNumStr;
import 'injection_calc.dart';

/// What the INJECTION MOULDING form derives from a block: the shared caps
/// (TOTAL QTY. within Ideal Quantity rounded down, OK within TOTAL, every
/// downtime box within what the Machine Shift has left) over [injectionRowCalc],
/// plus this sheet's own grey figures.
class InjectionMetrics extends EntryMetrics {
  InjectionMetrics(super.values) : super(calcFn: injectionRowCalc);

  /// Ideal Quantity as the sheet shows it — not rounded down (`idealQty`, the
  /// cap on TOTAL QTY., is the whole number under it).
  Object? get idealQtyExact => calc['idealQtyExact'];

  /// Ideal Quantity/Hours = 3600 ÷ Standard Time per Piece.
  Object? get idealQtyPerHour => calc['idealQtyPerHour'];

  /// Why the downtime boxes take nothing more (phone-only; the web raises a popup
  /// when you type), in this sheet's "idle time" words.
  @override
  String get downtimeLockReason {
    final limit = stoppageLimit;
    if (limit == null || limit <= 0) return 'No idle time left — the Machine Shift is 0 min.';
    return 'No idle time left — all ${jsNumStr(limit)} min of the Machine Shift are used.';
  }
}
