import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/charts/chart_data.dart' show causeColumns;
import 'package:indo/features/production/dashboard/charts/chart_props.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart' as eng;
import 'package:indo/features/production/dashboard/data/processes_controller.dart';
import 'package:indo/features/production/dashboard/sheets/drill_sheet.dart';
import 'package:indo/features/production/dashboard/shell/process_dashboard_page.dart';
import 'package:indo/features/production/processes/rubber/rubber_calc.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';
import '../../calc/golden_support.dart';
import '../../dashboard_shell_fixtures.dart';

/// The RUBBER dashboard (web utils/processDashboard.js `isWorkerProcess`,
/// `unitWordsFor`, `worded`, `dimLabel`, `stoppageKeysFor`): the same figures as
/// any process, said per WORKER, and its tables carry only the stoppage causes
/// its sheet has.
const rubberProcess = <String, dynamic>{
  '_id': 'pr',
  'processName': 'RUBBER',
  'dataEntryMenu': '/hqepl/production/rubber-data-entry',
  'machines': <Object>[],
};

Map<String, dynamic> workerEntry(String id, String worker, {int setup = 10, int bdMech = 0}) => {
      ...entryFixture(id, machine: worker, operator: worker == 'w1' ? 'Asha' : 'Ravi', setup: setup),
      'bdMechMin': bdMech,
    };

void main() {
  group('the engine', () {
    test('RUBBER and After Powder Coating are worker processes; a machine process is not', () {
      expect(eng.isWorkerProcess(rubberProcess), isTrue);
      // Not linked to a page yet: its name decides.
      expect(eng.isWorkerProcess({'processName': 'Rubber'}), isTrue);
      expect(eng.isWorkerProcess({'processName': 'AFTER POWDER COATING'}), isTrue);
      expect(eng.isWorkerProcess({'processName': 'VMC', 'dataEntryMenu': '/hqepl/production/vmc-data-entry'}), isFalse);
      // A page link wins over the name.
      expect(eng.isWorkerProcess({'processName': 'RUBBER', 'dataEntryMenu': '/hqepl/production/vmc-data-entry'}), isFalse);
      expect(eng.isWorkerProcess(null), isFalse);
      expect(eng.unitWordsFor(rubberProcess), UnitWords.worker);
      expect(eng.unitWordsFor(null), UnitWords.machine);
    });

    test('a tile or graph in the worker\'s words; a machine process keeps its own', () {
      final effective = eng.worded(eng.statsByKey['effectiveHours']!, UnitWords.worker);
      expect(effective['label'], 'Effective Working Time');
      final shift = eng.worded(eng.statsByKey['shiftHours']!, UnitWords.worker);
      expect(shift['label'], 'Worker Shift Time');
      expect(shift['hint'], 'Working end − start');
      expect(eng.worded(eng.chartsByKey['machineSummary']!, UnitWords.worker)['label'], 'Worker Performance Summary');
      // No worker wording: unchanged.
      expect(eng.worded(eng.statsByKey['totalQty']!, UnitWords.worker), same(eng.statsByKey['totalQty']));
      expect(eng.worded(eng.statsByKey['effectiveHours']!, UnitWords.machine)['label'], 'Effective Machine Run Time');
    });

    test('RUBBER\'s stoppage causes are its sheet\'s (RUBBER_STOPPAGE_FIELDS): no machine breakdowns', () {
      final fields = loadFixture('fields.json', dir: 'test/production/processes/rubber/fixtures') as Map;
      final web = [for (final f in fields['stoppage'] as List) (f as Map)['key']];
      expect(eng.stoppageKeysFor(rubberProcess), web);
      expect(eng.stoppageKeysFor(rubberProcess), isNot(contains('bdMechMin')));
      expect(eng.stoppageKeysFor({'processName': 'AFTER POWDER COATING'}), ['lunchMin', 'otherMin']);
      expect(eng.stoppageKeysFor(null), hasLength(10));
    });

    test('a cause table leaves out the breakdown columns, unless minutes sit there', () {
      final ctx = DashboardCtx(
        machineName: const {},
        machineOrder: const {},
        bucket: 'date',
        stoppageKeys: eng.stoppageKeysFor(rubberProcess),
        words: UnitWords.worker,
      );
      Map<String, dynamic> summary(Map<String, double> causes) => {'downtimeByCause': causes};
      final quiet = [for (final f in causeColumns(ctx, [summary({'setupMin': 10})])) f['key']];
      expect(quiet, containsAll(rubberMinuteKeys));
      expect(quiet, isNot(contains('bdMechMin')));
      expect(quiet, isNot(contains('bdEleMin')));
      final odd = [for (final f in causeColumns(ctx, [summary({'bdMechMin': 5})])) f['key']];
      expect(odd, contains('bdMechMin'), reason: 'a column never hides time the totals include');
      expect(eng.dimLabel('machine', ctx), 'Worker');
      expect(eng.dimLabel('operator', ctx), 'Operator');
    });
  });

  group('the page', () {
    setUp(() {
      pinDashboardClock();
      SharedPreferences.setMockInitialValues({});
    });
    tearDown(unpinDashboardClock);

    Future<FakeApi> pumpRubber(WidgetTester tester, {List<Map<String, dynamic>>? entries, List<String>? stats, List<String>? charts}) async {
      final api = FakeApi.install();
      installDashboardApi(
        api,
        processes: [
          {...rubberProcess, 'stats': ?stats, 'charts': ?charts},
        ],
        entries: (_) => {
          'isOk': true,
          'data': entries ?? [workerEntry('e1', 'w1'), workerEntry('e2', 'w2', setup: 20)],
          'extent': {'from': '2026-01-05', 'to': '2026-09-14'},
          'machineNames': {'w1': 'Asha', 'w2': 'Ravi'},
        },
      );
      final processes = ProcessesController();
      await tester.runAsync(processes.load);
      await pumpScreen(tester, ProcessDashboardPage(processId: 'pr', processes: processes), size: const Size(390, 2400));
      return api;
    }

    testWidgets('tiles, graphs, tables and the breakdown say "Worker"', (tester) async {
      await pumpRubber(tester, stats: ['effectiveHours', 'shiftHours'], charts: ['runTimeByMachineBars', 'machineSummary']);
      expect(find.text('Effective Working Time'), findsOneWidget);
      expect(find.text('Worker Shift Time'), findsOneWidget);
      expect(find.text('Effective Working Time by Worker (hr)'), findsOneWidget);
      expect(find.text('Worker Performance Summary'), findsOneWidget);
      // The summary table is headed by the worker (headers are set in capitals),
      // each named as the API sent them.
      expect(find.text('WORKER'), findsWidgets);
      expect(find.text('Asha'), findsWidgets);
      expect(find.text('MACHINE'), findsNothing);
      expect(find.byTooltip('Break down by worker, operator, part, date'), findsWidgets);

      await tester.tap(find.byKey(const ValueKey('kpi:effectiveHours')));
      await tester.pumpAndSettle();
      expect(find.byType(DrillSheet), findsOneWidget);
      expect(find.text('By Worker'), findsOneWidget);
      expect(find.text('By Machine'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('no entries: no "assign machines" advice for a process kept per worker', (tester) async {
      await pumpRubber(tester, entries: const []);
      expect(find.textContaining('No entries for RUBBER'), findsOneWidget);
      expect(find.textContaining('has no machines yet'), findsNothing);
    });
  });
}
