import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/charts/chart_data.dart';
import 'package:indo/features/production/dashboard/charts/chart_props.dart';
import 'package:indo/features/production/dashboard/charts/charts_registry.dart';
import 'package:indo/features/production/dashboard/charts/mini_table.dart';
import 'package:indo/features/production/dashboard/charts/stoppage_treemap.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart' as eng;

import '../../../support/fake_api.dart';
import '../../calc/golden_support.dart';

/// The dashboard shows PRINTING's own three downtime causes (Ask Query To QC
/// Team, Empty Bag Tugging, Stock Counting) on their own — in the totals, the
/// Downtime by Cause radar and table, the Downtime by Machine tiles and the
/// "Other stoppages" group — exactly as the REAL utils/processDashboard.js
/// works them out (fixtures/dashboard.json, tool/gen_printing_golden.mjs).
final dir = Platform.environment['PRINTING_FIXTURE_DIR'] ?? 'test/production/processes/printing/fixtures';

const printingProcess = <String, dynamic>{'processName': 'PRINTING', 'dataEntryMenu': '/hqepl/production/printing-data-entry'};
const ownThree = ['askQueryQcMin', 'emptyBagTuggingMin', 'stockCountingMin'];

List<Map<String, dynamic>> rowsOf(Object? v) => [for (final r in v as List) Map<String, dynamic>.from(r as Map)];

DashboardCtx ctxFor({List<String>? stoppageKeys}) => DashboardCtx(
      machineName: const {'op1': 'Surekha', 'op2': 'Ravi', 'op3': 'Meena', 'OP1': 'Surekha'},
      machineOrder: const {'op1': 0, 'op2': 1, 'op3': 2},
      bucket: 'date',
      stoppageKeys: stoppageKeys,
    );

void main() {
  final f = loadFixture('dashboard.json', dir: dir) as Map;

  group('the engine names and groups the causes like the web', () {
    test('CAUSE_FIELDS: the shared ten, then PRINTING\'s own three', () {
      expect(eng.causeFields, f['causeFields']);
      expect(eng.causeFields.map((c) => c['key']).skip(10), ownThree);
    });
    test('STOPPAGE_GROUPS: "Other stoppages" takes PRINTING\'s three', () {
      expect(eng.stoppageGroups, f['stoppageGroups']);
    });
    test('causeLabel', () {
      for (final p in f['causeLabels'] as List) {
        expect(eng.causeLabel(p[0] as String), p[1], reason: '${p[0]}');
      }
      expect(eng.causeLabel('askQueryQcMin'), 'Ask Query To QC Team');
    });
    test('stoppageKeysFor: PRINTING\'s thirteen; a machine process and "All machines" the ten', () {
      expect(eng.stoppageKeysFor(printingProcess), f['stoppageKeysPrinting']);
      expect(eng.stoppageKeysFor(null), f['stoppageKeysNone']);
      expect(eng.stoppageKeysFor(const {'processName': 'CNC', 'dataEntryMenu': '/hqepl/production/cnc-data-entry'}), f['stoppageKeysCnc']);
      // A process not linked to a page yet is PRINTING by its name.
      expect(eng.stoppageKeysFor(const {'processName': 'PRINTING'}), f['stoppageKeysPrinting']);
    });
    test('PRINTING is worded per worker (isWorkerProcess)', () {
      expect(eng.isWorkerProcess(printingProcess), f['isWorkerPrinting']);
    });
  });

  group('summarize matches the web over the dashboard feed', () {
    final scenarios = f['scenarios'] as Map;
    for (final name in scenarios.keys) {
      test('$name', () {
        final sc = scenarios[name] as Map;
        final rows = rowsOf(sc['rows']);
        final s = eng.summarize(rows);
        expect(diff(s, sc['summary']), isNull, reason: name);
        final causes = [
          for (final c in eng.causeFields)
            () {
              final m = eng.causeMeasure(c['key'] as String);
              return {'key': m['key'], 'label': m['label'], 'value': eng.measureValue(m, s)};
            }(),
        ];
        expect(diff(causes, sc['causes']), isNull, reason: '$name causes');
      });
    }

    test('the paper row: each own cause has its minutes, and Total Downtime counts them', () {
      final s = eng.summarize(rowsOf((scenarios['paper'] as Map)['rows']));
      final by = s['downtimeByCause'] as Map;
      expect(by['askQueryQcMin'], 5);
      expect(by['emptyBagTuggingMin'], 7);
      expect(by['stockCountingMin'], 3);
      expect(s['downtimeMin'], 45);
    });
  });

  group('the charts give PRINTING\'s causes their own bars and columns', () {
    final rows = rowsOf(((f['scenarios'] as Map)['printing'] as Map)['rows']);

    test('Downtime by Cause: a bar (spoke) per own cause, in its own words', () {
      final causes = stoppageCauses(rows);
      final keys = causes.map((c) => c.key).toList();
      expect(keys, containsAll(ownThree));
      final byKey = {for (final c in causes) c.key: c};
      expect(byKey['askQueryQcMin']!.label, 'Ask Query To QC Team');
      expect(byKey['emptyBagTuggingMin']!.label, 'Empty Bag Tugging');
      expect(byKey['stockCountingMin']!.label, 'Stock Counting');
      final total = eng.summarize(rows)['downtimeByCause'] as Map;
      for (final k in ownThree) {
        expect(byKey[k]!.value, total[k]);
      }
    });

    test('Downtime by Machine: each operator\'s tiles include the own causes; "Other stoppages" adds them', () {
      final machines = stoppageMachines(rows, ctxFor());
      expect(machines, isNotEmpty);
      final other = eng.stoppageGroups.firstWhere((g) => g['key'] == 'other');
      for (final m in machines) {
        final by = m.summary['downtimeByCause'] as Map;
        for (final k in ownThree) {
          final v = (by[k] as num).toDouble();
          expect(m.causes.any((c) => c.$1 == k), v > 0, reason: '${m.key} $k');
        }
        final expected = [for (final k in (other['fields'] as List)) (by[k] as num).toDouble()].fold<double>(0, (a, b) => a + b);
        expect(m.groupTotal(other), closeTo(expected, 1e-9));
      }
    });

    test('causeColumns: a PRINTING dashboard always lists its thirteen; others add a cause only when it carries minutes', () {
      final zero = [
        {'downtimeByCause': {for (final c in eng.causeFields) c['key']: 0.0}},
      ];
      final printing = causeColumns(ctxFor(stoppageKeys: eng.stoppageKeysFor(printingProcess)), zero);
      expect(printing.map((c) => c['key']), [for (final c in eng.causeFields) c['key']]);
      final machine = causeColumns(ctxFor(), zero);
      expect(machine.map((c) => c['key']), [for (final c in eng.causeFields.take(10)) c['key']]);
      final withMinutes = causeColumns(ctxFor(), [
        {'downtimeByCause': {for (final c in eng.causeFields) c['key']: c['key'] == 'stockCountingMin' ? 4.0 : 0.0}},
      ]);
      expect(withMinutes.map((c) => c['key']), [...[for (final c in eng.causeFields.take(10)) c['key']], 'stockCountingMin']);
    });

    Future<void> pumpChart(WidgetTester t, String chart, DashboardCtx ctx, ChartView view) => pumpScreen(
          t,
          Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                height: 360,
                child: Builder(
                  builder: (context) => dashboardCharts[chart]!(DashboardChartProps(
                    rowsFor: (_) => rows,
                    ctx: ctx,
                    colors: DashboardColors.of(context),
                    filters: const {},
                    onToggle: (_, _) {},
                    onDrill: (_) {},
                    view: view,
                  )),
                ),
              ),
            ),
          ),
          size: const Size(390, 700),
        );

    testWidgets('the Downtime by Cause table heads a column for each own cause', (t) async {
      await pumpChart(t, 'runTimeByMachine', ctxFor(stoppageKeys: eng.stoppageKeysFor(printingProcess)), ChartView.table);
      final table = t.widget<MiniTable>(find.byType(MiniTable));
      expect(table.columns, containsAll(['Ask Query To QC Team (min)', 'Empty Bag Tugging (min)', 'Stock Counting (min)']));
      expect(table.columns, hasLength(2 + 13));
      expect(t.takeException(), isNull);
    });

    testWidgets('the radar and the treemap draw with PRINTING rows', (t) async {
      for (final chart in ['runTimeByMachine', 'downtimeByMachine']) {
        await pumpChart(t, chart, ctxFor(stoppageKeys: eng.stoppageKeysFor(printingProcess)), ChartView.chart);
        expect(t.takeException(), isNull, reason: chart);
      }
      expect(find.byType(StoppageTreemapView), findsOneWidget);
    });
  });
}
