import 'package:flutter/material.dart';

import '../dashboard_engine.dart' show monthLabels;
import 'sheet_kit.dart';

const double _cellHeight = 44;

DateTime _day(DateTime d) => DateTime(d.year, d.month, d.day);
bool _same(DateTime? a, DateTime? b) => a != null && b != null && a.year == b.year && a.month == b.month && a.day == b.day;

/// A month-per-page calendar that highlights a date range: swipe (or use the
/// arrows) between months, tap the title to jump to any month or year. It only
/// reports taps - the owner decides what one or two taps mean.
///
/// Built from plain widgets rather than Flutter's date pickers so the range
/// band, the tap targets (44 px) and the light / dark colours follow the
/// dashboard's own look.
class RangeCalendar extends StatefulWidget {
  const RangeCalendar({
    super.key,
    required this.start,
    required this.end,
    required this.firstDate,
    required this.lastDate,
    required this.today,
    required this.initialMonth,
    required this.onDayTap,
  });

  /// First / last day of the highlighted range (end null while picking).
  final DateTime? start;
  final DateTime? end;

  /// Earliest and latest selectable day.
  final DateTime firstDate;
  final DateTime lastDate;
  final DateTime today;

  /// Month shown first.
  final DateTime initialMonth;
  final ValueChanged<DateTime> onDayTap;

  @override
  State<RangeCalendar> createState() => _RangeCalendarState();
}

class _RangeCalendarState extends State<RangeCalendar> {
  late final PageController _pages;
  late int _page;
  bool _jump = false;

  int _indexOf(DateTime d) => (d.year - widget.firstDate.year) * 12 + (d.month - widget.firstDate.month);
  DateTime _monthAt(int i) => DateTime(widget.firstDate.year, widget.firstDate.month + i);
  int get _count => _indexOf(widget.lastDate) + 1;

  @override
  void initState() {
    super.initState();
    _page = _indexOf(widget.initialMonth).clamp(0, _count - 1);
    _pages = PageController(initialPage: _page);
  }

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  void _go(int page) {
    final target = page.clamp(0, _count - 1);
    if (target == _page) return;
    SheetHaptics.selection();
    _pages.animateToPage(target, duration: const Duration(milliseconds: 240), curve: Curves.easeOutCubic);
  }

  void _jumpTo(int page) {
    setState(() => _jump = false);
    SheetHaptics.selection();
    _pages.jumpToPage(page.clamp(0, _count - 1));
  }

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    final month = _monthAt(_page);
    final title = '${monthLabels[month.month - 1]} ${month.year}';
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            IconButton(
              tooltip: 'Previous month',
              constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
              onPressed: _jump || _page <= 0 ? null : () => _go(_page - 1),
              icon: const Icon(Icons.chevron_left_rounded),
            ),
            Expanded(
              child: Semantics(
                button: true,
                label: 'Choose month and year, showing $title',
                excludeSemantics: true,
                child: InkWell(
                  borderRadius: BorderRadius.circular(10),
                  onTap: () {
                    SheetHaptics.selection();
                    setState(() => _jump = !_jump);
                  },
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 44),
                    child: Center(
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Flexible(
                            child: Text(
                              title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700, color: t.ink),
                            ),
                          ),
                          const SizedBox(width: 2),
                          Icon(_jump ? Icons.arrow_drop_up_rounded : Icons.arrow_drop_down_rounded, color: t.muted),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
            IconButton(
              tooltip: 'Next month',
              constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
              onPressed: _jump || _page >= _count - 1 ? null : () => _go(_page + 1),
              icon: const Icon(Icons.chevron_right_rounded),
            ),
          ],
        ),
        if (_jump)
          _JumpPanel(
            firstDate: widget.firstDate,
            lastDate: widget.lastDate,
            current: month,
            onPick: (m) => _jumpTo(_indexOf(m)),
          ),
        // Kept mounted (just hidden) while the jump panel is open so the page
        // controller stays attached and the month survives.
        Offstage(
          offstage: _jump,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const _Weekdays(),
              SizedBox(
                height: _cellHeight * 6,
                child: PageView.builder(
                  controller: _pages,
                  itemCount: _count,
                  onPageChanged: (i) => setState(() => _page = i),
                  itemBuilder: (context, i) => _MonthGrid(
                    month: _monthAt(i),
                    start: widget.start,
                    end: widget.end,
                    firstDate: widget.firstDate,
                    lastDate: widget.lastDate,
                    today: widget.today,
                    onDayTap: widget.onDayTap,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Weekdays extends StatelessWidget {
  const _Weekdays();

  @override
  Widget build(BuildContext context) {
    final loc = MaterialLocalizations.of(context);
    final first = loc.firstDayOfWeekIndex;
    final t = SheetTone.of(context);
    return SizedBox(
      height: 28,
      child: Row(
        children: [
          for (var i = 0; i < 7; i++)
            Expanded(
              child: Center(
                child: ExcludeSemantics(
                  child: Text(
                    loc.narrowWeekdays[(first + i) % 7],
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: t.muted),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _MonthGrid extends StatelessWidget {
  const _MonthGrid({
    required this.month,
    required this.start,
    required this.end,
    required this.firstDate,
    required this.lastDate,
    required this.today,
    required this.onDayTap,
  });

  final DateTime month;
  final DateTime? start;
  final DateTime? end;
  final DateTime firstDate;
  final DateTime lastDate;
  final DateTime today;
  final ValueChanged<DateTime> onDayTap;

  @override
  Widget build(BuildContext context) {
    final firstDow = MaterialLocalizations.of(context).firstDayOfWeekIndex;
    final daysInMonth = DateTime(month.year, month.month + 1, 0).day;
    final lead = (DateTime(month.year, month.month, 1).weekday % 7 - firstDow + 7) % 7;
    return Column(
      children: [
        for (var r = 0; r < 6; r++)
          SizedBox(
            height: _cellHeight,
            child: Row(
              children: [
                for (var c = 0; c < 7; c++)
                  Expanded(
                    child: () {
                      final n = r * 7 + c - lead + 1;
                      if (n < 1 || n > daysInMonth) return const SizedBox.shrink();
                      final d = DateTime(month.year, month.month, n);
                      return _DayCell(
                        day: d,
                        start: start,
                        end: end,
                        enabled: !d.isBefore(_day(firstDate)) && !d.isAfter(_day(lastDate)),
                        isToday: _same(d, today),
                        roundLeft: c == 0 || n == 1,
                        roundRight: c == 6 || n == daysInMonth,
                        onTap: () => onDayTap(d),
                      );
                    }(),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

class _DayCell extends StatelessWidget {
  const _DayCell({
    required this.day,
    required this.start,
    required this.end,
    required this.enabled,
    required this.isToday,
    required this.roundLeft,
    required this.roundRight,
    required this.onTap,
  });

  final DateTime day;
  final DateTime? start;
  final DateTime? end;
  final bool enabled;
  final bool isToday;
  final bool roundLeft;
  final bool roundRight;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    final isStart = _same(day, start);
    final isEnd = _same(day, end);
    final ranged = start != null && end != null && !_same(start, end);
    final inside = ranged && day.isAfter(start!) && day.isBefore(end!);
    final leftBand = ranged && (inside || isEnd);
    final rightBand = ranged && (inside || isStart);
    final picked = isStart || isEnd;

    Widget band(bool on, {required bool left}) => Expanded(
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: on ? t.wash : Colors.transparent,
              borderRadius: BorderRadius.horizontal(
                left: Radius.circular(left && roundLeft ? _cellHeight / 2 : 0),
                right: Radius.circular(!left && roundRight ? _cellHeight / 2 : 0),
              ),
            ),
          ),
        );

    final dayLabel = '${day.day} ${monthLabels[day.month - 1]} ${day.year}';
    return Semantics(
      button: true,
      enabled: enabled,
      selected: picked,
      label: isToday ? '$dayLabel, today' : dayLabel,
      excludeSemantics: true,
      onTap: enabled ? onTap : null,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Positioned.fill(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(children: [band(leftBand, left: true), band(rightBand, left: false)]),
            ),
          ),
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: picked ? t.accent : Colors.transparent,
              shape: BoxShape.circle,
              border: isToday && !picked ? Border.all(color: t.accent, width: 1.5) : null,
            ),
          ),
          Positioned.fill(
            child: InkResponse(
              onTap: enabled ? onTap : null,
              radius: 22,
              highlightShape: BoxShape.circle,
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 2),
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      '${day.day}',
                      style: TextStyle(
                        fontSize: 14.5,
                        fontWeight: picked || isToday ? FontWeight.w700 : FontWeight.w500,
                        color: picked ? t.onAccent : (enabled ? t.ink : t.muted.withValues(alpha: 0.45)),
                      ),
                    ),
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

/// Inline "jump to" panel: a year stepper and the twelve months.
class _JumpPanel extends StatefulWidget {
  const _JumpPanel({required this.firstDate, required this.lastDate, required this.current, required this.onPick});

  final DateTime firstDate;
  final DateTime lastDate;
  final DateTime current;
  final ValueChanged<DateTime> onPick;

  @override
  State<_JumpPanel> createState() => _JumpPanelState();
}

class _JumpPanelState extends State<_JumpPanel> {
  late int _year = widget.current.year;

  bool _has(int year, int month) {
    final v = year * 12 + month;
    return v >= widget.firstDate.year * 12 + widget.firstDate.month && v <= widget.lastDate.year * 12 + widget.lastDate.month;
  }

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    final cols = gridColumns(context, normal: 4, minCellWidth: 76);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            IconButton(
              tooltip: 'Previous year',
              constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
              onPressed: _year > widget.firstDate.year ? () => setState(() => _year--) : null,
              icon: const Icon(Icons.remove_rounded),
            ),
            SizedBox(
              width: 88,
              child: Center(
                child: Text('$_year', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: t.ink)),
              ),
            ),
            IconButton(
              tooltip: 'Next year',
              constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
              onPressed: _year < widget.lastDate.year ? () => setState(() => _year++) : null,
              icon: const Icon(Icons.add_rounded),
            ),
          ],
        ),
        const SizedBox(height: 4),
        GridView.count(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisCount: cols,
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          childAspectRatio: cols >= 4 ? 2.3 : 2.9,
          children: [
            for (var m = 1; m <= 12; m++)
              MonthChip(
                label: monthLabels[m - 1].substring(0, 3),
                semanticLabel: '${monthLabels[m - 1]} $_year',
                selected: _year == widget.current.year && m == widget.current.month,
                enabled: _has(_year, m),
                onTap: () => widget.onPick(DateTime(_year, m)),
              ),
          ],
        ),
        const SizedBox(height: 6),
      ],
    );
  }
}

/// A rounded tappable chip in a month / year grid.
class MonthChip extends StatelessWidget {
  const MonthChip({super.key, required this.label, required this.selected, required this.enabled, required this.onTap, this.semanticLabel});

  final String label;
  final String? semanticLabel;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    final fg = selected ? t.onAccent : (enabled ? t.ink : t.muted.withValues(alpha: 0.5));
    return Semantics(
      button: true,
      enabled: enabled,
      selected: selected,
      label: semanticLabel ?? label,
      excludeSemantics: true,
      child: Material(
        color: selected ? t.accent : t.card,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: selected ? t.accent : t.border),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: enabled ? onTap : null,
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6),
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(label, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: fg)),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
