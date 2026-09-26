import 'dart:math' as math;
import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/alerts.dart';
import '../../shared/production_sheet_calc.dart';
import '../sheet_controller.dart';
import '../sheet_model.dart';
import '../widgets/machine_day_card.dart' show SheetAccess, EntryAction;
import '../widgets/sheet_popovers.dart';
import '../widgets/sheet_style.dart';
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
  });

  final Json row;
  final String date;
  final String machineId;
  final int dayIndex;
  final bool dateStart;
  final bool dateEnd;
  final bool machineStart;
  final bool machineEnd;

  /// The first row of a date other than the sheet's very first: drawn with
  /// the heavier top rule.
  bool get boundary => dateStart && dayIndex > 0;

  String get id => '${row['_id']}';
}

/// The flat list of rows, in the order the web sheet sorts them.
List<SheetTableItem> buildTableItems(List<SheetDay> days) {
  final out = <SheetTableItem>[];
  for (var d = 0; d < days.length; d++) {
    final day = days[d];
    final total = day.entryCount;
    var n = 0;
    for (final m in day.machines) {
      for (var j = 0; j < m.entries.length; j++) {
        out.add(SheetTableItem(
          row: m.entries[j],
          date: day.date,
          machineId: m.machineId,
          dayIndex: d,
          dateStart: n == 0,
          dateEnd: n == total - 1,
          machineStart: j == 0,
          machineEnd: j == m.entries.length - 1,
        ));
        n++;
      }
    }
  }
  return out;
}

/// The single position of [c], or null while nothing (or, for a frame while the
/// table is being rebuilt, two scroll views) is attached — `c.position` throws
/// in both of those cases.
ScrollPosition? soleScrollPosition(ScrollController c) => c.positions.length == 1 ? c.positions.first : null;

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
    head = math.max(40.0, (2 * headFont * 1.15 * scale.clamp(1.0, 1.6) + 12).ceilToDouble());
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
  });

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

  void _toggle(String id) {
    final wasOpen = _open.contains(id);
    setState(() => wasOpen ? _open.remove(id) : _open.add(id));
    // Collapsing shrinks the table under the scroll offset; bring the total
    // this breakdown belongs to back into view instead of being thrown to the
    // far right.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final m = soleScrollPosition(widget.hController);
      if (!mounted || m == null || !m.hasPixels || !m.hasContentDimensions) return;
      if (m.pixels > m.maxScrollExtent) m.jumpTo(m.maxScrollExtent);
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final tablet = widget.tablet;
    final metrics = TableMetrics(context, tablet: tablet);
    final cols = buildSheetColumns(_open);
    final k = metrics.k;
    // The frozen columns keep close to their design width however large the
    // text is (their text ellipsises instead), or they would eat the screen.
    final kf = math.min(k, 1.15);
    final leftW = cols.leftWidth(kf);
    final midW0 = cols.middleWidth(k);
    final actW = actionsWidth;

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
        if (extra > 0 && cols.middle.isNotEmpty) widths[cols.middle.last.key] = widths[cols.middle.last.key]! + extra;

        // On a very narrow screen at a large text size there is no room left for
        // the scrolling middle: let Actions (then Date + Machine) scroll instead.
        final freezeLeft = vw - leftW >= 140;
        final freezeRight = vw - leftW - actW >= 100;
        final palette = _Palette(context);
        final h = widget.hController;
        final items = widget.items;
        final rowH = metrics.row;

        Widget frozen(bool on, double Function(double h) dx, Widget child) => !on
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
                  child: Row(children: [for (final c in cols.middle) _HeadCell(col: c, width: widths[c.key]!, metrics: metrics, palette: palette, onToggle: _toggle)]),
                ),
                Positioned(
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: leftW,
                  child: frozen(
                    freezeLeft,
                    (o) => o,
                    Row(children: [for (final c in cols.left) _HeadCell(col: c, width: widths[c.key]!, metrics: metrics, palette: palette, onToggle: _toggle)]),
                  ),
                ),
                Positioned(
                  left: totalW - actW,
                  top: 0,
                  bottom: 0,
                  width: actW,
                  child: frozen(freezeRight, (o) => o + vw - totalW, _HeadCell.actions(width: actW, metrics: metrics, palette: palette)),
                ),
              ],
            ),
          );
        }

        Widget bodyRow(int i) {
          final it = items[i];
          final d = CellData(
            row: it.row,
            calc: widget.controller.calcOf(it.row),
            day: widget.controller.dayOf(it.row),
            machineName: widget.controller.machineName[it.machineId] ?? '—',
          );
          Widget cell(SheetCol c) => _BodyCell(
                key: ValueKey('${it.id}:${c.key}'),
                col: c,
                width: widths[c.key]!,
                item: it,
                data: d,
                metrics: metrics,
                palette: palette,
                machineTone: c.key == 'machine' ? MachineColors.of(widget.controller.machineOf(it.machineId), widget.controller.rankOf(it.machineId)) : null,
              );
          return SizedBox(
            key: ValueKey('trow-${it.id}'),
            width: totalW,
            height: rowH,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Positioned(left: leftW, top: 0, bottom: 0, width: midW, child: Row(children: [for (final c in cols.middle) cell(c)])),
                Positioned(left: 0, top: 0, bottom: 0, width: leftW, child: frozen(freezeLeft, (o) => o, Row(children: [for (final c in cols.left) cell(c)]))),
                Positioned(
                  left: totalW - actW,
                  top: 0,
                  bottom: 0,
                  width: actW,
                  child: frozen(
                    freezeRight,
                    (o) => o + vw - totalW,
                    _ActionsCell(
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
          itemExtentBuilder: (i, _) => i == items.length ? widget.footerExtent : rowH,
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
                          child: SingleChildScrollView(physics: const NeverScrollableScrollPhysics(), child: widget.footer),
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
          physics: const ClampingScrollPhysics(parent: AlwaysScrollableScrollPhysics()),
          child: SizedBox(
            width: totalW,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [headerRow(), Expanded(child: list)],
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
                    final has = pos != null && pos.hasPixels && pos.hasContentDimensions;
                    final show = has && (left ? pos.pixels > 0.5 : pos.pixels < pos.maxScrollExtent - 0.5);
                    return AnimatedOpacity(
                      opacity: show ? 1 : 0,
                      duration: const Duration(milliseconds: 120),
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: left ? Alignment.centerLeft : Alignment.centerRight,
                            end: left ? Alignment.centerRight : Alignment.centerLeft,
                            colors: [Colors.black.withValues(alpha: dark ? 0.45 : 0.14), Colors.transparent],
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
            notificationPredicate: (n) => n.depth == 1 && n.metrics.axis == Axis.vertical,
            interactive: true,
            child: Scrollbar(
              controller: h,
              notificationPredicate: (n) => n.depth == 0 && n.metrics.axis == Axis.horizontal,
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

  Color day(int dayIndex) =>
      dayIndex.isEven ? s.surface : Color.alphaBlend(s.onSurface.withValues(alpha: dark ? 0.05 : 0.035), s.surface);

  Color wash(Color base, Color tone, double lightA, double darkA) => Color.alphaBlend(tone.withValues(alpha: dark ? darkA : lightA), base);

  Color bg(ColTone tone, int dayIndex) {
    final base = day(dayIndex);
    return switch (tone) {
      ColTone.none => base,
      ColTone.calc => wash(base, SheetTones.calc, 0.08, 0.16),
      ColTone.day => wash(base, SheetTones.day, 0.09, 0.16),
      ColTone.oee => wash(base, SheetTones.oee, dayIndex.isEven ? 0.10 : 0.17, dayIndex.isEven ? 0.20 : 0.28),
    };
  }

  Color text(ColTone tone) => switch (tone) {
        ColTone.none => s.onSurface,
        ColTone.calc => SheetTones.text(_context, SheetTones.calc),
        ColTone.day => SheetTones.text(_context, SheetTones.day),
        ColTone.oee => SheetTones.text(_context, SheetTones.oee),
      };

  Color headText(ColTone tone) => tone == ColTone.none ? s.onSurfaceVariant : text(tone);

  Color get headBg => s.surface;
}

class _HeadCell extends StatelessWidget {
  const _HeadCell({required this.col, required this.width, required this.metrics, required this.palette, required this.onToggle}) : _actions = false;

  const _HeadCell.actions({required this.width, required this.metrics, required this.palette})
      : col = null,
        onToggle = null,
        _actions = true;

  final SheetCol? col;
  final double width;
  final TableMetrics metrics;
  final _Palette palette;
  final void Function(String id)? onToggle;
  final bool _actions;

  @override
  Widget build(BuildContext context) {
    final c = col;
    final label = _actions ? 'Actions' : c!.label;
    final tone = _actions ? ColTone.none : c!.tone;
    final formulaKey = c?.formulaKey;
    final expand = c?.expand;
    final color = palette.headText(tone);
    final decoration = BoxDecoration(
      color: palette.headBg,
      border: Border(right: BorderSide(color: palette.strong, width: 1), bottom: BorderSide(color: palette.strong, width: 2)),
    );
    final text = Text(
      label,
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
      textAlign: _actions || !(c?.start ?? false) ? TextAlign.center : TextAlign.start,
      style: TextStyle(fontSize: metrics.headFont, height: 1.15, fontWeight: FontWeight.w700, color: color),
    );
    Widget content = Padding(
      padding: EdgeInsets.only(left: 6, right: expand == null ? 6 : 2),
      child: Row(
        children: [
          Expanded(child: text),
          if (formulaKey != null) Padding(padding: const EdgeInsets.only(left: 3), child: Icon(Icons.info_outline_rounded, size: 14, color: palette.s.onSurfaceVariant)),
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
          onTap: () => showFormulaSheet(context, title: label, formulaKey: formulaKey),
          child: content,
        ),
      );
    }
    return Container(key: ValueKey('head-${_actions ? 'actions' : c!.key}'), width: width, height: metrics.head, decoration: decoration, child: content);
  }
}

class _Chevron extends StatelessWidget {
  const _Chevron({required this.expand, required this.onToggle});
  final ColExpand expand;
  final void Function(String id) onToggle;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final label = expand.isOpen ? 'Collapse ${expand.label}' : 'Expand ${expand.label}';
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: Tooltip(
        message: label,
        child: InkResponse(
          key: ValueKey('expand-${expand.id}-${expand.isOpen ? (expand.end ? 'open-end' : 'open') : 'closed'}'),
          radius: 20,
          onTap: () => onToggle(expand.id),
          child: SizedBox(
            width: 32,
            height: 40,
            child: Center(
              child: Container(
                width: 20,
                height: 20,
                decoration: BoxDecoration(color: s.surfaceContainerHigh, shape: BoxShape.circle, border: Border.all(color: s.outline)),
                child: Icon(expand.isOpen ? Icons.chevron_left_rounded : Icons.chevron_right_rounded, size: 16, color: s.onSurface),
              ),
            ),
          ),
        ),
      ),
    );
  }
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
    this.machineTone,
  });

  final SheetCol col;
  final double width;
  final SheetTableItem item;
  final CellData data;
  final TableMetrics metrics;
  final _Palette palette;
  final Color? machineTone;

  @override
  Widget build(BuildContext context) {
    final show = switch (col.merge) {
      ColMerge.none => true,
      ColMerge.date => item.dateStart,
      ColMerge.machineDay => item.machineStart,
    };
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
      left: machineTone != null ? BorderSide(color: machineTone!, width: 3) : BorderSide.none,
      right: BorderSide(color: palette.grid),
      top: topRule ? BorderSide(color: palette.strong, width: 2) : BorderSide.none,
      bottom: joinBelow ? BorderSide.none : BorderSide(color: palette.grid),
    );

    Widget? child;
    if (show) {
      final txt = col.remarkKind == 'general' ? '' : col.text(data);
      final fw = col.tone == ColTone.oee ? FontWeight.w800 : (col.bold || col.tone != ColTone.none ? FontWeight.w700 : FontWeight.w500);
      final faint = txt == '—';
      final textWidget = txt.isEmpty
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
                color: faint ? s.onSurfaceVariant.withValues(alpha: 0.7) : palette.text(col.tone),
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            );
      if (col.remarkKind != null) {
        final parts = [for (final p in remarkParts(item.row)) if (p['key'] == col.remarkKind) p];
        final eye = parts.isEmpty ? null : _RemarkEye(parts: parts, kind: col.remarkKind!, id: item.id, metrics: metrics);
        if (col.remarkKind == 'general') {
          child = Center(child: eye ?? Text('—', style: TextStyle(fontSize: metrics.font, color: s.onSurfaceVariant.withValues(alpha: 0.55))));
        } else {
          child = Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [if (textWidget != null) Flexible(child: textWidget), ?eye],
          );
        }
      } else if (textWidget != null) {
        child = Align(alignment: col.start ? Alignment.centerLeft : Alignment.center, child: textWidget);
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
  const _RemarkEye({required this.parts, required this.kind, required this.id, required this.metrics});
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
    final canEdit = access.canEdit && !locked;
    final canDelete = access.canDelete && !locked;
    final side = math.min(44.0, metrics.row);
    final s = palette.s;

    Widget iconBtn({required Key key, required IconData icon, required String tip, required Color color, VoidCallback? onTap}) => SizedBox(
          width: 44,
          height: side,
          child: IconButton(key: key, tooltip: tip, padding: EdgeInsets.zero, iconSize: 19, color: color, icon: Icon(icon), onPressed: onTap),
        );

    Widget child;
    if (locked) {
      if (access.isAdmin) {
        final busy = controller.unlockingId == id;
        final warn = SheetTones.text(context, SheetTones.lock);
        child = Center(
          child: TextButton.icon(
            key: ValueKey('unlock-$id'),
            onPressed: busy ? null : () => onUnlock(row),
            style: TextButton.styleFrom(
              foregroundColor: warn,
              minimumSize: Size(64, side),
              padding: const EdgeInsets.symmetric(horizontal: 8),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              textStyle: TextStyle(fontSize: metrics.font, fontWeight: FontWeight.w700),
            ),
            icon: busy ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.lock_open_rounded, size: 16),
            label: Text(busy ? 'Unlocking…' : 'Unlock', maxLines: 1, softWrap: false),
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
      final deleting = controller.deletingId == id;
      child = Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (canEdit)
            iconBtn(key: ValueKey('edit-$id'), icon: Icons.edit_outlined, tip: 'Edit', color: SheetTones.text(context, AppColors.brand600), onTap: () => onEdit(row)),
          if (canDelete)
            iconBtn(
              key: ValueKey('delete-$id'),
              icon: Icons.delete_outline_rounded,
              tip: 'Delete',
              color: SheetTones.text(context, AppColors.critical),
              onTap: deleting ? null : () => onDelete(row),
            ),
        ],
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
          top: item.boundary ? BorderSide(color: palette.strong, width: 2) : BorderSide.none,
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

class _SheetTableSkeletonState extends State<SheetTableSkeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final rowH = TableMetrics.rowHeight(widget.tablet);
    Widget bone(double w, double h) => Container(width: w, height: h, decoration: BoxDecoration(color: s.surfaceContainerHigh, borderRadius: BorderRadius.circular(6)));
    return Semantics(
      label: 'Loading entries',
      child: ExcludeSemantics(
        child: FadeTransition(
          opacity: Tween<double>(begin: 0.45, end: 1).animate(CurvedAnimation(parent: _pulse, curve: Curves.easeInOut)),
          child: ListView(
            key: const ValueKey('sheet-skeleton'),
            physics: const NeverScrollableScrollPhysics(),
            children: [
              Container(
                height: 40,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(border: Border(bottom: BorderSide(color: s.outline, width: 2))),
                child: Row(children: [bone(64, 14), const SizedBox(width: 24), bone(54, 14), const SizedBox(width: 24), bone(90, 14), const Spacer(), bone(70, 14)]),
              ),
              for (var i = 0; i < 14; i++)
                Container(
                  height: rowH,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(border: Border(bottom: BorderSide(color: s.outlineVariant))),
                  child: Row(children: [bone(70, 12), const SizedBox(width: 24), bone(44, 12), const SizedBox(width: 24), bone(100, 12), const Spacer(), bone(56, 12)]),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
