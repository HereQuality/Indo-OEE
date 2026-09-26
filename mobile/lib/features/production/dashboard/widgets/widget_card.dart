import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../charts/chart_props.dart';
import 'dash_card.dart';

/// Builds a chart body for a given view (chart / table) and size.
typedef ChartBodyBuilder = Widget Function(BuildContext context, ChartView view, bool expanded);

/// A small square icon action in a card header (40 px hit area).
class CardIconButton extends StatelessWidget {
  const CardIconButton({super.key, required this.icon, required this.tooltip, required this.onPressed, this.active = false});

  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return IconButton(
      onPressed: onPressed,
      tooltip: tooltip,
      icon: Icon(icon, size: 18),
      isSelected: active,
      style: IconButton.styleFrom(
        minimumSize: const Size(40, 40),
        padding: EdgeInsets.zero,
        tapTargetSize: MaterialTapTargetSize.padded,
        foregroundColor: active ? cs.primary : cs.onSurfaceVariant,
        backgroundColor: active ? cs.primary.withValues(alpha: 0.12) : Colors.transparent,
      ),
    );
  }
}

/// The chart <-> table switch icon (the table is the accessible twin of the chart).
class ViewToggleButton extends StatelessWidget {
  const ViewToggleButton({super.key, required this.view, required this.onChanged});

  final ChartView view;
  final ValueChanged<ChartView> onChanged;

  @override
  Widget build(BuildContext context) => CardIconButton(
        icon: view == ChartView.chart ? Icons.table_rows_outlined : Icons.bar_chart_rounded,
        tooltip: view == ChartView.chart ? 'Show as table' : 'Show as chart',
        active: view == ChartView.table,
        onPressed: () {
          HapticFeedback.selectionClick();
          onChanged(view == ChartView.chart ? ChartView.table : ChartView.chart);
        },
      );
}

/// Opens the breakdown for the card's measure.
class DrillButton extends StatelessWidget {
  const DrillButton({super.key, required this.onPressed});
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => CardIconButton(
        icon: Icons.account_tree_outlined,
        tooltip: 'Break down by machine, operator, part, date',
        onPressed: onPressed,
      );
}

/// The frame around every visual (port of WidgetCard.jsx): title + hint, a
/// chart <-> table switch, a Break down button for the visual's measure and
/// Maximize. [builder] draws the visual; the card only frames it.
///
/// [fixedHeader] (tablet grid) reserves a two-line title + one-line hint, so
/// every card in a grid row is exactly as tall as its neighbours. A card
/// narrower than [_denseBelow] keeps its actions in one overflow menu so the
/// title still has room.
class WidgetCard extends StatelessWidget {
  const WidgetCard({
    super.key,
    required this.title,
    this.hint,
    required this.view,
    required this.onViewChanged,
    this.tableOnly = false,
    this.onDrill,
    required this.onMaximize,
    required this.builder,
    this.height = 264,
    this.fixedHeader = false,
  });

  static const double _denseBelow = 340;

  final String title;
  final String? hint;
  final ChartView view;
  final ValueChanged<ChartView> onViewChanged;

  /// A table-only visual (the MC No. Summary) has no chart view to switch to.
  final bool tableOnly;
  final VoidCallback? onDrill;
  final VoidCallback onMaximize;
  final ChartBodyBuilder builder;
  final double height;
  final bool fixedHeader;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final scaler = MediaQuery.textScalerOf(context);
    // At large text sizes the title needs the full width, so the actions
    // drop to their own row instead of squeezing it into a sliver.
    final roomy = scaler.scale(14) <= 19;

    void toggleView() {
      HapticFeedback.selectionClick();
      onViewChanged(view == ChartView.chart ? ChartView.table : ChartView.chart);
    }

    void drill() {
      HapticFeedback.lightImpact();
      onDrill!();
    }

    void maximize() {
      HapticFeedback.lightImpact();
      onMaximize();
    }

    final fullActions = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (!tableOnly) ViewToggleButton(view: view, onChanged: onViewChanged),
        if (onDrill != null) DrillButton(onPressed: drill),
        CardIconButton(icon: Icons.open_in_full_rounded, tooltip: 'Maximize', onPressed: maximize),
      ],
    );

    final menuActions = PopupMenuButton<String>(
      tooltip: 'Chart actions',
      icon: const Icon(Icons.more_vert_rounded, size: 18),
      style: IconButton.styleFrom(minimumSize: const Size(40, 40), padding: EdgeInsets.zero, foregroundColor: cs.onSurfaceVariant),
      onSelected: (v) => switch (v) {
        'view' => toggleView(),
        'drill' => drill(),
        _ => maximize(),
      },
      itemBuilder: (_) => [
        if (!tableOnly) PopupMenuItem(value: 'view', child: Text(view == ChartView.chart ? 'Show as table' : 'Show as chart')),
        if (onDrill != null) const PopupMenuItem(value: 'drill', child: Text('Break down')),
        const PopupMenuItem(value: 'max', child: Text('Maximize')),
      ],
    );

    Widget heading(bool reserve) {
      final text = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            maxLines: reserve ? 2 : 4,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 14, height: 1.25, fontWeight: FontWeight.w600),
          ),
          if (hint != null && hint!.isNotEmpty) ...[
            const SizedBox(height: 1),
            Text(
              hint!,
              maxLines: reserve ? 1 : 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12, height: 1.3, color: cs.onSurfaceVariant),
            ),
          ],
        ],
      );
      if (!reserve) return text;
      final h = scaler.scale(14) * 1.25 * 2 + 1 + scaler.scale(12) * 1.3;
      // Reserve exactly two title lines + one hint line; anything longer is
      // clipped, never an overflow error.
      return SizedBox(
        height: h + 1,
        child: ClipRect(child: OverflowBox(alignment: Alignment.topLeft, minHeight: 0, maxHeight: double.infinity, child: text)),
      );
    }

    final effectiveView = tableOnly ? ChartView.table : view;
    final body = builder(context, effectiveView, false);

    Widget stage() => Padding(
          padding: const EdgeInsets.only(right: 4),
          // A chart needs a fixed stage to fill; a table-only card is only as
          // tall as its rows (up to the stage height) — one machine shouldn't
          // leave a few hundred pixels of blank card below it.
          child: tableOnly
              ? ConstrainedBox(constraints: BoxConstraints(maxHeight: height), child: body)
              : SizedBox(
                  height: height,
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 160),
                    // The chart is laid out against the full stage, also mid-fade.
                    layoutBuilder: (current, previous) => Stack(fit: StackFit.expand, children: [...previous, ?current]),
                    child: KeyedSubtree(key: ValueKey(effectiveView), child: body),
                  ),
                ),
        );

    return LayoutBuilder(
      builder: (context, box) {
        final dense = box.maxWidth < _denseBelow || (fixedHeader && !roomy);
        final top = dense
            ? Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: Padding(padding: const EdgeInsets.only(top: 4), child: heading(fixedHeader))),
                  menuActions,
                ],
              )
            : roomy
                ? Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: Padding(padding: const EdgeInsets.only(top: 4), child: heading(fixedHeader))),
                      fullActions,
                    ],
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(padding: const EdgeInsets.only(top: 4, right: 8), child: heading(false)),
                      Align(alignment: Alignment.centerRight, child: fullActions),
                    ],
                  );
        return DashCard(
          padding: const EdgeInsets.fromLTRB(12, 6, 4, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [top, const SizedBox(height: 2), stage()],
          ),
        );
      },
    );
  }
}
