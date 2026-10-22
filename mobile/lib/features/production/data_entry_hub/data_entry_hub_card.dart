import 'package:flutter/material.dart';

import 'data_entry_hub_model.dart';

/// One process on the hub: icon, name, machine count (or why it can't be
/// opened) and a chevron.
class HubCard extends StatelessWidget {
  const HubCard({super.key, required this.entry, required this.onTap});
  final HubEntry entry;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final on = entry.enabled;
    final fg = on ? s.onSurface : s.onSurface.withValues(alpha: 0.5);
    return Semantics(
      button: true,
      enabled: on,
      label: '${entry.process.name}, ${entry.subtitle}',
      excludeSemantics: true,
      onTap: on ? onTap : null,
      child: Card(
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: s.outlineVariant),
        ),
        child: InkWell(
          onTap: on ? onTap : null,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: (on ? s.primary : s.onSurfaceVariant).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    on ? Icons.precision_manufacturing_outlined : Icons.do_not_disturb_on_outlined,
                    color: on ? s.primary : s.onSurfaceVariant,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        entry.process.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: fg),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        entry.subtitle,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 13, color: s.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                if (on) ...[
                  const SizedBox(width: 8),
                  Icon(Icons.chevron_right_rounded, color: s.onSurfaceVariant),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
