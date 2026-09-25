import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/form_widgets.dart';
import 'entry_fields.dart';
import 'entry_style.dart';

/// One labelled field of a grid: its label, the box, and what shows under it —
/// a validation [error] (red) or a [hint] (muted). [span] is how many columns
/// it takes; a full-width field passes [EntryCell.full].
class EntryCell {
  const EntryCell({
    this.label,
    this.required = false,
    required this.child,
    this.error,
    this.hint,
    this.span = 1,
  });

  static const int full = 99;

  final String? label;
  final bool required;
  final Widget child;
  final String? error;
  final String? hint;
  final int span;
}

/// A responsive grid of [EntryCell]s. Columns follow the width: one on a
/// 360 px phone (or whenever text is scaled up), two on larger phones, up to
/// [maxCols] on tablets. Labels sit on one row, the boxes on the next and the
/// messages below, so boxes line up even when one label wraps to two lines.
class EntryGrid extends StatelessWidget {
  const EntryGrid({super.key, required this.cells, this.maxCols = 2, this.minColWidth = 140});

  final List<EntryCell> cells;
  final int maxCols;
  final double minColWidth;

  /// Column count for [width] at [textScale].
  static int columnsFor(double width, double textScale, {int maxCols = 2, double minColWidth = 140}) {
    const gap = EntryStyle.gap;
    final min = minColWidth * math.max(1.0, textScale);
    final fit = ((width + gap) / (min + gap)).floor();
    return fit.clamp(1, maxCols);
  }

  @override
  Widget build(BuildContext context) {
    final scale = entryTextScale(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final cols = columnsFor(width, scale, maxCols: maxCols, minColWidth: minColWidth);
        const gap = EntryStyle.gap;
        final colW = ((width - gap * (cols - 1)) / cols).floorToDouble();

        final chunks = <List<EntryCell>>[];
        var current = <EntryCell>[];
        var used = 0;
        for (final c in cells) {
          final span = math.min(c.span, cols);
          if (used + span > cols && current.isNotEmpty) {
            chunks.add(current);
            current = <EntryCell>[];
            used = 0;
          }
          current.add(c);
          used += span;
        }
        if (current.isNotEmpty) chunks.add(current);

        double widthOf(EntryCell c) {
          final span = math.min(c.span, cols);
          return colW * span + gap * (span - 1);
        }

        Widget row(List<EntryCell> chunk, CrossAxisAlignment align, Widget Function(EntryCell c) build) => Row(
              crossAxisAlignment: align,
              children: [
                for (var i = 0; i < chunk.length; i++) ...[
                  if (i > 0) const SizedBox(width: gap),
                  SizedBox(width: widthOf(chunk[i]), child: build(chunk[i])),
                ],
              ],
            );

        final out = <Widget>[];
        for (final chunk in chunks) {
          if (out.isNotEmpty) out.add(const SizedBox(height: 14));
          out.add(
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (chunk.any((c) => c.label != null))
                  row(
                    chunk,
                    CrossAxisAlignment.end,
                    (c) => c.label == null
                        ? const SizedBox.shrink()
                        : Padding(padding: const EdgeInsets.only(bottom: 6), child: FieldLabel(c.label!, required: c.required)),
                  ),
                row(chunk, CrossAxisAlignment.start, (c) => c.child),
                if (chunk.any((c) => c.error != null || c.hint != null))
                  row(chunk, CrossAxisAlignment.start, (c) {
                    if (c.error != null) return EntryErrorText(c.error!);
                    if (c.hint != null) return EntryHintText(c.hint!);
                    return const SizedBox.shrink();
                  }),
              ],
            ),
          );
        }
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: out);
      },
    );
  }
}

/// A validation message under a box.
class EntryErrorText extends StatelessWidget {
  const EntryErrorText(this.message, {super.key});

  final String message;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Semantics(
        liveRegion: true,
        child: Text(message, style: TextStyle(color: s.error, fontSize: 12.5, height: 1.3)),
      ),
    );
  }
}

/// A muted note under a box.
class EntryHintText extends StatelessWidget {
  const EntryHintText(this.message, {super.key});

  final String message;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Text(
          message,
          style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 12.5, height: 1.3),
        ),
      );
}

/// One line of the entry sheet as a card with a header. Turns red-bordered and
/// gets a "Check this line" badge when a field inside it needs attention.
class EntryLineCard extends StatelessWidget {
  const EntryLineCard({
    super.key,
    required this.title,
    required this.icon,
    this.hasError = false,
    required this.children,
  });

  final String title;
  final IconData icon;
  final bool hasError;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final dark = s.brightness == Brightness.dark;
    return Card(
      elevation: dark ? 0 : 1,
      shadowColor: s.shadow.withValues(alpha: 0.12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: hasError ? s.error : s.outlineVariant, width: hasError ? 1.4 : 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(
                    color: s.primary.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Icon(icon, size: 17, color: AppColors.readable(context, s.primary)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Semantics(
                    header: true,
                    child: Text(title, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700, height: 1.25)),
                  ),
                ),
              ],
            ),
            if (hasError)
              Padding(
                padding: const EdgeInsets.only(top: 8, left: 40),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: const EntryBadge('Check this line'),
                ),
              ),
            const SizedBox(height: 14),
            ...children,
          ],
        ),
      ),
    );
  }
}


/// The red "needs attention" pill. Unlike the shared StatusChip its text wraps,
/// so a long label never overflows on a 360 px phone at large text sizes.
class EntryBadge extends StatelessWidget {
  const EntryBadge(this.label, {super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    final fg = AppColors.readable(context, AppColors.critical);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.critical.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(padding: const EdgeInsets.only(top: 2), child: Icon(Icons.error_outline_rounded, size: 13, color: fg)),
          const SizedBox(width: 4),
          Flexible(child: Text(label, style: TextStyle(fontSize: 12, height: 1.25, fontWeight: FontWeight.w600, color: fg))),
        ],
      ),
    );
  }
}
