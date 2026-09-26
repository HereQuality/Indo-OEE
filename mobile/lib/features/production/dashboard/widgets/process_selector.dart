import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/theme/app_colors.dart';

/// One choice on the process selector. [id] null = "All machines".
class ProcessChoice {
  const ProcessChoice({required this.id, required this.label});
  final String? id;
  final String label;
}

/// The row that replaces the old "pick a process" landing page: a chip per
/// process that has machines, then "All machines". On a phone it is a
/// swipeable row of pills; on a tablet ([tabs]) a segmented tab strip like the
/// web's period tabs. Horizontal drags on it scroll the row and never turn the
/// tab pager.
class ProcessSelector extends StatefulWidget {
  const ProcessSelector({
    super.key,
    required this.choices,
    required this.selectedId,
    required this.onSelect,
    this.tabs = false,
  });

  final List<ProcessChoice> choices;
  final String? selectedId;
  final ValueChanged<String?> onSelect;
  final bool tabs;

  @override
  State<ProcessSelector> createState() => _ProcessSelectorState();
}

class _ProcessSelectorState extends State<ProcessSelector> {
  final GlobalKey _selectedKey = GlobalKey();
  final ScrollController _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _reveal(animate: false);
  }

  @override
  void didUpdateWidget(ProcessSelector old) {
    super.didUpdateWidget(old);
    if (old.selectedId != widget.selectedId) _reveal();
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _reveal({bool animate = true}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ctx = _selectedKey.currentContext;
      if (!mounted || ctx == null || !_scroll.hasClients) return;
      Scrollable.ensureVisible(
        ctx,
        alignment: 0.5,
        duration: animate ? const Duration(milliseconds: 220) : Duration.zero,
        curve: Curves.easeOutCubic,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final items = <Widget>[
      for (final c in widget.choices)
        widget.tabs
            ? _Tab(
                key: c.id == widget.selectedId ? _selectedKey : ValueKey('proc-tab:${c.id}'),
                label: c.label,
                selected: c.id == widget.selectedId,
                onTap: () => widget.onSelect(c.id),
              )
            : _Pill(
                key: c.id == widget.selectedId ? _selectedKey : ValueKey('proc-chip:${c.id}'),
                label: c.label,
                selected: c.id == widget.selectedId,
                onTap: () => widget.onSelect(c.id),
              ),
    ];

    final row = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < items.length; i++) ...[
          if (i > 0) SizedBox(width: widget.tabs ? 2 : 6),
          items[i],
        ],
      ],
    );

    final scroller = SingleChildScrollView(
      controller: _scroll,
      scrollDirection: Axis.horizontal,
      padding: widget.tabs ? const EdgeInsets.all(3) : const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: row,
    );
    if (!widget.tabs) return SizedBox(height: 40, child: scroller);
    return DecoratedBox(
      decoration: BoxDecoration(color: cs.surfaceContainerHigh, borderRadius: BorderRadius.circular(12)),
      child: scroller,
    );
  }
}

/// Phone chip: filled brand pill when selected, outlined otherwise.
class _Pill extends StatelessWidget {
  const _Pill({super.key, required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final bg = selected ? (dark ? cs.primary.withValues(alpha: 0.28) : cs.primary) : Colors.transparent;
    final fg = selected ? (dark ? AppColors.readable(context, cs.primary) : cs.onPrimary) : cs.onSurface;
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      excludeSemantics: true,
      onTap: onTap,
      child: Material(
        color: bg,
        shape: StadiumBorder(side: BorderSide(color: selected ? (dark ? cs.primary : Colors.transparent) : cs.outline)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: () {
            HapticFeedback.selectionClick();
            onTap();
          },
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 36, minWidth: 44),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: Center(
                widthFactor: 1,
                child: Text(label, maxLines: 1, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: fg)),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Tablet segment: a raised card on the track when selected.
class _Tab extends StatelessWidget {
  const _Tab({super.key, required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final card = Theme.of(context).cardTheme.color ?? cs.surface;
    final fg = selected ? AppColors.readable(context, cs.primary) : cs.onSurfaceVariant;
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      excludeSemantics: true,
      onTap: onTap,
      child: Material(
        color: selected ? card : Colors.transparent,
        elevation: selected && !dark ? 1 : 0,
        shadowColor: Colors.black.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: () {
            HapticFeedback.selectionClick();
            onTap();
          },
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 36, minWidth: 44),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: Center(
                widthFactor: 1,
                child: Text(label, maxLines: 1, style: TextStyle(fontWeight: selected ? FontWeight.w700 : FontWeight.w600, fontSize: 13, color: fg)),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
