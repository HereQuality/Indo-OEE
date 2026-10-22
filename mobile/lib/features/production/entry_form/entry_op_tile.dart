import 'package:flutter/material.dart';

import 'entry_style.dart';

/// One cycle operation of the picked Part as a tickable tile. Untick to leave
/// it out of this entry's cycle time (its seconds stay struck through); a
/// Part without the operation shows it disabled.
class EntryOpTile extends StatelessWidget {
  const EntryOpTile({
    super.key,
    required this.label,
    required this.value,
    required this.ticked,
    required this.excluded,
    required this.enabled,
    required this.focusNode,
    required this.onToggle,
  });

  final String label;
  final String value;
  final bool ticked;
  final bool excluded;
  final bool enabled;
  final FocusNode focusNode;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final tint = ticked ? Color.alphaBlend(s.primary.withValues(alpha: 0.10), EntryStyle.fill(context)) : EntryStyle.fill(context);
    final valueStyle = excluded
        ? TextStyle(decoration: TextDecoration.lineThrough, color: s.onSurfaceVariant)
        : const TextStyle(fontWeight: FontWeight.w700);
    return Semantics(
      checked: ticked,
      enabled: enabled,
      label: value.isEmpty ? label : '$label, $value',
      excludeSemantics: true,
      onTap: enabled ? onToggle : null,
      child: Opacity(
        opacity: enabled ? 1 : 0.5,
        child: Focus(
          focusNode: focusNode,
          child: Material(
            color: tint,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(EntryStyle.radius),
              side: BorderSide(color: ticked ? s.primary.withValues(alpha: 0.55) : s.outlineVariant),
            ),
            child: InkWell(
              canRequestFocus: false,
              borderRadius: BorderRadius.circular(EntryStyle.radius),
              onTap: enabled ? onToggle : null,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 40),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(4, 2, 10, 2),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ExcludeFocus(
                        child: IgnorePointer(
                          child: Checkbox(
                            value: ticked,
                            onChanged: enabled ? (_) {} : null,
                            visualDensity: VisualDensity.compact,
                            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                        ),
                      ),
                      const SizedBox(width: 2),
                      Flexible(
                        child: Text.rich(
                          TextSpan(
                            style: const TextStyle(fontSize: 12.5, height: 1.25),
                            children: [
                              TextSpan(text: label, style: TextStyle(color: excluded ? s.onSurfaceVariant : s.onSurface)),
                              if (value.isNotEmpty) TextSpan(text: ' — $value', style: valueStyle),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
