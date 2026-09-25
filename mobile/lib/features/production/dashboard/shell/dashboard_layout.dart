import 'package:flutter/material.dart';

/// How the dashboard is laid out. Phones (narrower than [tabletMinWidth]) get
/// one column, sheets and a compact header; an iPad / any wide window gets the
/// web portal's layout: the whole width, a one-row header bar, an auto-fill KPI
/// grid and the 12-column chart grid.
const double tabletMinWidth = 700;

/// Content width from which the chart grid uses all 12 columns (sm = 4,
/// md = 6, lg = 8). Below it (but on a tablet) sm / md take 6 and lg 12 —
/// the web's 1200 px viewport breakpoint, less the sidebar it has and this
/// app does not.
const double gridWideMinWidth = 940;

enum GridDensity { single, medium, wide }

bool isTabletWidth(double width) => width >= tabletMinWidth;

GridDensity densityFor(double contentWidth) {
  if (contentWidth >= gridWideMinWidth) return GridDensity.wide;
  if (contentWidth >= tabletMinWidth - 40) return GridDensity.medium;
  return GridDensity.single;
}

/// Columns (of 12) a card of catalog size [size] takes (processDashboard.css
/// `.pd-span-*` with its media queries).
int spanFor(String? size, GridDensity density) {
  switch (density) {
    case GridDensity.single:
      return 12;
    case GridDensity.medium:
      return switch (size) { 'sm' || 'md' => 6, _ => 12 };
    case GridDensity.wide:
      return switch (size) { 'sm' => 4, 'md' => 6, 'lg' => 8, _ => 12 };
  }
}

/// A grid item: its column span and the widget to show.
class SpanItem {
  const SpanItem({required this.span, required this.child});
  final int span;
  final Widget child;
}

/// Splits [items] into rows the way a CSS grid with `repeat(12, 1fr)` and
/// `grid-column: span n` places them: in order, wrapping when the next item
/// does not fit the row's remaining columns.
///
/// [dense] also lets a later item fill a gap left earlier in the grid
/// (`grid-auto-flow: row dense`). The tablet-portrait grid uses it so a lone
/// half-width card is not left with an empty half beside it.
List<List<SpanItem>> packRows(List<SpanItem> items, {bool dense = false}) {
  final rows = <List<SpanItem>>[];
  final used = <int>[];
  for (final item in items) {
    var at = -1;
    if (dense) {
      at = used.indexWhere((u) => u + item.span <= 12);
    } else if (rows.isNotEmpty && used.last + item.span <= 12) {
      at = rows.length - 1;
    }
    if (at < 0) {
      rows.add([]);
      used.add(0);
      at = rows.length - 1;
    }
    rows[at].add(item);
    used[at] += item.span;
  }
  return rows;
}

/// One row of a [packRows] result, drawn with the exact column widths of a
/// 12-column grid with [gap] gutters (a partial row leaves its right side
/// empty, like the web).
class SpanRow extends StatelessWidget {
  const SpanRow({super.key, required this.items, this.gap = 12});

  final List<SpanItem> items;
  final double gap;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, box) {
        final col = (box.maxWidth - 11 * gap) / 12;
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < items.length; i++) ...[
              if (i > 0) SizedBox(width: gap),
              SizedBox(width: col * items[i].span + gap * (items[i].span - 1), child: items[i].child),
            ],
          ],
        );
      },
    );
  }
}
