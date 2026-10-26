import 'package:flutter/painting.dart' show Color;

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
  const OeeSeries(this.key, this.label, this.shortLabel, {this.tone});
  final String key;
  final String label;

  /// Compact wording for the phone legend (the full one is in tooltips + table).
  final String shortLabel;

  /// 'ok' | 'reject' | 'downtime': draws the series in that entity colour
  /// instead of the next `series` slot (the web's `s.tone`).
  final String? tone;

  /// The line / area colour of series number [index].
  Color colorIn(DashboardColors c, int index) => switch (tone) {
        'ok' => c.ok,
        'reject' => c.reject,
        'downtime' => c.downtime,
        _ => c.series[index % c.series.length],
      };
}

const List<OeeSeries> oeeSeries = [
  OeeSeries('oeeLosses', 'Considering Losses', 'Considering Losses'),
  OeeSeries('oeeLunch', 'Excl. Losses (Lunch Only)', 'Lunch Only'),
  OeeSeries('oeeLunchCot', 'Excl. Losses (Lunch + Setup)', 'Lunch + Setup'),
];

/// One x position of a time chart: the bucket key ('2026-09-05' / '2026-09').
class TimePoint {
  const TimePoint(this.key, this.label, this.values);
  final String key;
  final String label;

  /// One entry per series (null = no figure for that bucket).
  final List<double?> values;
}

/// The three OEE components — each the entries' minutes and pieces added up
/// and divided once (summarize's oeeAvailability / ...), not averaged percentages.
const List<OeeSeries> apqSeries = [
  OeeSeries('oeeAvailability', 'Availability', 'Availability'),
  OeeSeries('oeePerformance', 'Performance', 'Performance'),
  OeeSeries('oeeQuality', 'Quality', 'Quality'),
];

/// Unutilized Machine Time over time: one filled area in the downtime colour.
const List<OeeSeries> utilSeries = [
  OeeSeries('unutilized', 'Unutilized machine time', 'Unutilized machine time', tone: 'downtime'),
];

/// The same on a worker-based process (web `UTIL_SERIES_WORKER`).
const List<OeeSeries> utilSeriesWorker = [
  OeeSeries('unutilized', 'Unutilized time', 'Unutilized time', tone: 'downtime'),
];

List<TimePoint> oeeTrend(Rows rows, String dim, DashboardCtx ctx, [List<OeeSeries> series = oeeSeries]) {
  final out = <TimePoint>[];
  for (final g in eng.summarizeBy(rows, dim, ctx)) {
    final s = g['summary'] as Map<String, dynamic>;
    final values = [for (final ser in series) pct100(s[ser.key])];
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

// ── Stoppages by cause (radar) and by machine (nested treemap) ─────────────

/// charts.jsx `shortCause`: the cause label with the long lunch wording folded,
/// in the process's own words where it has them ([DashboardCtx.causeLabels]).
String shortCause(String key, [DashboardCtx? ctx]) =>
    eng.causeLabel(key, ctx?.causeLabels).replaceFirst(RegExp(r'Lunch/Tea/Wash room etc\.'), 'Lunch / Tea');

/// RunTimeByMachine (radar): minutes lost per stoppage cause over [rows], every
/// cause (none folded into "Other" — PRINTING's own three included), largest
/// first, zero causes dropped.
List<BarDatum> stoppageCauses(Rows rows, [DashboardCtx? ctx]) {
  final total = eng.summarize(rows)['downtimeByCause'];
  final out = <BarDatum>[];
  for (final f in eng.causeFields) {
    final key = f['key'] as String;
    final v = total is Map ? (_num(total[key]) ?? 0.0) : 0.0;
    if (v > 0) out.add(BarDatum(key, shortCause(key, ctx), v));
  }
  return sortedStable(out, (a, b) => b.value.compareTo(a.value));
}

/// charts.jsx `causeColumns`: the causes a cause table lists — the ones the
/// process's sheet has ([DashboardCtx.stoppageKeys]; the shared ten when not
/// given), plus any other that does carry minutes in one of [summaries], so a
/// column never hides time the totals include.
List<Map<String, dynamic>> causeColumns(DashboardCtx ctx, Iterable<Map<String, dynamic>> summaries) {
  final keys = ctx.stoppageKeys ?? eng.stoppageKeysFor(null);
  bool carries(String key) => summaries.any((s) {
        final by = s['downtimeByCause'];
        final v = by is Map ? _num(by[key]) : null;
        return v != null && v != 0;
      });
  return [
    for (final f in eng.causeFields)
      if (keys.contains(f['key']) || carries(f['key'] as String)) f,
  ];
}

/// One machine of the B.D. Backup treemap: its causes, largest first.
class StoppageMachine {
  const StoppageMachine(this.key, this.label, this.summary, this.causes);
  final String key;
  final String label;
  final Map<String, dynamic> summary;

  /// (cause key, short label, minutes), minutes > 0, largest first.
  final List<(String, String, double)> causes;

  double get total => causes.fold<double>(0, (s, c) => s + c.$3);

  /// Minutes in one of [eng.stoppageGroups] (the table view's columns).
  double groupTotal(Map<String, dynamic> group) {
    final by = summary['downtimeByCause'];
    var sum = 0.0;
    for (final f in group['fields'] as List) {
      if (by is Map) sum += _num(by[f]) ?? 0;
    }
    return sum;
  }
}

/// DowntimeByMachine: machines with downtime, in sheet order.
List<StoppageMachine> stoppageMachines(Rows rows, DashboardCtx ctx) {
  final items = <Map<String, dynamic>>[];
  for (final g in eng.summarizeBy(rows, 'machine', ctx)) {
    final s = g['summary'] as Map<String, dynamic>;
    if (!((_num(s['downtimeMin']) ?? 0) > 0)) continue;
    items.add({'key': g['key'], 'label': g['label'], 'summary': s});
  }
  return [
    for (final m in sortedStable(items, eng.compareMachines(ctx)))
      () {
        final s = m['summary'] as Map<String, dynamic>;
        final by = s['downtimeByCause'];
        final causes = <(String, String, double)>[
          for (final f in eng.causeFields)
            if (by is Map && (_num(by[f['key']]) ?? 0) > 0) (f['key'] as String, shortCause(f['key'] as String, ctx), _num(by[f['key']])!),
        ];
        return StoppageMachine('${m['key']}', '${m['label']}', s, sortedStable(causes, (a, b) => b.$3.compareTo(a.$3)));
      }(),
  ];
}

/// One hue per machine (white text sits on all of them); a machine keeps its
/// colour by its place in the sheet order, so filtering never repaints it.
const List<Color> machineHues = [
  Color(0xFF2F6FE0),
  Color(0xFF1E2A8A),
  Color(0xFFD4682F),
  Color(0xFF5B1A7A),
  Color(0xFF17855F),
  Color(0xFFA8700A),
  Color(0xFFB02A5B),
  Color(0xFF3A7F8C),
];

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

// ── Machine Performance Summary ─────────────────────────────────────────────────────────

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
