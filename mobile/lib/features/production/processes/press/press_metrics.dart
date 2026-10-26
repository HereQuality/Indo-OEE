import '../../entry_form/entry_form_logic.dart';
import 'press_calc.dart';

/// What the PRESS form derives from a block's values: the shared caps (Actual
/// within Ideal, OK within Actual, the Rejection Master room, the stoppage
/// allowance = the Machine Shift itself) over the PRESS formulas.
class PressMetrics extends EntryMetrics {
  PressMetrics(super.values) : super(calcFn: pressRowCalc);
}
