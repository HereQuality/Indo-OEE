import '../../entry_form/entry_form_logic.dart';
import '../../shared/production_sheet_calc.dart' show jsNumStr;
import 'embossing_calc.dart';

/// What the EMBOSSING form derives from a block: OK within TOTAL and every
/// downtime box within what the Machine Shift has left, over [embossingRowCalc],
/// plus this sheet's own grey figures. TOTAL QTY. is NOT capped at Ideal
/// Quantity (web `capByIdeal: false`): past it the entry goes to OEE Review.
class EmbossingMetrics extends EntryMetrics {
  EmbossingMetrics(super.values) : super(calcFn: embossingRowCalc);

  /// Ideal Quantity as the sheet shows it — not rounded down, and not a cap.
  Object? get idealQtyExact => calc['idealQtyExact'];

  /// Ideal Quantity/Hours = 3600 ÷ Standard Time per Piece.
  Object? get idealQtyPerHour => calc['idealQtyPerHour'];

  /// OK QTY's ceiling: the typed TOTAL QTY when it is a number, else none (the
  /// web's `capByIdeal: false` — Ideal never caps a box on this sheet).
  @override
  double? get okMax {
    final total = entryNum(values['actualQty']);
    return (total != null && !isBlankValue(values['actualQty'])) ? total : null;
  }

  /// Why the downtime boxes take nothing more (phone-only; the web raises a popup
  /// when you type), in this sheet's "idle time" words.
  @override
  String get downtimeLockReason {
    final limit = stoppageLimit;
    if (limit == null || limit <= 0) return 'No idle time left — the Machine Shift is 0 min.';
    return 'No idle time left — all ${jsNumStr(limit)} min of the Machine Shift are used.';
  }
}
