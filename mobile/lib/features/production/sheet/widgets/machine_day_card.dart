import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';

import '../../../../core/theme/app_colors.dart';
import '../../shared/production_sheet_calc.dart';
import '../sheet_controller.dart';
import '../sheet_model.dart';
import 'entry_detail.dart';
import 'sheet_format.dart';
import 'sheet_popovers.dart';
import 'sheet_style.dart';

/// What the signed-in role may do on this page (Manage Role) plus SuperAdmin.
class SheetAccess {
  const SheetAccess({required this.canEdit, required this.canDelete, required this.isAdmin});
  final bool canEdit;
  final bool canDelete;
  final bool isAdmin;
}

typedef EntryAction = Future<void> Function(Json row);

/// One machine's day: a coloured header (machine, entries, the day's OEE) and
/// its entries — up to three — as compact rows that expand into the full
/// calculated detail. Swipe a row right to edit (Unlock, for a Super Admin, on
/// a locked one) or left to delete; long-press for the same as a menu.
class MachineDayCard extends StatelessWidget {
  const MachineDayCard({
    super.key,
    required this.group,
    required this.controller,
    required this.access,
    required this.expanded,
    required this.onToggle,
    required this.onEdit,
    required this.onDelete,
    required this.onUnlock,
    this.margin = const EdgeInsets.fromLTRB(16, 0, 16, 10),
  });

  final EdgeInsets margin;
  final SheetMachineDay group;
  final SheetController controller;
  final SheetAccess access;
  final Set<String> expanded;
  final void Function(String id) onToggle;
  final EntryAction onEdit;
  final EntryAction onDelete;
  final EntryAction onUnlock;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final tone = MachineColors.of(controller.machineOf(group.machineId), group.rank);
    final first = group.entries.first;
    final oee = controller.dayOf(first)['oeeLosses'];
    var ok = 0.0;
    var actual = 0.0;
    var anyOk = false;
    for (final e in group.entries) {
      final c = controller.calcOf(e);
      final a = c['actualQty'];
      if (isNum(a)) actual += (a as num).toDouble();
      final o = jsNumber(e['okQty']);
      if (isNum(o)) {
        ok += o!;
        anyOk = true;
      }
    }
    final filtered = group.entries.length < group.totalEntries;
    final entriesLabel = filtered
        ? '${group.entries.length} of ${group.totalEntries} entries'
        : '${group.entries.length} ${group.entries.length == 1 ? 'entry' : 'entries'}';

    return Padding(
      padding: margin,
      child: Container(
        key: ValueKey('card-${group.key}'),
        decoration: BoxDecoration(
          color: Theme.of(context).cardTheme.color ?? s.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: s.outlineVariant),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: Theme.of(context).brightness == Brightness.dark ? 0.28 : 0.05),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          children: [
            Positioned(left: 0, top: 0, bottom: 0, width: 5, child: ColoredBox(color: tone)),
            Padding(
              padding: const EdgeInsets.only(left: 5),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                group.machineName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                anyOk ? '$entriesLabel · OK ${fmtNum(ok)} / ${fmtNum(actual)}' : entriesLabel,
                                style: TextStyle(fontSize: 12.5, color: s.onSurfaceVariant),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        _OeeChip(value: oee),
                      ],
                    ),
                  ),
                  for (final e in group.entries) ...[
                    Divider(height: 1, thickness: 1, color: s.outlineVariant.withValues(alpha: 0.7)),
                    EntryRow(
                      key: ValueKey('entry-${e['_id']}'),
                      row: e,
                      controller: controller,
                      access: access,
                      expanded: expanded.contains('${e['_id']}'),
                      onToggle: () => onToggle('${e['_id']}'),
                      onEdit: onEdit,
                      onDelete: onDelete,
                      onUnlock: onUnlock,
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OeeChip extends StatelessWidget {
  const _OeeChip({required this.value});
  final Object? value;

  @override
  Widget build(BuildContext context) {
    final tone = SheetTones.text(context, SheetTones.oee);
    final text = pctStr(value);
    return Semantics(
      label: 'Day OEE considering losses $text',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(color: SheetTones.wash(context, SheetTones.oee), borderRadius: BorderRadius.circular(999)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('OEE', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.4, color: tone.withValues(alpha: 0.85))),
            const SizedBox(width: 6),
            Text(
              text,
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: tone, fontFeatures: const [FontFeature.tabularFigures()]),
            ),
          ],
        ),
      ),
    );
  }
}

/// One saved entry: the compact line, and under it (when open) the full detail.
class EntryRow extends StatelessWidget {
  const EntryRow({
    super.key,
    required this.row,
    required this.controller,
    required this.access,
    required this.expanded,
    required this.onToggle,
    required this.onEdit,
    required this.onDelete,
    required this.onUnlock,
  });

  final Json row;
  final SheetController controller;
  final SheetAccess access;
  final bool expanded;
  final VoidCallback onToggle;
  final EntryAction onEdit;
  final EntryAction onDelete;
  final EntryAction onUnlock;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final id = '${row['_id']}';
    final calc = controller.calcOf(row);
    final day = controller.dayOf(row);
    final lock = controller.lockInfo(row);
    final locked = lock.isNotEmpty;
    final unlockedUntil = controller.unlockedUntilOf(row);
    final canEdit = access.canEdit && !locked;
    final canDelete = access.canDelete && !locked;
    final canUnlock = access.isAdmin && locked;

    final startAction = canUnlock ? _SwipeKind.unlock : (canEdit ? _SwipeKind.edit : null);
    final endAction = canDelete ? _SwipeKind.delete : null;
    final direction = startAction != null && endAction != null
        ? DismissDirection.horizontal
        : startAction != null
            ? DismissDirection.startToEnd
            : endAction != null
                ? DismissDirection.endToStart
                : DismissDirection.none;

    final remarks = remarkParts(row);
    final slot = (jsNumber(row['slot']) ?? 0).toInt();
    final operator = '${row['operator'] ?? ''}'.trim();
    final part = '${row['itemName'] ?? ''}'.trim();
    final drawing = '${row['drawingNo'] ?? ''}'.trim();
    final on = '${row['machineOnTime'] ?? ''}';
    final off = '${row['machineOffTime'] ?? ''}';
    final okText = minStr(row['okQty']);
    final actualText = nStr(calc['actualQty']);

    Widget header = InkWell(
      key: ValueKey('toggle-$id'),
      onTap: () {
        HapticFeedback.selectionClick();
        onToggle();
      },
      onLongPress: () => _showMenu(context, canEdit: canEdit, canDelete: canDelete, canUnlock: canUnlock, hasRemarks: remarks.isNotEmpty),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 26,
              height: 26,
              alignment: Alignment.center,
              margin: const EdgeInsets.only(top: 1),
              decoration: BoxDecoration(color: s.surfaceContainerHigh, borderRadius: BorderRadius.circular(8)),
              child: Text('#$slot', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: s.onSurfaceVariant)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    operator.isEmpty ? '(no operator)' : operator,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: operator.isEmpty ? s.onSurfaceVariant : s.onSurface),
                  ),
                  if (part.isNotEmpty || drawing.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 1),
                      child: Text(
                        [if (part.isNotEmpty) part, if (drawing.isNotEmpty) drawing].join(' · '),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 13, color: s.onSurfaceVariant),
                      ),
                    ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (on.isNotEmpty || off.isNotEmpty) _Pill(icon: Icons.schedule_rounded, text: '${textStr(on)} – ${textStr(off)}'),
                      if (isNum(calc['shiftHours'])) _Pill(text: '${nStr(calc['shiftHours'])} hr'),
                      if (locked) _Pill(icon: Icons.lock_outline_rounded, text: 'Locked', tone: SheetTones.lock, key: ValueKey('locked-$id')),
                      if (!locked && unlockedUntil != null)
                        _Pill(icon: Icons.lock_open_rounded, text: 'Unlocked', tone: AppColors.ok, key: ValueKey('unlockedpill-$id')),
                      if (remarks.isNotEmpty) _Pill(icon: Icons.chat_bubble_outline_rounded, text: '${remarks.length}', key: ValueKey('remarks-$id')),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 118),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerRight,
                    child: Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(text: okText, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: s.onSurface)),
                          TextSpan(text: ' / $actualText', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: s.onSurfaceVariant)),
                        ],
                      ),
                      style: const TextStyle(fontFeatures: [FontFeature.tabularFigures()]),
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    isNum(calc['pctOk']) ? '${fmtPct(calc['pctOk'])} OK' : 'OK / Actual',
                    style: TextStyle(fontSize: 11.5, color: s.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            SizedBox(
              width: 32,
              height: 26,
              child: AnimatedRotation(
                turns: expanded ? 0.5 : 0,
                duration: const Duration(milliseconds: 200),
                child: Icon(Icons.keyboard_arrow_down_rounded, color: s.onSurfaceVariant),
              ),
            ),
          ],
        ),
      ),
    );

    if (direction != DismissDirection.none) {
      header = Dismissible(
        key: ValueKey('swipe-$id'),
        direction: direction,
        dismissThresholds: const {DismissDirection.startToEnd: 0.32, DismissDirection.endToStart: 0.32},
        background: _SwipeBackground(kind: startAction ?? endAction!, alignLeft: startAction != null),
        secondaryBackground: startAction != null && endAction != null ? _SwipeBackground(kind: endAction, alignLeft: false) : null,
        onUpdate: (d) {
          if (d.reached && !d.previousReached) HapticFeedback.mediumImpact();
        },
        confirmDismiss: (dir) async {
          if (dir == DismissDirection.startToEnd) {
            unawaited(startAction == _SwipeKind.unlock ? onUnlock(row) : onEdit(row));
          } else {
            await onDelete(row);
          }
          return false;
        },
        child: Material(color: Theme.of(context).cardTheme.color ?? s.surface, child: header),
      );
    }

    final actions = <CustomSemanticsAction, VoidCallback>{
      if (canEdit) const CustomSemanticsAction(label: 'Edit entry'): () => onEdit(row),
      if (canDelete) const CustomSemanticsAction(label: 'Delete entry'): () => onDelete(row),
      if (canUnlock) const CustomSemanticsAction(label: 'Unlock entry for 24 hours'): () => onUnlock(row),
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          customSemanticsActions: actions,
          child: header,
        ),
        AnimatedSize(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOutCubic,
          alignment: Alignment.topCenter,
          child: expanded
              ? EntryDetail(
                  row: row,
                  calc: calc,
                  day: day,
                  lockMessage: lock,
                  unlockedUntil: unlockedUntil,
                  canEdit: canEdit,
                  canDelete: canDelete,
                  isAdmin: access.isAdmin,
                  unlocking: controller.unlockingId == id,
                  deleting: controller.deletingId == id,
                  onEdit: () => onEdit(row),
                  onDelete: () => onDelete(row),
                  onUnlock: () => onUnlock(row),
                )
              : const SizedBox(width: double.infinity),
        ),
      ],
    );
  }

  Future<void> _showMenu(
    BuildContext context, {
    required bool canEdit,
    required bool canDelete,
    required bool canUnlock,
    required bool hasRemarks,
  }) async {
    if (!canEdit && !canDelete && !canUnlock && !hasRemarks) return;
    HapticFeedback.mediumImpact();
    final title = '${controller.machineName['${row['machine']}'] ?? ''} · #${(jsNumber(row['slot']) ?? 0).toInt()}';
    final choice = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      constraints: const BoxConstraints(maxWidth: 720),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            ),
            if (canEdit) ListTile(leading: const Icon(Icons.edit_outlined), title: const Text('Edit entry'), onTap: () => Navigator.pop(ctx, 'edit')),
            if (canUnlock)
              ListTile(leading: const Icon(Icons.lock_open_rounded), title: const Text('Unlock for 24 hours'), onTap: () => Navigator.pop(ctx, 'unlock')),
            if (hasRemarks) ListTile(leading: const Icon(Icons.visibility_outlined), title: const Text('View remarks'), onTap: () => Navigator.pop(ctx, 'remarks')),
            if (canDelete)
              ListTile(
                leading: Icon(Icons.delete_outline_rounded, color: SheetTones.text(ctx, AppColors.critical)),
                title: Text('Delete entry', style: TextStyle(color: SheetTones.text(ctx, AppColors.critical))),
                onTap: () => Navigator.pop(ctx, 'delete'),
              ),
          ],
        ),
      ),
    );
    if (!context.mounted || choice == null) return;
    switch (choice) {
      case 'edit':
        unawaited(onEdit(row));
      case 'unlock':
        unawaited(onUnlock(row));
      case 'delete':
        unawaited(onDelete(row));
      case 'remarks':
        unawaited(showRemarkSheet(context, remarkParts(row)));
    }
  }
}

enum _SwipeKind { edit, delete, unlock }

class _SwipeBackground extends StatelessWidget {
  const _SwipeBackground({required this.kind, required this.alignLeft});
  final _SwipeKind kind;
  final bool alignLeft;

  @override
  Widget build(BuildContext context) {
    final (color, icon, label) = switch (kind) {
      _SwipeKind.edit => (AppColors.brand600, Icons.edit_outlined, 'Edit'),
      _SwipeKind.unlock => (AppColors.warn, Icons.lock_open_rounded, 'Unlock'),
      _SwipeKind.delete => (AppColors.critical, Icons.delete_outline_rounded, 'Delete'),
    };
    return Container(
      color: color,
      alignment: alignLeft ? Alignment.centerLeft : Alignment.centerRight,
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: Colors.white, size: 22),
          const SizedBox(width: 8),
          Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({super.key, required this.text, this.icon, this.tone});
  final String text;
  final IconData? icon;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final fg = tone == null ? s.onSurfaceVariant : SheetTones.text(context, tone!);
    final bg = tone == null ? s.surfaceContainerHigh : SheetTones.wash(context, tone!);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 12.5, color: fg), const SizedBox(width: 4)],
          Flexible(
            child: Text(
              text,
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg, fontFeatures: const [FontFeature.tabularFigures()]),
            ),
          ),
        ],
      ),
    );
  }
}
