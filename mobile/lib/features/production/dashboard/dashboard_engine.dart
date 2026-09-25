// API SKELETON (step 1) - bodies marked UnimplementedError are being filled in
// by CALC-ENGINE right now. Signatures below are FINAL.
//
// 1:1 port of client/src/utils/processDashboard.js. Naming: SCREAMING_CASE ->
// lowerCamelCase (STAT_CATALOG -> statCatalog, MAX_RANGE_DAYS -> maxRangeDays).
//
// Conventions
//  * Data are Map<String, dynamic> with the exact JS keys; numbers inside them
//    are ALWAYS double (or null = JS null/undefined, double.nan = NaN) - so
//    `s['entries']` and `s['machineDays']` are doubles too.
//  * summarize() -> Map with the JS keys (totalQty, okQty, rejectedQty, idealQty,
//    shiftHours, effectiveHours, plannedShiftHours, downtimeMin, unreportedMin,
//    unutilizedDays, entries, okPct, rejectionPct, performance, setupEfficiency,
//    oeeLosses, oeeLunch, oeeLunchCot, machineDays,
//    downtimeByCause: Map<String,double>, rejectByReason: Map<String,double>).
//  * Measures (statMeasure/causeMeasure/reasonMeasure) are maps
//    {'key','label','format','get'} where 'get' is a MeasureGetter:
//    `double? Function(Map<String,dynamic> summary)`. Use measureValue().
//  * Functions with an optional JS argument take it as an optional POSITIONAL
//    argument, exactly like the JS call: applyFilters(rows, filters, dim),
//    compareMachines(ctx, keyOf).
//  * Dates are 'YYYY-MM-DD' strings built from LOCAL calendar parts.
//  * Tests can pin "today" by assigning [engineClock].
import 'charts/chart_props.dart' show DashboardCtx;

// ── Clock (tests only) ──────────────────────────────────────────────────────
/// "Now" for every period helper. Only tests should reassign it.
DateTime Function() engineClock = DateTime.now;

// ── Formats ────────────────────────────────────────────────────────────────
/// FORMATS: 'qty' | 'pct' | 'hours' | 'minutes' | 'days' -> formatter.
final Map<String, String Function(num? v)> formats = {
  'qty': _fmtQty,
  'pct': (v) => throw UnimplementedError(),
  'hours': (v) => throw UnimplementedError(),
  'minutes': (v) => throw UnimplementedError(),
  'days': (v) => throw UnimplementedError(),
};
String _fmtQty(num? v) => throw UnimplementedError();

/// Full-precision twin of [formats], for tooltips and tables.
String formatExact(String format, num? v) => throw UnimplementedError();

// ── Catalog: KPI tiles ─────────────────────────────────────────────────────
/// Each: {'key','label','hint','format', 'tone'? ('ok'|'reject'|'downtime'), 'example'}.
const List<Map<String, dynamic>> statCatalog = [
  {'key': 'totalQty', 'label': 'Total QTY', 'hint': 'Actual quantity produced', 'format': 'qty', 'example': '1.43M'},
  {'key': 'okQty', 'label': 'OK QTY', 'hint': 'Pieces that passed', 'format': 'qty', 'tone': 'ok', 'example': '269K'},
  {'key': 'rejectedQty', 'label': 'Rejected QTY', 'hint': 'Actual − OK', 'format': 'qty', 'tone': 'reject', 'example': '9,453'},
  {'key': 'okPct', 'label': '% OK Quantity', 'hint': 'OK ÷ (OK + Rejected)', 'format': 'pct', 'tone': 'ok', 'example': '99.97%'},
  {'key': 'rejectionPct', 'label': 'Rejection %', 'hint': 'Rejected ÷ Actual', 'format': 'pct', 'tone': 'reject', 'example': '0.66%'},
  {'key': 'idealQty', 'label': 'Ideal QTY', 'hint': 'Shift time ÷ cycle time', 'format': 'qty', 'example': '1.51M'},
  {'key': 'performance', 'label': 'Actual vs Ideal', 'hint': 'Actual ÷ Ideal quantity', 'format': 'pct', 'example': '94.70%'},
  {'key': 'oeeLosses', 'label': 'OEE Considering Losses', 'hint': 'Averaged per machine-day', 'format': 'pct', 'example': '96.42%'},
  {'key': 'oeeLunch', 'label': 'OEE NOT Considering Losses, But Lunch', 'hint': 'Averaged per machine-day', 'format': 'pct', 'example': '91.10%'},
  // Key kept as oeeLunchCot: it is what a process's saved dashboard stores, so renaming it would drop the tile.
  {'key': 'oeeLunchCot', 'label': 'OEE NOT Considering Losses, But Lunch & Setup Time', 'hint': 'Averaged per machine-day', 'format': 'pct', 'example': '93.85%'},
  {'key': 'effectiveHours', 'label': 'Effective Machine Run Time', 'hint': 'OK × cycle time', 'format': 'hours', 'example': '7,281 hr'},
  {'key': 'shiftHours', 'label': 'Machine Shift Time', 'hint': 'Machine OFF − ON', 'format': 'hours', 'example': '8,120 hr'},
  {'key': 'downtimeMin', 'label': 'Total Downtime', 'hint': 'All stoppage causes', 'format': 'minutes', 'tone': 'downtime', 'example': '5,160 min'},
];

// ── Catalog: graphs ────────────────────────────────────────────────────────
/// Each: {'key','measure'? (a stat key, or 'unreportedMin'), 'label','hint',
/// 'size' ('sm'|'md'|'lg'|'full' = 4/6/8/12 of 12 columns), 'preview', 'tone'?}.
const List<Map<String, dynamic>> chartCatalog = [
  {'key': 'oeeTrend', 'measure': 'oeeLosses', 'label': 'OEE (over time)', 'hint': 'The three OEE figures by date — by month on long ranges.', 'size': 'lg', 'preview': 'lines'},
  {'key': 'runTimeByOperator', 'measure': 'effectiveHours', 'label': 'Effective Machine Run Time (Hour) by Operator', 'hint': 'Hours of effective run time each operator produced.', 'size': 'sm', 'preview': 'hbars', 'tone': 'ok'},
  {'key': 'downtimeByMachine', 'measure': 'downtimeMin', 'label': 'B.D. Backup — Stoppage by MC No.', 'hint': 'Minutes lost per machine: breakdown, setup, lunch/tea, other.', 'size': 'md', 'preview': 'stacked'},
  {'key': 'runTimeByMachine', 'measure': 'effectiveHours', 'label': 'Effective Machine Run Time (Hour) by MC No.', 'hint': "Each machine's share of effective run time.", 'size': 'md', 'preview': 'treemap'},
  {'key': 'unreportedByMachine', 'measure': 'unreportedMin', 'label': 'Unreported Time (Min) by MC No.', 'hint': 'Minutes not accounted for — one small chart per machine.', 'size': 'md', 'preview': 'multiples'},
  {'key': 'okRejectedTrend', 'measure': 'okQty', 'label': 'OK vs Rejected QTY (over time)', 'hint': 'Stacked — the full bar is the actual quantity.', 'size': 'md', 'preview': 'stackedTime'},
  {'key': 'oeeByMachine', 'measure': 'oeeLosses', 'label': 'OEE by MC No.', 'hint': "Considering losses — average of that machine's days.", 'size': 'md', 'preview': 'vbars', 'tone': 'ok'},
  {'key': 'rejectByReason', 'measure': 'rejectedQty', 'label': 'Rejected QTY by Reason', 'hint': 'Rejected quantity grouped by reject reason.', 'size': 'md', 'preview': 'hbars', 'tone': 'reject'},
  {'key': 'okPctByOperator', 'measure': 'okPct', 'label': 'Operator v/s OK QTY %', 'hint': 'OK ÷ Actual for each operator.', 'size': 'md', 'preview': 'hbars', 'tone': 'ok'},
  {'key': 'outputByItem', 'measure': 'okQty', 'label': 'OK QTY by Part', 'hint': 'Parts ranked by OK quantity.', 'size': 'md', 'preview': 'hbars', 'tone': 'ok'},
  {'key': 'machineSummary', 'label': 'MC No. Summary (table)', 'hint': 'One row per machine — quantities, run time, downtime and OEE.', 'size': 'full', 'preview': 'table'},
];

const List<String> defaultStats = ['totalQty', 'okQty', 'rejectedQty', 'okPct', 'oeeLosses', 'oeeLunch', 'effectiveHours', 'downtimeMin'];
const List<String> defaultCharts = ['runTimeByOperator', 'oeeTrend', 'downtimeByMachine', 'runTimeByMachine', 'unreportedByMachine', 'okRejectedTrend', 'rejectByReason', 'machineSummary'];

/// STATS_BY_KEY / CHARTS_BY_KEY.
final Map<String, Map<String, dynamic>> statsByKey = {for (final w in statCatalog) w['key'] as String: w};
final Map<String, Map<String, dynamic>> chartsByKey = {for (final w in chartCatalog) w['key'] as String: w};

/// A process's saved keys -> catalog entries, dropping unknown keys. [saved]
/// that is not a List (never configured) falls back to [defaults]; an empty
/// list is respected as "show none".
List<Map<String, dynamic>> resolveWidgets(Object? saved, Map<String, Map<String, dynamic>> lookup, List<String> defaults) =>
    throw UnimplementedError();

// ── Stoppage groups ────────────────────────────────────────────────────────
/// Each: {'key','label','fields': List<String>}.
const List<Map<String, dynamic>> stoppageGroups = [
  {'key': 'breakdown', 'label': 'Breakdown (Mech + Ele)', 'fields': ['bdMechMin', 'bdEleMin']},
  {'key': 'setup', 'label': 'Setup', 'fields': ['setupMin']},
  {'key': 'lunch', 'label': 'Lunch / Tea', 'fields': ['lunchMin']},
  {
    'key': 'other',
    'label': 'Other stoppages',
    'fields': ['plannedDownMin', 'noManPowerMin', 'materialShiftingMin', 'noMaterialMin', 'noPowerMin', 'otherMin'],
  },
];

/// Label of a stoppage cause without its " (min)" suffix; the key itself if unknown.
String causeLabel(String key) => throw UnimplementedError();

// ── Dimensions ─────────────────────────────────────────────────────────────
/// "Jan 2026" for "2026-01".
String monthLabel(String yyyymm) => throw UnimplementedError();

/// One thing a row can be sliced / cross-filtered by.
class DashboardDimension {
  const DashboardDimension(this.key, this.label, this._value, this._text);

  /// 'machine' | 'operator' | 'item' | 'month' | 'date'
  final String key;

  /// "Machine" / "Operator" / "Part" / "Month" / "Date"
  final String label;
  final String Function(Map<String, dynamic> row) _value;
  final String Function(String value, DashboardCtx? ctx) _text;

  /// The row's bucket for this dimension ('' = no operator / no part).
  String value(Map<String, dynamic> row) => _value(row);

  /// Human text for a bucket value; [ctx] is only needed for 'machine'.
  String text(String value, [DashboardCtx? ctx]) => _text(value, ctx);
}

/// DIMENSIONS, in the JS key order (machine, operator, item, month, date).
final Map<String, DashboardDimension> dimensions = {};

/// EMPTY_FILTERS (unmodifiable). Use [newEmptyFilters] for a mutable copy.
const Map<String, List<String>> emptyFilters = {'machine': [], 'operator': [], 'item': [], 'month': [], 'date': []};
Map<String, List<String>> newEmptyFilters() => {'machine': [], 'operator': [], 'item': [], 'month': [], 'date': []};

/// Sheet order for machines: ctx.machineOrder is {machineId: position}. A
/// machine not in it ranks after every listed one, then by name (natural
/// order). [keyOf] reads the machine id off the sorted item (default
/// item['key']; filter options carry it as 'value').
int Function(Map<String, dynamic> a, Map<String, dynamic> b) compareMachines(DashboardCtx? ctx, [String? Function(Map<String, dynamic> item)? keyOf]) =>
    throw UnimplementedError();

/// JS `a.localeCompare(b, undefined, {numeric: true})` (natural, case-insensitive
/// first, lower before upper). Returns -1 / 0 / 1.
int naturalCompare(String a, String b) => throw UnimplementedError();

bool hasFilters(Map<String, List<String>> filters) => throw UnimplementedError();

/// New filters map with [value] toggled in [dim].
Map<String, List<String>> toggleFilter(Map<String, List<String>> filters, String dim, String value) => throw UnimplementedError();

/// Rows passing every active filter; [except] leaves one dimension unfiltered
/// (the chart that owns it keeps all its marks). Returns [rows] itself when no
/// filter is active.
List<Map<String, dynamic>> applyFilters(List<Map<String, dynamic>> rows, Map<String, List<String>> filters, [String? except]) =>
    throw UnimplementedError();

/// Rows by dimension value, in first-seen order.
Map<String, List<Map<String, dynamic>>> groupRows(List<Map<String, dynamic>> rows, String dim) => throw UnimplementedError();

/// 'month' when the rows span more than 62 distinct dates, else 'date'.
String timeBucket(List<Map<String, dynamic>> rows) => throw UnimplementedError();

// ── Aggregation ────────────────────────────────────────────────────────────
/// rowCalc(row), cached per row map identity.
Map<String, dynamic> calcOf(Map<String, dynamic> row) => throw UnimplementedError();

Map<String, dynamic> summarize(List<Map<String, dynamic>> rows) => throw UnimplementedError();

/// One summary per value of [dim]: [{'key': String, 'label': String, 'summary': Map}].
List<Map<String, dynamic>> summarizeBy(List<Map<String, dynamic>> rows, String dim, DashboardCtx ctx) => throw UnimplementedError();

// ── Measures ───────────────────────────────────────────────────────────────
typedef MeasureGetter = double? Function(Map<String, dynamic> summary);

/// {'key','label','format','get'} for a KPI tile (an entry of [statCatalog]).
Map<String, dynamic> statMeasure(Map<String, dynamic> stat) => throw UnimplementedError();

/// A stoppage cause ('bdMechMin', ...) as a measure (minutes).
Map<String, dynamic> causeMeasure(String causeKey) => throw UnimplementedError();

/// A reject reason as a measure (qty).
Map<String, dynamic> reasonMeasure(String reason) => throw UnimplementedError();

/// measure['get'](summary) without casting the closure yourself.
double? measureValue(Map<String, dynamic> measure, Map<String, dynamic> summary) => throw UnimplementedError();

// ── Period ─────────────────────────────────────────────────────────────────
/// 'YYYY-MM-DD' from LOCAL calendar parts.
String isoDate(DateTime d) => throw UnimplementedError();

/// Local-midnight DateTime of a 'YYYY-MM-DD' string (FormatException if unparsable).
DateTime parseIsoDate(String s) => throw UnimplementedError();

/// ['2026-09-01','2026-09-30'] for '2026-09'.
List<String> monthRange(String yyyymm) => throw UnimplementedError();
List<String> yearRange(int year) => throw UnimplementedError();

/// One of the quick ranges offered under the calendar; [range] is computed from
/// [engineClock] each call.
class QuickRange {
  const QuickRange(this.key, this.label, this.range);
  final String key;
  final String label;
  final List<String> Function() range;
}

/// QUICK_RANGES: today, last7, last30, last90, thisMonth, lastMonth, thisYear, lastYear.
final List<QuickRange> quickRanges = [];

const String defaultRangeKey = 'thisMonth';
List<String> defaultRange() => throw UnimplementedError();

/// Rolling window ending today going back one year (data-entry sheet default).
List<String> defaultEntryRange() => throw UnimplementedError();

/// The API accepts at most this many days in one request.
const int maxRangeDays = 366 * 5;

/// Inclusive number of days in [from, to].
int rangeDays(List<String> range) => throw UnimplementedError();

/// "2025", "September 2026", a single day, or "dd/mm/yyyy to dd/mm/yyyy".
String describeRange(List<String> range) => throw UnimplementedError();

/// Key of the quick range equal to [range], or null.
String? quickRangeKey(List<String> range) => throw UnimplementedError();

/// Years the process has data for (newest first), from the API's `extent`
/// ({'from','to'} or null); always includes the current year.
List<int> yearsOfExtent(Map<String, dynamic>? extent) => throw UnimplementedError();

/// MONTH_LABELS: January ... December.
const List<String> monthLabels = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
];
