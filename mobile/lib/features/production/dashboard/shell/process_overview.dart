import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/theme/app_colors.dart';
import '../data/dashboard_models.dart';
import '../widgets/dash_card.dart';

String machineCountText(int count) => '$count machine${count == 1 ? '' : 's'}';

/// The dashboard's landing content: every process as a tile, then "All
/// machines" (port of ProcessOverview.jsx). Deliberately a plain menu — it
/// loads no production data; the entries request only happens once a process
/// is opened.
class ProcessOverview extends StatelessWidget {
  const ProcessOverview({
    super.key,
    required this.processes,
    required this.machines,
    required this.onOpen,
  });

  final List<ProcessInfo> processes;
  final List<Map<String, dynamic>> machines;

  /// The process id, or null for "All machines".
  final void Function(String? processId) onOpen;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final unassigned = machines.where(machineUnassigned).length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // The app bar already says "Dashboard"; this is the lead-in under it.
        Text('Select a process to open its dashboard', style: TextStyle(fontSize: 15, height: 1.3, color: cs.onSurfaceVariant)),
        const SizedBox(height: 18),
        if (processes.isEmpty)
          const _NoProcesses()
        else ...[
          _SectionLabel('Processes', count: processes.length),
          const SizedBox(height: 10),
          _TileGrid(
            children: [
              for (final p in processes)
                ProcessTile(
                  title: p.name,
                  subtitle: machineCountText(p.machines.length),
                  detail: _machinePreview(p.machines),
                  icon: Icons.precision_manufacturing_outlined,
                  onTap: () => onOpen(p.id),
                ),
            ],
          ),
        ],
        if (machines.isNotEmpty) ...[
          const SizedBox(height: 22),
          const _SectionLabel('Overview'),
          const SizedBox(height: 10),
          _TileGrid(
            children: [
              ProcessTile(
                title: 'All machines',
                subtitle: '${machineCountText(machines.length)}${unassigned > 0 ? ' · $unassigned not in any process' : ''}',
                icon: Icons.layers_outlined,
                emphasized: true,
                onTap: () => onOpen(null),
              ),
            ],
          ),
        ],
      ],
    );
  }

  /// "7A · 7B · 8A +4" — a glance at what is inside.
  static String? _machinePreview(List<Map<String, dynamic>> list) {
    final names = list.map(machineName).where((n) => n.isNotEmpty).toList();
    if (names.isEmpty) return null;
    const shown = 3;
    final head = names.take(shown).join(' · ');
    return names.length > shown ? '$head  +${names.length - shown}' : head;
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text, {this.count});
  final String text;
  final int? count;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Row(
      children: [
        Text(text.toUpperCase(), style: TextStyle(fontSize: 12, letterSpacing: 0.8, fontWeight: FontWeight.w700, color: cs.onSurfaceVariant)),
        if (count != null) ...[
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
            decoration: BoxDecoration(color: cs.onSurface.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(999)),
            child: Text('$count', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: cs.onSurfaceVariant)),
          ),
        ],
      ],
    );
  }
}

/// One column on a phone, two once there is room; rows share the height of
/// their tallest tile.
class _TileGrid extends StatelessWidget {
  const _TileGrid({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, box) {
        final columns = box.maxWidth >= 560 ? 2 : 1;
        if (columns == 1) {
          return Column(
            children: [
              for (var i = 0; i < children.length; i++) ...[
                if (i > 0) const SizedBox(height: 10),
                children[i],
              ],
            ],
          );
        }
        final rows = <Widget>[];
        for (var i = 0; i < children.length; i += columns) {
          final slice = children.skip(i).take(columns).toList();
          rows.add(
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var c = 0; c < columns; c++) ...[
                    if (c > 0) const SizedBox(width: 12),
                    Expanded(child: c < slice.length ? slice[c] : const SizedBox.shrink()),
                  ],
                ],
              ),
            ),
          );
        }
        return Column(
          children: [
            for (var i = 0; i < rows.length; i++) ...[
              if (i > 0) const SizedBox(height: 12),
              rows[i],
            ],
          ],
        );
      },
    );
  }
}

/// A process box on the landing page: icon, name, machine count, chevron.
class ProcessTile extends StatelessWidget {
  const ProcessTile({
    super.key,
    required this.title,
    required this.subtitle,
    this.detail,
    required this.icon,
    required this.onTap,
    this.emphasized = false,
  });

  final String title;
  final String subtitle;
  final String? detail;
  final IconData icon;
  final VoidCallback onTap;

  /// The "All machines" tile is set apart with the brand colour.
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final accent = emphasized ? cs.primary : AppColors.brand600;
    final accentText = AppColors.readable(context, accent);
    return Semantics(
      button: true,
      excludeSemantics: true,
      label: '$title, $subtitle. Open dashboard',
      onTap: onTap,
      child: DashCard(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        tint: emphasized ? cs.primary : null,
        onTap: () {
          HapticFeedback.lightImpact();
          onTap();
        },
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(color: accent.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(12)),
                child: Icon(icon, color: accentText, size: 24),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, height: 1.2, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(subtitle, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant)),
                    if (detail != null) ...[
                      const SizedBox(height: 2),
                      Text(detail!, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant.withValues(alpha: 0.8))),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right_rounded, color: cs.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}

class _NoProcesses extends StatelessWidget {
  const _NoProcesses();

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return DashCard(
      padding: const EdgeInsets.all(24),
      child: Column(
        children: [
          Icon(Icons.layers_outlined, size: 36, color: cs.onSurfaceVariant),
          const SizedBox(height: 10),
          Text.rich(
            TextSpan(
              style: TextStyle(color: cs.onSurfaceVariant, height: 1.4),
              children: const [
                TextSpan(text: 'No processes yet. Add them in '),
                TextSpan(text: 'Production › Processes', style: TextStyle(fontWeight: FontWeight.w700)),
                TextSpan(text: ' — name each one, assign its machines and choose its graphs.'),
              ],
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
