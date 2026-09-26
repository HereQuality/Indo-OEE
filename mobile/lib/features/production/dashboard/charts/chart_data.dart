import '../dashboard_engine.dart' as eng;
import 'chart_props.dart';
import 'hbars.dart' show BarDatum;

/// The data behind each visual: rows -> plain, ready-to-draw values. Kept free
/// of widgets so it is cheap to memoize and easy to test. Everything follows
/// the derivations at the top of client/src/Components/ProcessDashboard/charts.jsx.

typedef Rows = List<Map<String, dynamic>>;

/// JS `Array.prototype.sort` is stable, Dart's `List.sort` is not: tie-break
/// on the original position so equal values keep their first-seen order.
List<T> sortedStable<T>(Iterable<T> items, int Function(T a, T b) compare) {
  final indexed = [for (var i = 0; i < items.length; i++) (i, items.elementAt(i))];
  indexed.sort((a, b) {
    final c = compare(a.$2, b.$2);
    return c != 0 ? c : a.$1.compareTo(b.$1);
  });
  return [for (final e in indexed) e.$2];
}

double? _num(Object? v) => v is num && v.isFinite ? v.toDouble() : null;

/// `pct100`: a 0-1 ratio as 0-100, null when it is not a finite number.
double? pct100(Object? v) {
  final d = _num(v);
  return d == null ? null : d * 100;
}

/// Reads a finite number off a summary map (null when missing / NaN / null).
double? pick(Map<String, dynamic> summary, String key) => _num(summary[key]);

/// `useDimBars`: one bar per value of [dim] for one measure of the summary.
/// [sort]: 'value' (largest first), 'machine' (sheet order) or 'label'.
List<BarDatum> dimBars(
  Rows rows,
  String dim,
  DashboardCtx ctx,
  double? Function(Map<String, dynamic> summary) measure, {
  String sort = 'value',
  bool positiveOnly = true,
}) {
  final items = <Map<String, dynamic>>[];
  for (final g in eng.summarizeBy(rows, dim, ctx)) {
    final v = measure(g['summary'] as Map<String, dynamic>);
    if (v == null || !v.isFinite) continue;
    if (positiveOnly && !(v > 0)) continue;
    items.add({'key': g['key'], 'label': g['label'], 'value': v});
  }
  final List<Map<String, dynamic>> ordered;
  if (sort == 'machine') {
    ordered = sortedStable(items, eng.compareMachines(ctx));
  } else if (sort == 'label') {
    ordered = sortedStable(items, (a, b) => eng.naturalCompare('${a['label']}', '${b['label']}'));
  } else {
    ordered = sortedStable(items, (a, b) => (b['value'] as double).compareTo(a['value'] as double));
  }
  return [for (final m in ordered) BarDatum('${m['key']}', '${m['label']}', m['value'] as double)];
}

/// RejectByReason: rejected pieces by reason, largest first (all rows).
List<BarDatum> rejectReasons(Rows rows) {
  final by = eng.summarize(rows)['rejectByReason'];
  if (by is! Map) return const [];
  final items = [
    for (final e in by.entries)
      if (_num(e.value) != null) BarDatum('${e.key}', '${e.key}', _num(e.value)!),
  ];
  return sortedStable(items, (a, b) => b.value.compareTo(a.value));
}

// ── OEE over time ──────────────────────────────────────────────────────────

class OeeSeries {
  const OeeSeries(this.key, this.label, this.shortLabel);
  final String key;
  final String label;

  /// Compact wording for the phone legend (the full one is in tooltips + table).
  final String shortLabel;
}

const List<OeeSeries> oeeSeries = [
  OeeSeries('oeeLosses', 'Considering losses', 'Considering losses'),
  OeeSeries('oeeLunch', 'Not considering losses, but lunch', 'Lunch only'),
  OeeSeries('oeeLunchCot', 'Not considering losses, but lunch & setup time', 'Lunch + setup time'),
];

/// One x position of a time chart: the bucket key ('2026-09-05' / '2026-09').
class TimePoint {
  const TimePoint(this.key, this.label, this.values);
  final String key;
  final String label;

  /// One entry per series (null = no figure for that bucket).
  final List<double?> values;
}

List<TimePoint> oeeTrend(Rows rows, String dim, DashboardCtx ctx) {
  final out = <TimePoint>[];
  for (final g in eng.summarizeBy(rows, dim, ctx)) {
    final s = g['summary'] as Map<String, dynamic>;
    final values = [for (final ser in oeeSeries) pct100(s[ser.key])];
    if (values.every((v) => v == null)) continue;
    out.add(TimePoint('${g['key']}', '${g['label']}', values));
  }
  return sortedStable(out, (a, b) => a.key.compareTo(b.key));
}

/// OkRejectedTrend: [ok, rejected] per bucket, empty buckets dropped.
List<TimePoint> okRejectedTrend(Rows rows, String dim, DashboardCtx ctx) {
  final out = <TimePoint>[];
  for (final g in eng.summarizeBy(rows, dim, ctx)) {
    final s = g['summary'] as Map<String, dynamic>;
    final ok = _num(s['okQty']);
    final rej = _num(s['rejectedQty']);
    if (!((ok ?? 0) > 0 || (rej ?? 0) > 0)) continue;
    out.add(TimePoint('${g['key']}', '${g['label']}', [ok ?? 0, rej ?? 0]));
  }
  return sortedStable(out, (a, b) => a.key.compareTo(b.key));
}

/// DowntimeByMachine: minutes per stoppage group per machine (sheet order).
/// Values follow [eng.stoppageGroups].
List<TimePoint> downtimeByMachine(Rows rows, DashboardCtx ctx) {
  final items = <Map<String, dynamic>>[];
  for (final g in eng.summarizeBy(rows, 'machine', ctx)) {
    final s = g['summary'] as Map<String, dynamic>;
    final byCause = s['downtimeByCause'];
    final values = <double?>[
      for (final grp in eng.stoppageGroups)
        [
          for (final f in grp['fields'] as List) if (byCause is Map) _num(byCause[f]) ?? 0,
        ].fold<double>(0, (a, b) => a + b),
    ];
    if (!values.any((v) => (v ?? 0) > 0)) continue;
    items.add({'key': g['key'], 'label': g['label'], 'values': values});
  }
  return [
    for (final m in sortedStable(items, eng.compareMachines(ctx)))
      TimePoint('${m['key']}', '${m['label']}', (m['values'] as List).cast<double?>()),
  ];
}

// ── Unreported time, one small chart per machine ───────────────────────────

class MachinePanel {
  const MachinePanel(this.key, this.label, this.total, this.points);
  final String key;
  final String label;
  final double total;

  /// (bucket key, unreported minutes), oldest first.
  final List<(String, double)> points;
}

List<MachinePanel> unreportedPanels(Rows rows, String dim, DashboardCtx ctx) {
  final machines = <Map<String, dynamic>>[
    for (final m in eng.summarizeBy(rows, 'machine', ctx))
      {'key': m['key'], 'label': m['label'], 'summary': m['summary']},
  ];
  final out = <MachinePanel>[];
  for (final m in sortedStable(machines, eng.compareMachines(ctx))) {
    final key = '${m['key']}';
    final mine = [for (final r in rows) if (r['machine'] == key) r];
    final pts = <(String, double)>[];
    for (final g in eng.summarizeBy(mine, dim, ctx)) {
      final v = _num((g['summary'] as Map<String, dynamic>)['unreportedMin']);
      pts.add(('${g['key']}', v ?? 0));
    }
    pts.sort((a, b) => a.$1.compareTo(b.$1));
    out.add(MachinePanel(
      key,
      '${m['label']}',
      _num((m['summary'] as Map<String, dynamic>)['unreportedMin']) ?? 0,
      pts,
    ));
  }
  return out;
}

// ── MC No. Summary ─────────────────────────────────────────────────────────

class SummaryRow {
  const SummaryRow(this.key, this.label, this.summary);
  final String key;
  final String label;
  final Map<String, dynamic> summary;
}

List<SummaryRow> machineSummaryRows(Rows rows, DashboardCtx ctx) {
  final items = <Map<String, dynamic>>[
    for (final g in eng.summarizeBy(rows, 'machine', ctx)) {'key': g['key'], 'label': g['label'], 'summary': g['summary']},
  ];
  return [
    for (final m in sortedStable(items, eng.compareMachines(ctx)))
      SummaryRow('${m['key']}', '${m['label']}', m['summary'] as Map<String, dynamic>),
  ];
}

/// Text of a time-bucket tick: "dd/MM" for a date, "Sep 2026" for a month.
String bucketTick(String key, String dim) =>
    dim == 'date' ? '${jsSlice(key, 8)}/${jsSlice(key, 5, 7)}' : eng.monthLabel(key);

/// JS `s.slice(from, to)`: never throws on a short or empty key (a legacy
/// entry with no / an odd date lands in a bucket named '' or '—').
String jsSlice(String s, int from, [int? to]) {
  final a = from.clamp(0, s.length);
  final b = (to ?? s.length).clamp(0, s.length);
  return a >= b ? '' : s.substring(a, b);
}

/// The full label of a bucket ("05/09/2026" / "Sep 2026") for tooltips.
String bucketText(String key, String dim, DashboardCtx ctx) => eng.dimensions[dim]!.text(key, ctx);

/// Convenience for chart State classes: the fully filtered rows or the rows
/// sliced for [dim], as the web does with `rowsFor`.
Rows rowsForDim(DashboardChartProps p, String? dim) => p.rowsFor(dim);
