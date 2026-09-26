import 'package:flutter/material.dart';

import 'dash_card.dart';

/// One small line of the summary: label on the left, figure on the right.
class SummaryLine {
  const SummaryLine(this.label, this.value);
  final String label;
  final String value;
}

/// The phone dashboard's "at a glance" card: the headline figure (OEE) big on
/// the left, a few small label / figure lines on the right. It sits above the
/// KPI tiles so the state of the period reads without scrolling; tapping it
/// opens the headline figure's breakdown.
///
/// With large system text there is no room for two columns, so it stacks: the
/// headline on top, the lines in a 2 x n grid underneath. Text is never shrunk.
class DashboardSummaryCard extends StatelessWidget {
  const DashboardSummaryCard({
    super.key,
    required this.headlineLabel,
    required this.headlineValue,
    this.headlineHint,
    required this.lines,
    required this.onTap,
  });

  final String headlineLabel;
  final String headlineValue;
  final String? headlineHint;
  final List<SummaryLine> lines;
  final VoidCallback onTap;

  /// Text scale from which the side-by-side layout no longer fits a phone.
  static const double stackFrom = 1.25;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final stacked = MediaQuery.textScalerOf(context).scale(10) > 10 * stackFrom;
    final semantics = '$headlineLabel $headlineValue'
        '${headlineHint == null ? '' : ', $headlineHint'}. '
        '${lines.map((l) => '${l.label} ${l.value}').join(', ')}. Double tap for the breakdown.';
    return Semantics(
      button: true,
      excludeSemantics: true,
      label: semantics,
      onTap: onTap,
      child: DashCard(
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
        tint: cs.primary,
        onTap: onTap,
        child: stacked ? _stacked(cs) : _sideBySide(cs),
      ),
    );
  }

  Widget _headline(ColorScheme cs) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            headlineLabel,
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.4, color: cs.onSurfaceVariant),
          ),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              headlineValue,
              style: TextStyle(fontSize: 30, height: 1.1, fontWeight: FontWeight.w800, color: cs.primary),
            ),
          ),
          if (headlineHint != null) ...[
            const SizedBox(height: 2),
            Text(headlineHint!, style: TextStyle(fontSize: 11, height: 1.25, color: cs.onSurfaceVariant)),
          ],
        ],
      );

  Widget _sideBySide(ColorScheme cs) => IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(flex: 5, child: _headline(cs)),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: VerticalDivider(width: 1, thickness: 1, color: cs.outlineVariant),
            ),
            Expanded(
              flex: 6,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (var i = 0; i < lines.length; i++) ...[
                    if (i > 0) const SizedBox(height: 6),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.baseline,
                      textBaseline: TextBaseline.alphabetic,
                      children: [
                        Expanded(
                          child: Text(
                            lines[i].label,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 12, height: 1.2, color: cs.onSurfaceVariant),
                          ),
                        ),
                        const SizedBox(width: 8),
                        // A long figure shrinks a little rather than overflowing.
                        Flexible(
                          flex: 0,
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerRight,
                            child: Text(lines[i].value, style: _valueStyle(cs)),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(left: 4),
              child: Center(child: Icon(Icons.chevron_right_rounded, size: 18, color: cs.onSurfaceVariant)),
            ),
          ],
        ),
      );

  Widget _stacked(ColorScheme cs) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: _headline(cs)),
              Icon(Icons.chevron_right_rounded, size: 18, color: cs.onSurfaceVariant),
            ],
          ),
          const SizedBox(height: 10),
          Divider(height: 1, color: cs.outlineVariant),
          const SizedBox(height: 10),
          LayoutBuilder(
            builder: (context, box) {
              const gap = 12.0;
              final w = (box.maxWidth - gap) / 2;
              return Wrap(
                spacing: gap,
                runSpacing: 10,
                children: [
                  for (final l in lines)
                    SizedBox(
                      width: w,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(l.label, style: TextStyle(fontSize: 12, height: 1.2, color: cs.onSurfaceVariant)),
                          const SizedBox(height: 2),
                          Text(l.value, style: _valueStyle(cs)),
                        ],
                      ),
                    ),
                ],
              );
            },
          ),
        ],
      );

  TextStyle _valueStyle(ColorScheme cs) => TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w700,
        color: cs.onSurface,
        fontFeatures: const [FontFeature.tabularFigures()],
      );
}
