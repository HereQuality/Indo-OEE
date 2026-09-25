import 'package:flutter/material.dart';

/// How the Data Entry list is drawn: the web-style table (default) or the
/// date-grouped cards.
enum SheetView { table, cards }

/// The small segmented "Table | Cards" switch in the toolbar. Two 48 px
/// segments (icon only on a phone, icon + label on the iPad).
class SheetViewToggle extends StatelessWidget {
  const SheetViewToggle({super.key, required this.value, required this.onChanged, this.labels = false});

  final SheetView value;
  final ValueChanged<SheetView> onChanged;
  final bool labels;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    Widget seg(SheetView v, IconData icon, String label) {
      final selected = v == value;
      final fg = selected ? s.onPrimaryContainer : s.onSurfaceVariant;
      return Semantics(
        button: true,
        selected: selected,
        label: '$label view',
        excludeSemantics: true,
        child: Tooltip(
          message: '$label view',
          child: InkWell(
            key: ValueKey('view-${v.name}'),
            onTap: selected ? null : () => onChanged(v),
            child: Container(
              constraints: BoxConstraints(minWidth: labels ? 0 : 46, minHeight: 46),
              padding: EdgeInsets.symmetric(horizontal: labels ? 14 : 0),
              alignment: Alignment.center,
              color: selected ? s.primaryContainer : Colors.transparent,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 20, color: fg),
                  if (labels) ...[
                    const SizedBox(width: 6),
                    Text(label, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: fg)),
                  ],
                ],
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      key: const ValueKey('sheet-view-toggle'),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: s.outline),
      ),
      clipBehavior: Clip.antiAlias,
      child: IntrinsicHeight(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            seg(SheetView.table, Icons.table_rows_rounded, 'Table'),
            VerticalDivider(width: 1, thickness: 1, color: s.outline),
            seg(SheetView.cards, Icons.view_agenda_outlined, 'Cards'),
          ],
        ),
      ),
    );
  }
}
