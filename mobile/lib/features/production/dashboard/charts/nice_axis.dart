import 'dart:math' as math;

import 'package:intl/intl.dart';

/// A value axis rounded outward to "nice" steps.
class NiceAxis {
  const NiceAxis(this.lo, this.hi, this.step, this.ticks);
  final double lo;
  final double hi;
  final double step;
  final List<double> ticks;
}

/// Smallest 1 / 2 / 5 x 10^k that is >= [raw] (never below [minStep]).
double niceStep(double raw, {double minStep = 0}) {
  if (!(raw > 0) || !raw.isFinite) return math.max(1, minStep);
  var pow = math.pow(10, (math.log(raw) / math.ln10).floor()).toDouble();
  if (raw / pow >= 10) pow *= 10; // log10 rounding just under an exact power
  final f = raw / pow;
  final m = f <= 1 ? 1 : (f <= 2 ? 2 : (f <= 5 ? 5 : 10));
  return math.max(minStep, m * pow);
}

/// Port of charts.jsx `niceAxis`: rounds the axis every small-multiple panel
/// shares outward to a 1/2/5 x 10^k step (never finer than 1 minute) with 0
/// always on a tick, so labels read as whole numbers instead of raw floats.
NiceAxis niceAxis(double min, double max, int intervals) {
  final span = max - min;
  if (!(span > 0)) return const NiceAxis(0, 10, 5, [0, 5, 10]);
  final step = niceStep(span / intervals, minStep: 1);
  final lo = (min / step).floor() * step;
  final hi = (max / step).ceil() * step;
  final count = ((hi - lo) / step).round();
  return NiceAxis(lo, hi, step, [for (var i = 0; i <= count; i++) lo + i * step]);
}

/// Ticks for a value axis that starts at [lo] and ends at [hi] exactly (a
/// domain rule such as OEE's 0-100+), on a nice step near [intervals] parts.
NiceAxis fixedDomainAxis(double lo, double hi, int intervals) {
  final span = hi - lo;
  if (!(span > 0)) return NiceAxis(lo, lo + 1, 1, [lo, lo + 1]);
  final step = niceStep(span / intervals);
  final first = (lo / step).ceil();
  final last = (hi / step).floor();
  return NiceAxis(lo, hi, step, [for (var i = first; i <= last; i++) i * step]);
}

/// Whole-number tick label with grouping ("1,234", "-96").
String tickText(double v) {
  final r = v.round();
  return NumberFormat('#,##0').format(r == 0 ? 0 : r);
}

/// Every [n]-th label to show so that labels [labelWidth] wide (plus [gap])
/// never overlap when there is a slot of [pitch] px per data point.
int labelEvery(double labelWidth, double pitch, {double gap = 12}) {
  if (!(pitch > 0)) return 1;
  return math.max(1, ((labelWidth + gap) / pitch).ceil());
}

/// A 0-based axis up to [max] on a nice step, aiming at [intervals] parts.
NiceAxis niceMaxAxis(double max, int intervals) {
  if (!(max > 0) || !max.isFinite) return const NiceAxis(0, 1, 0.5, [0, 0.5, 1]);
  final step = niceStep(max / intervals);
  final count = (max / step).ceil();
  return NiceAxis(0, count * step, step, [for (var i = 0; i <= count; i++) i * step]);
}
