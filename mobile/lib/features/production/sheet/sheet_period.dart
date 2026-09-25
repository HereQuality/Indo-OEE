// The period helpers of client/src/utils/processDashboard.js that the Data
// Entry filters use (default range, quick ranges, month/year ranges and how a
// range reads). Dates are "YYYY-MM-DD" strings throughout — the form the API
// takes — built from LOCAL calendar parts, never from UTC, so a phone east or
// west of UTC never shifts the day.

const List<String> monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const List<String> monthAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const List<String> weekdayAbbr = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/// The API accepts at most this many days in one request (server MAX_RANGE_DAYS).
const int maxRangeDays = 366 * 5;

/// The sheet defaults to a rolling window ending today and going back a year.
const int entryRangeDays = 366;

String _pad(int v) => v.toString().padLeft(2, '0');

String isoDate(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${_pad(d.month)}-${_pad(d.day)}';

/// "YYYY-MM-DD" -> local midnight; null when it isn't a date.
DateTime? parseIsoDate(String? s) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(s ?? '');
  if (m == null) return null;
  final y = int.parse(m.group(1)!);
  final mo = int.parse(m.group(2)!);
  final d = int.parse(m.group(3)!);
  final out = DateTime(y, mo, d);
  return (out.year == y && out.month == mo && out.day == d) ? out : null;
}

DateTime _daysAgo(DateTime now, int days) => DateTime(now.year, now.month, now.day - days);

int _lastDayOfMonth(int y, int m) => DateTime(y, m + 1, 0).day;

/// "2026-09" -> ['2026-09-01', '2026-09-30'].
List<String> monthRange(String yyyymm) {
  final p = yyyymm.split('-');
  final y = int.parse(p[0]);
  final m = int.parse(p[1]);
  return ['$y-${_pad(m)}-01', '$y-${_pad(m)}-${_pad(_lastDayOfMonth(y, m))}'];
}

List<String> yearRange(int year) => ['$year-01-01', '$year-12-31'];

class QuickRange {
  const QuickRange(this.key, this.label, this.range);
  final String key;
  final String label;
  final List<String> Function(DateTime now) range;
}

/// Quick ranges offered in the Filters sheet.
final List<QuickRange> quickRanges = [
  QuickRange('today', 'Today', (n) => [isoDate(n), isoDate(n)]),
  QuickRange('last7', 'Last 7 days', (n) => [isoDate(_daysAgo(n, 6)), isoDate(n)]),
  QuickRange('last30', 'Last 30 days', (n) => [isoDate(_daysAgo(n, 29)), isoDate(n)]),
  QuickRange('last90', 'Last 90 days', (n) => [isoDate(_daysAgo(n, 89)), isoDate(n)]),
  QuickRange('thisMonth', 'This month', (n) => monthRange(isoDate(n).substring(0, 7))),
  QuickRange('lastMonth', 'Last month', (n) => monthRange(isoDate(DateTime(n.year, n.month - 1, 1)).substring(0, 7))),
  QuickRange('thisYear', 'This year', (n) => yearRange(n.year)),
  QuickRange('lastYear', 'Last year', (n) => yearRange(n.year - 1)),
];

/// The Data Entry sheet defaults to a rolling window ending today and going
/// back one year — wide enough that real data doesn't look like it vanished
/// across a month/year rollover.
List<String> defaultEntryRange([DateTime? now]) {
  final n = now ?? DateTime.now();
  return [isoDate(_daysAgo(n, entryRangeDays - 1)), isoDate(n)];
}

/// Days spanned by a range, both ends included.
int rangeDays(List<String> range) {
  final a = parseIsoDate(range[0]);
  final b = parseIsoDate(range[1]);
  if (a == null || b == null) return 0;
  // Compare as UTC so a daylight-saving change never makes a day 23/25 hours.
  final ua = DateTime.utc(a.year, a.month, a.day);
  final ub = DateTime.utc(b.year, b.month, b.day);
  return ub.difference(ua).inDays + 1;
}

/// "22/09/2026" for "2026-09-22".
String dmy(String iso) {
  final p = iso.split('-');
  return p.length == 3 ? '${p[2]}/${p[1]}/${p[0]}' : iso;
}

/// How a range reads on the filter button and chips: a whole year or month is
/// named as one ("2025", "September 2026"); a single day as itself; anything
/// else as its two dates.
String describeRange(List<String> range) {
  final from = range[0];
  final to = range[1];
  if (from.isEmpty || to.isEmpty) return '';
  final fp = from.split('-');
  if (fp.length != 3) return '$from to $to';
  final fy = fp[0];
  final fm = fp[1];
  if (from == '$fy-01-01' && to == '$fy-12-31') return fy;
  final mr = monthRange('$fy-$fm');
  if (from == mr[0] && to == mr[1]) return '${monthNames[int.parse(fm) - 1]} $fy';
  if (from == to) return dmy(from);
  return '${dmy(from)} to ${dmy(to)}';
}

int? _yearOf(Object? v) {
  final s = '${v ?? ''}';
  return s.length < 4 ? null : int.tryParse(s.substring(0, 4));
}

/// Years the data covers (newest first), from the API's `extent`; falls back
/// to the current year so the Year tab is never empty.
List<int> yearsOfExtent(Map<String, dynamic>? extent, [DateTime? now]) {
  final thisYear = (now ?? DateTime.now()).year;
  final first = _yearOf(extent?['from']) ?? thisYear;
  final to = _yearOf(extent?['to']);
  final last = to == null || to < thisYear ? thisYear : to;
  if (last < first) return [thisYear];
  return [for (var i = 0; i <= last - first; i++) last - i];
}

/// "Mon, 22 Sep 2026" for "2026-09-22".
String longDay(String iso) {
  final d = parseIsoDate(iso);
  if (d == null) return iso;
  return '${weekdayAbbr[d.weekday - 1]}, ${d.day} ${monthAbbr[d.month - 1]} ${d.year}';
}

/// "Sep 2026" for "2026-09-22".
String monthTitle(String iso) {
  final d = parseIsoDate(iso);
  if (d == null) return iso;
  return '${monthAbbr[d.month - 1]} ${d.year}';
}
