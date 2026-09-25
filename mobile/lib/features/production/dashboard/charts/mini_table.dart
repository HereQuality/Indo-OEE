import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'chart_kit.dart';
import 'chart_props.dart';

/// One MiniTable row: [key] is the value cross-filtered when it is tapped.
class MiniRow {
  const MiniRow(this.key, this.cells);
  final String key;
  final List<String> cells;
}

/// Mobile twin of the web's `MiniTable`: a compact table with a sticky header
/// and — because most tables here are wider than a phone — a sticky first
/// column and horizontal scrolling. Numeric columns are right-aligned, rows
/// are tappable (cross-filter) and the selected ones are washed.
///
/// It is as tall as its rows up to the height it is given, so a one-machine
/// table does not leave a blank card below it.
class MiniTable extends StatefulWidget {
  const MiniTable({
    super.key,
    required this.columns,
    required this.rows,
    required this.colors,
    this.hints,
    this.onRowClick,
    this.selected = const [],
  });

  final List<String> columns;

  /// Optional, parallel to [columns]: long-press text of each header.
  final List<String?>? hints;
  final List<MiniRow> rows;
  final DashboardColors colors;
  final void Function(String key)? onRowClick;
  final List<String> selected;

  @override
  State<MiniTable> createState() => _MiniTableState();
}

class _Layout {
  _Layout(this.widths, this.rowH, this.headH);
  final List<double> widths;
  final double rowH;
  final double headH;
  double get total => widths.fold(0.0, (s, w) => s + w);
}

class _MiniTableState extends State<MiniTable> {
  final ScrollController _h = ScrollController();

  // Column widths are measured once per (content, width, text scale).
  _Layout? _layout;
  Object? _sigRows;
  Object? _sigCols;
  double _sigWidth = -1;
  double _sigScale = -1;

  static const double _pad = 12; // cell side padding
  static const int _measureRows = 400;

  @override
  void dispose() {
    _h.dispose();
    super.dispose();
  }

  TextStyle _headStyle(BuildContext context) =>
      chartText(context, size: 10.5, color: widget.colors.axis, weight: FontWeight.w700, spacing: 0.4);
  TextStyle _cellStyle(BuildContext context, {bool first = false}) =>
      chartText(context, size: 12.5, color: widget.colors.ink, weight: first ? FontWeight.w600 : FontWeight.w400, tabular: !first);

  _Layout _measure(BuildContext context, double avail, TextScaler scaler) {
    final cached = _layout;
    if (cached != null &&
        identical(_sigRows, widget.rows) &&
        identical(_sigCols, widget.columns) &&
        _sigWidth == avail &&
        _sigScale == scaler.scale(10)) {
      return cached;
    }
    final head = _headStyle(context);
    final n = widget.columns.length;
    final widths = List<double>.filled(n, 0);
    for (var i = 0; i < n; i++) {
      widths[i] = measureText(widget.columns[i].toUpperCase(), head, scaler).width;
    }
    final count = math.min(widget.rows.length, _measureRows);
    for (var r = 0; r < count; r++) {
      final cells = widget.rows[r].cells;
      for (var i = 0; i < n && i < cells.length; i++) {
        final w = measureText(cells[i], _cellStyle(context, first: i == 0), scaler).width;
        if (w > widths[i]) widths[i] = w;
      }
    }
    for (var i = 0; i < n; i++) {
      widths[i] = math.max(64, widths[i] + _pad * 2);
    }
    // A very wide first column would leave no room to scroll the rest.
    if (n > 1) widths[0] = math.min(widths[0], math.max(96, avail * 0.46));

    var total = widths.fold<double>(0, (s, w) => s + w);
    if (total < avail) {
      // Spread the spare width: a little to the label, the rest over the values.
      final extra = avail - total;
      if (n == 1) {
        widths[0] += extra;
      } else {
        widths[0] += extra * 0.4;
        final each = extra * 0.6 / (n - 1);
        for (var i = 1; i < n; i++) {
          widths[i] += each;
        }
      }
      total = avail;
    }
    final rowH = math.max(38.0, scaler.scale(12.5) * 1.25 + 20);
    final headH = math.max(32.0, scaler.scale(10.5) * 1.25 + 16);
    _sigRows = widget.rows;
    _sigCols = widget.columns;
    _sigWidth = avail;
    _sigScale = scaler.scale(10);
    return _layout = _Layout(widths, rowH, headH);
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.colors;
    return LayoutBuilder(
      builder: (context, box) {
        final scaler = MediaQuery.textScalerOf(context);
        final avail = box.hasBoundedWidth ? box.maxWidth : 360.0;
        final lay = _measure(context, avail, scaler);
        final bg = chartSurface(context);
        final wash = chartWash(c, context);
        final grid = c.grid.withValues(alpha: 0.9);
        final desired = lay.headH + lay.rowH * widget.rows.length + 1;
        final height = box.hasBoundedHeight ? math.min(desired, box.maxHeight) : desired;
        final scrollsSideways = lay.total > avail + 0.5;

        Widget stickyFirst(Widget cell) {
          if (!scrollsSideways) return cell;
          return AnimatedBuilder(
            animation: _h,
            child: cell,
            builder: (context, child) {
              final off = _h.hasClients ? math.max(0.0, _h.offset) : 0.0;
              return Transform.translate(offset: Offset(off, 0), child: child);
            },
          );
        }

        Widget head = SizedBox(
          height: lay.headH,
          width: lay.total,
          child: Stack(
            children: [
              Positioned.fill(left: lay.widths[0], child: Row(children: [
                for (var i = 1; i < widget.columns.length; i++) _headerCell(context, i, lay.widths[i]),
              ])),
              Positioned(left: 0, top: 0, bottom: 0, width: lay.widths[0], child: stickyFirst(_opaque(bg, _headerCell(context, 0, lay.widths[0]), border: grid, scrollsSideways: scrollsSideways))),
            ],
          ),
        );
        head = DecoratedBox(
          decoration: BoxDecoration(border: Border(bottom: BorderSide(color: grid))),
          child: head,
        );

        Widget row(int r) {
          final data = widget.rows[r];
          final selected = widget.selected.contains(data.key);
          return _TableRow(
            key: ValueKey(data.key),
            height: lay.rowH,
            width: lay.total,
            first: stickyFirst,
            selected: selected,
            surface: bg,
            wash: wash,
            gridColor: grid,
            scrollsSideways: scrollsSideways,
            onTap: widget.onRowClick == null
                ? null
                : () {
                    chartHaptic();
                    widget.onRowClick!(data.key);
                  },
            semanticLabel: [for (var i = 0; i < data.cells.length && i < widget.columns.length; i++) '${widget.columns[i]} ${data.cells[i]}'].join(', '),
            firstCell: _cell(context, data.cells.isEmpty ? '' : data.cells[0], lay.widths[0], 0, selected),
            restCells: [
              for (var i = 1; i < widget.columns.length; i++)
                _cell(context, i < data.cells.length ? data.cells[i] : '', lay.widths[i], i, selected),
            ],
            firstWidth: lay.widths[0],
          );
        }

        final body = ListView.builder(
          padding: EdgeInsets.zero,
          itemExtent: lay.rowH,
          itemCount: widget.rows.length,
          physics: const ClampingScrollPhysics(),
          itemBuilder: (context, r) => row(r),
        );

        return SizedBox(
          height: height,
          width: box.hasBoundedWidth ? box.maxWidth : null,
          child: SingleChildScrollView(
            controller: _h,
            scrollDirection: Axis.horizontal,
            physics: const ClampingScrollPhysics(),
            child: SizedBox(
              width: lay.total,
              child: Column(
                children: [
                  head,
                  Expanded(child: body),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  // The sticky first column paints over what scrolls beneath it.
  Widget _opaque(Color bg, Widget child, {required Color border, required bool scrollsSideways}) => DecoratedBox(
        decoration: BoxDecoration(
          color: bg,
          border: scrollsSideways ? Border(right: BorderSide(color: border)) : null,
        ),
        child: child,
      );

  Widget _headerCell(BuildContext context, int i, double width) {
    final hint = widget.hints != null && i < widget.hints!.length ? widget.hints![i] : null;
    final text = Padding(
      padding: const EdgeInsets.symmetric(horizontal: _pad),
      child: Align(
        alignment: i == 0 ? Alignment.centerLeft : Alignment.centerRight,
        child: Text(
          widget.columns[i].toUpperCase(),
          maxLines: 1,
          softWrap: false,
          overflow: TextOverflow.ellipsis,
          style: _headStyle(context),
        ),
      ),
    );
    return SizedBox(
      width: width,
      child: hint == null || hint.isEmpty ? text : ChartPressTip(message: hint, colors: widget.colors, child: text),
    );
  }

  Widget _cell(BuildContext context, String text, double width, int i, bool selected) {
    final style = _cellStyle(context, first: i == 0);
    return SizedBox(
      width: width,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: _pad),
        child: Align(
          alignment: i == 0 ? Alignment.centerLeft : Alignment.centerRight,
          child: Text(
            text,
            maxLines: 1,
            softWrap: false,
            overflow: TextOverflow.ellipsis,
            style: selected && i == 0 ? style.copyWith(fontWeight: FontWeight.w700) : style,
          ),
        ),
      ),
    );
  }
}

/// One tappable table row with press feedback; the first cell is opaque so it
/// can stay put over the cells that scroll beneath it.
class _TableRow extends StatefulWidget {
  const _TableRow({
    super.key,
    required this.height,
    required this.width,
    required this.first,
    required this.selected,
    required this.surface,
    required this.wash,
    required this.gridColor,
    required this.scrollsSideways,
    required this.onTap,
    required this.semanticLabel,
    required this.firstCell,
    required this.restCells,
    required this.firstWidth,
  });

  final double height;
  final double width;
  final double firstWidth;
  final Widget Function(Widget cell) first;
  final bool selected;
  final Color surface;
  final Color wash;
  final Color gridColor;
  final bool scrollsSideways;
  final VoidCallback? onTap;
  final String semanticLabel;
  final Widget firstCell;
  final List<Widget> restCells;

  @override
  State<_TableRow> createState() => _TableRowState();
}

class _TableRowState extends State<_TableRow> {
  bool _down = false;

  void _set(bool v) {
    if (_down != v) setState(() => _down = v);
  }

  @override
  Widget build(BuildContext context) {
    final tint = widget.selected ? widget.wash : (_down ? widget.wash.withValues(alpha: widget.wash.a * 0.6) : Colors.transparent);
    final firstBg = Color.alphaBlend(tint, widget.surface);
    Widget row = SizedBox(
      width: widget.width,
      height: widget.height,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: tint,
          border: Border(bottom: BorderSide(color: widget.gridColor.withValues(alpha: 0.6))),
        ),
        child: Stack(
          children: [
            Positioned(left: widget.firstWidth, top: 0, bottom: 0, right: 0, child: Row(children: widget.restCells)),
            Positioned(
              left: 0,
              top: 0,
              bottom: 0,
              width: widget.firstWidth,
              child: widget.first(
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: firstBg,
                    border: Border(
                      bottom: BorderSide(color: widget.gridColor.withValues(alpha: 0.6)),
                      right: widget.scrollsSideways ? BorderSide(color: widget.gridColor) : BorderSide.none,
                    ),
                  ),
                  child: widget.firstCell,
                ),
              ),
            ),
          ],
        ),
      ),
    );
    if (widget.onTap == null) return Semantics(label: widget.semanticLabel, child: row);
    row = GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: widget.onTap,
      onTapDown: (_) => _set(true),
      onTapUp: (_) => _set(false),
      onTapCancel: () => _set(false),
      child: row,
    );
    return Semantics(
      button: true,
      selected: widget.selected,
      label: widget.semanticLabel,
      excludeSemantics: true,
      onTap: widget.onTap,
      child: row,
    );
  }
}
