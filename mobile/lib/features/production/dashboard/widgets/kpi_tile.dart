import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import 'dash_card.dart';

/// One KPI tile (a `pd-stat` on the web): label, big figure, hint. A toned
/// tile (ok / reject / downtime) gets a coloured dot and a faint wash of that
/// colour. Tapping opens the figure's breakdown.
class KpiTile extends StatelessWidget {
  const KpiTile({
    super.key,
    required this.label,
    required this.value,
    this.hint,
    this.tone,
    required this.onTap,
    this.web = false,
  });

  final String label;
  final String value;
  final String? hint;

  /// Accent colour of the tone, or null for a neutral tile.
  final Color? tone;
  final VoidCallback onTap;

  /// The tablet / web look (`.pd-stat`): upper-case label, slightly roomier.
  final bool web;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final semanticsLabel = '$label, $value${hint == null ? '' : ', $hint'}. Double tap for the breakdown.';
    return Semantics(
      button: true,
      excludeSemantics: true,
      label: semanticsLabel,
      onTap: onTap,
      child: DashCard(
        padding: EdgeInsets.fromLTRB(14, web ? 14 : 12, 14, web ? 14 : 12),
        tint: tone,
        radius: web ? 14 : 16,
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (tone != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4, right: 6),
                    child: Container(width: 8, height: 8, decoration: BoxDecoration(color: tone, shape: BoxShape.circle)),
                  ),
                Expanded(
                  child: Text(
                    web ? label.toUpperCase() : label,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: web ? 11 : 12,
                      height: 1.25,
                      letterSpacing: web ? 0.5 : 0,
                      fontWeight: web ? FontWeight.w700 : FontWeight.w600,
                      color: cs.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                value,
                maxLines: 1,
                style: TextStyle(
                  fontSize: web ? 25 : 26,
                  height: 1.15,
                  fontWeight: FontWeight.w800,
                  color: cs.onSurface,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ),
            if (hint != null) ...[
              const SizedBox(height: 4),
              Text(
                hint!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, height: 1.25, color: AppColors.readable(context, cs.onSurfaceVariant).withValues(alpha: 0.85)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Lays tiles out in equal-height rows of [columns] (2 on a phone, 3 on a
/// wide screen). Rows size to their tallest tile, so nothing is clipped at
/// large text sizes.
class KpiGrid extends StatelessWidget {
  const KpiGrid({super.key, required this.children, this.spacing = 10});

  final List<Widget> children;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, box) {
        final columns = box.maxWidth >= 560 ? 3 : 2;
        final rows = <Widget>[];
        for (var i = 0; i < children.length; i += columns) {
          final slice = children.skip(i).take(columns).toList();
          rows.add(
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var c = 0; c < columns; c++) ...[
                    if (c > 0) SizedBox(width: spacing),
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
              if (i > 0) SizedBox(height: spacing),
              rows[i],
            ],
          ],
        );
      },
    );
  }
}

/// The tablet KPI strip (`.pd-stats`): as many tiles per row as fit at
/// [minTileWidth], every row stretched to the full width, like the web's
/// `flex: 1 1 168px` wrap.
class KpiFlowGrid extends StatelessWidget {
  const KpiFlowGrid({super.key, required this.children, this.minTileWidth = 168, this.spacing = 12});

  final List<Widget> children;
  final double minTileWidth;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, box) {
        final perRow = ((box.maxWidth + spacing) / (minTileWidth + spacing)).floor().clamp(1, 12);
        final rows = <Widget>[];
        for (var i = 0; i < children.length; i += perRow) {
          final slice = children.skip(i).take(perRow).toList();
          rows.add(
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var c = 0; c < slice.length; c++) ...[
                    if (c > 0) SizedBox(width: spacing),
                    Expanded(child: slice[c]),
                  ],
                ],
              ),
            ),
          );
        }
        return Column(
          children: [
            for (var i = 0; i < rows.length; i++) ...[
              if (i > 0) SizedBox(height: spacing),
              rows[i],
            ],
          ],
        );
      },
    );
  }
}
