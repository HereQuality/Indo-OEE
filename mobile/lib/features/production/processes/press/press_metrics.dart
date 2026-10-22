import 'dart:math' as math;

import '../../entry_form/entry_form_logic.dart';
import '../../shared/production_sheet_calc.dart';
import 'press_calc.dart';

/// What the PRESS form derives from a block's values: the shared caps over the
/// PRESS formulas (the stoppage allowance is the Machine Shift itself, as in the
/// shared metrics).
class PressMetrics extends EntryMetrics {
  PressMetrics(super.values) : super(calcFn: pressRowCalc);

  static double _or0(double? v) => (v == null || v.isNaN || v == 0) ? 0.0 : v;

  /// OK + Rejected can't go past Ideal Quantity: each box may take what the
  /// other leaves. null (no ceiling) until Ideal Quantity is known.
  double? qtyRoom(String otherKey) {
    final ideal = idealQty;
    if (ideal == null) return null;
    return math.max(0.0, ideal - _or0(jsNumber(values[otherKey])));
  }

  /// The explanation of a blocked OK / Rejected keystroke (qtyNotice).
  String get qtyMessage => 'As per calculation, this machine can make at most ${fmtNum(idealQty)} pieces in this shift.';
}
