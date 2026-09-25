import 'dart:math' as math;
import 'dart:ui';

/// One laid-out treemap cell; [index] points back at the input value.
class TreemapCell {
  const TreemapCell(this.index, this.rect);
  final int index;
  final Rect rect;
}

/// Squarified treemap (Bruls, Huizing, van Wijk): lays [values] out inside
/// [bounds] so cell areas are proportional to the values and cells stay as
/// close to square as possible. Non-positive / non-finite values get no cell.
/// The result keeps the input order of the cells that are placed; feed it the
/// values sorted descending for the classic look.
List<TreemapCell> squarify(List<double> values, Rect bounds) {
  final items = <(int, double)>[
    for (var i = 0; i < values.length; i++)
      if (values[i].isFinite && values[i] > 0) (i, values[i]),
  ];
  if (items.isEmpty || bounds.width <= 0 || bounds.height <= 0) return const [];
  final total = items.fold<double>(0, (s, e) => s + e.$2);
  final scale = bounds.width * bounds.height / total;
  // Areas in px^2.
  final areas = [for (final e in items) e.$2 * scale];

  final out = <TreemapCell>[];
  var rect = bounds;
  var start = 0;

  double worst(List<double> row, double side) {
    final sum = row.fold<double>(0, (s, a) => s + a);
    var maxA = 0.0;
    var minA = double.infinity;
    for (final a in row) {
      maxA = math.max(maxA, a);
      minA = math.min(minA, a);
    }
    final s2 = side * side;
    return math.max(s2 * maxA / (sum * sum), sum * sum / (s2 * minA));
  }

  while (start < items.length) {
    final shortSide = math.min(rect.width, rect.height);
    var end = start + 1;
    var row = <double>[areas[start]];
    while (end < items.length) {
      final next = [...row, areas[end]];
      if (worst(next, shortSide) <= worst(row, shortSide)) {
        row = next;
        end++;
      } else {
        break;
      }
    }
    final rowSum = row.fold<double>(0, (s, a) => s + a);
    final horizontal = rect.width >= rect.height; // lay the row along the short side
    if (horizontal) {
      final w = rowSum / rect.height;
      var y = rect.top;
      for (var i = 0; i < row.length; i++) {
        final h = row[i] / w;
        out.add(TreemapCell(items[start + i].$1, Rect.fromLTWH(rect.left, y, w, h)));
        y += h;
      }
      rect = Rect.fromLTRB(rect.left + w, rect.top, rect.right, rect.bottom);
    } else {
      final h = rowSum / rect.width;
      var x = rect.left;
      for (var i = 0; i < row.length; i++) {
        final w = row[i] / h;
        out.add(TreemapCell(items[start + i].$1, Rect.fromLTWH(x, rect.top, w, h)));
        x += w;
      }
      rect = Rect.fromLTRB(rect.left, rect.top + h, rect.right, rect.bottom);
    }
    start = end;
  }
  return out;
}
