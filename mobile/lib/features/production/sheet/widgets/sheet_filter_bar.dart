import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';

/// One removable chip under the search field (a slicer that is in use).
class ActiveFilterChip {
  const ActiveFilterChip({required this.id, required this.label, required this.onTap, required this.onRemove});
  final String id;
  final String label;
  final VoidCallback onTap;
  final VoidCallback onRemove;
}

/// The search box, the Filters button (with a count badge) and — once anything
/// is filtered — a row of chips for each active slicer with a Clear at the end.
class SheetFilterBar extends StatelessWidget {
  const SheetFilterBar({
    super.key,
    required this.controller,
    required this.onSearchChanged,
    required this.onOpenFilters,
    required this.activeCount,
    required this.chips,
    required this.onClearAll,
    this.wide = false,
    this.extras = const [],
    this.below,
  });

  /// iPad / wide: a labelled Filters button and roomier spacing.
  final bool wide;

  /// Widgets after the Filters button (the date navigator, the Table | Cards
  /// toggle, the Add Entry button).
  final List<Widget> extras;

  /// A full-width row under the search row (the date strip on narrower iPads).
  final Widget? below;

  final TextEditingController controller;
  final ValueChanged<String> onSearchChanged;
  final VoidCallback onOpenFilters;
  final int activeCount;
  final List<ActiveFilterChip> chips;
  final VoidCallback onClearAll;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Material(
      color: Theme.of(context).appBarTheme.backgroundColor ?? s.surface,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(wide ? 16 : 12, wide ? 8 : 6, wide ? 16 : 12, 6),
            child: Row(
              children: [
                Expanded(
                  flex: wide ? 3 : 1,
                  child: TextField(
                    key: const ValueKey('sheet-search'),
                    controller: controller,
                    onChanged: onSearchChanged,
                    // Part / operator / drawing no.: plain text, but no autocorrect
                    // (it mangles codes) and a Search key.
                    keyboardType: TextInputType.text,
                    textInputAction: TextInputAction.search,
                    autocorrect: false,
                    enableSuggestions: false,
                    textCapitalization: TextCapitalization.none,
                    onSubmitted: (_) => FocusManager.instance.primaryFocus?.unfocus(),
                    // A tap anywhere else closes the keyboard (mobile does not by default).
                    onTapOutside: (_) => FocusManager.instance.primaryFocus?.unfocus(),
                    style: const TextStyle(fontSize: 14),
                    decoration: InputDecoration(
                      hintText: 'Search part, operator, drawing…',
                      prefixIcon: const Icon(Icons.search, size: 20),
                      prefixIconConstraints: const BoxConstraints(minWidth: 38, minHeight: 40),
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      suffixIconConstraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                      suffixIcon: ValueListenableBuilder<TextEditingValue>(
                        valueListenable: controller,
                        builder: (_, v, _) => v.text.isEmpty
                            ? const SizedBox.shrink()
                            : IconButton(
                                tooltip: 'Clear search',
                                padding: EdgeInsets.zero,
                                constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                                icon: const Icon(Icons.close_rounded, size: 18),
                                onPressed: () {
                                  controller.clear();
                                  onSearchChanged('');
                                },
                              ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Badge(
                  isLabelVisible: activeCount > 0,
                  label: Text('$activeCount'),
                  offset: const Offset(-2, 2),
                  child: wide
                      ? FilledButton.tonalIcon(
                          key: const ValueKey('sheet-filter-btn'),
                          style: FilledButton.styleFrom(minimumSize: const Size(0, 40), padding: const EdgeInsets.symmetric(horizontal: 14)),
                          icon: const Icon(Icons.tune_rounded, size: 18),
                          label: const Text('Filters'),
                          onPressed: onOpenFilters,
                        )
                      : IconButton.filledTonal(
                          key: const ValueKey('sheet-filter-btn'),
                          tooltip: activeCount > 0 ? 'Filters ($activeCount active)' : 'Filters',
                          style: IconButton.styleFrom(minimumSize: const Size(40, 40), fixedSize: const Size(40, 40)),
                          iconSize: 20,
                          icon: const Icon(Icons.tune_rounded),
                          onPressed: onOpenFilters,
                        ),
                ),
                for (final e in extras) ...[const SizedBox(width: 8), e],
              ],
            ),
          ),
          if (chips.isNotEmpty)
            SizedBox(
              height: 38,
              child: ListView(
                key: const ValueKey('sheet-active-chips'),
                scrollDirection: Axis.horizontal,
                padding: EdgeInsets.fromLTRB(wide ? 16 : 12, 0, 8, 6),
                children: [
                  for (final c in chips)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: InputChip(
                        key: ValueKey('chip-${c.id}'),
                        label: Text(c.label, maxLines: 1, overflow: TextOverflow.ellipsis),
                        onPressed: c.onTap,
                        onDeleted: c.onRemove,
                        deleteIcon: const Icon(Icons.close_rounded, size: 16),
                        deleteButtonTooltipMessage: 'Remove filter',
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(horizontal: 2),
                        backgroundColor: s.primary.withValues(alpha: 0.10),
                        side: BorderSide(color: s.primary.withValues(alpha: 0.35)),
                        labelStyle: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.readable(context, s.primary)),
                      ),
                    ),
                  TextButton.icon(
                    key: const ValueKey('sheet-clear'),
                    onPressed: onClearAll,
                    style: TextButton.styleFrom(
                      foregroundColor: s.error,
                      visualDensity: VisualDensity.compact,
                      minimumSize: const Size(0, 36),
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                    ),
                    icon: const Icon(Icons.close_rounded, size: 16),
                    label: const Text('Clear'),
                  ),
                ],
              ),
            ),
          ?below,
          Divider(height: 1, thickness: 1, color: s.outlineVariant),
        ],
      ),
    );
  }
}
