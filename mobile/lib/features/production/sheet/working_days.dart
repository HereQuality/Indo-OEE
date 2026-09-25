// Port of client/src/utils/workingDays.js (itself a copy of
// server/utils/workingDays.js) — "working day" math behind the entry lock.
//
// Used only to PREVIEW an entry's lock state (lock icon, hidden Edit/Delete,
// SuperAdmin Unlock). The server runs the same math again on every
// Save/Delete/Unlock, so a stale calendar here can only show the wrong hint
// until the request comes back — it can never let a locked entry be changed.

/// An entry can be edited / deleted until this many working days after its date.
const int lockWorkingDays = 2;

String _pad(int n) => n.toString().padLeft(2, '0');

String _toIso(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${_pad(d.month)}-${_pad(d.day)}';

String _toMonthDay(DateTime d) => '${_pad(d.month)}-${_pad(d.day)}';

/// "YYYY-MM-DD" -> UTC midnight (JS `new Date("YYYY-MM-DDT00:00:00.000Z")`).
DateTime? _parseIsoDay(String s) => DateTime.tryParse('${s}T00:00:00.000Z');

/// JS `new Date(x)` for what the API sends: an ISO string (date-only strings
/// are UTC, like JS). Null when it is not a date.
DateTime? _parseJsDate(Object? v) {
  if (v == null) return null;
  var s = v.toString().trim();
  if (s.isEmpty) return null;
  if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(s)) s = '${s}T00:00:00.000Z';
  return DateTime.tryParse(s)?.toUtc();
}

/// Active holidays split into one-off dates ("YYYY-MM-DD") and yearly ones
/// ("MM-DD"). A holiday counts only when `isActive` is truthy, like the web.
class HolidaySets {
  const HolidaySets(this.exact, this.recurring);
  final Set<String> exact;
  final Set<String> recurring;
}

HolidaySets buildHolidaySets(Iterable<Map<String, dynamic>>? holidays) {
  final exact = <String>{};
  final recurring = <String>{};
  for (final h in holidays ?? const <Map<String, dynamic>>[]) {
    if (h['isActive'] != true) continue;
    final d = _parseJsDate(h['date']);
    if (d == null) continue;
    if (h['isRecurringYearly'] == true) {
      recurring.add(_toMonthDay(d));
    } else {
      exact.add(_toIso(d));
    }
  }
  return HolidaySets(exact, recurring);
}

/// 0 = Sunday … 6 = Saturday (JS `getUTCDay`).
int _jsWeekday(DateTime d) => d.weekday % 7;

bool isNonWorkingDay(DateTime date, List<int> weeklyOffDays, HolidaySets sets) =>
    weeklyOffDays.contains(_jsWeekday(date)) || sets.exact.contains(_toIso(date)) || sets.recurring.contains(_toMonthDay(date));

/// The last "YYYY-MM-DD" an entry dated [entryDateIso] can still be edited or
/// deleted — exactly [workingDaysAhead] working days after its own date.
///
/// Safety net the web copy lacks: with every weekday marked off the loop could
/// never finish, so it gives up after ten years.
String getLockDeadline(
  String entryDateIso,
  List<int> weeklyOffDays,
  HolidaySets holidays, [
  int workingDaysAhead = lockWorkingDays,
]) {
  var d = _parseIsoDay(entryDateIso);
  if (d == null) return entryDateIso;
  var counted = 0;
  var guard = 0;
  while (counted < workingDaysAhead && guard < 3660) {
    d = d!.add(const Duration(days: 1));
    guard++;
    if (!isNonWorkingDay(d, weeklyOffDays, holidays)) counted++;
  }
  return _toIso(d!);
}

bool isEntryLocked(
  String entryDateIso,
  List<int> weeklyOffDays,
  HolidaySets holidays,
  String asOfIso, [
  int workingDaysAhead = lockWorkingDays,
]) =>
    asOfIso.compareTo(getLockDeadline(entryDateIso, weeklyOffDays, holidays, workingDaysAhead)) > 0;

/// What [SheetController] asks about an entry: the company calendar (weekly-off
/// weekdays + holidays) with the lock deadline per date memoised, since a long
/// list asks the same dates over and over.
class WorkingCalendar {
  WorkingCalendar({List<int>? weeklyOffDays, Iterable<Map<String, dynamic>>? holidays})
      : weeklyOffDays = weeklyOffDays ?? const [0],
        _holidays = [for (final h in holidays ?? const <Map<String, dynamic>>[]) if (h['isActive'] == true) h],
        _sets = buildHolidaySets(holidays);

  /// The web's defaults until the calendar arrives: Sunday off, no holidays.
  factory WorkingCalendar.fallback() => WorkingCalendar();

  final List<int> weeklyOffDays;
  final List<Map<String, dynamic>> _holidays;
  final HolidaySets _sets;
  final Map<String, String> _deadlines = {};

  String lockDeadline(String dateIso) =>
      _deadlines.putIfAbsent(dateIso, () => getLockDeadline(dateIso, weeklyOffDays, _sets, lockWorkingDays));

  /// True when [dateIso] is a weekly-off weekday or a holiday.
  bool isNonWorking(String dateIso) {
    final d = _parseIsoDay(dateIso);
    return d != null && isNonWorkingDay(d, weeklyOffDays, _sets);
  }

  bool isWeeklyOff(String dateIso) {
    final d = _parseIsoDay(dateIso);
    return d != null && weeklyOffDays.contains(_jsWeekday(d));
  }

  /// The name of the company holiday on [dateIso], or null when it is not one.
  String? holidayName(String dateIso) {
    final d = _parseIsoDay(dateIso);
    if (d == null) return null;
    for (final h in _holidays) {
      final hd = _parseJsDate(h['date']);
      if (hd == null) continue;
      final hit = h['isRecurringYearly'] == true ? _toMonthDay(hd) == _toMonthDay(d) : _toIso(hd) == _toIso(d);
      if (hit) {
        final name = '${h['name'] ?? ''}'.trim();
        return name.isEmpty ? 'Holiday' : name;
      }
    }
    return null;
  }
}
