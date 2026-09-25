import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/theme/app_colors.dart';
import '../shell/dashboard_controller.dart';
import 'dash_card.dart';

/// The dashboard's control strip: the period chip (opens the date-range
/// sheet), the Filters button with an active-count badge, and — once anything
/// is filtered — a swipeable row of removable chips with Clear all.
///
/// It is the phone form of the web header's date chip / Filters / Clear
/// buttons: one row of two big buttons instead of a wrapped toolbar, and the
/// Clear button lives with the chips it clears.
class DashboardControlBar extends StatelessWidget {
  const DashboardControlBar({
    super.key,
    required this.periodLabel,
    required this.isDefaultRange,
    required this.onPickRange,
    required this.onResetRange,
    required this.filterCount,
    required this.onOpenFilters,
    required this.chips,
    required this.onRemoveChip,
    required this.onClearAll,
    this.refreshing = false,
    this.leading,
  });

  /// Sits above the period row inside the same bar (the process chips).
  final Widget? leading;

  final String periodLabel;
  final bool isDefaultRange;
  final VoidCallback onPickRange;
  final VoidCallback onResetRange;
  final int filterCount;
  final VoidCallback onOpenFilters;
  final List<ActiveFilter> chips;
  final void Function(ActiveFilter chip) onRemoveChip;
  final VoidCallback onClearAll;

  /// A new period is loading behind the dimmed dashboard.
  final bool refreshing;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).appBarTheme.backgroundColor ?? cs.surface,
        border: Border(bottom: BorderSide(color: cs.outlineVariant)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (leading != null) Padding(padding: const EdgeInsets.only(top: 6), child: leading),
          Padding(
            padding: EdgeInsets.fromLTRB(16, leading != null ? 4 : 4, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: PeriodChip(label: periodLabel, resettable: !isDefaultRange, onTap: onPickRange, onReset: onResetRange),
                ),
                const SizedBox(width: 8),
                FiltersButton(count: filterCount, onPressed: onOpenFilters),
              ],
            ),
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            child: chips.isEmpty
                ? const SizedBox(width: double.infinity)
                : Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            padding: const EdgeInsets.only(left: 16, right: 4),
                            child: Row(
                              children: [
                                for (final chip in chips) ...[
                                  RemovableChip(label: chip.label, onRemove: () => onRemoveChip(chip)),
                                  const SizedBox(width: 6),
                                ],
                              ],
                            ),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: TextButton(
                            onPressed: () {
                              HapticFeedback.mediumImpact();
                              onClearAll();
                            },
                            style: TextButton.styleFrom(foregroundColor: AppColors.readable(context, AppColors.critical)),
                            child: const Text('Clear all', style: TextStyle(fontWeight: FontWeight.w700)),
                          ),
                        ),
                      ],
                    ),
                  ),
          ),
          SizedBox(height: 2, child: refreshing ? const LinearProgressIndicator(minHeight: 2) : null),
        ],
      ),
    );
  }
}

/// The "September 2026" pill. When the period was changed, an x resets it to
/// the default.
class PeriodChip extends StatelessWidget {
  const PeriodChip({super.key, required this.label, required this.resettable, required this.onTap, required this.onReset});

  final String label;
  final bool resettable;
  final VoidCallback onTap;
  final VoidCallback onReset;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final fg = AppColors.readable(context, cs.primary);
    return Material(
      color: cs.primary.withValues(alpha: 0.10),
      shape: StadiumBorder(side: BorderSide(color: cs.primary.withValues(alpha: 0.35))),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: () {
          HapticFeedback.selectionClick();
          onTap();
        },
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 44),
          child: Padding(
            padding: const EdgeInsets.only(left: 14, right: 4),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.calendar_month_rounded, size: 18, color: fg),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w700, color: fg)),
                ),
                if (resettable)
                  IconButton(
                    tooltip: 'Reset the period to this month',
                    onPressed: () {
                      HapticFeedback.selectionClick();
                      onReset();
                    },
                    icon: Icon(Icons.close_rounded, size: 18, color: fg),
                    style: IconButton.styleFrom(minimumSize: const Size(40, 40), tapTargetSize: MaterialTapTargetSize.shrinkWrap),
                  )
                else
                  Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: Icon(Icons.expand_more_rounded, size: 20, color: fg)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// "Filters" with a corner count badge, so the button is the same width with
/// and without one and nothing beside it moves.
class FiltersButton extends StatelessWidget {
  const FiltersButton({super.key, required this.count, required this.onPressed});

  final int count;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      label: count > 0 ? 'Filters, $count active' : 'Filters',
      excludeSemantics: true,
      onTap: onPressed,
      child: Material(
        color: count > 0 ? cs.primary.withValues(alpha: 0.10) : Colors.transparent,
        shape: StadiumBorder(side: BorderSide(color: count > 0 ? cs.primary.withValues(alpha: 0.35) : cs.outline)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: () {
            HapticFeedback.selectionClick();
            onPressed();
          },
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 44),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Badge(
                    isLabelVisible: count > 0,
                    label: Text('$count'),
                    child: Icon(Icons.tune_rounded, size: 19, color: cs.onSurface),
                  ),
                  const SizedBox(width: 8),
                  Text('Filters', style: TextStyle(fontWeight: FontWeight.w700, color: cs.onSurface)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// An active filter: tap anywhere on it to remove it.
class RemovableChip extends StatelessWidget {
  const RemovableChip({super.key, required this.label, required this.onRemove});

  final String label;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final fg = AppColors.readable(context, cs.primary);
    return Semantics(
      button: true,
      label: 'Remove filter $label',
      excludeSemantics: true,
      onTap: onRemove,
      child: Material(
        color: cs.primary.withValues(alpha: 0.14),
        shape: StadiumBorder(side: BorderSide(color: cs.primary.withValues(alpha: 0.35))),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: () {
            HapticFeedback.selectionClick();
            onRemove();
          },
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 44, maxWidth: 260),
            child: Padding(
              padding: const EdgeInsets.only(left: 14, right: 10),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: fg))),
                  const SizedBox(width: 6),
                  Icon(Icons.close_rounded, size: 16, color: fg),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The tablet header (`.pd-header`): a card with the process tabs, the period
/// chip, Filters, Clear and Customize on ONE row when there is room (two rows
/// on an iPad in portrait), and the active-filter chips wrapped under it.
class TabletHeaderBar extends StatelessWidget {
  const TabletHeaderBar({
    super.key,
    this.selector,
    required this.periodLabel,
    required this.isDefaultRange,
    required this.onPickRange,
    required this.onResetRange,
    required this.filterCount,
    required this.onOpenFilters,
    required this.filtersActive,
    required this.onClearAll,
    this.onCustomize,
    required this.chips,
    required this.onRemoveChip,
    this.refreshing = false,
  });

  final Widget? selector;
  final String periodLabel;
  final bool isDefaultRange;
  final VoidCallback onPickRange;
  final VoidCallback onResetRange;
  final int filterCount;
  final VoidCallback onOpenFilters;
  final bool filtersActive;
  final VoidCallback onClearAll;
  final VoidCallback? onCustomize;
  final List<ActiveFilter> chips;
  final void Function(ActiveFilter chip) onRemoveChip;
  final bool refreshing;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final controls = <Widget>[
      ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 320),
        child: PeriodChip(label: periodLabel, resettable: !isDefaultRange, onTap: onPickRange, onReset: onResetRange),
      ),
      FiltersButton(count: filterCount, onPressed: onOpenFilters),
      if (filtersActive)
        TextButton.icon(
          onPressed: () {
            HapticFeedback.mediumImpact();
            onClearAll();
          },
          icon: const Icon(Icons.filter_alt_off_outlined, size: 18),
          label: const Text('Clear', style: TextStyle(fontWeight: FontWeight.w700)),
          style: TextButton.styleFrom(
            minimumSize: const Size(44, 44),
            foregroundColor: AppColors.readable(context, AppColors.critical),
          ),
        ),
      if (onCustomize != null)
        OutlinedButton.icon(
          onPressed: onCustomize,
          icon: const Icon(Icons.dashboard_customize_outlined, size: 18),
          label: const Text('Customize', style: TextStyle(fontWeight: FontWeight.w700)),
          style: OutlinedButton.styleFrom(minimumSize: const Size(44, 44), shape: const StadiumBorder(), foregroundColor: cs.onSurface),
        ),
    ];

    Widget controlsWrap() => Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: controls);

    final card = DecoratedBox(
      decoration: BoxDecoration(
        color: DashCard.surfaceOf(context),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: cs.outlineVariant),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
              child: LayoutBuilder(
                builder: (context, box) {
                  final oneRow = box.maxWidth >= 900 || selector == null;
                  if (oneRow) {
                    return Row(
                      children: [
                        if (selector != null) Expanded(child: Align(alignment: Alignment.centerLeft, child: selector)) else const Spacer(),
                        const SizedBox(width: 12),
                        for (var i = 0; i < controls.length; i++) ...[
                          if (i > 0) const SizedBox(width: 8),
                          controls[i],
                        ],
                      ],
                    );
                  }
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Align(alignment: Alignment.centerLeft, child: selector),
                      const SizedBox(height: 8),
                      controlsWrap(),
                    ],
                  );
                },
              ),
            ),
            SizedBox(height: 2, child: refreshing ? const LinearProgressIndicator(minHeight: 2) : null),
          ],
        ),
      ),
    );

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        card,
        AnimatedSize(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOutCubic,
          alignment: Alignment.topCenter,
          child: chips.isEmpty
              ? const SizedBox(width: double.infinity)
              : Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [for (final chip in chips) RemovableChip(label: chip.label, onRemove: () => onRemoveChip(chip))],
                  ),
                ),
        ),
      ],
    );
  }
}
