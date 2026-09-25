import 'package:flutter/material.dart';

import '../charts/chart_props.dart';
import 'sheet_kit.dart';

/// Port of client/src/Components/ProcessDashboard/WidgetPreview.jsx: the little
/// example picture on each option of the Customize sheet, so "B.D. Backup" or
/// "Unreported Time by MC No." can be recognised before it is switched on.
/// These are sketches of the chart's shape in the dashboard's own series
/// colours (light / dark aware) - not real data.

const double _w = 200;
const double _h = 84;

/// Series colour for a catalog `tone` ('ok' | 'reject' | 'downtime'); the first
/// series colour otherwise.
Color previewTone(DashboardColors c, String? tone) => switch (tone) {
      'reject' => c.reject,
      'downtime' => c.downtime,
      _ => c.ok,
    };

/// Thumbnail of one graph, drawn from its catalog entry (`preview`, `tone`).
class ChartPreview extends StatelessWidget {
  const ChartPreview({super.key, required this.chart, this.width = 84, this.height = 36});

  final Map<String, dynamic> chart;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    final colors = DashboardColors.of(context);
    final t = SheetTone.of(context);
    return ExcludeSemantics(
      child: Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: t.dark ? t.scheme.surfaceContainerLowest : t.scheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: t.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: CustomPaint(
          painter: SketchPainter(
            kind: '${chart['preview'] ?? ''}',
            color: previewTone(colors, chart['tone'] as String?),
            series: colors.series,
            grid: colors.grid,
          ),
        ),
      ),
    );
  }
}

/// A KPI tile's example: a tone dot and the sample figure, as the dashboard
/// shows it.
class StatPreview extends StatelessWidget {
  const StatPreview({super.key, required this.stat, this.width = 84, this.height = 36});

  final Map<String, dynamic> stat;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    final colors = DashboardColors.of(context);
    final t = SheetTone.of(context);
    final tone = stat['tone'] as String?;
    return ExcludeSemantics(
      child: Container(
        width: width,
        height: height,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: t.dark ? t.scheme.surfaceContainerLowest : t.scheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: t.border),
        ),
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (tone != null) ...[
                Container(width: 8, height: 8, decoration: BoxDecoration(color: previewTone(colors, tone), shape: BoxShape.circle)),
                const SizedBox(width: 5),
              ],
              Text('${stat['example'] ?? ''}', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: t.ink)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Draws one sketch on the 200 x 84 canvas of the web SVGs, scaled to fit.
class SketchPainter extends CustomPainter {
  const SketchPainter({required this.kind, required this.color, required this.series, required this.grid});

  final String kind;
  final Color color;
  final List<Color> series;
  final Color grid;

  Color _s(int i) => series[i % series.length];

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / _w, size.height / _h);
    switch (kind) {
      case 'lines':
        _lines(canvas);
      case 'hbars':
        _hbars(canvas, color);
      case 'vbars':
        _vbars(canvas, color);
      case 'stacked':
        _stacked(canvas);
      case 'stackedTime':
        _stackedTime(canvas);
      case 'treemap':
        _treemap(canvas);
      case 'nestedTreemap':
        _nestedTreemap(canvas);
      case 'funnel':
        _funnel(canvas, color);
      case 'multiples':
        _multiples(canvas);
      case 'table':
        _table(canvas);
      default:
        _vbars(canvas, color);
    }
    canvas.restore();
  }

  Paint _fill(Color c) => Paint()..color = c;

  Paint _stroke(Color c, double w) => Paint()
    ..color = c
    ..style = PaintingStyle.stroke
    ..strokeWidth = w
    ..strokeJoin = StrokeJoin.round
    ..strokeCap = StrokeCap.butt;

  void _rect(Canvas canvas, double x, double y, double w, double h, Color c, {double r = 0}) {
    final rect = Rect.fromLTWH(x, y, w, h);
    if (r <= 0) {
      canvas.drawRect(rect, _fill(c));
    } else {
      canvas.drawRRect(RRect.fromRectAndRadius(rect, Radius.circular(r)), _fill(c));
    }
  }

  void _line(Canvas canvas, double x1, double y1, double x2, double y2, double w) =>
      canvas.drawLine(Offset(x1, y1), Offset(x2, y2), _stroke(grid, w));

  void _baseline(Canvas canvas) => _line(canvas, 14, 74, _w - 8, 74, 1.5);

  void _poly(Canvas canvas, List<double> pts, Color c) {
    final path = Path()..moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) {
      path.lineTo(pts[i], pts[i + 1]);
    }
    canvas.drawPath(path, _stroke(c, 2.5));
  }

  void _lines(Canvas canvas) {
    for (final y in [20.0, 38.0, 56.0]) {
      _line(canvas, 14, y, _w - 8, y, 1);
    }
    _baseline(canvas);
    _poly(canvas, [14, 24, 40, 20, 66, 26, 92, 18, 118, 22, 144, 17, 170, 21, 192, 16], _s(0));
    _poly(canvas, [14, 36, 40, 31, 66, 38, 92, 30, 118, 35, 144, 29, 170, 34, 192, 28], _s(2));
    _poly(canvas, [14, 50, 40, 44, 66, 55, 92, 42, 118, 52, 144, 40, 170, 49, 192, 41], _s(1));
  }

  void _hbars(Canvas canvas, Color c) {
    _line(canvas, 52, 8, 52, 78, 1.5);
    const widths = [132.0, 104.0, 86.0, 60.0, 34.0];
    for (var i = 0; i < widths.length; i++) {
      _rect(canvas, 14, 12.0 + i * 14, 30, 5, grid, r: 2.5);
      _rect(canvas, 54, 10.0 + i * 14, widths[i], 9, c, r: 3);
    }
  }

  void _vbars(Canvas canvas, Color c) {
    _baseline(canvas);
    const heights = [52.0, 58.0, 46.0, 55.0, 40.0, 50.0];
    for (var i = 0; i < heights.length; i++) {
      _rect(canvas, 24.0 + i * 28, 74 - heights[i], 16, heights[i], c, r: 3);
    }
  }

  void _stacked(Canvas canvas) {
    _baseline(canvas);
    const bars = [
      [8.0, 18.0, 22.0, 8.0],
      [12.0, 24.0, 28.0, 12.0],
      [9.0, 20.0, 18.0, 6.0],
      [6.0, 12.0, 10.0, 5.0],
      [10.0, 22.0, 20.0, 12.0],
    ];
    for (var i = 0; i < bars.length; i++) {
      var y = 74.0;
      for (var j = 0; j < bars[i].length; j++) {
        y -= bars[i][j];
        _rect(canvas, 26.0 + i * 32, y, 20, bars[i][j] - 1, _s(j), r: j == bars[i].length - 1 ? 3 : 0);
      }
    }
  }

  void _stackedTime(Canvas canvas) {
    _baseline(canvas);
    const heights = [44.0, 52.0, 38.0, 56.0, 48.0, 42.0, 58.0, 50.0, 46.0];
    for (var i = 0; i < heights.length; i++) {
      _rect(canvas, 18.0 + i * 20, 74 - heights[i], 12, heights[i], _s(0));
      _rect(canvas, 18.0 + i * 20, 74 - heights[i] - 5, 12, 4, _s(1), r: 2);
    }
  }

  void _treemap(Canvas canvas) {
    const cells = [
      [14.0, 8.0, 96.0, 44.0],
      [14.0, 54.0, 96.0, 24.0],
      [112.0, 8.0, 44.0, 70.0],
      [158.0, 8.0, 34.0, 46.0],
      [158.0, 56.0, 34.0, 22.0],
    ];
    for (final c in cells) {
      _rect(canvas, c[0], c[1], c[2], c[3], _s(0), r: 3);
    }
  }

  // A treemap whose panels are split into two coloured slices: "machine, then cause".
  void _nestedTreemap(Canvas canvas) {
    const panels = [
      [14.0, 8.0, 96.0],
      [112.0, 8.0, 44.0],
      [158.0, 8.0, 34.0],
    ];
    for (var i = 0; i < panels.length; i++) {
      final x = panels[i][0], y = panels[i][1], w = panels[i][2];
      final h = 70.0 - i * 6;
      canvas.drawRect(Rect.fromLTWH(x, y, w, h), _stroke(grid, 1.5));
      _rect(canvas, x + 2, y + 2, w - 4, h * 0.6, _s(0));
      _rect(canvas, x + 2, y + 2 + h * 0.62, w - 4, h * 0.36, _s(2));
    }
  }

  // A wide band narrowing to a point.
  void _funnel(Canvas canvas, Color c) {
    const widths = [172.0, 148.0, 128.0, 108.0, 90.0, 72.0, 54.0, 36.0, 20.0];
    for (var i = 0; i < widths.length; i++) {
      _rect(canvas, (_w - widths[i]) / 2, 6.0 + i * 8, widths[i], 7, c);
    }
  }

  void _multiples(Canvas canvas) {
    const origins = [
      [14.0, 6.0],
      [108.0, 6.0],
      [14.0, 46.0],
      [108.0, 46.0],
    ];
    const bars = [10, 22, 8, 26, 14, 6, 18, 12];
    for (var p = 0; p < origins.length; p++) {
      final x = origins[p][0], y = origins[p][1];
      _line(canvas, x, y + 32, x + 80, y + 32, 1.5);
      for (var i = 0; i < bars.length; i++) {
        final h = ((bars[i] + p * 5) % 28).toDouble();
        _rect(canvas, x + 4 + i * 9.5, y + 32 - h, 5, h, _s(0), r: 1.5);
      }
    }
  }

  void _table(Canvas canvas) {
    _rect(canvas, 14, 8, _w - 28, 10, grid, r: 3);
    for (var r = 0; r < 4; r++) {
      _rect(canvas, 14, 27.0 + r * 14, 26, 5, _s(0), r: 2.5);
      for (var c = 0; c < 4; c++) {
        _rect(canvas, 66.0 + c * 32, 27.0 + r * 14, 18.0 + ((r + c) % 3) * 4, 5, grid, r: 2.5);
      }
    }
  }

  @override
  bool shouldRepaint(SketchPainter old) => old.kind != kind || old.color != color || old.grid != grid || old.series != series;
}
