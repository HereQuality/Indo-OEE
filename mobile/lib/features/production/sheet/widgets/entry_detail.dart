import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/formatters.dart';
import '../../shared/production_entry_validation.dart';
import '../../shared/production_sheet_calc.dart';
import '../sheet_model.dart';
import 'sheet_format.dart';
import 'sheet_popovers.dart';
import 'sheet_style.dart';

/// Everything one saved entry holds, grouped: the three OEE percentages up
/// top, then Quantities, Time, Stoppage, Efficiency and the entry's own text —
/// every calculated column of the web sheet's table, with the "Other" reject /
/// downtime remarks behind an eye beside their figure and the general remark
/// on its own row, exactly as the web sheet places them. The action bar at the
/// bottom is Edit / Delete, or the lock notice (with Unlock for a Super Admin).
class EntryDetail extends StatelessWidget {
  const EntryDetail({
    super.key,
    required this.row,
    required this.calc,
    required this.day,
    required this.lockMessage,
    required this.unlockedUntil,
    required this.canEdit,
    required this.canDelete,
    required this.isAdmin,
    required this.unlocking,
    required this.deleting,
    required this.onEdit,
    required this.onDelete,
    required this.onUnlock,
  });

  final Json row;
  final Json calc;
  final Json day;
  final String lockMessage;
  final DateTime? unlockedUntil;
  final bool canEdit;
  final bool canDelete;
  final bool isAdmin;
  final bool unlocking;
  final bool deleting;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onUnlock;

  Object? _v(String key) => row[key];

  List<Json> _remarks(String kind) => [
        for (final p in remarkParts(row))
          if (p['key'] == kind) p,
      ];

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final breakdown = row['rejectBreakdown'] is Map ? Map<String, dynamic>.from(row['rejectBreakdown'] as Map) : <String, dynamic>{};
    final excluded = row['excludedOps'] is List ? (row['excludedOps'] as List).map((e) => '$e').toSet() : <String>{};

    final rejectRows = <Widget>[
      for (final reason in rejectReasons)
        if (hasValue(breakdown[reason]) || (reason == 'Other' && _remarks('reject').isNotEmpty))
          _SubRow(
            label: reason,
            value: minStr(breakdown[reason]),
            remarks: reason == 'Other' ? _remarks('reject') : const [],
            remarkTone: SheetTones.reject,
            remarkLabel: 'View reject remark',
          ),
    ];
    final opRows = <Widget>[
      for (final f in cycleOpFields)
        if (hasValue(row[f['key']]))
          _SubRow(
            label: cycleOpLabel(f),
            value: minStr(row[f['key']]),
            struck: excluded.contains(f['key']),
            note: excluded.contains(f['key']) ? 'skipped' : null,
          ),
    ];
    const downtimeOrder = ['setupMin', 'noManPowerMin', 'materialShiftingMin', 'noMaterialMin', 'bdMechMin', 'bdEleMin', 'noPowerMin', 'otherMin', 'plannedDownMin'];
    final stopRows = <Widget>[
      for (final key in downtimeOrder)
        if (positive(row[key]))
          _SubRow(
            label: downtimeLabels[key] ?? key,
            value: zeroIfBlank(row[key]),
            unit: 'min',
            remarks: key == 'otherMin' ? _remarks('downtime') : const [],
            remarkTone: SheetTones.downtime,
            remarkLabel: 'View downtime remark',
          ),
    ];

    final general = _remarks('general');
    final generalText = general.isEmpty ? '' : '${general.first['text']}';
    final allowed = stoppageLimitMin(row);

    return Container(
      key: ValueKey('detail-${row['_id']}'),
      width: double.infinity,
      decoration: BoxDecoration(
        color: s.surfaceContainerLow,
        border: Border(top: BorderSide(color: s.outlineVariant)),
      ),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _OeeStrip(day: day),
          const SizedBox(height: 10),
          _Group(
            title: 'Quantities',
            icon: Icons.inventory_2_outlined,
            children: [
              _Metric(label: 'Total Cycle Time (sec)', value: nStr(calc['totalCycleSec']), tone: SheetTones.calc, formulaKey: 'cycle'),
              ...opRows,
              _Metric(label: 'Ideal Quantity', value: nStr(calc['idealQty']), tone: SheetTones.calc, formulaKey: 'idealQty'),
              _Metric(label: 'Actual Quantity', value: nStr(calc['actualQty'])),
              _Metric(label: 'Actual OK Quantity', value: minStr(_v('okQty')), strong: true),
              _Metric(label: 'Rejected Quantity', value: nStr(calc['rejectedQty']), tone: SheetTones.calc, formulaKey: 'rejectedQty'),
              ...rejectRows,
              _Metric(label: '% OK Quantity', value: pctStr(calc['pctOk']), tone: SheetTones.calc, formulaKey: 'pctOk'),
            ],
          ),
          _Group(
            title: 'Time',
            icon: Icons.schedule_rounded,
            children: [
              _Metric(label: 'Machine ON Time', value: textStr(_v('machineOnTime'))),
              _Metric(label: 'Machine OFF Time', value: textStr(_v('machineOffTime'))),
              _Metric(label: 'Machine Shift Time (hr)', value: nStr(calc['shiftHours']), tone: SheetTones.calc, formulaKey: 'shift'),
              _Metric(label: 'Planned Operator Shift Time (hr)', value: minStr(_v('plannedOperatorShiftHours'))),
              _Metric(label: 'Lunch / Rest (min)', value: zeroIfBlank(_v('lunchMin'))),
              _Metric(label: 'Stoppage Allowed (min)', value: nStr(allowed), tone: SheetTones.calc, formulaKey: 'stoppageAllowed'),
              _Metric(label: 'Unutilized Machine Time (%)', value: pctStr(day['unutilized']), tone: SheetTones.day, formulaKey: 'unutilized'),
              _Metric(label: 'Gap to next shift (min)', value: nStr(day['gapMin']), tone: SheetTones.day, formulaKey: 'gap'),
            ],
          ),
          _Group(
            title: 'Stoppage',
            icon: Icons.pause_circle_outline_rounded,
            children: [
              _Metric(label: 'Total Stoppage (min)', value: nStr(calc['totalStoppageMin']), tone: SheetTones.calc, formulaKey: 'totalStoppage'),
              ...stopRows,
            ],
          ),
          _Group(
            title: 'Efficiency',
            icon: Icons.speed_rounded,
            children: [
              _Metric(label: 'Effective Machine Run Time (hr)', value: nStr(calc['effectiveHours']), tone: SheetTones.calc, formulaKey: 'effective'),
              _Metric(label: 'Setup Efficiency (%)', value: pctStr(calc['setupEfficiency']), tone: SheetTones.calc, formulaKey: 'setupEff'),
              _Metric(label: 'Unreported Time (min)', value: nStr(day['unreportedMin']), tone: SheetTones.day, formulaKey: 'unreported'),
            ],
          ),
          _Group(
            title: 'Entry',
            icon: Icons.assignment_outlined,
            children: [
              _Metric(label: 'Operator', value: textStr(_v('operator'))),
              _Metric(label: 'Part Name', value: textStr(_v('itemName'))),
              _Metric(label: 'Drawing No.', value: textStr(_v('drawingNo'))),
              _Metric(
                label: 'Remarks',
                value: generalText.isEmpty ? '—' : generalText,
                maxLines: 3,
                remarks: general,
                remarkTone: s.onSurfaceVariant,
              ),
            ],
          ),
          const SizedBox(height: 4),
          _ActionBar(
            row: row,
            lockMessage: lockMessage,
            unlockedUntil: unlockedUntil,
            canEdit: canEdit,
            canDelete: canDelete,
            isAdmin: isAdmin,
            unlocking: unlocking,
            deleting: deleting,
            onEdit: onEdit,
            onDelete: onDelete,
            onUnlock: onUnlock,
          ),
        ],
      ),
    );
  }
}

/// The three OEE percentages — the sheet's headline numbers. Combined across
/// every entry of the machine's date, so every entry of that day shows the same.
class _OeeStrip extends StatelessWidget {
  const _OeeStrip({required this.day});
  final Json day;

  @override
  Widget build(BuildContext context) {
    final tiles = [
      ('oeeLosses', 'OEE considering losses', 'Considering losses'),
      ('oeeLunch', 'OEE not considering losses but lunch', 'Lunch only'),
      ('oeeLunchCot', 'OEE not considering losses but lunch and setup time', 'Lunch + Setup Time'),
    ];
    final big = MediaQuery.textScalerOf(context).scale(14) > 19;
    Widget tile((String, String, String) t) => _OeeTile(
          formulaKey: t.$1,
          title: t.$2,
          label: t.$3,
          value: pctStr(day[t.$1]),
          wide: big,
        );
    if (big) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [for (final t in tiles) Padding(padding: const EdgeInsets.only(bottom: 6), child: tile(t))],
      );
    }
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < tiles.length; i++) ...[
            if (i > 0) const SizedBox(width: 8),
            Expanded(child: tile(tiles[i])),
          ],
        ],
      ),
    );
  }
}

class _OeeTile extends StatelessWidget {
  const _OeeTile({required this.formulaKey, required this.title, required this.label, required this.value, required this.wide});
  final String formulaKey;
  final String title;
  final String label;
  final String value;
  final bool wide;

  @override
  Widget build(BuildContext context) {
    final tone = SheetTones.text(context, SheetTones.oee);
    final labelText = Text(
      label,
      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Theme.of(context).colorScheme.onSurfaceVariant),
    );
    final valueText = FittedBox(
      fit: BoxFit.scaleDown,
      alignment: wide ? Alignment.centerRight : Alignment.centerLeft,
      child: Text(value, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: tone, fontFeatures: const [FontFeature.tabularFigures()])),
    );
    return Semantics(
      button: true,
      label: '$title $value, tap for the formula',
      child: Material(
        color: SheetTones.wash(context, SheetTones.oee),
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => showFormulaSheet(context, title: title, formulaKey: formulaKey),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
            child: wide
                ? Row(
                    children: [
                      Expanded(child: labelText),
                      const SizedBox(width: 10),
                      Flexible(child: valueText),
                    ],
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [labelText, const SizedBox(height: 4), valueText],
                  ),
          ),
        ),
      ),
    );
  }
}

class _Group extends StatelessWidget {
  const _Group({required this.title, required this.icon, required this.children});
  final String title;
  final IconData icon;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: 3),
            child: Row(
              children: [
                Icon(icon, size: 14, color: s.onSurfaceVariant),
                const SizedBox(width: 5),
                Text(
                  title.toUpperCase(),
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.4, color: s.onSurfaceVariant),
                ),
              ],
            ),
          ),
          Container(
            decoration: BoxDecoration(
              color: s.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: s.outlineVariant),
            ),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (var i = 0; i < children.length; i++) ...[
                  if (i > 0) Divider(height: 1, thickness: 1, color: s.outlineVariant.withValues(alpha: 0.6)),
                  children[i],
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A label / value line; a tap on a calculated one shows its formula.
class _Metric extends StatelessWidget {
  const _Metric({
    required this.label,
    required this.value,
    this.tone,
    this.formulaKey,
    this.strong = false,
    this.maxLines = 2,
    this.remarks = const [],
    this.remarkTone,
  });

  final String label;
  final String value;
  final Color? tone;
  final String? formulaKey;
  final bool strong;
  final int maxLines;
  final List<Json> remarks;
  final Color? remarkTone;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final color = tone == null ? s.onSurface : SheetTones.text(context, tone!);
    final calculated = tone != null;
    final content = ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 38),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              flex: 5,
              child: Text.rich(
                TextSpan(
                  text: label,
                  style: TextStyle(fontSize: 13, color: s.onSurfaceVariant),
                  children: [
                    if (formulaKey != null)
                      WidgetSpan(
                        alignment: PlaceholderAlignment.middle,
                        child: Padding(
                          padding: const EdgeInsets.only(left: 5),
                          child: Icon(Icons.info_outline_rounded, size: 14, color: s.onSurfaceVariant.withValues(alpha: 0.7)),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 12),
            Flexible(
              flex: 4,
              child: Text(
                value,
                textAlign: TextAlign.end,
                maxLines: maxLines,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: calculated || strong ? FontWeight.w700 : FontWeight.w500,
                  color: color,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ),
            if (remarks.isNotEmpty) _EyeButton(parts: remarks, tone: remarkTone ?? s.onSurfaceVariant, label: 'View remarks'),
          ],
        ),
      ),
    );
    if (formulaKey == null) return content;
    return InkWell(
      onTap: () => showFormulaSheet(context, title: label, formulaKey: formulaKey!),
      child: content,
    );
  }
}

/// An indented line under a figure (one reject reason, one downtime cause, one
/// operation time). The "Other" ones carry the eye with their required remark.
class _SubRow extends StatelessWidget {
  const _SubRow({
    required this.label,
    required this.value,
    this.unit,
    this.struck = false,
    this.note,
    this.remarks = const [],
    this.remarkTone,
    this.remarkLabel,
  });

  final String label;
  final String value;
  final String? unit;
  final bool struck;
  final String? note;
  final List<Json> remarks;
  final Color? remarkTone;
  final String? remarkLabel;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Container(
      color: s.surfaceContainerLow.withValues(alpha: 0.5),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 34),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 3, 12, 3),
          child: Row(
            children: [
              Expanded(
                flex: 5,
                child: Text.rich(
                  TextSpan(
                    text: label,
                    style: TextStyle(fontSize: 12.5, color: s.onSurfaceVariant, decoration: struck ? TextDecoration.lineThrough : null),
                    children: [
                      if (note != null)
                        TextSpan(text: '  $note', style: TextStyle(fontSize: 11.5, fontStyle: FontStyle.italic, color: AppColors.readable(context, AppColors.warn))),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Flexible(
                flex: 3,
                child: Text(
                  unit == null ? value : '$value $unit',
                  textAlign: TextAlign.end,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: s.onSurface,
                    decoration: struck ? TextDecoration.lineThrough : null,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
              if (remarks.isNotEmpty) _EyeButton(parts: remarks, tone: remarkTone ?? s.onSurfaceVariant, label: remarkLabel ?? 'View remarks'),
            ],
          ),
        ),
      ),
    );
  }
}

/// The eye that opens a remark next to the figure it explains.
class _EyeButton extends StatelessWidget {
  const _EyeButton({required this.parts, required this.tone, required this.label});
  final List<Json> parts;
  final Color tone;
  final String label;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: label,
      constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
      padding: EdgeInsets.zero,
      visualDensity: VisualDensity.compact,
      iconSize: 19,
      color: SheetTones.text(context, tone),
      icon: const Icon(Icons.visibility_outlined),
      onPressed: () => showRemarkSheet(context, parts),
    );
  }
}

class _ActionBar extends StatelessWidget {
  const _ActionBar({
    required this.row,
    required this.lockMessage,
    required this.unlockedUntil,
    required this.canEdit,
    required this.canDelete,
    required this.isAdmin,
    required this.unlocking,
    required this.deleting,
    required this.onEdit,
    required this.onDelete,
    required this.onUnlock,
  });

  final Json row;
  final String lockMessage;
  final DateTime? unlockedUntil;
  final bool canEdit;
  final bool canDelete;
  final bool isAdmin;
  final bool unlocking;
  final bool deleting;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onUnlock;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final id = '${row['_id']}';
    if (lockMessage.isNotEmpty) {
      final warn = SheetTones.text(context, SheetTones.lock);
      return Container(
        key: ValueKey('lock-$id'),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: SheetTones.wash(context, SheetTones.lock),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.lock_outline_rounded, size: 20, color: warn),
                const SizedBox(width: 10),
                Expanded(child: Text(lockMessage, style: TextStyle(fontSize: 13, height: 1.3, color: s.onSurface))),
              ],
            ),
            if (isAdmin) ...[
              const SizedBox(height: 10),
              OutlinedButton.icon(
                key: ValueKey('unlock-$id'),
                onPressed: unlocking ? null : onUnlock,
                style: OutlinedButton.styleFrom(foregroundColor: warn, side: BorderSide(color: warn.withValues(alpha: 0.6))),
                icon: unlocking
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.lock_open_rounded, size: 18),
                label: Text(unlocking ? 'Unlocking…' : 'Unlock for 24 hours'),
              ),
            ],
          ],
        ),
      );
    }
    final children = <Widget>[
      if (unlockedUntil != null)
        Container(
          key: ValueKey('unlocked-$id'),
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: SheetTones.wash(context, AppColors.ok), borderRadius: BorderRadius.circular(12)),
          child: Row(
            children: [
              Icon(Icons.lock_open_rounded, size: 20, color: SheetTones.text(context, AppColors.ok)),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Unlocked until ${Fmt.dateTime(unlockedUntil)} — edit or delete before it locks again.',
                  style: TextStyle(fontSize: 13, height: 1.3, color: s.onSurface),
                ),
              ),
            ],
          ),
        ),
      if (canEdit || canDelete)
        Row(
          children: [
            if (canEdit)
              Expanded(
                child: FilledButton.tonalIcon(
                  key: ValueKey('edit-$id'),
                  onPressed: onEdit,
                  icon: const Icon(Icons.edit_outlined, size: 18),
                  label: const Text('Edit'),
                ),
              ),
            if (canEdit && canDelete) const SizedBox(width: 10),
            if (canDelete)
              Expanded(
                child: OutlinedButton.icon(
                  key: ValueKey('delete-$id'),
                  onPressed: deleting ? null : onDelete,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: SheetTones.text(context, AppColors.critical),
                    side: BorderSide(color: AppColors.critical.withValues(alpha: 0.5)),
                  ),
                  icon: deleting
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.delete_outline_rounded, size: 18),
                  label: Text(deleting ? 'Deleting…' : 'Delete'),
                ),
              ),
          ],
        ),
    ];
    if (children.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children);
  }
}
