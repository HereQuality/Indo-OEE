// Numeric + textual parity of the whole dashboard with the web.
//
// fixtures/dashboard_parity_golden.json is produced by tool/golden_dashboard.jsx,
// which renders the REAL web dashboard (charts.jsx, DrillModal.jsx and
// processDashboard.js, via react-dom/server) over many "views" (scenario x
// period slice x cross-filters x process machines). Here the Dart dashboard is
// run over the very same rows and every figure must match: KPI tile texts,
// each chart's table / empty state / text, the chart-only datasets, the
// drill-down splits and entries, the Filters options and chips.
// Numbers are compared to 1e-9 (float rounding only); texts exactly.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/charts/chart_data.dart';
import 'package:indo/features/production/dashboard/charts/chart_kit.dart' show ChartEmpty, truncateLabel;
import 'package:indo/features/production/dashboard/charts/chart_props.dart';
import 'package:indo/features/production/dashboard/charts/charts_registry.dart';
import 'package:indo/features/production/dashboard/charts/mini_table.dart';
import 'package:indo/features/production/dashboard/charts/nice_axis.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart' as eng;
import 'package:indo/features/production/dashboard/shell/dashboard_controller.dart';
import 'package:indo/features/production/dashboard/sheets/drill_sheet.dart';
import 'package:indo/features/production/dashboard/sheets/sheet_kit.dart' show SheetCard;

import '../../support/fake_api.dart';
import '../dashboard_sheets_support.dart';

typedef Json = Map<String, dynamic>;

late Json golden;

Json _load(String name) => jsonDecode(File('test/production/engine/fixtures/$name').readAsStringSync()) as Json;

class ViewCase {
  ViewCase(this.json) {
    final scenario = json['scenario'] as String;
    final sc = golden['scenarios'][scenario] as Json;
    var rows = [for (final r in sc['rows'] as List) Map<String, dynamic>.from(r as Map)];
    final machines = json['machines'] as List?;
    if (machines != null) rows = [for (final r in rows) if (machines.contains(r['machine'])) r];
    final range = json['range'] as List?;
    if (range != null) rows = [for (final r in rows) if ('${r['date']}'.compareTo(range[0] as String) >= 0 && '${r['date']}'.compareTo(range[1] as String) <= 0) r];
    final cj = sc['ctx'] as Json;
    names = (cj['machineName'] as Map).map((k, v) => MapEntry('$k', '$v'));
    order = (cj['machineOrder'] as Map).map((k, v) => MapEntry('$k', (v as num).toInt()));
    filters = eng.newEmptyFilters();
    for (final e in (json['filters'] as Map).entries) {
      filters[e.key as String] = (e.value as List).cast<String>();
    }
    // The controller builds ctx / rowsFor / summary / options exactly as the app does.
    final inOrder = order.keys.toList()..sort((a, b) => order[a]!.compareTo(order[b]!));
    ctl = DashboardController(machines: [for (final id in inOrder) {'_id': id, 'machineName': names[id] ?? ''}])
      ..rows = rows
      ..entryMachineNames = names
      ..filters = filters;
  }

  final Json json;
  late final Map<String, String> names;
  late final Map<String, int> order;
  late final Map<String, List<String>> filters;
  late final DashboardController ctl;

  String get id => json['id'] as String;
  DashboardCtx get ctx => ctl.ctx;
  List<Map<String, dynamic>> rowsFor(String? dim) => ctl.rowsFor(dim);
  Json get charts => json['charts'] as Json;
}

// ── comparison helpers ─────────────────────────────────────────────────────
Object? _dec(Object? v) => v == '__NaN__' ? double.nan : v;

void near(num? actual, Object? expected, String what) {
  final want = _dec(expected);
  if (want == null) return expect(actual, isNull, reason: what);
  want as num;
  expect(actual, isNotNull, reason: what);
  if (want.isNaN) return expect(actual!.isNaN, isTrue, reason: what);
  final diff = (actual! - want).abs();
  expect(diff <= 1e-9 || diff <= 1e-12 * want.abs(), isTrue, reason: '$what: expected $want got $actual');
}

String _squash(String s) => s.replaceAll(RegExp(r'\s+'), '');

DashboardChartProps _props(ViewCase v, ChartView view, bool expanded) => DashboardChartProps(
      rowsFor: v.rowsFor,
      ctx: v.ctx,
      colors: DashboardColors.light,
      filters: v.filters,
      onToggle: (_, _) {},
      onDrill: (_) {},
      view: view,
      expanded: expanded,
    );

Future<void> _pumpChart(WidgetTester t, String key, DashboardChartProps p) async {
  await pumpScreen(
    t,
    Scaffold(body: SizedBox(width: 1000, height: 1800, child: dashboardCharts[key]!(p))),
    size: const Size(1000, 1800),
    settle: false,
  );
  await t.pump();
}

List<String> _texts(WidgetTester t) {
  final out = <String>[];
  for (final w in t.widgetList<Text>(find.byType(Text))) {
    out.add(w.data ?? w.textSpan?.toPlainText() ?? '');
  }
  return out;
}

void main() {
  golden = _load('dashboard_parity_golden.json');
  eng.engineNumberLocale = 'en-US';
  final views = [for (final j in golden['views'] as List) ViewCase(j as Json)];

  test('the fixture covers the intended views', () {
    final ids = [for (final j in golden['views'] as List) (j as Json)['id']];
    expect(ids.length, greaterThan(40));
    expect(ids, containsAll(['factory:all machines', 'factory:CNC process', 'factory:overnight', 'plant:no match', 'long:thisMonth', 'factoryLong:all', 'empty:all']));
  });

  group('shell: ctx, buckets, filter options and chips equal the web', () {
    test('every view', () {
      for (final v in views) {
        final j = v.json;
        expect(v.ctx.bucket, j['bucket'], reason: v.id);
        expect(v.ctl.rows.length, j['rowCount'], reason: v.id);
        expect(v.ctl.filtered.length, j['filteredCount'], reason: v.id);
        final opts = j['filterOptions'] as Json;
        for (final dim in ['machine', 'operator', 'item']) {
          final want = [for (final o in opts[dim] as List) '${(o as Json)['value']}|${o['label']}'];
          final got = [for (final o in v.ctl.filterOptions[dim]!) '${o['value']}|${o['label']}'];
          expect(got, want, reason: '${v.id} options $dim');
        }
        expect([for (final c in v.ctl.activeFilters) c.label], j['chips'], reason: '${v.id} chips');
      }
    });
  });

  test('toStringAsFixed == Number.toFixed on ties, near-ties and negatives (chart labels, tooltips, rings)', () {
    final bad = <String>[];
    for (final c in golden['toFixed'] as List) {
      final v = ((c as List)[0] as num).toDouble();
      final got = v.toStringAsFixed((c[1] as num).toInt());
      if (got != c[2]) bad.add('$v.toFixed(${c[1]}): web ${c[2]} Dart $got');
    }
    expect(bad, isEmpty, reason: bad.take(20).join('\n'));
  });

  group('KPI tiles: every stat text, in catalog order', () {
    test('every view', () {
      for (final v in views) {
        final summary = v.ctl.summary;
        final want = v.json['stats'] as List;
        expect([for (final s in eng.statCatalog) s['key']], [for (final s in want) (s as Json)['key']], reason: '${v.id} order');
        for (var i = 0; i < want.length; i++) {
          final stat = eng.statCatalog[i];
          final text = eng.formats[stat['format']]!(summary[stat['key']] as num?);
          expect(text, (want[i] as Json)['text'], reason: '${v.id} tile ${stat['key']}');
        }
        expect(v.json['entries'], '${v.ctl.filtered.length} ${v.ctl.filtered.length == 1 ? 'entry' : 'entries'}', reason: '${v.id} entries');
      }
    });
  });

  group('chart-only datasets (what Recharts draws)', () {
    test('radar causes, treemap tiles, rings, x ticks', () {
      for (final v in views) {
        final d = v.json['datasets'] as Json;
        final radar = stoppageCauses(v.rowsFor('machine'));
        final wr = d['radar'] as List;
        expect(radar.length, wr.length, reason: '${v.id} radar');
        for (var i = 0; i < wr.length; i++) {
          expect(radar[i].key, (wr[i] as Json)['key'], reason: '${v.id} radar[$i]');
          expect(radar[i].label, wr[i]['label'], reason: '${v.id} radar[$i]');
          near(radar[i].value, wr[i]['value'], '${v.id} radar[$i]');
        }

        final tiles = stoppageMachines(v.rowsFor('machine'), v.ctx);
        final wt = d['treemap'] as List;
        expect(tiles.map((m) => '${m.key}|${m.label}').toList(), [for (final m in wt) '${(m as Json)['key']}|${m['label']}'], reason: '${v.id} treemap machines');
        for (var i = 0; i < wt.length; i++) {
          final m = tiles[i];
          final w = wt[i] as Json;
          final wc = w['children'] as List;
          expect(m.causes.length, wc.length, reason: '${v.id} treemap ${m.key}');
          for (var k = 0; k < wc.length; k++) {
            expect(m.causes[k].$1, (wc[k] as Json)['key'], reason: '${v.id} treemap ${m.key}[$k]');
            expect(m.causes[k].$2, wc[k]['name'], reason: '${v.id} treemap ${m.key}[$k]');
            near(m.causes[k].$3, wc[k]['value'], '${v.id} treemap ${m.key}[$k]');
          }
          near(m.total, w['total'], '${v.id} treemap total ${m.key}');
          final groups = w['groups'] as List;
          for (var g = 0; g < eng.stoppageGroups.length; g++) {
            near(m.groupTotal(eng.stoppageGroups[g]), groups[g], '${v.id} treemap group $g ${m.key}');
          }
        }

        final sum = eng.summarize(v.rowsFor(null));
        final rings = d['rings'] as List;
        for (var i = 0; i < apqSeries.length; i++) {
          near(pct100(sum[apqSeries[i].key]), rings[i], '${v.id} ring ${apqSeries[i].key}');
        }

        final ticks = d['ticks'] as List;
        final dim = v.ctx.bucket;
        final keys = {for (final r in v.rowsFor(dim)) eng.dimensions[dim]!.value(r)}.toList()..sort();
        expect(keys, [for (final t in ticks) (t as Json)['key']], reason: '${v.id} x keys');
        for (final t in ticks) {
          expect(bucketTick(t['key'] as String, dim), t['tick'], reason: '${v.id} tick');
          expect(bucketText(t['key'] as String, dim, v.ctx), t['tip'], reason: '${v.id} tooltip');
        }
      }
    });

    test('unreported-time panels share one nice axis', () {
      for (final v in views) {
        final u = (v.json['datasets'] as Json)['unreported'] as Json;
        final panels = unreportedPanels(v.rowsFor(null), v.ctx.bucket, v.ctx);
        final wp = u['panels'] as List;
        expect(panels.map((p) => '${p.key}|${p.label}').toList(), [for (final p in wp) '${(p as Json)['key']}|${p['label']}'], reason: v.id);
        var lo = 0.0, hi = 0.0;
        for (var i = 0; i < wp.length; i++) {
          final w = wp[i] as Json;
          near(panels[i].total, w['total'], '${v.id} total ${panels[i].key}');
          final wd = w['data'] as List;
          expect(panels[i].points.length, wd.length, reason: '${v.id} points ${panels[i].key}');
          for (var k = 0; k < wd.length; k++) {
            expect(panels[i].points[k].$1, (wd[k] as Json)['key'], reason: v.id);
            near(panels[i].points[k].$2, wd[k]['value'], '${v.id} ${panels[i].key}[$k]');
            lo = lo < panels[i].points[k].$2 ? lo : panels[i].points[k].$2;
            hi = hi > panels[i].points[k].$2 ? hi : panels[i].points[k].$2;
          }
        }
        final axis = niceAxis(lo, hi, wp.length <= 6 ? 3 : 2);
        final wa = u['axis'] as Json;
        near(axis.lo, (wa['domain'] as List)[0], '${v.id} axis lo');
        near(axis.hi, wa['domain'][1], '${v.id} axis hi');
        expect(axis.ticks.length, (wa['ticks'] as List).length, reason: '${v.id} axis ticks');
        for (var i = 0; i < axis.ticks.length; i++) {
          near(axis.ticks[i], wa['ticks'][i], '${v.id} axis tick $i');
        }
        expect([for (final t in axis.ticks) tickText(t)], (u['tickTexts'] as List).cast<String>(), reason: '${v.id} tick texts');
      }
    });

    test('niceAxis / tickText / truncate / shortCause on a battery of inputs', () {
      for (final c in golden['axisCases'] as List) {
        final i = (c as Json)['in'] as List;
        final a = niceAxis((i[0] as num).toDouble(), (i[1] as num).toDouble(), (i[2] as num).toInt());
        final w = c['out'] as Json;
        near(a.lo, (w['domain'] as List)[0], 'niceAxis $i lo');
        near(a.hi, w['domain'][1], 'niceAxis $i hi');
        expect(a.ticks.length, (w['ticks'] as List).length, reason: 'niceAxis $i');
        expect([for (final t in a.ticks) tickText(t)], (c['ticks'] as List).cast<String>(), reason: 'tickText $i');
      }
      for (final c in golden['truncate'] as List) {
        final i = (c as Json)['in'] as List;
        expect(truncateLabel(i[0] as String, (i[1] as num).toInt()), c['out']);
      }
      for (final p in golden['shortCause'] as List) {
        expect(shortCause((p as List)[0] as String), p[1]);
      }
    });
  });

  group('every chart: empty state, table view and text, equal to the web', () {
    final keys = [for (final c in eng.chartCatalog) c['key'] as String];
    for (final key in keys) {
      testWidgets(key, (t) async {
        for (final v in views) {
          for (final entry in [('chart', ChartView.chart), ('table', ChartView.table)]) {
            for (final expanded in [false, true]) {
              final name = '${entry.$1}${expanded ? ':expanded' : ''}';
              final want = ((v.charts[key] as Json)[name] ?? (v.charts[key] as Json)[entry.$1]) as Json;
              await _pumpChart(t, key, _props(v, entry.$2, expanded));
              final where = '${v.id} / $key / $name';
              if (want.containsKey('empty')) {
                expect(find.byType(ChartEmpty), findsOneWidget, reason: where);
                expect(t.widget<ChartEmpty>(find.byType(ChartEmpty)).message, want['empty'], reason: where);
              } else if (want.containsKey('table')) {
                final w = want['table'] as Json;
                expect(find.byType(MiniTable), findsOneWidget, reason: where);
                final mt = t.widget<MiniTable>(find.byType(MiniTable));
                expect(mt.columns, (w['columns'] as List).cast<String>(), reason: '$where columns');
                final hints = (w['hints'] as List).cast<String?>();
                if (hints.any((h) => h != null)) expect(mt.hints, hints, reason: '$where hints');
                final wr = w['rows'] as List;
                expect(mt.rows.length, wr.length, reason: '$where row count');
                for (var i = 0; i < wr.length; i++) {
                  expect(mt.rows[i].cells, (wr[i] as List).cast<String>(), reason: '$where row $i');
                }
                final selIdx = [for (var i = 0; i < mt.rows.length; i++) if (mt.selected.contains(mt.rows[i].key)) i];
                expect(selIdx, (w['selected'] as List).cast<int>(), reason: '$where selected rows');
              } else {
                expect(find.byType(ChartEmpty), findsNothing, reason: where);
                final dart = _squash(_texts(t).join());
                for (final tok in (want['texts'] as List).cast<String>()) {
                  expect(dart.contains(_squash(tok)), isTrue, reason: '$where: web text "$tok" missing; Dart shows ${_texts(t)}');
                }
                for (final title in (want['multiples'] as List).cast<String>()) {
                  expect(dart.contains(_squash(title)), isTrue, reason: '$where: panel title "$title" missing; Dart shows ${_texts(t)}');
                }
                // The card's "+N more" footer appears exactly when the web has it.
                final web = (want['texts'] as List).cast<String>().where((s) => s.startsWith('+') && s.contains('more')).toList();
                final mine = _texts(t).where((s) => s.startsWith('+') && s.contains('more —')).toList();
                expect(mine, web, reason: '$where: +N more footer');
              }
            }
          }
        }
      });
    }
  });

  group('drill-down: totals and every split equal the web', () {
    // One sheet per (view, measure); every tab is read in the opened sheet.
    final byId = {for (final j in golden['views'] as List) (j as Json)['id'] as String: j};
    for (final id in ['factory:all machines', 'factory:CNC process', 'plant:all', 'long:thisMonth', 'factoryLong:all', 'weird:all', 'factory:part x CNC', 'factory:overnight']) {
      testWidgets(id, (t) async {
        final vj = byId[id]!;
        final v = views.firstWhere((x) => x.id == id);
        final drills = vj['drills'] as List;
        // Cause / reason / stat measures are rebuilt from their keys, like the charts do.
        for (final d in drills) {
          final key = (d as Json)['key'] as String;
          final Json measure;
          if (key.startsWith('cause:')) {
            measure = eng.causeMeasure(key.substring(6));
          } else if (key.startsWith('reason:')) {
            measure = eng.reasonMeasure(key.substring(7));
          } else {
            measure = eng.statMeasure(eng.statsByKey[key]!);
          }
          expect(measure['label'], d['label'], reason: '$id $key label');
          expect(measure['format'], d['format'], reason: '$id $key format');
          final rows = v.ctl.filtered;
          expect(eng.formats[measure['format']]!(eng.measureValue(measure, eng.summarize(rows))), d['total'], reason: '$id $key total');

          await t.pumpWidget(const SizedBox());
          await openSheet(
            t,
            (context) => showDrillSheet(context, measure: measure, rows: rows, ctx: v.ctx, onPick: (_, _) {}),
            size: const Size(700, 9000),
          );
          expect(find.text('${d['label']}'), findsWidgets, reason: '$id $key title');
          expect(find.text(d['total'] as String), findsWidgets, reason: '$id $key total shown');
          expect(find.text('for the current filters · ${vj['entries']}'), findsOneWidget, reason: '$id $key count');
          final splits = d['splits'] as Json;
          final tabs = ['machine', 'operator', 'item', v.ctx.bucket];
          for (final tab in tabs) {
            final label = 'By ${{'machine': 'Machine', 'operator': 'Operator', 'item': 'Part', 'date': 'Date', 'month': 'Month'}[tab]}';
            if (tab != 'machine') {
              await t.ensureVisible(find.text(label));
              await t.tap(find.text(label));
              await t.pumpAndSettle();
            }
            final s = splits[tab] as Json;
            final where = '$id / $key / $tab';
            if (s['empty'] == true) {
              expect(find.text('Nothing to show for this selection.'), findsOneWidget, reason: where);
              continue;
            }
            final items = s['items'] as List;
            final list = find.byType(SliverList);
            final texts = [for (final w in t.widgetList<Text>(find.descendant(of: list, matching: find.byType(Text)))) w.data ?? ''];
            expect(texts.length, items.length * 2, reason: '$where rows: $texts');
            for (var i = 0; i < items.length; i++) {
              expect(texts[2 * i], (items[i] as Json)['label'], reason: '$where label $i');
              expect(texts[2 * i + 1], items[i]['value'], reason: '$where value $i');
            }
            final fractions = [for (final w in t.widgetList<FractionallySizedBox>(find.descendant(of: list, matching: find.byType(FractionallySizedBox)))) w.widthFactor!];
            expect(fractions.length, items.length, reason: '$where bars');
            for (var i = 0; i < items.length; i++) {
              near(fractions[i] * 100, items[i]['width'], '$where bar $i');
            }
          }
          if (vj['records'] != null && key == 'totalQty') {
            await t.ensureVisible(find.text('Entries'));
            await t.tap(find.text('Entries'));
            await t.pumpAndSettle();
            final rec = vj['records'] as Json;
            final cards = t.widgetList<SheetCard>(find.byType(SheetCard)).toList();
            final want = rec['rows'] as List;
            expect(cards, isNotEmpty, reason: '$id records');
            final shown = cards.length < want.length ? cards.length : want.length;
            // The web lists the latest 300 entries, newest first; the sheet builds the visible ones.
            expect(shown, greaterThanOrEqualTo(want.length < 12 ? want.length : 12), reason: '$id built cards');
            for (var i = 0; i < shown; i++) {
              final tx = [for (final w in t.widgetList<Text>(find.descendant(of: find.byType(SheetCard).at(i), matching: find.byType(Text)))) w.data ?? w.textSpan?.toPlainText() ?? ''];
              final w = (want[i] as Json);
              final c = (w['cells'] as List).cast<String>(); // date, machine, operator, part, actual, ok, rejected, shift, effective, stoppage
              final got = [tx[0], tx[1], tx[2], tx[3], tx[5], tx[7], tx[9], tx[11], tx[13], tx[15]];
              expect(got, c, reason: '$id entry $i cells');
              expect(tx.sublist(16), (w['remarks'] as List).cast<String>(), reason: '$id entry $i remarks');
            }
            if (rec['footer'] != null) {
              expect(rows.length > 300, isTrue);
            }
          }
        }
      });
    }
  });
}
