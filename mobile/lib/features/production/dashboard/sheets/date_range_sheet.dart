import 'dart:async';

import 'package:flutter/material.dart';

import '../../shared/production_sheet_calc.dart' show displayDay;
import '../dashboard_engine.dart';
import 'range_calendar.dart';
import 'sheet_kit.dart';

/// Shown when a picked period is longer than the API accepts (same wording as
/// ProcessDashboard.jsx).
const String kRangeTooLongMessage = 'That period is longer than 5 years — pick a shorter one.';

/// The dashboard's period picker (port of DateRangeField.jsx + the Period part
/// of FilterPanel.jsx) as a bottom sheet with the web's three tabs:
///
///  * Date range - quick ranges and a calendar (tap a start day, then an end day)
///  * Month      - a month grid with a year stepper
///  * Year       - the years the process has data for
///
/// [range] is `['YYYY-MM-DD', 'YYYY-MM-DD']`; [extent] is the `{from, to}` of the
/// data (feeds the Year tab and how far back the calendar goes). A choice
/// applies straight away: [onChanged] is called once with the complete range and
/// the sheet closes. A period longer than [maxRangeDays] is refused with the
/// web's message and the sheet stays open.
Future<void> showDateRangeSheet(
  BuildContext context, {
  required List<String> range,
  Map<String, dynamic>? extent,
  required void Function(List<String> range) onChanged,
}) {
  return showDraggableSheet<void>(
    context,
    minSize: 0.5,
    initialSize: 0.88,
    maxSize: 0.96,
    builder: (ctx, scroll, sheet) => DateRangeSheet(range: range, extent: extent, onChanged: onChanged, scroll: scroll, sheet: sheet),
  );
}

enum _PeriodTab { range, month, year }

/// The web's `periodTabOf`: reopen on the tab that matches what is applied.
_PeriodTab _tabOf(List<String> range) {
  final label = describeRange(range);
  if (RegExp(r'^\d{4}$').hasMatch(label)) return _PeriodTab.year;
  if (RegExp(r'^[A-Z][a-z]+ \d{4}$').hasMatch(label)) return _PeriodTab.month;
  return _PeriodTab.range;
}

DateTime? _tryDay(String? s) {
  if (s == null) return null;
  try {
    return parseIsoDate(s);
  } catch (_) {
    return null;
  }
}

int? _yearOf(Object? isoish) {
  final s = '${isoish ?? ''}';
  return s.length >= 4 ? int.tryParse(s.substring(0, 4)) : null;
}

class DateRangeSheet extends StatefulWidget {
  const DateRangeSheet({super.key, required this.range, required this.extent, required this.onChanged, required this.scroll, required this.sheet});

  final List<String> range;
  final Map<String, dynamic>? extent;
  final void Function(List<String> range) onChanged;
  final ScrollController scroll;
  final DraggableScrollableController sheet;

  @override
  State<DateRangeSheet> createState() => _DateRangeSheetState();
}

class _DateRangeSheetState extends State<DateRangeSheet> {
  late _PeriodTab _tab = _tabOf(widget.range);
  late int _monthYear = _yearOf(widget.range.isNotEmpty ? widget.range[0] : null) ?? engineClock().year;

  /// First calendar tap while an end date is still to be picked.
  DateTime? _pickStart;

  /// The range the calendar highlights right after the second tap, until the
  /// sheet closes.
  List<DateTime>? _shown;
  String? _error;
  bool _applying = false;

  DateTime get _today {
    final n = engineClock();
    return DateTime(n.year, n.month, n.day);
  }

  Future<void> _apply(List<String> next, {bool pause = false}) async {
    if (_applying) return;
    if (rangeDays(next) > maxRangeDays) {
      SheetHaptics.medium();
      setState(() {
        _error = kRangeTooLongMessage;
        _pickStart = null;
        _shown = null;
      });
      return;
    }
    _applying = true;
    SheetHaptics.light();
    if (pause) {
      // Let the chosen range show on the calendar for a beat before closing.
      await Future<void>.delayed(const Duration(milliseconds: 180));
      if (!mounted) return;
    }
    final changed = next.length != widget.range.length || next[0] != widget.range[0] || next[1] != widget.range[1];
    Navigator.of(context).pop();
    if (changed) widget.onChanged(next);
  }

  void _tapDay(DateTime d) {
    if (_applying) return;
    final start = _pickStart;
    if (start != null && !d.isBefore(start)) {
      setState(() {
        _error = null;
        _pickStart = null;
        _shown = [start, d];
      });
      unawaited(_apply([isoDate(start), isoDate(d)], pause: true));
    } else {
      SheetHaptics.selection();
      setState(() {
        _error = null;
        _pickStart = d;
        _shown = null;
      });
    }
  }

  void _switchTab(_PeriodTab tab) => setState(() {
        _tab = tab;
        _pickStart = null;
        _error = null;
      });

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    final picking = _pickStart != null;
    final days = rangeDays(widget.range);
    final subtitle = picking
        ? '${displayDay(isoDate(_pickStart!))} → pick the end date'
        : 'Showing ${describeRange(widget.range)} · ${plural(days, 'day')}';

    return Column(
      children: [
        SheetGrabArea(
          controller: widget.sheet,
          minSize: 0.5,
          snapSizes: const [0.88, 0.96],
          child: Column(
            children: [
              const SheetHandle(),
              SheetHeader(title: 'Select period', overline: 'Period', subtitle: subtitle),
              Padding(
                padding: const EdgeInsets.fromLTRB(kSheetGutter, 4, kSheetGutter, 10),
                child: SegmentedTabs<_PeriodTab>(
                  items: const [
                    TabItem(_PeriodTab.range, 'Date range'),
                    TabItem(_PeriodTab.month, 'Month'),
                    TabItem(_PeriodTab.year, 'Year'),
                  ],
                  selected: _tab,
                  onSelected: _switchTab,
                ),
              ),
            ],
          ),
        ),
        Divider(height: 1, color: t.border),
        Expanded(
          child: ListView(
            controller: widget.scroll,
            padding: const EdgeInsets.fromLTRB(kSheetGutter, 14, kSheetGutter, 20),
            children: [
              if (_error != null) ...[SheetBanner(_error!), const SizedBox(height: 14)],
              switch (_tab) {
                _PeriodTab.range => _rangeTab(context),
                _PeriodTab.month => _monthTab(context),
                _PeriodTab.year => _yearTab(context),
              },
            ],
          ),
        ),
        if (picking)
          SheetFooter(
            child: Row(
              children: [
                Expanded(child: OutlinedButton(onPressed: () => setState(() => _pickStart = null), child: const Text('Cancel'))),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    onPressed: () => _apply([isoDate(_pickStart!), isoDate(_pickStart!)]),
                    child: const Text('Just this day'),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  // ── Date range tab ───────────────────────────────────────────────────────
  Widget _rangeTab(BuildContext context) {
    final t = SheetTone.of(context);
    final active = _pickStart == null && _shown == null ? quickRangeKey(widget.range) : null;

    final applied = _tryDay(widget.range.isNotEmpty ? widget.range[0] : null);
    final firstYear = <int>[
      _yearOf(widget.extent?['from']) ?? _today.year - 5,
      if (applied != null) applied.year,
    ].reduce((a, b) => a < b ? a : b);
    final firstDate = DateTime(firstYear, 1, 1);
    final initial = applied == null ? _today : (applied.isAfter(_today) ? _today : applied);

    final start = _pickStart ?? _shown?.first ?? applied;
    final end = _pickStart != null ? null : (_shown?.last ?? _tryDay(widget.range.length > 1 ? widget.range[1] : null));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SheetLabel('Quick ranges'),
        Wrap(
          spacing: 8,
          children: [
            for (final q in quickRanges)
              _QuickChip(
                label: q.label,
                selected: active == q.key,
                onTap: () => _apply(q.range()),
              ),
          ],
        ),
        const SizedBox(height: 10),
        const SheetLabel('Custom range'),
        SheetCard(
          padding: const EdgeInsets.fromLTRB(6, 6, 6, 8),
          child: RangeCalendar(
            start: start,
            end: end,
            firstDate: firstDate,
            lastDate: _today,
            today: _today,
            initialMonth: initial,
            onDayTap: _tapDay,
          ),
        ),
        const SizedBox(height: 10),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(padding: const EdgeInsets.only(top: 1), child: Icon(Icons.touch_app_outlined, size: 16, color: t.muted)),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                _pickStart != null
                    ? 'Now tap an end date - or use just this day.'
                    : 'Tap a start date, then an end date. Swipe to change month, tap the month to jump.',
                style: TextStyle(fontSize: 12.5, height: 1.35, color: t.muted),
              ),
            ),
          ],
        ),
      ],
    );
  }

  // ── Month tab ────────────────────────────────────────────────────────────
  Widget _monthTab(BuildContext context) {
    final years = yearsOfExtent(widget.extent);
    final monthYears = years.contains(_monthYear) ? years : ([_monthYear, ...years]..sort((a, b) => b.compareTo(a)));
    final idx = monthYears.indexOf(_monthYear);
    final applied = describeRange(widget.range);
    final thisMonth = isoDate(_today).substring(0, 7);
    final cols = gridColumns(context, normal: 4, minCellWidth: 76);
    final t = SheetTone.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SheetLabel('Year'),
        SheetCard(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
          child: Row(
            children: [
              IconButton(
                tooltip: 'Earlier year',
                constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                onPressed: idx < monthYears.length - 1 ? () => setState(() => _monthYear = monthYears[idx + 1]) : null,
                icon: const Icon(Icons.chevron_left_rounded),
              ),
              Expanded(
                child: Center(
                  child: Text('$_monthYear', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: t.ink)),
                ),
              ),
              IconButton(
                tooltip: 'Later year',
                constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                onPressed: idx > 0 ? () => setState(() => _monthYear = monthYears[idx - 1]) : null,
                icon: const Icon(Icons.chevron_right_rounded),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        const SheetLabel('Month'),
        GridView.count(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisCount: cols,
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          childAspectRatio: cols >= 4 ? 2.1 : 2.6,
          children: [
            for (var i = 0; i < 12; i++)
              MonthChip(
                label: monthLabels[i].substring(0, 3),
                semanticLabel: '${monthLabels[i]} $_monthYear',
                // The web disables months that have not started yet.
                enabled: '$_monthYear-${(i + 1).toString().padLeft(2, '0')}'.compareTo(thisMonth) <= 0,
                selected: applied == '${monthLabels[i]} $_monthYear',
                onTap: () => _apply(monthRange('$_monthYear-${(i + 1).toString().padLeft(2, '0')}')),
              ),
          ],
        ),
      ],
    );
  }

  // ── Year tab ─────────────────────────────────────────────────────────────
  Widget _yearTab(BuildContext context) {
    final years = yearsOfExtent(widget.extent);
    final applied = describeRange(widget.range);
    final cols = gridColumns(context, normal: 4, minCellWidth: 76);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SheetLabel('Years with data'),
        GridView.count(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisCount: cols,
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          childAspectRatio: cols >= 4 ? 2.1 : 2.6,
          children: [
            for (final y in years)
              MonthChip(
                label: '$y',
                selected: applied == '$y',
                enabled: true,
                onTap: () => _apply(yearRange(y)),
              ),
          ],
        ),
      ],
    );
  }
}

/// A quick-range pill (44 px tap area, slimmer pill drawn inside it).
class _QuickChip extends StatelessWidget {
  const _QuickChip({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 40),
          child: Center(
            widthFactor: 1,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: selected ? t.accent : t.card,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: selected ? t.accent : t.border),
              ),
              child: Text(
                label,
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: selected ? t.onAccent : t.ink),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
