import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import '../dashboard_engine.dart' as eng;
import 'chart_data.dart';
import 'chart_kit.dart';
import 'chart_props.dart';
import 'mini_table.dart';
import 'treemap_layout.dart';

/// Downtime by Machine (min) (charts.jsx `DowntimeByMachine`): a nested
/// treemap. Each machine is a block (area = its minutes lost, in its own hue)
/// split into one tile per stoppage cause. fl_chart has no treemap, so the
/// squarified layout (treemap_layout.dart) is painted on a canvas and
/// hit-tested here. Tap a tile to cross-filter that machine; press and hold
/// for the cause's exact minutes. Labels are drawn only on tiles big enough.
class DowntimeByMachineChart extends StatefulWidget {
  const DowntimeByMachineChart({super.key, required this.props});
  final DashboardChartProps props;

  @override
  State<DowntimeByMachineChart> createState() => _DowntimeByMachineChartState();
}

class _DowntimeByMachineChartState extends State<DowntimeByMachineChart> {
  final _memo = DataMemo<List<StoppageMachine>>();

  @override
  Widget build(BuildContext context) {
    final p = widget.props;
    final rows = p.rowsFor('machine');
    final machines = _memo.get(rows, p.ctx, 'machine', () => stoppageMachines(rows, p.ctx));
    if (machines.isEmpty) return const ChartEmpty('No downtime recorded.');
    final selected = p.filters['machine'] ?? const <String>[];
    if (p.view == ChartView.table) {
      return MiniTable(
        columns: ['Machine', for (final g in eng.stoppageGroups) '${g['label']} (min)'],
        rows: [
          for (final m in machines)
            MiniRow(m.key, [m.label, for (final g in eng.stoppageGroups) eng.formatExact('qty', m.groupTotal(g))]),
        ],
        selected: selected,
        onRowClick: (k) => p.onToggle('machine', k),
        colors: p.colors,
      );
    }
    return ChartTextScope(
      child: Semantics(
        container: true,
        label: 'Stoppage minutes by machine and cause, ${machines.length} machines',
        child: StoppageTreemapView(
          machines: machines,
          selected: selected,
          colors: p.colors,
          onSelect: (k) => p.onToggle('machine', k),
        ),
      ),
    );
  }
}

/// One laid-out cause tile.
class _Tile {
  const _Tile(this.rect, this.machine, this.cause, this.first);
  final Rect rect;

  /// Index into the machines list.
  final int machine;

  /// Index into that machine's causes.
  final int cause;

  /// The machine's biggest tile (top-left): it carries the machine's name.
  final bool first;
}

/// The interactive nested treemap (chart only).
class StoppageTreemapView extends StatefulWidget {
  const StoppageTreemapView({
    super.key,
    required this.machines,
    required this.selected,
    required this.colors,
    required this.onSelect,
  });

  final List<StoppageMachine> machines;
  final List<String> selected;
  final DashboardColors colors;
  final void Function(String machineKey) onSelect;

  @override
  State<StoppageTreemapView> createState() => _StoppageTreemapViewState();
}

class _StoppageTreemapViewState extends State<StoppageTreemapView> {
  List<StoppageMachine>? _machines;
  Size? _size;
  List<_Tile> _tiles = const [];
  int? _pressed; // index into _tiles while a long press is held

  List<_Tile> _layout(Size size) {
    if (!identical(_machines, widget.machines) || _size != size) {
      _tiles = _layoutStoppageTiles(widget.machines, size);
      _machines = widget.machines;
      _size = size;
    }
    return _tiles;
  }

  int? _hit(Offset pos) {
    for (var i = _tiles.length - 1; i >= 0; i--) {
      if (_tiles[i].rect.contains(pos)) return i;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.colors;
    return LayoutBuilder(
      builder: (context, box) {
        final size = stageSize(box);
        final tiles = _layout(size);
        final scaler = MediaQuery.textScalerOf(context);
        final painter = _StoppagePainter(
          tiles: tiles,
          machines: widget.machines,
          selected: widget.selected,
          scaler: scaler,
          machineStyle: chartText(context, size: 13, color: Colors.white, weight: FontWeight.w700, tabular: false),
          causeStyle: chartText(context, size: 11, color: Colors.white, weight: FontWeight.w600, tabular: false),
          valueStyle: chartText(context, size: 11, color: Colors.white),
          dimmedText: c.axis,
          gap: chartSurface(context),
          pressed: _pressed,
        );
        final pressed = _pressed == null || _pressed! >= tiles.length ? null : tiles[_pressed!];
        return SizedBox(
          width: size.width,
          height: size.height,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTapUp: (d) {
              final hit = _hit(d.localPosition);
              if (hit != null) {
                chartHaptic();
                widget.onSelect(widget.machines[tiles[hit].machine].key);
              }
            },
            onLongPressStart: (d) => setState(() => _pressed = _hit(d.localPosition)),
            onLongPressMoveUpdate: (d) {
              final i = _hit(d.localPosition);
              if (i != _pressed) setState(() => _pressed = i);
            },
            onLongPressEnd: (_) => setState(() => _pressed = null),
            onLongPressCancel: () => setState(() => _pressed = null),
            child: Stack(
              children: [
                Positioned.fill(child: CustomPaint(painter: painter)),
                if (pressed != null)
                  Positioned.fill(
                    child: IgnorePointer(
                      child: CustomSingleChildLayout(
                        delegate: TileTipLayout(pressed.rect),
                        child: ChartTooltipCard(
                          colors: c,
                          title: widget.machines[pressed.machine].label,
                          lines: [
                            TooltipLine(
                              widget.machines[pressed.machine].causes[pressed.cause].$2,
                              value: eng.formatExact('minutes', widget.machines[pressed.machine].causes[pressed.cause].$3),
                            ),
                          ],
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

/// Lays the machines out as blocks (largest first, like Recharts' Treemap),
/// then each block's causes inside it. A 1.5 px margin around a block keeps
/// the card colour between machines.
List<_Tile> _layoutStoppageTiles(List<StoppageMachine> machines, Size size) {
  final order = sortedStable(List<int>.generate(machines.length, (i) => i), (a, b) => machines[b].total.compareTo(machines[a].total));
  final blocks = squarify([for (final i in order) machines[i].total], Offset.zero & size);
  final out = <_Tile>[];
  for (final block in blocks) {
    final mi = order[block.index];
    final causes = machines[mi].causes;
    final inner = block.rect.deflate(math.min(1.5, math.min(block.rect.width, block.rect.height) / 4));
    final cells = squarify([for (final c in causes) c.$3], inner);
    for (var k = 0; k < cells.length; k++) {
      out.add(_Tile(cells[k].rect, mi, cells[k].index, cells[k].index == 0));
    }
  }
  return out;
}

/// Places a tooltip above [anchor] (below when there is no room), kept inside
/// the stage.
class TileTipLayout extends SingleChildLayoutDelegate {
  TileTipLayout(this.anchor);
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
  bool shouldRelayout(TileTipLayout old) => old.anchor != anchor;
}

class _StoppagePainter extends CustomPainter {
  _StoppagePainter({
    required this.tiles,
    required this.machines,
    required this.selected,
    required this.scaler,
    required this.machineStyle,
    required this.causeStyle,
    required this.valueStyle,
    required this.dimmedText,
    required this.gap,
    required this.pressed,
  });

  final List<_Tile> tiles;
  final List<StoppageMachine> machines;
  final List<String> selected;
  final TextScaler scaler;
  final TextStyle machineStyle;
  final TextStyle causeStyle;
  final TextStyle valueStyle;
  final Color dimmedText;
  final Color gap;
  final int? pressed;

  Color _hue(int machineIndex) => machineHues[machineIndex % machineHues.length];

  @override
  void paint(Canvas canvas, Size size) {
    for (var i = 0; i < tiles.length; i++) {
      final t = tiles[i];
      final m = machines[t.machine];
      final op = markOpacity(selected, m.key);
      final r = t.rect;
      canvas.drawRect(r, Paint()..color = _hue(t.machine).withValues(alpha: op));
      canvas.drawRect(
        r,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1
          ..color = Colors.white.withValues(alpha: 0.55),
      );
      if (pressed == i) {
        canvas.drawRect(
          r.deflate(2),
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2
            ..color = Colors.white.withValues(alpha: 0.9),
        );
      }
      final dim = op < 1;
      TextStyle tone(TextStyle s) => dim ? s.copyWith(color: dimmedText) : s;
      // A machine's biggest tile sits in its top-left corner, so the machine's name rides on it.
      if (t.first && r.width > 30 && r.height > 20) {
        final name = _paragraph(truncateLabel(m.label, (r.width / 8).floor()), tone(machineStyle), r.width - 8);
        name.paint(canvas, Offset(r.left + 6, r.top + 3));
        name.dispose();
      }
      if (r.width > 56 && r.height > 24) {
        final cause = m.causes[t.cause];
        final tall = r.height > 42;
        final label = _paragraph(truncateLabel(cause.$2, (r.width / 6.5).floor()), tone(causeStyle), r.width - 8);
        label.paint(canvas, Offset(r.left + 6, r.bottom - (tall ? 33 : 19)));
        label.dispose();
        if (tall) {
          final value = _paragraph(eng.formats['minutes']!(cause.$3), tone(valueStyle), r.width - 8);
          value.paint(canvas, Offset(r.left + 6, r.bottom - 18));
          value.dispose();
        }
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
  bool shouldRepaint(_StoppagePainter old) =>
      !identical(old.tiles, tiles) ||
      !identical(old.machines, machines) ||
      old.pressed != pressed ||
      old.gap != gap ||
      old.scaler != scaler ||
      old.dimmedText != dimmedText ||
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
        for (final t in tiles)
          CustomPainterSemantics(
            rect: t.rect,
            properties: SemanticsProperties(
              label: '${machines[t.machine].label}, ${machines[t.machine].causes[t.cause].$2}, '
                  '${eng.formatExact('minutes', machines[t.machine].causes[t.cause].$3)}',
              textDirection: TextDirection.ltr,
              button: true,
              selected: selected.contains(machines[t.machine].key),
            ),
          ),
      ];

  @override
  bool shouldRebuildSemantics(_StoppagePainter old) => !identical(old.tiles, tiles) || !_sameList(old.selected, selected);
}
