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
          if (out.isNotEmpty) out.add(const SizedBox(height: EntryStyle.rowGap));
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
                        : Padding(padding: const EdgeInsets.only(bottom: 4), child: FieldLabel(c.label!, required: c.required)),
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
      padding: const EdgeInsets.only(top: 4),
      child: Semantics(
        liveRegion: true,
        child: Text(message, style: TextStyle(color: s.error, fontSize: EntryStyle.noteSize, height: 1.25)),
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
        padding: const EdgeInsets.only(top: 4),
        child: Text(
          message,
          style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: EntryStyle.noteSize, height: 1.25),
        ),
      );
}

/// One line of the entry sheet as a card with a header. Turns red-bordered and
/// gets a "Check this line" badge when a field inside it needs attention.
///
/// An [optional] line is the web's `FormLine optional`: it starts folded to its
/// header ("Optional — tap to add"), and opens by itself when it already holds
/// something ([hasValue]), has an error after Save, or [openByDefault] says it
/// needs typing. Its fields stay mounted while folded (so a failed Save can
/// still find them). [summary] replaces "Optional — tap to add" while folded.
/// [revealKey] lets [EntryLineCard.reveal] open it from outside (the Machine
/// Status "Remarks" tick).
class EntryLineCard extends StatefulWidget {
  const EntryLineCard({
    super.key,
    required this.title,
    required this.icon,
    this.hasError = false,
    required this.children,
    this.optional = false,
    this.openByDefault = false,
    this.hasValue = false,
    this.summary = '',
    this.revealKey,
  });

  final String title;
  final IconData icon;
  final bool hasError;
  final List<Widget> children;
  final bool optional;
  final bool openByDefault;
  final bool hasValue;
  final String summary;
  final String? revealKey;

  /// Tests that are about something else switch folding off (test/flutter_test_config.dart)
  /// so every optional card is open; the folding tests switch it back on.
  @visibleForTesting
  static bool foldOptional = true;

  static final Set<_EntryLineCardState> _live = {};

  /// Opens the optional card registered under [key] (no-op otherwise).
  static bool reveal(String key) {
    var any = false;
    for (final st in _live) {
      if (st.widget.revealKey == key) {
        st._reveal();
        any = true;
      }
    }
    return any;
  }

  @override
  State<EntryLineCard> createState() => _EntryLineCardState();
}

class _EntryLineCardState extends State<EntryLineCard> {
  late bool _open = !EntryLineCard.foldOptional || !widget.optional || widget.hasValue || widget.openByDefault;

  @override
  void initState() {
    super.initState();
    EntryLineCard._live.add(this);
  }

  @override
  void dispose() {
    EntryLineCard._live.remove(this);
    super.dispose();
  }

  void _reveal() {
    if (!_open) setState(() => _open = true);
  }

  @override
  void didUpdateWidget(EntryLineCard old) {
    super.didUpdateWidget(old);
    if (widget.hasValue || widget.openByDefault || widget.hasError) _open = true;
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final dark = s.brightness == Brightness.dark;
    final w = widget;
    final shown = !w.optional || !EntryLineCard.foldOptional || _open || w.hasError;
    final hint = shown
        ? (w.hasValue ? 'Filled in' : '')
        : (w.summary.isNotEmpty ? w.summary : (w.hasValue ? 'Filled in' : 'Optional \u2014 tap to add'));
    Widget header = Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          width: 26,
          height: 26,
          decoration: BoxDecoration(
            color: s.primary.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(w.icon, size: 15, color: AppColors.readable(context, s.primary)),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Semantics(
            header: true,
            child: Text(w.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, height: 1.25)),
          ),
        ),
        if (w.optional && !w.hasError) ...[
          if (hint.isNotEmpty)
            Flexible(
              child: Padding(
                padding: const EdgeInsets.only(left: 8),
                child: Text(
                  hint,
                  textAlign: TextAlign.end,
                  style: TextStyle(fontSize: 12, color: EntryStyle.hint(context)),
                ),
              ),
            ),
          AnimatedRotation(
            turns: shown ? 0.5 : 0,
            duration: const Duration(milliseconds: 150),
            child: Icon(Icons.expand_more_rounded, size: 20, color: EntryStyle.hint(context)),
          ),
        ],
      ],
    );
    if (w.optional) {
      header = Semantics(
        button: true,
        expanded: shown,
        child: InkWell(
          key: ValueKey('line-toggle/${w.title}'),
          borderRadius: BorderRadius.circular(8),
          onTap: () => setState(() => _open = !shown),
          child: header,
        ),
      );
    }
    return Card(
      elevation: dark ? 0 : 1,
      shadowColor: s.shadow.withValues(alpha: 0.12),
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: w.hasError ? s.error : s.outlineVariant, width: w.hasError ? 1.4 : 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(EntryStyle.cardPadding),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            header,
            if (w.hasError)
              Padding(
                padding: const EdgeInsets.only(top: 6, left: 34),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: const EntryBadge('Check this line'),
                ),
              ),
            Visibility(
              visible: shown,
              maintainState: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [const SizedBox(height: 10), ...w.children],
              ),
            ),
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
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.critical.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(padding: const EdgeInsets.only(top: 2), child: Icon(Icons.error_outline_rounded, size: 12, color: fg)),
          const SizedBox(width: 4),
          Flexible(child: Text(label, style: TextStyle(fontSize: 11.5, height: 1.25, fontWeight: FontWeight.w600, color: fg))),
        ],
      ),
    );
  }
}
