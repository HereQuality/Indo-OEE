import 'package:flutter/material.dart';

import '../../shared/production_sheet_calc.dart' show displayDay;
import '../dashboard_engine.dart' show monthLabel;
import 'sheet_kit.dart';

/// The dashboard's Filters panel (port of the machine / operator / part
/// pickers of FilterPanel.jsx) as a full-height bottom sheet.
///
/// [options] are the values present in the loaded period, keyed `machine` |
/// `operator` | `item`, each `[{'value','label'}]` already in display order;
/// [filters] holds the current selection of all five dimensions (machine,
/// operator, item, month, date). Ticking is a draft: nothing reaches the
/// dashboard until Apply, which calls [onFilterSet] once per dimension that
/// changed. "Clear all" empties every selection (including month / date picks
/// made by tapping charts) and, on Apply, also calls [onClearAll] - which the
/// dashboard uses to reset the period as well, like the web's Clear button.
Future<void> showFilterSheet(
  BuildContext context, {
  required Map<String, List<Map<String, String>>> options,
  required Map<String, List<String>> filters,
  required void Function(String dim, List<String> values) onFilterSet,
  required VoidCallback onClearAll,
}) {
  return showSheet<void>(
    context,
    builder: (ctx) => FullHeightSheet(
      child: FilterSheet(options: options, filters: filters, onFilterSet: onFilterSet, onClearAll: onClearAll),
    ),
  );
}

const List<String> _pickDims = ['machine', 'operator', 'item'];
const List<String> _allDims = ['machine', 'operator', 'item', 'month', 'date'];
const Map<String, String> _dimLabel = {
  'machine': 'Machine',
  'operator': 'Operator',
  'item': 'Part',
  'month': 'Month',
  'date': 'Date',
};
const Map<String, String> _allLabel = {'machine': 'All machines', 'operator': 'All operators', 'item': 'All parts'};

final ButtonStyle _quietButton = TextButton.styleFrom(
  minimumSize: const Size(40, 36),
  padding: const EdgeInsets.symmetric(horizontal: 10),
  textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
);

bool _sameSet(List<String> a, List<String> b) => a.length == b.length && a.toSet().containsAll(b);

class FilterSheet extends StatefulWidget {
  const FilterSheet({super.key, required this.options, required this.filters, required this.onFilterSet, required this.onClearAll});

  final Map<String, List<Map<String, String>>> options;
  final Map<String, List<String>> filters;
  final void Function(String dim, List<String> values) onFilterSet;
  final VoidCallback onClearAll;

  @override
  State<FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<FilterSheet> {
  late final Map<String, List<String>> _sel = {
    for (final d in _allDims) d: List<String>.of(widget.filters[d] ?? const <String>[]),
  };
  final Map<String, String> _queries = {};
  final TextEditingController _search = TextEditingController();
  String _tab = 'machine';
  bool _clearedAll = false;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  List<Map<String, String>> _optionsOf(String dim) => widget.options[dim] ?? const [];

  String _query(String dim) => (_queries[dim] ?? '').trim().toLowerCase();

  List<Map<String, String>> _visible(String dim) {
    final q = _query(dim);
    final all = _optionsOf(dim);
    if (q.isEmpty) return all;
    return all.where((o) => (o['label'] ?? '').toLowerCase().contains(q)).toList();
  }

  int get _total => _allDims.fold(0, (n, d) => n + _sel[d]!.length);

  bool get _changed => _clearedAll || _allDims.any((d) => !_sameSet(_sel[d]!, widget.filters[d] ?? const []));

  String _textOf(String dim, String value) {
    if (dim == 'month') {
      try {
        return monthLabel(value);
      } catch (_) {
        return value;
      }
    }
    if (dim == 'date') return displayDay(value);
    for (final o in _optionsOf(dim)) {
      if (o['value'] == value) return o['label'] ?? value;
    }
    return value.isEmpty ? '(none)' : value;
  }

  void _toggle(String dim, String value) {
    SheetHaptics.selection();
    setState(() {
      final list = _sel[dim]!;
      list.contains(value) ? list.remove(value) : list.add(value);
    });
  }

  void _selectShown(String dim) {
    SheetHaptics.selection();
    setState(() {
      final list = _sel[dim]!;
      for (final o in _visible(dim)) {
        final v = o['value'] ?? '';
        if (!list.contains(v)) list.add(v);
      }
    });
  }

  void _clearShown(String dim) {
    SheetHaptics.selection();
    setState(() {
      if (_query(dim).isEmpty) {
        _sel[dim]!.clear();
      } else {
        final hide = _visible(dim).map((o) => o['value'] ?? '').toSet();
        _sel[dim]!.removeWhere(hide.contains);
      }
    });
  }

  void _clearAll() {
    SheetHaptics.medium();
    setState(() {
      for (final d in _allDims) {
        _sel[d]!.clear();
      }
      _clearedAll = true;
    });
  }

  void _switchTab(String dim) {
    FocusScope.of(context).unfocus();
    setState(() {
      _queries[_tab] = _search.text;
      _tab = dim;
      final q = _queries[dim] ?? '';
      _search.value = TextEditingValue(text: q, selection: TextSelection.collapsed(offset: q.length));
    });
  }

  void _apply() {
    SheetHaptics.light();
    if (_clearedAll) {
      widget.onClearAll();
      for (final d in _allDims) {
        if (_sel[d]!.isNotEmpty) widget.onFilterSet(d, List<String>.of(_sel[d]!));
      }
    } else {
      for (final d in _allDims) {
        if (!_sameSet(_sel[d]!, widget.filters[d] ?? const [])) widget.onFilterSet(d, List<String>.of(_sel[d]!));
      }
    }
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    final keyboardUp = MediaQuery.viewInsetsOf(context).bottom > 0;
    final total = _total;
    final subtitle = total == 0
        ? (_clearedAll ? 'Everything cleared - apply to update the dashboard' : 'No filters - showing everything')
        : plural(total, 'filter', 'filters');
    final picks = [
      for (final d in _allDims)
        for (final v in _sel[d]!) (d, v),
    ];

    return Column(
      children: [
        const SheetHandle(),
        SheetHeader(
          title: 'Filters',
          overline: 'Dashboard',
          subtitle: subtitle,
          actions: [
            TextButton(
              onPressed: (total == 0 && _clearedAll) ? null : _clearAll,
              child: const Text('Clear all'),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(kSheetGutter, 2, kSheetGutter, 8),
          child: SegmentedTabs<String>(
            items: [for (final d in _pickDims) TabItem(d, _dimLabel[d]!, count: _sel[d]!.length)],
            selected: _tab,
            onSelected: _switchTab,
          ),
        ),
        Divider(height: 1, color: t.border),
        // Everything between the tabs and the Apply bar scrolls together, so a
        // short landscape screen or a large text size can never overflow.
        Expanded(
          child: CustomScrollView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            slivers: [
              if (_clearedAll)
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(kSheetGutter, 12, kSheetGutter, 0),
                    child: SheetBanner('Applying will also reset the period to its default.', icon: Icons.info_outline_rounded, isError: false),
                  ),
                ),
              // The chip row steps aside while the keyboard is up: the search
              // box and the list need the room more.
              if (picks.isNotEmpty && !keyboardUp)
                SliverToBoxAdapter(
                  child: SizedBox(
                    height: 44,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: kSheetGutter, vertical: 4),
                      itemCount: picks.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 8),
                      itemBuilder: (context, i) {
                        final (dim, value) = picks[i];
                        return _SelectionChip(
                          label: '${_dimLabel[dim]}: ${_textOf(dim, value)}',
                          onRemove: () => _toggle(dim, value),
                        );
                      },
                    ),
                  ),
                ),
              SliverToBoxAdapter(child: _searchBar(context)),
              ..._listSlivers(context),
            ],
          ),
        ),
        SheetFooter(
          child: SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _apply,
              child: Text(
                _changed ? (total > 0 ? 'Apply · ${plural(total, 'filter', 'filters')}' : 'Apply') : 'Done',
                textAlign: TextAlign.center,
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _searchBar(BuildContext context) {
    final t = SheetTone.of(context);
    final all = _optionsOf(_tab);
    final shown = _visible(_tab);
    final picked = _sel[_tab]!.length;
    final searching = _query(_tab).isNotEmpty;
    return Padding(
      padding: const EdgeInsets.fromLTRB(kSheetGutter, 8, kSheetGutter, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _search,
            // Names and part numbers: plain text, never auto-corrected or
            // capitalised into something else, and Search on the return key.
            keyboardType: TextInputType.text,
            textInputAction: TextInputAction.search,
            textCapitalization: TextCapitalization.none,
            autocorrect: false,
            enableSuggestions: false,
            // Keep the field clear of the sheet's sticky Apply bar when it is focused.
            scrollPadding: const EdgeInsets.only(bottom: 96),
            onTapOutside: (_) => FocusManager.instance.primaryFocus?.unfocus(),
            onSubmitted: (_) => FocusManager.instance.primaryFocus?.unfocus(),
            onChanged: (v) => setState(() => _queries[_tab] = v),
            style: const TextStyle(fontSize: 14),
            decoration: InputDecoration(
              hintText: 'Search ${_dimLabel[_tab]!.toLowerCase()}',
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              prefixIcon: const Icon(Icons.search_rounded, size: 20),
              prefixIconConstraints: const BoxConstraints(minWidth: 40, minHeight: 40),
              suffixIconConstraints: const BoxConstraints(minWidth: 40, minHeight: 40),
              suffixIcon: _search.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Clear search',
                      icon: const Icon(Icons.close_rounded, size: 18),
                      onPressed: () => setState(() {
                        _search.clear();
                        _queries[_tab] = '';
                      }),
                    ),
            ),
          ),
          const SizedBox(height: 2),
          // A Wrap, not a Row: at large text the count and the two buttons
          // stack instead of squeezing the count to a sliver.
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                searching ? '$picked of ${all.length} selected · ${shown.length} shown' : '$picked of ${all.length} selected',
                style: TextStyle(fontSize: 12, color: t.muted),
              ),
              Wrap(
                children: [
                  TextButton(
                    style: _quietButton,
                    onPressed: shown.isEmpty ? null : () => _selectShown(_tab),
                    child: const Text('Select all'),
                  ),
                  TextButton(
                    style: _quietButton,
                    onPressed: picked == 0 ? null : () => _clearShown(_tab),
                    child: const Text('Clear'),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  List<Widget> _listSlivers(BuildContext context) {
    final t = SheetTone.of(context);
    final all = _optionsOf(_tab);
    final shown = _visible(_tab);
    if (all.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: _Empty(icon: Icons.filter_alt_off_outlined, title: 'Nothing in this period', body: '${_allLabel[_tab]} appear here once the period has entries.'),
        ),
      ];
    }
    if (shown.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: _Empty(icon: Icons.search_off_rounded, title: 'No matches', body: 'Nothing called "${_search.text.trim()}".'),
        ),
      ];
    }
    return [
      SliverList.builder(
        itemCount: shown.length,
        itemBuilder: (context, i) {
          final o = shown[i];
          final value = o['value'] ?? '';
          final on = _sel[_tab]!.contains(value);
          return CheckboxListTile(
            key: ValueKey('$_tab:$value'),
            value: on,
            onChanged: (_) => _toggle(_tab, value),
            controlAffinity: ListTileControlAffinity.leading,
            dense: true,
            visualDensity: VisualDensity.compact,
            contentPadding: const EdgeInsets.symmetric(horizontal: kSheetGutter),
            tileColor: on ? t.wash : null,
            title: Text(
              o['label'] ?? value,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 14, fontWeight: on ? FontWeight.w600 : FontWeight.w500, color: t.ink),
            ),
          );
        },
      ),
      const SliverToBoxAdapter(child: SizedBox(height: 8)),
    ];
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.icon, required this.title, required this.body});
  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 32, color: t.muted.withValues(alpha: 0.7)),
          const SizedBox(height: 10),
          Text(title, textAlign: TextAlign.center, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: t.ink)),
          const SizedBox(height: 4),
          Text(body, textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: t.muted)),
        ],
      ),
    );
  }
}

/// One selected value with a remove cross (44 px tall hit area).
class _SelectionChip extends StatelessWidget {
  const _SelectionChip({required this.label, required this.onRemove});
  final String label;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    return Semantics(
      button: true,
      label: 'Remove filter $label',
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onRemove,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 36, maxWidth: 240),
          child: Center(
            widthFactor: 1,
            child: Container(
              padding: const EdgeInsets.fromLTRB(10, 5, 6, 5),
              decoration: BoxDecoration(
                color: t.wash,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: t.accent.withValues(alpha: 0.5)),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: t.ink)),
                  ),
                  const SizedBox(width: 4),
                  Icon(Icons.close_rounded, size: 15, color: t.muted),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
