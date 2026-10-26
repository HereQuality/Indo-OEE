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

/// The chart | table switch (WidgetCard.jsx `ViewToggle`): both choices are
/// always visible with the current one highlighted, so there is never a doubt
/// how to get the graph back. [labels] adds the words next to the icons (cards
/// wide enough to carry them); the table is the accessible twin of the chart.
class ViewToggleButton extends StatelessWidget {
  const ViewToggleButton({super.key, required this.view, required this.onChanged, this.labels = false});

  final ChartView view;
  final ValueChanged<ChartView> onChanged;
  final bool labels;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    Widget segment(ChartView v, IconData icon, String text, String tooltip) {
      final on = view == v;
      return Tooltip(
        message: tooltip,
        child: Semantics(
          button: true,
          selected: on,
          label: tooltip,
          excludeSemantics: true,
          onTap: () => onChanged(v),
          child: InkWell(
            onTap: () {
              if (on) return;
              HapticFeedback.selectionClick();
              onChanged(v);
            },
            child: Container(
              constraints: BoxConstraints(minWidth: labels ? 0 : 36, minHeight: 34),
              padding: EdgeInsets.symmetric(horizontal: labels ? 10 : 8),
              color: on ? cs.primary.withValues(alpha: 0.12) : Colors.transparent,
              alignment: Alignment.center,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 16, color: on ? cs.primary : cs.onSurfaceVariant),
                  if (labels) ...[
                    const SizedBox(width: 4),
                    Text(
                      text,
                      style: TextStyle(fontSize: 12, fontWeight: on ? FontWeight.w600 : FontWeight.w500, color: on ? cs.primary : cs.onSurfaceVariant),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border.all(color: cs.outlineVariant),
          borderRadius: BorderRadius.circular(8),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(7),
          child: Material(
            type: MaterialType.transparency,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                segment(ChartView.chart, Icons.bar_chart_rounded, 'Chart', 'Show as chart'),
                Container(width: 1, height: 34, color: cs.outlineVariant),
                segment(ChartView.table, Icons.table_rows_outlined, 'Table', 'Show as table'),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The small icon a graph kind wears in its card header (WidgetCard.jsx
/// `KIND_ICON`), keyed by the catalog `preview`.
IconData kindIcon(String? preview) => switch (preview) {
      'lines' => Icons.show_chart_rounded,
      'hbars' => Icons.align_horizontal_left_rounded,
      'vbars' => Icons.bar_chart_rounded,
      'stacked' || 'stackedTime' => Icons.layers_outlined,
      'treemap' || 'nestedTreemap' => Icons.grid_view_rounded,
      'multiples' => Icons.stacked_line_chart_rounded,
      'table' => Icons.table_chart_outlined,
      'radial' => Icons.speed_rounded,
      'radar' => Icons.radar_rounded,
      'area' => Icons.area_chart_outlined,
      'donut' => Icons.donut_large_rounded,
      _ => Icons.bar_chart_rounded,
    };

/// The tinted square holding a [kindIcon]; the tint follows the catalog `tone`
/// (reject = orange, downtime = aqua, anything else the accent).
class KindBadge extends StatelessWidget {
  const KindBadge({super.key, required this.preview, this.tone});
  final String? preview;
  final String? tone;

  @override
  Widget build(BuildContext context) {
    final c = DashboardColors.of(context);
    final cs = Theme.of(context).colorScheme;
    final fg = switch (tone) {
      'reject' => c.reject,
      'downtime' => c.downtime,
      _ => cs.primary,
    };
    return ExcludeSemantics(
      child: Container(
        width: 30,
        height: 30,
        decoration: BoxDecoration(color: fg.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(9)),
        child: Icon(kindIcon(preview), size: 17, color: fg),
      ),
    );
  }
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

/// The frame around every visual (port of WidgetCard.jsx): title (hint on long-press), a
/// chart <-> table switch, a Break down button for the visual's measure and
/// Maximize. [builder] draws the visual; the card only frames it.
///
/// [fixedHeader] (tablet grid) reserves a two-line title, so
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
    this.preview,
    this.tone,
  });

  static const double _denseBelow = 340;

  final String title;
  final String? hint;
  final ChartView view;
  final ValueChanged<ChartView> onViewChanged;

  /// A table-only visual (the Machine Performance Summary) has no chart view to switch to.
  final bool tableOnly;
  final VoidCallback? onDrill;
  final VoidCallback onMaximize;
  final ChartBodyBuilder builder;
  final double height;
  final bool fixedHeader;

  /// Catalog `preview` / `tone` of the graph: the kind icon in the header.
  final String? preview;
  final String? tone;

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

    Widget fullActions(bool labelled) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (!tableOnly) ViewToggleButton(view: view, onChanged: onViewChanged, labels: labelled),
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

    // Title only: the longer explanation is a long-press tooltip (and the
    // screen-reader hint), never a second line of text on the card.
    Widget heading(bool reserve) {
      Widget text = Text(
        title,
        maxLines: reserve ? 2 : 4,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 14, height: 1.25, fontWeight: FontWeight.w600),
      );
      final tip = hint;
      if (tip != null && tip.isNotEmpty) {
        text = Tooltip(message: tip, triggerMode: TooltipTriggerMode.longPress, child: Semantics(hint: tip, child: text));
      }
      if (!reserve) return text;
      final h = scaler.scale(14) * 1.25 * 2;
      // Reserve exactly two title lines; anything longer is clipped, never an
      // overflow error.
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
        // Cards wide enough say "Chart" / "Table" in words, narrower ones keep the icons.
        final labelled = box.maxWidth >= 440;
        Widget titled(bool reserve, {double right = 0}) => Padding(
              padding: EdgeInsets.only(top: 4, right: right),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(padding: const EdgeInsets.only(top: 1, right: 8), child: KindBadge(preview: preview, tone: tone)),
                  Expanded(child: heading(reserve)),
                ],
              ),
            );
        final top = dense
            ? Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: titled(fixedHeader)),
                  menuActions,
                ],
              )
            : roomy
                ? Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: titled(fixedHeader)),
                      fullActions(labelled),
                    ],
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      titled(false, right: 8),
                      Align(alignment: Alignment.centerRight, child: fullActions(labelled)),
                    ],
                  );
        return DashCard(
          padding: EdgeInsets.zero,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const AccentEdge(gradient: true),
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 6, 4, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [top, const SizedBox(height: 2), stage()],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
