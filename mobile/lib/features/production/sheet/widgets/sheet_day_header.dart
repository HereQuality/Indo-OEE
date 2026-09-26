import 'package:flutter/material.dart';

import '../sheet_model.dart';
import '../sheet_period.dart';
import '../working_days.dart';
import 'sheet_style.dart';

/// "Today" / "Yesterday" (else '') for a "YYYY-MM-DD" date.
String relativeDay(String iso, DateTime now) {
  String pad(int n) => n.toString().padLeft(2, '0');
  String of(DateTime d) => '${d.year}-${pad(d.month)}-${pad(d.day)}';
  if (iso == of(now)) return 'Today';
  if (iso == of(DateTime(now.year, now.month, now.day - 1))) return 'Yesterday';
  return '';
}

/// The header line of one date's section in the Cards view: the date, a
/// Today / Yesterday / Weekly off / holiday tag, and how many machines and
/// entries it holds. (The Table view shows the date in its own column.)
class SheetDayHeader extends StatelessWidget {
  const SheetDayHeader({super.key, required this.day, required this.calendar, required this.now});
  final SheetDay day;
  final WorkingCalendar calendar;
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
    // The header has a fixed height, so it stops growing past 1.3x text.
    final scale = MediaQuery.textScalerOf(context);
    return MediaQuery(
      data: MediaQuery.of(context).copyWith(textScaler: scale.scale(1) > 1.3 ? const TextScaler.linear(1.3) : scale),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14),
        child: Row(
          children: [
            // The date and its tag get the larger share; the counts take the rest
            // (a plain Spacer would split the row three ways and clip the date).
            Expanded(
              flex: 3,
              child: Row(
                children: [
                  Flexible(
                    child: Text(
                      longDay(day.date),
                      key: ValueKey('date-${day.date}'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
                    ),
                  ),
                  if (rel.isNotEmpty) ...[const SizedBox(width: 8), _Tag(rel, s.primary)],
                  if (tag.isNotEmpty) ...[const SizedBox(width: 6), Flexible(child: _Tag(tag, SheetTones.lock))],
                ],
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
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
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1.5),
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
