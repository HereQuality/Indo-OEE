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
    this.onReportPdf,
    this.onReportEmail,
    this.reporting,
    this.refreshing = false,
    this.leading,
  });

  /// Sits above the period row inside the same bar (the process chips).
  final Widget? leading;

  /// The Efficiency Report (OEE) for what is on screen: download / share the
  /// PDF, or mail it. Both null = no report menu.
  final VoidCallback? onReportPdf;
  final VoidCallback? onReportEmail;

  /// 'pdf' or 'mail' while one is being made; null otherwise.
  final String? reporting;

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
          if (leading != null) Padding(padding: const EdgeInsets.only(top: 4), child: leading),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 2, 12, 6),
            // Period and Filters share a row; on a narrow phone at a very large text
            // size they don't both fit, so Filters drops under the period.
            child: LayoutBuilder(
              builder: (context, c) {
                final period = PeriodChip(label: periodLabel, resettable: !isDefaultRange, onTap: onPickRange, onReset: onResetRange);
                final filters = FiltersButton(count: filterCount, onPressed: onOpenFilters);
                final report = onReportPdf == null && onReportEmail == null
                    ? null
                    : ReportMenuButton(onPdf: onReportPdf, onEmail: onReportEmail, busy: reporting != null);
                final stacked = c.maxWidth < 400 && MediaQuery.textScalerOf(context).scale(14) >= 22;
                // Filters and the report button wrap onto a second line rather
                // than overflow when the text is very large.
                final actions = Wrap(spacing: 6, runSpacing: 6, alignment: WrapAlignment.end, children: [filters, ?report]);
                if (stacked) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      period,
                      const SizedBox(height: 6),
                      Align(alignment: Alignment.centerLeft, child: actions),
                    ],
                  );
                }
                return Row(
                  children: [
                    Expanded(child: period),
                    const SizedBox(width: 6),
                    Flexible(child: actions),
                  ],
                );
              },
            ),
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            child: chips.isEmpty
                ? const SizedBox(width: double.infinity)
                : Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Row(
                      children: [
                        Expanded(
                          child: SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            padding: const EdgeInsets.only(left: 12, right: 4),
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
                          padding: const EdgeInsets.only(right: 4),
                          child: TextButton(
                            onPressed: () {
                              HapticFeedback.mediumImpact();
                              onClearAll();
                            },
                            style: TextButton.styleFrom(
                              minimumSize: const Size(40, 36),
                              padding: const EdgeInsets.symmetric(horizontal: 10),
                              foregroundColor: AppColors.readable(context, AppColors.critical),
                            ),
                            child: const Text('Clear all', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
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
          constraints: const BoxConstraints(minHeight: 40),
          child: Padding(
            padding: const EdgeInsets.only(left: 12, right: 2),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.calendar_month_rounded, size: 17, color: fg),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5, color: fg)),
                ),
                if (resettable)
                  IconButton(
                    tooltip: 'Reset the period to this month',
                    onPressed: () {
                      HapticFeedback.selectionClick();
                      onReset();
                    },
                    icon: Icon(Icons.close_rounded, size: 17, color: fg),
                    style: IconButton.styleFrom(minimumSize: const Size(40, 40), padding: EdgeInsets.zero, tapTargetSize: MaterialTapTargetSize.shrinkWrap),
                  )
                else
                  Padding(padding: const EdgeInsets.symmetric(horizontal: 6), child: Icon(Icons.expand_more_rounded, size: 19, color: fg)),
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
            constraints: const BoxConstraints(minHeight: 40),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Badge(
                    isLabelVisible: count > 0,
                    label: Text('$count'),
                    child: Icon(Icons.tune_rounded, size: 18, color: cs.onSurface),
                  ),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text('Filters', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5, color: cs.onSurface)),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The phone's report control: one round button that opens "Download PDF /
/// Email report" (the web header's PDF and Email buttons). Shows a spinner
/// while a report is being made.
class ReportMenuButton extends StatelessWidget {
  const ReportMenuButton({super.key, this.onPdf, this.onEmail, this.busy = false});

  final VoidCallback? onPdf;
  final VoidCallback? onEmail;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Material(
      color: Colors.transparent,
      shape: StadiumBorder(side: BorderSide(color: cs.outline)),
      child: busy
          ? const SizedBox(width: 44, height: 40, child: Center(child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))))
          : PopupMenuButton<String>(
              tooltip: 'Efficiency Report (OEE)',
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 220),
              position: PopupMenuPosition.under,
              onSelected: (v) {
                HapticFeedback.selectionClick();
                if (v == 'pdf') onPdf?.call();
                if (v == 'mail') onEmail?.call();
              },
              itemBuilder: (_) => [
                if (onPdf != null)
                  const PopupMenuItem(value: 'pdf', child: ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: Icon(Icons.picture_as_pdf_outlined), title: Text('Download PDF report'), subtitle: Text('This period, process and machines'))),
                if (onEmail != null)
                  const PopupMenuItem(value: 'mail', child: ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: Icon(Icons.mail_outline_rounded), title: Text('Email report'), subtitle: Text('PDF attached'))),
              ],
              child: SizedBox(
                width: 44,
                height: 40,
                child: Center(child: Icon(Icons.picture_as_pdf_outlined, size: 19, color: cs.onSurface)),
              ),
            ),
    );
  }
}

/// The tablet header's PDF and Email buttons (`.pd-field-btn` on the web).
class ReportButtons extends StatelessWidget {
  const ReportButtons({super.key, this.onPdf, this.onEmail, this.reporting});

  final VoidCallback? onPdf;
  final VoidCallback? onEmail;
  final String? reporting;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    Widget button(String key, IconData icon, String label, VoidCallback? onPressed, String tooltip) => Tooltip(
          message: tooltip,
          child: OutlinedButton.icon(
            onPressed: reporting != null ? null : onPressed,
            icon: reporting == key
                ? const SizedBox(width: 15, height: 15, child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(icon, size: 17),
            label: Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
            style: OutlinedButton.styleFrom(minimumSize: const Size(40, 40), shape: const StadiumBorder(), foregroundColor: cs.onSurface),
          ),
        );
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (onPdf != null) button('pdf', Icons.picture_as_pdf_outlined, 'PDF', onPdf, 'Download the Efficiency Report (OEE) for this period, process and machines as a PDF'),
        if (onPdf != null && onEmail != null) const SizedBox(width: 8),
        if (onEmail != null) button('mail', Icons.mail_outline_rounded, 'Email', onEmail, 'Email the same report (PDF attached)'),
      ],
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
            constraints: const BoxConstraints(minHeight: 34, maxWidth: 260),
            child: Padding(
              padding: const EdgeInsets.only(left: 12, right: 8),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 12.5, color: fg))),
                  const SizedBox(width: 4),
                  Icon(Icons.close_rounded, size: 15, color: fg),
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
    this.onReportPdf,
    this.onReportEmail,
    this.reporting,
    required this.chips,
    required this.onRemoveChip,
    this.refreshing = false,
  });

  final Widget? selector;
  final VoidCallback? onReportPdf;
  final VoidCallback? onReportEmail;
  final String? reporting;
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
          icon: const Icon(Icons.filter_alt_off_outlined, size: 17),
          label: const Text('Clear', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
          style: TextButton.styleFrom(
            minimumSize: const Size(40, 40),
            foregroundColor: AppColors.readable(context, AppColors.critical),
          ),
        ),
      if (onReportPdf != null || onReportEmail != null) ReportButtons(onPdf: onReportPdf, onEmail: onReportEmail, reporting: reporting),
      if (onCustomize != null)
        OutlinedButton.icon(
          onPressed: onCustomize,
          icon: const Icon(Icons.dashboard_customize_outlined, size: 17),
          label: const Text('Customize', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
          style: OutlinedButton.styleFrom(minimumSize: const Size(40, 40), shape: const StadiumBorder(), foregroundColor: cs.onSurface),
        ),
    ];

    Widget controlsWrap() => Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: controls);

    final card = DecoratedBox(
      decoration: BoxDecoration(
        color: DashCard.surfaceOf(context),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: cs.outlineVariant),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
              child: LayoutBuilder(
                builder: (context, box) {
                  // One row only when everything surely fits beside the process
                  // tabs: a landscape iPad at normal text. Otherwise the controls
                  // get their own line and wrap (large text, a landscape phone).
                  final scale = MediaQuery.textScalerOf(context).scale(14) / 14;
                  final oneRow = selector != null && (box.maxWidth >= 940 && scale <= 1.3 || box.maxWidth >= 1300);
                  if (oneRow) {
                    return Row(
                      children: [
                        Expanded(child: Align(alignment: Alignment.centerLeft, child: selector)),
                        const SizedBox(width: 12),
                        for (var i = 0; i < controls.length; i++) ...[
                          if (i > 0) const SizedBox(width: 8),
                          controls[i],
                        ],
                      ],
                    );
                  }
                  if (selector == null) return Align(alignment: Alignment.centerRight, child: Wrap(spacing: 8, runSpacing: 6, alignment: WrapAlignment.end, crossAxisAlignment: WrapCrossAlignment.center, children: controls));
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
                  padding: const EdgeInsets.only(top: 8),
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [for (final chip in chips) RemovableChip(label: chip.label, onRemove: () => onRemoveChip(chip))],
                  ),
                ),
        ),
      ],
    );
  }
}
