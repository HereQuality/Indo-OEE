import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/alerts.dart';
import '../../process/process_spec.dart';
import '../sheet_controller.dart';
import '../machine_day_status.dart';
import '../sheet_model.dart';
import '../widgets/not_running_dialog.dart';
import '../widgets/machine_day_card.dart'
    show SheetAccess, EntryAction, notRunningHint, notRunningKindColor;
import '../widgets/sheet_popovers.dart';
import '../widgets/sheet_style.dart';
import 'shared_columns.dart' show oeeFigureStyle;
import 'sheet_columns.dart';

/// One body row of the table, with where it sits in its date / machine run
/// (the web merges those cells with rowSpan; here the first row of a run carries
/// the value and the rest continue it).
class SheetTableItem {
  const SheetTableItem({
    required this.row,
    required this.date,
    required this.machineId,
    required this.dayIndex,
    required this.dateStart,
    required this.dateEnd,
    required this.machineStart,
    required this.machineEnd,
    this.dateIndex = 0,
    this.dateRun = 1,
    this.machineIndex = 0,
    this.machineRun = 1,
  });

  final Json row;
  final String date;
  final String machineId;
  final int dayIndex;
  final bool dateStart;
  final bool dateEnd;
  final bool machineStart;
  final bool machineEnd;

  /// Where this row sits in its date's run / its machine's run, and how long each
  /// run is — a merged cell is drawn once, in the middle of its run.
  final int dateIndex;
  final int dateRun;
  final int machineIndex;
  final int machineRun;

  /// The first row of a date other than the sheet's very first: drawn with
  /// the heavier top rule.
  bool get boundary => dateStart && dayIndex > 0;

  String get id => '${row['_id']}';

  /// A "Not filled yet" row: a machine with nothing entered on the date.
  bool get placeholder => row['_placeholder'] == true;
}

/// The flat list of rows, in the order the web sheet sorts them.
List<SheetTableItem> buildTableItems(List<SheetDay> days) {
  final out = <SheetTableItem>[];
  for (var d = 0; d < days.length; d++) {
    final day = days[d];
    final total = day.machines.fold(
      0,
      (sum, m) => sum + (m.entries.isEmpty ? 1 : m.entries.length),
    );
    var n = 0;
    for (final m in day.machines) {
      // A machine with nothing entered yet is one row of its own.
      final rows = m.entries.isEmpty
          ? [
              <String, dynamic>{
                '_id': 'ph|${day.date}|${m.machineId}',
                '_placeholder': true,
                'date': day.date,
                'machine': m.machineId,
              },
            ]
          : m.entries;
      for (var j = 0; j < rows.length; j++) {
        out.add(
          SheetTableItem(
            row: rows[j],
            date: day.date,
            machineId: m.machineId,
            dayIndex: d,
            dateStart: n == 0,
            dateEnd: n == total - 1,
            machineStart: j == 0,
            machineEnd: j == rows.length - 1,
            dateIndex: n,
            dateRun: total,
            machineIndex: j,
            machineRun: rows.length,
          ),
        );
        n++;
      }
    }
  }
  return out;
}

/// The single position of [c], or null while nothing (or, for a frame while the
/// table is being rebuilt, two scroll views) is attached — `c.position` throws
/// in both of those cases.
ScrollPosition? soleScrollPosition(ScrollController c) =>
    c.positions.length == 1 ? c.positions.first : null;

double _hOffset(ScrollController h) {
  final p = soleScrollPosition(h);
  return p != null && p.hasPixels ? p.pixels : 0;
}

/// Row height, font and column scale for the phone / the iPad.
class TableMetrics {
  TableMetrics(BuildContext context, {required this.tablet}) {
    final scale = MediaQuery.textScalerOf(context).scale(16) / 16;
    k = (tablet ? 1.1 : 1.0) * scale.clamp(1.0, 1.3);
    // A header is two lines at most: room for exactly that at this text size.
    head = math.max(
      40.0,
      (2 * headFont * 1.15 * scale.clamp(1.0, 1.6) + 12).ceilToDouble(),
    );
  }

  final bool tablet;
  late final double k;
  late final double head;

  static double rowHeight(bool tablet) => tablet ? 44 : 40;
  double get row => rowHeight(tablet);
  double get font => tablet ? 13 : 12;
  double get headFont => tablet ? 12 : 11;
}

/// Data Entry as a real table: a sticky header, Date + Machine frozen at the
/// left, Actions frozen at the right, the rest scrolling under them both ways.
///
/// One horizontal scroll view holds a column of [header, rows]; the frozen
/// groups are translated by the horizontal offset instead of being separate
/// scrollers, so a single vertical ListView (fixed-height rows, lazily built)
/// drives the whole body. A horizontal drag anywhere inside scrolls this table
/// (an inner scrollable wins over the tab PageView around it).
class SheetTable extends StatefulWidget {
  const SheetTable({
    super.key,
    required this.controller,
    required this.items,
    required this.access,
    required this.tablet,
    required this.vController,
    required this.hController,
    required this.onEdit,
    required this.onDelete,
    required this.onUnlock,
    required this.onRefresh,
    required this.footer,
    required this.footerExtent,
    this.onAddFor,
  });

  /// "Add entry" on a "Not filled yet" row: (date, machineId). Null = no button.
  final void Function(String date, String machineId)? onAddFor;

  final SheetController controller;
  final List<SheetTableItem> items;
  final SheetAccess access;
  final bool tablet;
  final ScrollController vController;
  final ScrollController hController;
  final EntryAction onEdit;
  final EntryAction onDelete;
  final EntryAction onUnlock;
  final Future<void> Function() onRefresh;
  final Widget footer;
  final double footerExtent;

  @override
  State<SheetTable> createState() => _SheetTableState();
}

class _SheetTableState extends State<SheetTable> {
  final Set<String> _open = {};

  // Layout of the last build (design px x k), so a toggle can work out where the
  // opened / closed breakdown sits without measuring widgets.
  double _k = 1, _visible = 0;

  void _toggle(String id) {
    final wasOpen = _open.contains(id);
    setState(() => wasOpen ? _open.remove(id) : _open.add(id));
    // Keep the column you tapped where it was. Opening brings the whole new
    // breakdown into view (without pushing its own total off the left edge);
    // closing only pulls the table back if it is now shorter than the scroll.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final m = soleScrollPosition(widget.hController);
      if (!mounted || m == null || !m.hasPixels || !m.hasContentDimensions) {
        return;
      }
      if (m.pixels > m.maxScrollExtent) {
        m.jumpTo(m.maxScrollExtent);
        return;
      }
      final cols = widget.controller.columnsFor(_open);
      final summary = cols.expandSummary[id];
      if (wasOpen || summary == null || _visible <= 0) return;
      final start = cols.middleLeftOf(summary, _k);
      var end = start;
      var inGroup = false;
      for (final c in cols.middle) {
        if (c.key == summary) inGroup = true;
        if (inGroup) {
          if (c.key != summary && !c.sub) break;
          end += c.width * _k;
        }
      }
      final shown = m.pixels + _visible;
      if (end > shown) {
        final target = math
            .min(end - _visible, start)
            .clamp(0.0, m.maxScrollExtent)
            .toDouble();
        if ((target - m.pixels).abs() > 1) {
          m.animateTo(
            target,
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOutCubic,
          );
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final tablet = widget.tablet;
    final metrics = TableMetrics(context, tablet: tablet);
    final k = metrics.k;
    // Every scrolling column is at least wide enough for its header to sit on
    // two lines without an ellipsis or a word broken in half.
    final raw = widget.controller.columnsFor(_open);
    final cols = SheetColumns(
      left: raw.left,
      middle: [
        for (final c in raw.middle)
          c.withWidth(
            math.max(
              c.width,
              _headerNeed(context, c, metrics.headFont) / k,
            ),
          ),
      ],
      expandSummary: raw.expandSummary,
    );
    // The frozen columns keep close to their design width however large the
    // text is (their text ellipsises instead), or they would eat the screen.
    final kf = math.min(k, 1.15);
    // The Status column before Date: a row's state and its quick actions
    // (Add / Not running), as on the web.
    final statusW = (tablet ? 196.0 : 164.0) * kf;
    // Date + Machine stay frozen as before; Status is the first scrolling
    // column, right after Machine.
    final frozenW = cols.leftWidth(kf);
    final leftW = frozenW;
    final midW0 = statusW + cols.middleWidth(k);
    final actW = tablet ? actionsWidth : actionsWidthPhone;

    Widget table = LayoutBuilder(
      builder: (context, box) {
        final vw = box.maxWidth;
        final natural = leftW + midW0 + actW;
        final totalW = math.max(natural, vw);
        final extra = totalW - natural;
        final midW = midW0 + extra;
        final widths = <String, double>{
          for (final c in cols.left) c.key: c.width * kf,
          for (final c in cols.middle) c.key: c.width * k,
        };
        if (extra > 0 && cols.middle.isNotEmpty) {
          widths[cols.middle.last.key] = widths[cols.middle.last.key]! + extra;
        }

        // On a very narrow screen at a large text size there is no room left for
        // the scrolling middle: let Actions (then Date + Machine) scroll instead.
        _k = k;
        _visible = math.max(0.0, vw - leftW - actW);
        final freezeLeft = vw - frozenW >= 140;
        // Actions stay pinned (visible on every row) whenever the columns still get a
        // usable width; on a phone they are compact for exactly that reason.
        final freezeRight = vw - frozenW - actW >= 120;
        final palette = _Palette(context);
        final h = widget.hController;
        final items = widget.items;
        final rowH = metrics.row;

        Widget frozen(bool on, double Function(double h) dx, Widget child) =>
            !on
            ? child
            : ListenableBuilder(
                listenable: h,
                child: child,
                builder: (context, child) => Transform.translate(
                  offset: Offset(dx(_hOffset(h)), 0),
                  child: child,
                ),
              );

        Widget headerRow() {
          return SizedBox(
            width: totalW,
            height: metrics.head,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Positioned(
                  left: leftW,
                  top: 0,
                  bottom: 0,
                  width: midW,
                  child: Row(
                    children: [
                      _HeadCell.actions(
                        width: statusW,
                        metrics: metrics,
                        palette: palette,
                        title: 'Status',
                      ),
                      for (final c in cols.middle)
                        _HeadCell(
                          col: c,
                          width: widths[c.key]!,
                          metrics: metrics,
                          palette: palette,
                          onToggle: _toggle,
                          spec: widget.controller.spec,
                        ),
                    ],
                  ),
                ),
                Positioned(
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: leftW,
                  child: frozen(
                    freezeLeft,
                    (o) => o,
                    Row(
                      children: [
                        for (final c in cols.left)
                          _HeadCell(
                            col: c,
                            width: widths[c.key]!,
                            metrics: metrics,
                            palette: palette,
                            onToggle: _toggle,
                            spec: widget.controller.spec,
                          ),
                      ],
                    ),
                  ),
                ),
                Positioned(
                  left: totalW - actW,
                  top: 0,
                  bottom: 0,
                  width: actW,
                  child: frozen(
                    freezeRight,
                    (o) => o + vw - totalW,
                    _HeadCell.actions(
                      width: actW,
                      metrics: metrics,
                      palette: palette,
                    ),
                  ),
                ),
              ],
            ),
          );
        }

        // Width of the middle columns to the left of each one.
        final before = <String, double>{};
        var run = statusW;
        for (final c in cols.middle) {
          before[c.key] = run;
          run += widths[c.key]!;
        }

        Widget bodyRow(int i) {
          final it = items[i];
          final ph = it.placeholder;
          final d = CellData(
            row: it.row,
            calc: ph ? const {} : widget.controller.calcOf(it.row),
            day: ph ? const {} : widget.controller.dayOf(it.row),
            machineName: widget.controller.machineName[it.machineId] ?? '—',
          );
          Widget cell(SheetCol c, {double? before}) => _BodyCell(
            // Pinned columns (before == null) may lift freely over the row above;
            // scrolling ones stop at the pinned edges.
            liftClip: _LiftClipper(
              h: h,
              before: before ?? 0,
              freezeLeft: before != null && freezeLeft,
              freezeRight: before != null && freezeRight,
              viewport: vw,
              actionsWidth: actW,
              rowHeight: rowH,
            ),
            key: ValueKey('${it.id}:${c.key}'),
            col: c,
            width: widths[c.key]!,
            item: it,
            data: d,
            spec: widget.controller.spec,
            metrics: metrics,
            palette: palette,
            machineTone: c.key == 'machine'
                ? MachineColors.of(
                    widget.controller.machineOf(it.machineId),
                    widget.controller.rankOf(it.machineId),
                  )
                : null,
          );
          return SizedBox(
            key: ValueKey('trow-${it.id}'),
            width: totalW,
            height: rowH,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Positioned(
                  left: leftW,
                  top: 0,
                  bottom: 0,
                  width: midW,
                  child: Row(
                    children: [
                      _StatusCell(
                        item: it,
                        mark: ph
                            ? widget.controller.markOf(it.date, it.machineId)
                            : null,
                        width: statusW,
                        metrics: metrics,
                        palette: palette,
                        controller: widget.controller,
                        canAdd:
                            widget.access.canEdit && widget.onAddFor != null,
                        onAdd: () =>
                            widget.onAddFor?.call(it.date, it.machineId),
                      ),
                      Expanded(
                        child: ph
                            ? _PlaceholderCells(
                                item: it,
                                mark: widget.controller.markOf(
                                  it.date,
                                  it.machineId,
                                ),
                                widths: [
                                  for (final c in cols.middle) widths[c.key]!,
                                ],
                                metrics: metrics,
                                palette: palette,
                              )
                            : Row(
                                children: [
                                  for (final c in cols.middle)
                                    cell(c, before: before[c.key]!),
                                ],
                              ),
                      ),
                    ],
                  ),
                ),
                Positioned(
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: leftW,
                  child: frozen(
                    freezeLeft,
                    (o) => o,
                    Row(children: [for (final c in cols.left) cell(c)]),
                  ),
                ),
                Positioned(
                  left: totalW - actW,
                  top: 0,
                  bottom: 0,
                  width: actW,
                  child: frozen(
                    freezeRight,
                    (o) => o + vw - totalW,
                    ph
                        ? _AddCell(
                            item: it,
                            width: actW,
                            metrics: metrics,
                            palette: palette,
                          )
                        : _ActionsCell(
                            item: it,
                            width: actW,
                            metrics: metrics,
                            palette: palette,
                            controller: widget.controller,
                            access: widget.access,
                            onEdit: widget.onEdit,
                            onDelete: widget.onDelete,
                            onUnlock: widget.onUnlock,
                          ),
                  ),
                ),
              ],
            ),
          );
        }

        final list = ListView.builder(
          key: const ValueKey('sheet-table-list'),
          controller: widget.vController,
          physics: const AlwaysScrollableScrollPhysics(),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          itemCount: items.length + 1,
          itemExtentBuilder: (i, _) =>
              i == items.length ? widget.footerExtent : rowH,
          itemBuilder: (context, i) {
            if (i == items.length) {
              return SizedBox(
                width: totalW,
                height: widget.footerExtent,
                child: Stack(
                  children: [
                    Positioned(
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: vw,
                      child: frozen(
                        true,
                        (o) => o,
                        Align(
                          alignment: Alignment.topCenter,
                          child: SingleChildScrollView(
                            physics: const NeverScrollableScrollPhysics(),
                            child: widget.footer,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              );
            }
            return bodyRow(i);
          },
        );

        final scroller = SingleChildScrollView(
          key: const ValueKey('sheet-table-h'),
          controller: h,
          scrollDirection: Axis.horizontal,
          physics: const ClampingScrollPhysics(
            parent: AlwaysScrollableScrollPhysics(),
          ),
          child: SizedBox(
            width: totalW,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                headerRow(),
                Expanded(child: list),
              ],
            ),
          ),
        );

        Widget shadow({required bool left}) => Positioned(
          left: left ? leftW : null,
          right: left ? null : actW,
          top: 0,
          bottom: 0,
          width: 9,
          child: IgnorePointer(
            child: ListenableBuilder(
              listenable: h,
              builder: (context, _) {
                final pos = soleScrollPosition(h);
                final has =
                    pos != null && pos.hasPixels && pos.hasContentDimensions;
                final show =
                    has &&
                    (left
                        ? pos.pixels > 0.5
                        : pos.pixels < pos.maxScrollExtent - 0.5);
                return AnimatedOpacity(
                  opacity: show ? 1 : 0,
                  duration: const Duration(milliseconds: 120),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: left
                            ? Alignment.centerLeft
                            : Alignment.centerRight,
                        end: left
                            ? Alignment.centerRight
                            : Alignment.centerLeft,
                        colors: [
                          Colors.black.withValues(alpha: dark ? 0.45 : 0.14),
                          Colors.transparent,
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        );

        return RefreshIndicator(
          notificationPredicate: (n) => n.depth == 1,
          onRefresh: widget.onRefresh,
          child: Scrollbar(
            controller: widget.vController,
            notificationPredicate: (n) =>
                n.depth == 1 && n.metrics.axis == Axis.vertical,
            interactive: true,
            child: Scrollbar(
              controller: h,
              notificationPredicate: (n) =>
                  n.depth == 0 && n.metrics.axis == Axis.horizontal,
              scrollbarOrientation: ScrollbarOrientation.bottom,
              interactive: true,
              child: Stack(
                children: [
                  Positioned.fill(child: scroller),
                  if (freezeLeft) shadow(left: true),
                  if (freezeRight) shadow(left: false),
                ],
              ),
            ),
          ),
        );
      },
    );

    if (tablet) {
      table = Container(
        margin: const EdgeInsets.fromLTRB(12, 8, 12, 12),
        decoration: BoxDecoration(
          color: s.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: s.outlineVariant),
        ),
        clipBehavior: Clip.antiAlias,
        child: table,
      );
    }
    return ColoredBox(color: s.surface, child: table);
  }
}

/// The colours of the table for the current theme.
class _Palette {
  _Palette(BuildContext context)
    : s = Theme.of(context).colorScheme,
      dark = Theme.of(context).brightness == Brightness.dark,
      _context = context;

  final ColorScheme s;
  final bool dark;
  final BuildContext _context;

  Color get grid => s.outlineVariant;
  Color get strong => dark ? s.outline : AppColors.slate300;

  Color day(int dayIndex) => dayIndex.isEven
      ? s.surface
      : Color.alphaBlend(
          s.onSurface.withValues(alpha: dark ? 0.05 : 0.035),
          s.surface,
        );

  Color wash(Color base, Color tone, double lightA, double darkA) =>
      Color.alphaBlend(tone.withValues(alpha: dark ? darkA : lightA), base);

  Color bg(ColTone tone, int dayIndex) {
    final base = day(dayIndex);
    return switch (tone) {
      ColTone.none => base,
      ColTone.calc => wash(base, SheetTones.calc, 0.08, 0.16),
      ColTone.day => wash(base, SheetTones.day, 0.09, 0.16),
      ColTone.oee => wash(
        base,
        SheetTones.oee,
        dayIndex.isEven ? 0.10 : 0.17,
        dayIndex.isEven ? 0.20 : 0.28,
      ),
    };
  }

  Color text(ColTone tone) => switch (tone) {
    ColTone.none => s.onSurface,
    ColTone.calc => SheetTones.text(_context, SheetTones.calc),
    ColTone.day => SheetTones.text(_context, SheetTones.day),
    ColTone.oee => SheetTones.text(_context, SheetTones.oee),
  };

  Color headText(ColTone tone) =>
      tone == ColTone.none ? s.onSurfaceVariant : text(tone);

  Color get headBg => s.surface;
}

class _HeadCell extends StatelessWidget {
  const _HeadCell({
    required this.col,
    required this.width,
    required this.metrics,
    required this.palette,
    required this.onToggle,
    required ProcessSpec this.spec,
  }) : _actions = false,
       title = '';

  const _HeadCell.actions({
    required this.width,
    required this.metrics,
    required this.palette,
    this.title = 'Actions',
  }) : col = null,
       onToggle = null,
       spec = null,
       _actions = true;

  final SheetCol? col;
  final double width;
  final TableMetrics metrics;
  final _Palette palette;
  final void Function(String id)? onToggle;
  final ProcessSpec? spec;
  final bool _actions;
  final String title;

  @override
  Widget build(BuildContext context) {
    final c = col;
    final label = _actions ? title : c!.label;
    final tone = _actions ? ColTone.none : c!.tone;
    final formulaKey = c?.formulaKey;
    final expand = c?.expand;
    final color = palette.headText(tone);
    final decoration = BoxDecoration(
      color: palette.headBg,
      border: Border(
        right: BorderSide(color: palette.strong, width: 1),
        bottom: BorderSide(color: palette.strong, width: 2),
      ),
    );
    final text = Text(
      label,
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
      textAlign: _actions || !(c?.start ?? false)
          ? TextAlign.center
          : TextAlign.start,
      style: TextStyle(
        fontSize: metrics.headFont,
        height: 1.15,
        fontWeight: FontWeight.w700,
        color: color,
      ),
    );
    Widget content = Padding(
      padding: EdgeInsets.only(left: 6, right: expand == null ? 6 : 2),
      child: Row(
        children: [
          Expanded(child: text),
          if (formulaKey != null)
            Padding(
              padding: const EdgeInsets.only(left: 3),
              child: Icon(
                Icons.info_outline_rounded,
                size: 14,
                color: palette.s.onSurfaceVariant,
              ),
            ),
          if (expand != null) _Chevron(expand: expand, onToggle: onToggle!),
        ],
      ),
    );
    if (formulaKey != null) {
      content = Semantics(
        button: true,
        label: 'How $label is calculated',
        child: InkWell(
          key: ValueKey('formula-${c!.key}'),
          onTap: () => showFormulaSheet(
            context,
            title: label,
            formulaKey: formulaKey,
            formulas: spec?.formulas ?? sheetFormulas,
          ),
          child: content,
        ),
      );
    }
    return Container(
      key: ValueKey('head-${_actions ? title.toLowerCase() : c!.key}'),
      width: width,
      height: metrics.head,
      decoration: decoration,
      child: content,
    );
  }
}

class _Chevron extends StatelessWidget {
  const _Chevron({required this.expand, required this.onToggle});
  final ColExpand expand;
  final void Function(String id) onToggle;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final label = expand.isOpen
        ? 'Collapse ${expand.label}'
        : 'Expand ${expand.label}';
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: Tooltip(
        message: label,
        child: InkResponse(
          key: ValueKey(
            'expand-${expand.id}-${expand.isOpen ? (expand.end ? 'open-end' : 'open') : 'closed'}',
          ),
          radius: 20,
          onTap: () => onToggle(expand.id),
          child: SizedBox(
            width: 32,
            height: 40,
            child: Center(
              child: Container(
                width: 20,
                height: 20,
                decoration: BoxDecoration(
                  color: s.surfaceContainerHigh,
                  shape: BoxShape.circle,
                  border: Border.all(color: s.outline),
                ),
                child: Icon(
                  expand.isOpen
                      ? Icons.chevron_left_rounded
                      : Icons.chevron_right_rounded,
                  size: 16,
                  color: s.onSurface,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A merged value over an even run of rows sits on the line between two rows, so
/// it is drawn lifted into the row above. That row's pinned Date / Machine /
/// Actions cells were painted before it, so the lifted value must stop at the edge
/// of the scrolling area or it would print over them while the table scrolls.
class _LiftClipper extends CustomClipper<Rect> {
  _LiftClipper({
    required this.h,
    required this.before,
    required this.freezeLeft,
    required this.freezeRight,
    required this.viewport,
    required this.actionsWidth,
    required this.rowHeight,
  }) : super(reclip: h);

  final ScrollController h;

  /// Width of the middle columns before this cell.
  final double before;
  final bool freezeLeft;
  final bool freezeRight;
  final double viewport;
  final double actionsWidth;
  final double rowHeight;

  @override
  Rect getClip(Size size) {
    final scroll = _hOffset(h);
    final left = freezeLeft ? math.max(0.0, scroll - before) : 0.0;
    final right = freezeRight
        ? math.min(size.width, scroll + viewport - actionsWidth - before)
        : size.width;
    return Rect.fromLTRB(
      left,
      -rowHeight,
      math.max(left, right),
      size.height + rowHeight,
    );
  }

  @override
  bool shouldReclip(_LiftClipper old) =>
      old.before != before ||
      old.freezeLeft != freezeLeft ||
      old.freezeRight != freezeRight ||
      old.viewport != viewport ||
      old.actionsWidth != actionsWidth ||
      old.rowHeight != rowHeight;
}

class _BodyCell extends StatelessWidget {
  const _BodyCell({
    super.key,
    required this.col,
    required this.width,
    required this.item,
    required this.data,
    required this.metrics,
    required this.palette,
    required this.spec,
    this.machineTone,
    this.liftClip,
  });

  final ProcessSpec spec;

  final SheetCol col;
  final double width;

  /// How far a value lifted over the row above may show (see [_LiftClipper]).
  final CustomClipper<Rect>? liftClip;
  final SheetTableItem item;
  final CellData data;
  final TableMetrics metrics;
  final _Palette palette;
  final Color? machineTone;

  @override
  Widget build(BuildContext context) {
    // A merged cell (Date, Machine, Unreported, OEE…) is one value over its whole
    // run of rows, like the web's rowSpan: drawn once, in the middle of the run. An
    // odd run has a middle row; an even run's middle is the line between two rows,
    // so the value sits in the lower one, lifted half a row.
    final (int runIndex, int runLength) = switch (col.merge) {
      ColMerge.none => (0, 1),
      ColMerge.date => (item.dateIndex, item.dateRun),
      ColMerge.machineDay => (item.machineIndex, item.machineRun),
    };
    final show = runIndex == runLength ~/ 2;
    final lift = (runLength.isEven && runLength > 1) ? -metrics.row / 2 : 0.0;
    final joinBelow = switch (col.merge) {
      ColMerge.none => false,
      ColMerge.date => !item.dateEnd,
      ColMerge.machineDay => !item.machineEnd,
    };
    // A continuation row of a merged run keeps the run's colour and drops the
    // rule between it and the row above.
    final topRule = item.boundary;
    final s = palette.s;
    final bg = palette.bg(col.tone, item.dayIndex);
    final border = Border(
      left: machineTone != null
          ? BorderSide(color: machineTone!, width: 3)
          : BorderSide.none,
      right: BorderSide(color: palette.grid),
      top: topRule
          ? BorderSide(color: palette.strong, width: 2)
          : BorderSide.none,
      bottom: joinBelow ? BorderSide.none : BorderSide(color: palette.grid),
    );

    Widget? child;
    if (show) {
      final txt = col.remarkKind == 'general' ? '' : col.text(data);
      // A spec may emphasise one value (red over 100%, a review badge).
      final emph = txt.isEmpty
          ? null
          : (col.style?.call(data) ?? oeeFigureStyle(col, data.day));
      final mark = emph?.mark ?? CellMark.none;
      final markColor = mark == CellMark.none
          ? null
          : SheetTones.text(context, cellMarkColor(mark));
      final fw = emph?.bold != null
          ? (emph!.bold! ? FontWeight.w700 : FontWeight.w500)
          : col.tone == ColTone.oee
          ? FontWeight.w800
          : (col.bold || col.tone != ColTone.none
                ? FontWeight.w700
                : FontWeight.w500);
      final faint = txt == '—' && markColor == null;
      Widget? textWidget = txt.isEmpty
          ? null
          : Text(
              txt,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              softWrap: false,
              textAlign: col.start ? TextAlign.start : TextAlign.center,
              style: TextStyle(
                fontSize: metrics.font,
                fontWeight: fw,
                color: faint
                    ? s.onSurfaceVariant.withValues(alpha: 0.7)
                    : (markColor ?? palette.text(col.tone)),
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            );
      if (textWidget != null &&
          emph != null &&
          emph.pill &&
          markColor != null) {
        textWidget = DecoratedBox(
          key: ValueKey('pill-${col.key}-${item.id}'),
          decoration: BoxDecoration(
            color: SheetTones.wash(context, cellMarkColor(mark)),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            child: textWidget,
          ),
        );
      }
      if (col.remarkKind != null) {
        final parts = [
          for (final p in spec.remarkParts(item.row))
            if (p['key'] == col.remarkKind) p,
        ];
        final eye = parts.isEmpty
            ? null
            : _RemarkEye(
                parts: parts,
                kind: col.remarkKind!,
                id: item.id,
                metrics: metrics,
              );
        if (col.remarkKind == 'general') {
          child = Center(
            child:
                eye ??
                Text(
                  '—',
                  style: TextStyle(
                    fontSize: metrics.font,
                    color: s.onSurfaceVariant.withValues(alpha: 0.55),
                  ),
                ),
          );
        } else {
          child = Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (textWidget != null) Flexible(child: textWidget),
              ?eye,
            ],
          );
        }
      } else if (textWidget != null) {
        child = Align(
          alignment: col.start ? Alignment.centerLeft : Alignment.center,
          child: lift == 0
              ? textWidget
              : ClipRect(
                  clipper: liftClip,
                  child: Transform.translate(
                    offset: Offset(0, lift),
                    child: textWidget,
                  ),
                ),
        );
      }
    }
    return Container(
      width: width,
      height: metrics.row,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(color: bg, border: border),
      child: child,
    );
  }
}

/// The coloured eye beside an "Other" figure (orange reject, teal downtime) or
/// in the Remarks column (grey): opens the remark(s) it carries.
class _RemarkEye extends StatelessWidget {
  const _RemarkEye({
    required this.parts,
    required this.kind,
    required this.id,
    required this.metrics,
  });
  final List<Map<String, dynamic>> parts;
  final String kind;
  final String id;
  final TableMetrics metrics;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final tone = switch (kind) {
      'reject' => SheetTones.text(context, SheetTones.reject),
      'downtime' => SheetTones.text(context, SheetTones.downtime),
      _ => s.onSurfaceVariant,
    };
    final label = switch (kind) {
      'reject' => 'View reject remark',
      'downtime' => 'View downtime remark',
      _ => 'View remarks',
    };
    return SizedBox(
      width: 40,
      height: metrics.row,
      child: IconButton(
        key: ValueKey('eye-$kind-$id'),
        tooltip: label,
        padding: EdgeInsets.zero,
        iconSize: 18,
        color: tone,
        icon: const Icon(Icons.visibility_outlined),
        onPressed: () => showRemarkSheet(context, parts),
      ),
    );
  }
}

/// The Actions cell of a "Not filled yet" row: an Add button (when this user
/// may add entries), else nothing.
class _AddCell extends StatelessWidget {
  const _AddCell({
    required this.item,
    required this.width,
    required this.metrics,
    required this.palette,
  });

  final SheetTableItem item;
  final double width;
  final TableMetrics metrics;
  final _Palette palette;

  @override
  Widget build(BuildContext context) => Container(
    width: width,
    height: metrics.row,
    decoration: BoxDecoration(
      color: palette.bg(ColTone.none, item.dayIndex),
      border: Border(
        left: BorderSide(color: palette.grid),
        top: item.boundary
            ? BorderSide(color: palette.strong, width: 2)
            : BorderSide.none,
        bottom: BorderSide(color: palette.grid),
      ),
    ),
  );
}

/// The middle columns of a row with nothing entered, as before: the first
/// says "Not filled yet" (or the Not running reasons, remarks and who), the
/// rest show a dash.
class _PlaceholderCells extends StatelessWidget {
  const _PlaceholderCells({
    required this.item,
    required this.mark,
    required this.widths,
    required this.metrics,
    required this.palette,
  });

  final SheetTableItem item;
  final DayMark? mark;
  final List<double> widths;
  final TableMetrics metrics;
  final _Palette palette;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final m = mark;
    final border = Border(
      right: BorderSide(color: palette.grid),
      top: item.boundary
          ? BorderSide(color: palette.strong, width: 2)
          : BorderSide.none,
      bottom: BorderSide(color: palette.grid),
    );
    final muted = TextStyle(fontSize: metrics.font, color: s.onSurfaceVariant);
    Widget first() {
      if (m == null) {
        return Text(
          'Not filled yet',
          key: ValueKey('placeholder-${item.id}'),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: muted.copyWith(fontStyle: FontStyle.italic),
        );
      }
      final extra = [
        if (m.remarks.isNotEmpty && m.remarks != m.reasonLabel) m.remarks,
        if (m.markedBy.isNotEmpty) 'by ${m.markedBy}',
      ].join(' · ');
      return Tooltip(
        message: extra.isEmpty ? m.reasonLabel : '${m.reasonLabel} — $extra',
        child: Text.rich(
          TextSpan(
            children: [
              TextSpan(
                text: m.reasonLabel,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: notRunningKindColor(context, m.kind == 'planned'),
                ),
              ),
              if (extra.isNotEmpty) TextSpan(text: '  $extra'),
            ],
          ),
          key: ValueKey('notrunning-label-${item.id}'),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: muted,
        ),
      );
    }

    return Row(
      children: [
        for (var i = 0; i < widths.length; i++)
          Container(
            width: widths[i],
            height: metrics.row,
            padding: const EdgeInsets.symmetric(horizontal: 6),
            alignment: i == 0 ? Alignment.centerLeft : Alignment.center,
            decoration: BoxDecoration(
              color: palette.bg(ColTone.none, item.dayIndex),
              border: border,
            ),
            child: i == 0 ? first() : Text('—', style: muted),
          ),
      ],
    );
  }
}

/// The Status cell before Date. A saved entry reads "Filled"; a row with
/// nothing entered offers "Add" and "Not running" (labelled pills); a row
/// marked not running reads "Not running" with Edit and Undo.
class _StatusCell extends StatelessWidget {
  const _StatusCell({
    required this.item,
    required this.mark,
    required this.width,
    required this.metrics,
    required this.palette,
    required this.controller,
    required this.canAdd,
    required this.onAdd,
  });

  final SheetTableItem item;
  final DayMark? mark;
  final double width;
  final TableMetrics metrics;
  final _Palette palette;
  final SheetController controller;
  final bool canAdd;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final m = mark;
    final name =
        controller.machineName[item.machineId] ??
        (item.machineId.isEmpty ? 'Whole day' : '—');
    final blue = SheetTones.text(context, AppColors.brand600);
    final amber = notRunningKindColor(context, false);
    Widget pill(
      String key,
      String label,
      String tip,
      IconData icon,
      Color c,
      VoidCallback? onTap, {
      bool filled = false,
    }) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: Tooltip(
        message: tip,
        child: OutlinedButton.icon(
          key: ValueKey(key),
          onPressed: onTap,
          style: OutlinedButton.styleFrom(
            foregroundColor: filled ? Colors.white : c,
            disabledForegroundColor: c,
            backgroundColor: filled ? c : c.withValues(alpha: 0.10),
            side: BorderSide(color: c.withValues(alpha: filled ? 1 : 0.6)),
            shape: const StadiumBorder(),
            padding: const EdgeInsets.symmetric(horizontal: 9),
            minimumSize: const Size(0, 30),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            visualDensity: VisualDensity.compact,
            textStyle: const TextStyle(fontWeight: FontWeight.w700),
          ),
          icon: Icon(icon, size: 15),
          label: Text(label, maxLines: 1),
        ),
      ),
    );
    Widget iconBtn(
      String key,
      String tip,
      IconData icon,
      Color c,
      VoidCallback onTap,
    ) => IconButton(
      key: ValueKey(key),
      tooltip: tip,
      onPressed: onTap,
      icon: Icon(icon, size: 18, color: c),
      visualDensity: VisualDensity.compact,
      constraints: const BoxConstraints(minWidth: 34, minHeight: 34),
      padding: EdgeInsets.zero,
    );

    final List<Widget> children;
    if (!item.placeholder) {
      final green = SheetTones.text(context, const Color(0xFF059669));
      children = [
        pill(
          'filled-${item.id}',
          'Filled',
          'Entry saved',
          Icons.check_rounded,
          green,
          null,
        ),
      ];
    } else if (m != null) {
      final c = notRunningKindColor(context, m.kind == 'planned');
      children = [
        pill(
          'nr-chip-${item.id}',
          'Not running',
          m.reasonLabel,
          Icons.block_rounded,
          c,
          null,
        ),
        if (canAdd && !controller.canChangeMark(m))
          Tooltip(
            message:
                'Locked — it can only be changed on the day it was saved. Ask an Admin.',
            child: Padding(
              key: ValueKey('nr-locked-${item.id}'),
              padding: const EdgeInsets.symmetric(horizontal: 6),
              child: Icon(
                Icons.lock_outline_rounded,
                size: 16,
                color: s.onSurfaceVariant,
              ),
            ),
          ),
        if (canAdd && controller.canChangeMark(m)) ...[
          iconBtn(
            'nr-edit-${item.id}',
            'Edit not running',
            Icons.edit_outlined,
            blue,
            () => showNotRunningDialog(
              context,
              controller: controller,
              date: item.date,
              machineId: item.machineId,
              machineName: name,
              existing: m,
            ),
          ),
          iconBtn(
            'nr-undo-${item.id}',
            'Undo not running',
            Icons.undo_rounded,
            s.error,
            () => controller.removeMark(m),
          ),
        ],
      ];
    } else if (canAdd) {
      children = [
        pill(
          'add-${item.id}',
          'Add',
          'The machine ran — fill in its entry',
          Icons.add_rounded,
          blue,
          onAdd,
          filled: true,
        ),
        pill(
          'notrunning-${item.id}',
          'Not running',
          notRunningHint,
          Icons.block_rounded,
          amber,
          () => showNotRunningDialog(
            context,
            controller: controller,
            date: item.date,
            machineId: item.machineId,
            machineName: name,
          ),
        ),
      ];
    } else {
      children = [
        Text(
          'Pending',
          style: TextStyle(
            fontSize: metrics.font,
            fontStyle: FontStyle.italic,
            color: s.onSurfaceVariant,
          ),
        ),
      ];
    }

    return Container(
      key: ValueKey('status-${item.id}'),
      width: width,
      height: metrics.row,
      padding: const EdgeInsets.symmetric(horizontal: 4),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: palette.bg(ColTone.none, item.dayIndex),
        border: Border(
          right: BorderSide(color: palette.grid),
          top: item.boundary
              ? BorderSide(color: palette.strong, width: 2)
              : BorderSide.none,
          bottom: BorderSide(color: palette.grid),
        ),
      ),
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Row(mainAxisSize: MainAxisSize.min, children: children),
      ),
    );
  }
}

class _ActionsCell extends StatelessWidget {
  const _ActionsCell({
    required this.item,
    required this.width,
    required this.metrics,
    required this.palette,
    required this.controller,
    required this.access,
    required this.onEdit,
    required this.onDelete,
    required this.onUnlock,
  });

  final SheetTableItem item;
  final double width;
  final TableMetrics metrics;
  final _Palette palette;
  final SheetController controller;
  final SheetAccess access;
  final EntryAction onEdit;
  final EntryAction onDelete;
  final EntryAction onUnlock;

  @override
  Widget build(BuildContext context) {
    final row = item.row;
    final id = item.id;
    final lock = controller.lockInfo(row);
    final locked = lock.isNotEmpty;
    // An admin edits a locked row anyway, and is offered Unlock for it.
    final canEdit = access.canEdit && (!locked || access.isAdmin);
    final canDelete = access.canDelete && (!locked || access.isAdmin);
    final side = math.min(44.0, metrics.row);
    final s = palette.s;

    final iconW = math.min(44.0, (width - 4) / 2);
    Widget iconBtn({
      required Key key,
      required IconData icon,
      required String tip,
      required Color color,
      VoidCallback? onTap,
    }) => SizedBox(
      width: iconW,
      height: side,
      child: IconButton(
        key: key,
        tooltip: tip,
        padding: EdgeInsets.zero,
        iconSize: 19,
        color: color,
        icon: Icon(icon),
        onPressed: onTap,
      ),
    );

    Widget child;
    final deleting = controller.deletingId == id;
    final editButtons = <Widget>[
      if (canEdit)
        iconBtn(
          key: ValueKey('edit-$id'),
          icon: Icons.edit_outlined,
          tip: 'Edit',
          color: SheetTones.text(context, AppColors.brand600),
          onTap: () => onEdit(row),
        ),
      if (canDelete)
        iconBtn(
          key: ValueKey('delete-$id'),
          icon: Icons.delete_outline_rounded,
          tip: 'Delete',
          color: SheetTones.text(context, AppColors.critical),
          onTap: deleting ? null : () => onDelete(row),
        ),
    ];
    if (locked) {
      if (access.isAdmin) {
        // An admin is never locked out: Unlock (for everyone else) sits
        // beside their own edit / delete — three icons, scaled to fit the
        // narrow Actions column on a phone.
        final busy = controller.unlockingId == id;
        child = Center(
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                busy
                    ? SizedBox(
                        width: side,
                        height: side,
                        child: const Center(
                          child: SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        ),
                      )
                    : iconBtn(
                        key: ValueKey('unlock-$id'),
                        icon: Icons.lock_open_rounded,
                        tip: 'Unlock for 24 hours',
                        color: SheetTones.text(context, SheetTones.lock),
                        onTap: () => onUnlock(row),
                      ),
                ...editButtons,
              ],
            ),
          ),
        );
      } else {
        child = Center(
          child: iconBtn(
            key: ValueKey('locked-$id'),
            icon: Icons.lock_outline_rounded,
            tip: lock,
            color: s.onSurfaceVariant,
            onTap: () => Alerts.info(lock),
          ),
        );
      }
    } else if (canEdit || canDelete) {
      child = Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: editButtons,
      );
    } else {
      child = const SizedBox.shrink();
    }
    return Container(
      width: width,
      height: metrics.row,
      decoration: BoxDecoration(
        color: palette.day(item.dayIndex),
        border: Border(
          right: BorderSide(color: palette.grid),
          top: item.boundary
              ? BorderSide(color: palette.strong, width: 2)
              : BorderSide.none,
          bottom: BorderSide(color: palette.grid),
        ),
      ),
      child: child,
    );
  }
}

/// Placeholder rows while the first page loads — a header and pulsing bones.
class SheetTableSkeleton extends StatefulWidget {
  const SheetTableSkeleton({super.key, required this.tablet});
  final bool tablet;

  @override
  State<SheetTableSkeleton> createState() => _SheetTableSkeletonState();
}

class _SheetTableSkeletonState extends State<SheetTableSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final rowH = TableMetrics.rowHeight(widget.tablet);
    Widget bone(double w, double h) => Container(
      width: w,
      height: h,
      decoration: BoxDecoration(
        color: s.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(6),
      ),
    );
    // The last bone is dropped when the row would not fit (a 320 px phone).
    Widget boneRow(List<double> w, double h) => LayoutBuilder(
      builder: (context, c) {
        final needed = w.take(3).fold<double>(0, (a, b) => a + b) + 48 + w.last;
        final fits = needed <= c.maxWidth - 24;
        return Row(
          children: [
            bone(w[0], h),
            const SizedBox(width: 24),
            bone(w[1], h),
            const SizedBox(width: 24),
            bone(w[2], h),
            if (fits) ...[const Spacer(), bone(w.last, h)],
          ],
        );
      },
    );
    return Semantics(
      label: 'Loading entries',
      child: ExcludeSemantics(
        child: FadeTransition(
          opacity: Tween<double>(
            begin: 0.45,
            end: 1,
          ).animate(CurvedAnimation(parent: _pulse, curve: Curves.easeInOut)),
          child: ListView(
            key: const ValueKey('sheet-skeleton'),
            physics: const NeverScrollableScrollPhysics(),
            children: [
              Container(
                height: 40,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(color: s.outline, width: 2),
                  ),
                ),
                child: boneRow(const [64, 54, 90, 70], 14),
              ),
              for (var i = 0; i < 14; i++)
                Container(
                  height: rowH,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    border: Border(bottom: BorderSide(color: s.outlineVariant)),
                  ),
                  child: boneRow(const [70, 44, 100, 56], 12),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

final Map<String, double> _headerNeedCache = {};

/// The narrowest width at which [c]'s header label fits on two lines (bold,
/// at [font] and the device text size) without breaking a word, plus the
/// cell's padding and its formula / chevron icons.
double _headerNeed(BuildContext context, SheetCol c, double font) {
  final scaler = MediaQuery.textScalerOf(context);
  final scale = scaler.scale(font) / font;
  final key = '${c.label}|$font|$scale|${c.formulaKey != null}|${c.expand != null}';
  return _headerNeedCache.putIfAbsent(key, () {
    final style = TextStyle(fontSize: font, height: 1.15, fontWeight: FontWeight.w700);
    double widthOf(String t) {
      final tp = TextPainter(
        text: TextSpan(text: t, style: style),
        textDirection: TextDirection.ltr,
        textScaler: scaler,
        maxLines: 1,
      )..layout();
      return tp.width;
    }

    final words = c.label.split(' ');
    final space = widthOf('a a') - widthOf('aa');
    final ws = [for (final w in words) widthOf(w)];
    final longest = ws.fold(0.0, math.max);
    // Lines a greedy wrap takes at width w.
    int lines(double w) {
      var n = 1;
      var cur = -1.0;
      for (final x in ws) {
        if (cur < 0) {
          cur = x;
        } else if (cur + space + x <= w) {
          cur += space + x;
        } else {
          n++;
          cur = x;
        }
      }
      return n;
    }

    var lo = longest, hi = math.max(longest, widthOf(c.label));
    for (var i = 0; i < 20 && hi - lo > 0.5; i++) {
      final mid = (lo + hi) / 2;
      if (lines(mid) <= 2) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    final icons = (c.formulaKey != null ? 17.0 : 0.0) + (c.expand != null ? 24.0 : 0.0);
    return (hi + 14 + icons).ceilToDouble();
  });
}
