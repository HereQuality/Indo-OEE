import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../sheet_model.dart';
import '../sheet_period.dart';
import '../working_days.dart';
import 'sheet_style.dart';

/// The bar above the list that always shows which date is at the top and steps
/// between dates that have entries: the arrows, or a horizontal swipe on the
/// bar itself (swipe right = newer date, swipe left = older). Tapping the date
/// opens the jump panel with month and machine chips.
class SheetDateStrip extends StatelessWidget {
  const SheetDateStrip({
    super.key,
    required this.date,
    required this.position,
    required this.loadedDays,
    required this.totalDays,
    required this.canNewer,
    required this.canOlder,
    required this.onNewer,
    required this.onOlder,
    required this.onToggleJump,
    required this.jumpOpen,
  });

  /// "YYYY-MM-DD" of the date at the top of the list.
  final String date;

  /// 1-based place of [date] among the loaded dates.
  final int position;
  final int loadedDays;

  /// Dates the whole selection has on the server.
  final int totalDays;
  final bool canNewer;
  final bool canOlder;
  final VoidCallback onNewer;
  final VoidCallback onOlder;
  final VoidCallback onToggleJump;
  final bool jumpOpen;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final total = totalDays > loadedDays ? totalDays : loadedDays;
    return Material(
      color: s.surfaceContainerLow,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onHorizontalDragEnd: (d) {
          final v = d.primaryVelocity ?? 0;
          if (v > 250 && canNewer) {
            HapticFeedback.selectionClick();
            onNewer();
          } else if (v < -250 && canOlder) {
            HapticFeedback.selectionClick();
            onOlder();
          }
        },
        child: Row(
          children: [
            IconButton(
              key: const ValueKey('strip-newer'),
              tooltip: 'Newer date',
              onPressed: canNewer
                  ? () {
                      HapticFeedback.selectionClick();
                      onNewer();
                    }
                  : null,
              icon: const Icon(Icons.chevron_left_rounded),
            ),
            Expanded(
              child: InkWell(
                key: const ValueKey('strip-label'),
                borderRadius: BorderRadius.circular(10),
                onTap: onToggleJump,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: 48),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Flexible(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              AnimatedSwitcher(
                                duration: const Duration(milliseconds: 160),
                                child: Text(
                                  longDay(date),
                                  key: ValueKey(date),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
                                ),
                              ),
                              Text(
                                'Day $position of $total${totalDays > loadedDays ? ' · $loadedDays loaded' : ''}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(fontSize: 11.5, color: s.onSurfaceVariant),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 4),
                        AnimatedRotation(
                          turns: jumpOpen ? 0.5 : 0,
                          duration: const Duration(milliseconds: 180),
                          child: Icon(Icons.keyboard_arrow_down_rounded, color: s.onSurfaceVariant),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            IconButton(
              key: const ValueKey('strip-older'),
              tooltip: 'Older date',
              onPressed: canOlder
                  ? () {
                      HapticFeedback.selectionClick();
                      onOlder();
                    }
                  : null,
              icon: const Icon(Icons.chevron_right_rounded),
            ),
          ],
        ),
      ),
    );
  }
}

/// A month or machine the jump panel offers.
class JumpChip {
  const JumpChip({required this.id, required this.label, this.tone, this.count});
  final String id;
  final String label;
  final Color? tone;
  final int? count;
}

/// Month and machine quick-jump chips: a month scrolls to its newest loaded
/// date, a machine to its next card down the list.
class SheetJumpPanel extends StatelessWidget {
  const SheetJumpPanel({
    super.key,
    required this.months,
    required this.machines,
    required this.currentMonth,
    required this.onMonth,
    required this.onMachine,
  });

  final List<JumpChip> months;
  final List<JumpChip> machines;
  final String? currentMonth;
  final ValueChanged<String> onMonth;
  final ValueChanged<String> onMachine;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final maxH = MediaQuery.sizeOf(context).height * 0.4;
    Widget label(String text) => Padding(
          padding: const EdgeInsets.only(bottom: 4, top: 2),
          child: Text(
            text.toUpperCase(),
            style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, letterSpacing: 0.7, color: s.onSurfaceVariant),
          ),
        );
    return Material(
      color: s.surfaceContainerLow,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: maxH),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (months.isNotEmpty) ...[
                label('Jump to month'),
                Wrap(
                  spacing: 8,
                  runSpacing: 0,
                  children: [
                    for (final m in months)
                      ChoiceChip(
                        key: ValueKey('jump-month-${m.id}'),
                        label: Text(m.count == null ? m.label : '${m.label} · ${m.count}'),
                        selected: m.id == currentMonth,
                        onSelected: (_) => onMonth(m.id),
                      ),
                  ],
                ),
                const SizedBox(height: 8),
              ],
              if (machines.isNotEmpty) ...[
                label('Jump to machine'),
                Wrap(
                  spacing: 8,
                  runSpacing: 0,
                  children: [
                    for (final m in machines)
                      ActionChip(
                        key: ValueKey('jump-machine-${m.id}'),
                        avatar: Container(width: 10, height: 10, decoration: BoxDecoration(color: m.tone, shape: BoxShape.circle)),
                        label: Text(m.label),
                        onPressed: () => onMachine(m.id),
                      ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// "Today" / "Yesterday" (else '') for a "YYYY-MM-DD" date.
String relativeDay(String iso, DateTime now) {
  String pad(int n) => n.toString().padLeft(2, '0');
  String of(DateTime d) => '${d.year}-${pad(d.month)}-${pad(d.day)}';
  if (iso == of(now)) return 'Today';
  if (iso == of(DateTime(now.year, now.month, now.day - 1))) return 'Yesterday';
  return '';
}

/// The pinned header of one date's section: the date, a Today / Yesterday /
/// Weekly off / holiday tag, and how many machines and entries it holds.
class SheetDayHeader extends StatelessWidget {
  const SheetDayHeader({super.key, required this.day, required this.calendar, required this.elevated, required this.now});
  final SheetDay day;
  final WorkingCalendar calendar;
  final bool elevated;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final rel = relativeDay(day.date, now);
    final holiday = calendar.holidayName(day.date);
    final tag = holiday ?? (calendar.isWeeklyOff(day.date) ? 'Weekly off' : '');
    final machines = day.machines.length;
    final entries = day.entryCount;
    final meta = '$machines ${machines == 1 ? 'machine' : 'machines'} · $entries ${entries == 1 ? 'entry' : 'entries'}';
    // A pinned header has a fixed height, so it stops growing past 1.3x text.
    final scale = MediaQuery.textScalerOf(context);
    return MediaQuery(
      data: MediaQuery.of(context).copyWith(textScaler: scale.scale(1) > 1.3 ? const TextScaler.linear(1.3) : scale),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Theme.of(context).scaffoldBackgroundColor,
          border: Border(bottom: BorderSide(color: elevated ? s.outlineVariant : Colors.transparent)),
          boxShadow: elevated
              ? [BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 6, offset: const Offset(0, 2))]
              : null,
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            children: [
              Flexible(
                child: Text(
                  longDay(day.date),
                  key: ValueKey('date-${day.date}'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
                ),
              ),
              if (rel.isNotEmpty) ...[const SizedBox(width: 8), _Tag(rel, s.primary)],
              if (tag.isNotEmpty) ...[const SizedBox(width: 6), Flexible(child: _Tag(tag, SheetTones.lock))],
              const Spacer(),
              Flexible(
                flex: 2,
                child: Text(
                  meta,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.end,
                  style: TextStyle(fontSize: 12, color: s.onSurfaceVariant),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag(this.text, this.tone);
  final String text;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: SheetTones.wash(context, tone), borderRadius: BorderRadius.circular(999)),
      child: Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: SheetTones.text(context, tone)),
      ),
    );
  }
}

/// Fixed-extent delegate for the pinned day header.
class SheetDayHeaderDelegate extends SliverPersistentHeaderDelegate {
  SheetDayHeaderDelegate({required this.day, required this.calendar, required this.extent, required this.now, required this.headerKey});

  final SheetDay day;
  final WorkingCalendar calendar;
  final double extent;
  final DateTime now;
  final GlobalKey headerKey;

  @override
  double get minExtent => extent;

  @override
  double get maxExtent => extent;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) =>
      SheetDayHeader(key: headerKey, day: day, calendar: calendar, elevated: overlapsContent, now: now);

  @override
  bool shouldRebuild(covariant SheetDayHeaderDelegate old) =>
      old.extent != extent ||
      old.day.date != day.date ||
      old.day.machines.length != day.machines.length ||
      old.day.entryCount != day.entryCount ||
      old.calendar != calendar ||
      old.now.day != now.day;
}
