import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/theme/app_colors.dart';
import '../sheet_model.dart';
import '../sheet_period.dart';

typedef FilterOptions = Map<String, List<Map<String, String>>>;

/// Loads the machine / operator / part values present in a period (the sheet
/// re-asks whenever the period changes) as labelled options.
typedef FilterOptionsLoader = Future<FilterOptions> Function(List<String> range, SheetFilters selected);

const BoxConstraints _width = BoxConstraints(maxWidth: 720);

/// The Filters bottom sheet — the phone's version of the web FilterPanel: the
/// period (Date range / Month / Year) and the MC No. / Operator / Part
/// multi-selects. Changes are staged; Apply sends them to the sheet in one go
/// (each change reloads the list from the server, so it is not done per tap).
Future<void> showSheetFilters(
  BuildContext context, {
  required List<String> range,
  required Map<String, dynamic>? extent,
  required SheetFilters filters,
  required FilterOptions options,
  required FilterOptionsLoader loadOptions,
  required void Function(List<String> range, SheetFilters filters) onApply,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    constraints: _width,
    builder: (ctx) => _FilterSheet(
      range: range,
      extent: extent,
      filters: filters,
      options: options,
      loadOptions: loadOptions,
      onApply: onApply,
    ),
  );
}

enum _Tab { range, month, year }

_Tab _tabOf(List<String> range) {
  final label = describeRange(range);
  if (RegExp(r'^\d{4}$').hasMatch(label)) return _Tab.year;
  if (RegExp(r'^[A-Z][a-z]+ \d{4}$').hasMatch(label)) return _Tab.month;
  return _Tab.range;
}

class _FilterSheet extends StatefulWidget {
  const _FilterSheet({
    required this.range,
    required this.extent,
    required this.filters,
    required this.options,
    required this.loadOptions,
    required this.onApply,
  });

  final List<String> range;
  final Map<String, dynamic>? extent;
  final SheetFilters filters;
  final FilterOptions options;
  final FilterOptionsLoader loadOptions;
  final void Function(List<String> range, SheetFilters filters) onApply;

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late List<String> _range = List.of(widget.range);
  late SheetFilters _filters = widget.filters;
  late FilterOptions _options = widget.options;
  late _Tab _tab = _tabOf(widget.range);
  late int _monthYear = int.tryParse(widget.range[0].substring(0, 4)) ?? DateTime.now().year;
  Timer? _debounce;
  bool _optionsLoading = false;
  int _optionsGen = 0;

  final DateTime _now = DateTime.now();

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  String? get _rangeError {
    final a = parseIsoDate(_range[0]);
    final b = parseIsoDate(_range[1]);
    if (a == null || b == null) return 'Pick both dates.';
    if (a.isAfter(b)) return 'From date must be on or before To date.';
    if (rangeDays(_range) > maxRangeDays) return "Date range can't exceed $maxRangeDays days.";
    return null;
  }

  void _setRange(List<String> next) {
    setState(() => _range = next);
    _refreshOptions();
  }

  void _refreshOptions() {
    if (_rangeError != null) return;
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 250), () async {
      final gen = ++_optionsGen;
      if (mounted) setState(() => _optionsLoading = true);
      try {
        final next = await widget.loadOptions(_range, _filters);
        if (!mounted || gen != _optionsGen) return;
        setState(() {
          _options = next;
          _optionsLoading = false;
        });
      } catch (_) {
        if (mounted && gen == _optionsGen) setState(() => _optionsLoading = false);
      }
    });
  }

  Future<void> _pickDate(int index) async {
    final now = _now;
    final today = DateTime(now.year, now.month, now.day);
    final ext = widget.extent;
    final floorYear = int.tryParse('${ext?['from'] ?? ''}'.padRight(4, '0').substring(0, 4)) ?? 2020;
    final first = DateTime(floorYear < 2000 ? 2000 : floorYear, 1, 1);
    var initial = parseIsoDate(_range[index]) ?? today;
    if (initial.isAfter(today)) initial = today;
    if (initial.isBefore(first)) initial = first;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: first,
      lastDate: today,
      helpText: index == 0 ? 'From date' : 'To date',
    );
    if (picked == null || !mounted) return;
    final iso = isoDate(picked);
    final next = [..._range];
    next[index] = iso;
    _setRange(next);
  }

  Future<void> _pickMulti(String dim, String title) async {
    final list = _options[dim] ?? const [];
    final picked = await showModalBottomSheet<List<String>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      constraints: _width,
      builder: (ctx) => _MultiPickSheet(title: title, options: list, selected: _filters.of(dim)),
    );
    if (picked == null || !mounted) return;
    setState(() => _filters = _filters.withDim(dim, picked));
  }

  void _reset() {
    HapticFeedback.selectionClick();
    final fresh = defaultEntryRange();
    setState(() {
      _range = fresh;
      _filters = SheetFilters.empty;
      _tab = _tabOf(fresh);
      _monthYear = int.parse(fresh[0].substring(0, 4));
    });
    _refreshOptions();
  }

  void _apply() {
    if (_rangeError != null) return;
    HapticFeedback.selectionClick();
    Navigator.of(context).pop();
    widget.onApply(_range, _filters);
  }

  String _labelOf(String dim, String value) {
    for (final o in _options[dim] ?? const <Map<String, String>>[]) {
      if (o['value'] == value) return o['label']!;
    }
    return value;
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final h = MediaQuery.sizeOf(context).height;
    final error = _rangeError;
    final years = yearsOfExtent(widget.extent, _now);
    final monthYears = years.contains(_monthYear) ? years : ([_monthYear, ...years]..sort((a, b) => b.compareTo(a)));
    final thisMonth = isoDate(_now).substring(0, 7);
    final applied = describeRange(_range);

    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: h * 0.92),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 8, 4),
              child: Row(
                children: [
                  const Expanded(child: Text('Filters', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800))),
                  TextButton(onPressed: _reset, child: const Text('Reset')),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const _SectionLabel('Period'),
                    _Segments(
                      value: _tab.name,
                      items: const [('range', 'Date range'), ('month', 'Month'), ('year', 'Year')],
                      onChanged: (v) => setState(() => _tab = _Tab.values.byName(v)),
                    ),
                    const SizedBox(height: 14),
                    if (_tab == _Tab.range) ...[
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(child: _DateBox(label: 'From', iso: _range[0], onTap: () => _pickDate(0), invalid: error != null)),
                          const SizedBox(width: 12),
                          Expanded(child: _DateBox(label: 'To', iso: _range[1], onTap: () => _pickDate(1), invalid: error != null)),
                        ],
                      ),
                      if (error != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(error, style: TextStyle(color: s.error, fontSize: 13)),
                        ),
                      const SizedBox(height: 14),
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: [
                          for (final q in quickRanges)
                            ChoiceChip(
                              key: ValueKey('quick-${q.key}'),
                              label: Text(q.label),
                              selected: q.range(_now).join() == _range.join(),
                              onSelected: (_) => _setRange(q.range(_now)),
                            ),
                        ],
                      ),
                    ],
                    if (_tab == _Tab.month) ...[
                      _YearStepper(
                        year: _monthYear,
                        years: monthYears,
                        onChanged: (y) => setState(() => _monthYear = y),
                      ),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: [
                          for (var i = 0; i < 12; i++)
                            ChoiceChip(
                              key: ValueKey('month-$i'),
                              label: SizedBox(width: 44, child: Text(monthAbbr[i], textAlign: TextAlign.center)),
                              selected: applied == '${monthNames[i]} $_monthYear',
                              onSelected: '$_monthYear-${(i + 1).toString().padLeft(2, '0')}'.compareTo(thisMonth) > 0
                                  ? null
                                  : (_) => _setRange(monthRange('$_monthYear-${(i + 1).toString().padLeft(2, '0')}')),
                            ),
                        ],
                      ),
                    ],
                    if (_tab == _Tab.year)
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: [
                          for (final y in years)
                            ChoiceChip(
                              key: ValueKey('year-$y'),
                              label: SizedBox(width: 56, child: Text('$y', textAlign: TextAlign.center)),
                              selected: applied == '$y',
                              onSelected: (_) => _setRange(yearRange(y)),
                            ),
                        ],
                      ),
                    if (error == null)
                      Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: Text.rich(
                          TextSpan(
                            text: 'Showing ',
                            style: TextStyle(fontSize: 13, color: s.onSurfaceVariant),
                            children: [TextSpan(text: applied, style: TextStyle(fontWeight: FontWeight.w700, color: s.onSurface))],
                          ),
                        ),
                      ),
                    const SizedBox(height: 18),
                    Row(
                      children: [
                        const Expanded(child: _SectionLabel('Narrow down')),
                        if (_optionsLoading) const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
                      ],
                    ),
                    _PickRow(
                      key: const ValueKey('pick-machine'),
                      label: 'MC No.',
                      placeholder: 'All machines',
                      selected: [for (final v in _filters.machine) _labelOf('machine', v)],
                      onTap: () => _pickMulti('machine', 'MC No.'),
                      onRemove: (i) => setState(() => _filters = _filters.withDim('machine', [..._filters.machine]..removeAt(i))),
                    ),
                    _PickRow(
                      key: const ValueKey('pick-operator'),
                      label: 'Operator',
                      placeholder: 'All operators',
                      selected: [for (final v in _filters.operator) _labelOf('operator', v)],
                      onTap: () => _pickMulti('operator', 'Operator'),
                      onRemove: (i) => setState(() => _filters = _filters.withDim('operator', [..._filters.operator]..removeAt(i))),
                    ),
                    _PickRow(
                      key: const ValueKey('pick-item'),
                      label: 'Part',
                      placeholder: 'All parts',
                      selected: [for (final v in _filters.item) _labelOf('item', v)],
                      onTap: () => _pickMulti('item', 'Part'),
                      onRemove: (i) => setState(() => _filters = _filters.withDim('item', [..._filters.item]..removeAt(i))),
                    ),
                  ],
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 12),
              decoration: BoxDecoration(border: Border(top: BorderSide(color: s.outlineVariant))),
              child: Row(
                children: [
                  Expanded(
                    child: FilledButton(
                      key: const ValueKey('filters-apply'),
                      onPressed: error == null ? _apply : null,
                      child: const Text('Apply filters'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(
          text.toUpperCase(),
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.7,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      );
}

/// A three-way segmented switch that keeps its labels on screen at any text size.
class _Segments extends StatelessWidget {
  const _Segments({required this.value, required this.items, required this.onChanged});
  final String value;
  final List<(String, String)> items;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: s.surfaceContainerHigh, borderRadius: BorderRadius.circular(12)),
      child: Row(
        children: [
          for (final (key, label) in items)
            Expanded(
              child: Semantics(
                button: true,
                selected: key == value,
                label: label,
                child: InkWell(
                  borderRadius: BorderRadius.circular(9),
                  onTap: () {
                    HapticFeedback.selectionClick();
                    onChanged(key);
                  },
                  child: Container(
                    constraints: const BoxConstraints(minHeight: 44),
                    alignment: Alignment.center,
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
                    decoration: BoxDecoration(
                      color: key == value ? s.surface : Colors.transparent,
                      borderRadius: BorderRadius.circular(9),
                      boxShadow: key == value ? [BoxShadow(color: Colors.black.withValues(alpha: 0.10), blurRadius: 4, offset: const Offset(0, 1))] : null,
                    ),
                    child: Text(
                      label,
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 14, fontWeight: key == value ? FontWeight.w800 : FontWeight.w600, color: key == value ? s.onSurface : s.onSurfaceVariant),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _DateBox extends StatelessWidget {
  const _DateBox({required this.label, required this.iso, required this.onTap, required this.invalid});
  final String label;
  final String iso;
  final VoidCallback onTap;
  final bool invalid;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      label: '$label date ${dmy(iso)}',
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: label,
            suffixIcon: const Icon(Icons.calendar_today_outlined, size: 18),
            enabledBorder: invalid
                ? OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: s.error))
                : null,
          ),
          child: Text(dmy(iso), maxLines: 1, overflow: TextOverflow.ellipsis),
        ),
      ),
    );
  }
}

class _YearStepper extends StatelessWidget {
  const _YearStepper({required this.year, required this.years, required this.onChanged});
  final int year;
  final List<int> years; // newest first
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final at = years.indexOf(year);
    final older = at >= 0 && at < years.length - 1 ? years[at + 1] : null;
    final newer = at > 0 ? years[at - 1] : null;
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        IconButton(
          tooltip: 'Previous year',
          onPressed: older == null ? null : () => onChanged(older),
          icon: const Icon(Icons.chevron_left_rounded),
        ),
        SizedBox(
          width: 88,
          child: Text('$year', textAlign: TextAlign.center, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
        ),
        IconButton(
          tooltip: 'Next year',
          onPressed: newer == null ? null : () => onChanged(newer),
          icon: const Icon(Icons.chevron_right_rounded),
        ),
      ],
    );
  }
}

/// A "field" that opens the multi-select, with what is picked shown as chips.
class _PickRow extends StatelessWidget {
  const _PickRow({
    super.key,
    required this.label,
    required this.placeholder,
    required this.selected,
    required this.onTap,
    required this.onRemove,
  });

  final String label;
  final String placeholder;
  final List<String> selected;
  final VoidCallback onTap;
  final void Function(int index) onRemove;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: s.onSurface)),
          const SizedBox(height: 6),
          InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onTap,
            child: InputDecorator(
              decoration: const InputDecoration(suffixIcon: Icon(Icons.keyboard_arrow_down_rounded)),
              child: Text(
                selected.isEmpty ? placeholder : '${selected.length} selected',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: selected.isEmpty ? s.onSurfaceVariant : s.onSurface, fontWeight: selected.isEmpty ? FontWeight.w400 : FontWeight.w600),
              ),
            ),
          ),
          if (selected.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Wrap(
                spacing: 6,
                runSpacing: 2,
                children: [
                  for (var i = 0; i < selected.length; i++)
                    InputChip(
                      label: Text(selected[i]),
                      onDeleted: () => onRemove(i),
                      deleteButtonTooltipMessage: 'Remove ${selected[i]}',
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Searchable checklist; pops the picked values (or nothing when dismissed).
class _MultiPickSheet extends StatefulWidget {
  const _MultiPickSheet({required this.title, required this.options, required this.selected});
  final String title;
  final List<Map<String, String>> options;
  final List<String> selected;

  @override
  State<_MultiPickSheet> createState() => _MultiPickSheetState();
}

class _MultiPickSheetState extends State<_MultiPickSheet> {
  late final Set<String> _picked = {...widget.selected};
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final q = _q.trim().toLowerCase();
    final list = q.isEmpty ? widget.options : widget.options.where((o) => o['label']!.toLowerCase().contains(q)).toList();
    final h = MediaQuery.sizeOf(context).height;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: h * 0.85),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 8, 4),
                child: Row(
                  children: [
                    Expanded(child: Text(widget.title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800))),
                    TextButton(
                      onPressed: _picked.isEmpty ? null : () => setState(_picked.clear),
                      child: const Text('Clear'),
                    ),
                  ],
                ),
              ),
              if (widget.options.length > 6)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: TextField(
                    onChanged: (v) => setState(() => _q = v),
                    decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search', isDense: true),
                  ),
                ),
              Flexible(
                child: list.isEmpty
                    ? Padding(
                        padding: const EdgeInsets.all(28),
                        child: Text(
                          widget.options.isEmpty ? 'Nothing in this period' : 'No matches',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: s.onSurfaceVariant),
                        ),
                      )
                    : ListView.builder(
                        shrinkWrap: true,
                        itemCount: list.length,
                        itemBuilder: (_, i) {
                          final o = list[i];
                          final v = o['value']!;
                          return CheckboxListTile(
                            key: ValueKey('opt-$v'),
                            value: _picked.contains(v),
                            controlAffinity: ListTileControlAffinity.trailing,
                            title: Text(o['label']!, style: const TextStyle(fontWeight: FontWeight.w500)),
                            onChanged: (on) {
                              HapticFeedback.selectionClick();
                              setState(() => on == true ? _picked.add(v) : _picked.remove(v));
                            },
                          );
                        },
                      ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                child: FilledButton(
                  key: const ValueKey('multi-done'),
                  onPressed: () {
                    // Keep the order the options are listed in.
                    final ordered = [
                      for (final o in widget.options)
                        if (_picked.contains(o['value'])) o['value']!,
                      for (final v in _picked)
                        if (!widget.options.any((o) => o['value'] == v)) v,
                    ];
                    Navigator.of(context).pop(ordered);
                  },
                  child: Text(_picked.isEmpty ? 'Done' : 'Done (${_picked.length})'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Small helper for the filter bar's colour.
Color filterAccent(BuildContext context) => AppColors.readable(context, Theme.of(context).colorScheme.primary);
