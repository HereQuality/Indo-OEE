import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import '../dashboard_engine.dart' as eng;
import 'chart_data.dart';
import 'chart_kit.dart';
import 'chart_props.dart';
import 'hbars.dart' show BarDatum;
import 'mini_table.dart';
import 'treemap_layout.dart';

/// Effective Machine Run Time by MC No.: a treemap — each machine's area is
/// its share of the run time. fl_chart has no treemap, so the squarified
/// layout (treemap_layout.dart) is painted on a canvas and hit-tested here.
/// Tap a tile to cross-filter that machine; press and hold for its exact
/// figure. Labels are drawn only on tiles big enough to hold them.
class RunTimeTreemapChart extends StatefulWidget {
  const RunTimeTreemapChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  State<RunTimeTreemapChart> createState() => _RunTimeTreemapChartState();
}

class _RunTimeTreemapChartState extends State<RunTimeTreemapChart> {
  final _memo = DataMemo<List<BarDatum>>();

  @override
  Widget build(BuildContext context) {
    final p = widget.props;
    final rows = p.rowsFor('machine');
    final bars = _memo.get(rows, p.ctx, 'machine', () => dimBars(rows, 'machine', p.ctx, (s) => pick(s, 'effectiveHours')));
    if (bars.isEmpty) return const ChartEmpty('Needs cycle time and OK quantity.');
    final selected = p.filters['machine'] ?? const <String>[];
    if (p.view == ChartView.table) {
      return MiniTable(
        columns: const ['Machine', 'Effective run time'],
        rows: [for (final d in bars) MiniRow(d.key, [d.label, eng.formatExact('hours', d.value)])],
        selected: selected,
        onRowClick: (k) => p.onToggle('machine', k),
        colors: p.colors,
      );
    }
    return ChartTextScope(
      child: Semantics(
        container: true,
        label: 'Effective run time by machine, ${bars.length} machines',
        child: TreemapView(
          bars: bars,
          selected: selected,
          colors: p.colors,
          valueLabel: 'Effective run time',
          format: 'hours',
          onSelect: (k) => p.onToggle('machine', k),
        ),
      ),
    );
  }
}

/// The interactive treemap (chart only). [bars] must be sorted largest first.
class TreemapView extends StatefulWidget {
  const TreemapView({
    super.key,
    required this.bars,
    required this.selected,
    required this.colors,
    required this.valueLabel,
    required this.format,
    required this.onSelect,
  });

  final List<BarDatum> bars;
  final List<String> selected;
  final DashboardColors colors;
  final String valueLabel;
  final String format;
  final void Function(String key) onSelect;

  @override
  State<TreemapView> createState() => _TreemapViewState();
}

class _TreemapViewState extends State<TreemapView> {
  List<BarDatum>? _bars;
  Size? _size;
  List<TreemapCell> _cells = const [];
  int? _pressed; // index into bars while a long press is held

  List<TreemapCell> _layout(Size size) {
    if (!identical(_bars, widget.bars) || _size != size) {
      _cells = squarify([for (final b in widget.bars) b.value], Offset.zero & size);
      _bars = widget.bars;
      _size = size;
    }
    return _cells;
  }

  TreemapCell? _hit(Offset pos) {
    for (final cell in _cells.reversed) {
      if (cell.rect.contains(pos)) return cell;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.colors;
    return LayoutBuilder(
      builder: (context, box) {
        final size = stageSize(box);
        final cells = _layout(size);
        final scaler = MediaQuery.textScalerOf(context);
        final gap = chartSurface(context);
        final nameStyle = chartText(context, size: 12, color: Colors.white, weight: FontWeight.w700, tabular: false);
        final valueStyle = chartText(context, size: 11, color: Colors.white);
        final painter = _TreemapPainter(
          cells: cells,
          bars: widget.bars,
          selected: widget.selected,
          colors: c,
          scaler: scaler,
          nameStyle: nameStyle,
          valueStyle: valueStyle,
          dimmedText: c.axis,
          gap: gap,
          pressed: _pressed,
          format: widget.format,
        );

        TreemapCell? pressedCell;
        if (_pressed != null) {
          for (final cell in cells) {
            if (cell.index == _pressed) pressedCell = cell;
          }
        }

        return SizedBox(
          width: size.width,
          height: size.height,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTapUp: (d) {
              final hit = _hit(d.localPosition);
              if (hit != null) {
                chartHaptic();
                widget.onSelect(widget.bars[hit.index].key);
              }
            },
            onLongPressStart: (d) => setState(() => _pressed = _hit(d.localPosition)?.index),
            onLongPressMoveUpdate: (d) {
              final i = _hit(d.localPosition)?.index;
              if (i != _pressed) setState(() => _pressed = i);
            },
            onLongPressEnd: (_) => setState(() => _pressed = null),
            onLongPressCancel: () => setState(() => _pressed = null),
            child: Stack(
              children: [
                Positioned.fill(child: CustomPaint(painter: painter)),
                if (pressedCell != null)
                  Positioned.fill(
                    child: IgnorePointer(
                      child: CustomSingleChildLayout(
                        delegate: _TipLayout(pressedCell.rect),
                        child: ChartTooltipCard(
                          colors: c,
                          title: widget.bars[pressedCell.index].label,
                          lines: [TooltipLine(widget.valueLabel, value: eng.formatExact(widget.format, widget.bars[pressedCell.index].value))],
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Places the tooltip above the pressed tile (below when there is no room),
/// kept inside the stage.
class _TipLayout extends SingleChildLayoutDelegate {
  _TipLayout(this.anchor);
  final Rect anchor;

  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) => constraints.loosen();

  @override
  Offset getPositionForChild(Size size, Size childSize) {
    final x = (anchor.center.dx - childSize.width / 2).clamp(0.0, math.max(0.0, size.width - childSize.width)).toDouble();
    var y = anchor.top - childSize.height - 6;
    if (y < 0) y = anchor.bottom + 6;
    if (y + childSize.height > size.height) y = math.max(0.0, anchor.top + 6);
    return Offset(x, y);
  }

  @override
  bool shouldRelayout(_TipLayout old) => old.anchor != anchor;
}

class _TreemapPainter extends CustomPainter {
  _TreemapPainter({
    required this.cells,
    required this.bars,
    required this.selected,
    required this.colors,
    required this.scaler,
    required this.nameStyle,
    required this.valueStyle,
    required this.dimmedText,
    required this.gap,
    required this.pressed,
    required this.format,
  });

  final List<TreemapCell> cells;
  final List<BarDatum> bars;
  final List<String> selected;
  final DashboardColors colors;
  final TextScaler scaler;
  final TextStyle nameStyle;
  final TextStyle valueStyle;
  final Color dimmedText;
  final Color gap;
  final int? pressed;
  final String format;

  @override
  void paint(Canvas canvas, Size size) {
    final fill = Paint();
    for (final cell in cells) {
      final bar = bars[cell.index];
      final op = markOpacity(selected, bar.key);
      final r = cell.rect;
      // 2 px of card colour between tiles, like the web's surface stroke.
      final rr = RRect.fromRectAndRadius(r.deflate(1), const Radius.circular(4));
      fill.color = colors.ok.withValues(alpha: op);
      canvas.drawRRect(rr, fill);
      if (pressed == cell.index) {
        canvas.drawRRect(
          rr.deflate(1),
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2
            ..color = Colors.white.withValues(alpha: 0.9),
        );
      }
      // A label only where it fits (the web's rule: > 58 x 36).
      if (r.width > 58 && r.height > 36) {
        final dim = op < 1;
        final maxW = r.width - 16;
        final name = _paragraph(truncateLabel(bar.label, (r.width / 8).floor()), dim ? nameStyle.copyWith(color: dimmedText) : nameStyle, maxW);
        final value = _paragraph(eng.formats[format]!(bar.value), dim ? valueStyle.copyWith(color: dimmedText) : valueStyle, maxW);
        if (name.height + value.height + 14 <= r.height) {
          name.paint(canvas, Offset(r.left + 8, r.top + 6));
          value.paint(canvas, Offset(r.left + 8, r.bottom - 6 - value.height));
        }
        name.dispose();
        value.dispose();
      }
    }
  }

  TextPainter _paragraph(String text, TextStyle style, double maxWidth) => TextPainter(
        text: TextSpan(text: text, style: style),
        textDirection: TextDirection.ltr,
        textScaler: scaler,
        maxLines: 1,
        ellipsis: '…',
      )..layout(maxWidth: math.max(0, maxWidth));

  @override
  bool shouldRepaint(_TreemapPainter old) =>
      !identical(old.cells, cells) ||
      !identical(old.bars, bars) ||
      old.pressed != pressed ||
      old.colors != colors ||
      old.gap != gap ||
      old.scaler != scaler ||
      old.nameStyle != nameStyle ||
      old.selected.length != selected.length ||
      !_sameList(old.selected, selected);

  static bool _sameList(List<String> a, List<String> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  @override
  SemanticsBuilderCallback get semanticsBuilder => (size) => [
        for (final cell in cells)
          CustomPainterSemantics(
            rect: cell.rect,
            properties: SemanticsProperties(
              label: '${bars[cell.index].label}, ${eng.formatExact(format, bars[cell.index].value)}',
              textDirection: TextDirection.ltr,
              button: true,
              selected: selected.contains(bars[cell.index].key),
            ),
          ),
      ];

  @override
  bool shouldRebuildSemantics(_TreemapPainter old) => !identical(old.cells, cells) || !_sameList(old.selected, selected);
}
