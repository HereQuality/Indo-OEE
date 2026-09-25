import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart' as eng;
import 'package:indo/features/production/dashboard/shell/dashboard_controller.dart';

import '../support/fake_api.dart';
import 'dashboard_shell_fixtures.dart';

DashboardController make({String? processId = processVmc}) =>
    DashboardController(processId: processId, machines: machinesFixture().take(2).toList());

void main() {
  // Alerts (toasts) reach for the widgets binding.
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(pinDashboardClock);
  tearDown(unpinDashboardClock);

  group('loading', () {
    test('requests the default period for the process and fills the derived state', () async {
      final api = FakeApi.install();
      installDashboardApi(api);
      final c = make();
      expect(c.loading, isTrue);
      await c.load();

      final req = api.called('GET', '/api/v1/processes/entries').single;
      expect(req.query, {'from': '2026-09-01', 'to': '2026-09-30', 'process': processVmc});
      expect(c.loading, isFalse);
      expect(c.error, isNull);
      expect(c.rows, hasLength(3));
      expect(c.extent, {'from': '2026-01-05', 'to': '2026-09-14'});
      expect(c.ctx.machineName['m1'], '7A');
      expect(c.ctx.machineOrder, {'m1': 0, 'm2': 1});
      expect(c.ctx.bucket, 'date');
      // ints from JSON are widened for the calc engine.
      expect(c.rows.first['actualQty'], isA<double>());
      expect(c.summary['totalQty'], 1700);
      expect(c.summary['okQty'], 1670);
      expect(c.summary['rejectedQty'], 30);
      c.dispose();
    });

    test('"All machines" omits the process parameter', () async {
      final api = FakeApi.install();
      installDashboardApi(api);
      final c = make(processId: null);
      await c.load();
      expect(api.called('GET', '/api/v1/processes/entries').single.query.containsKey('process'), isFalse);
      c.dispose();
    });

    test('a failed load clears the rows and keeps the server message', () async {
      final api = FakeApi.install();
      installDashboardApi(api, entries: (_) => FakeResponse({'isOk': false, 'message': 'Boom'}, status: 500));
      final c = make();
      await c.load();
      expect(c.error, 'Boom');
      expect(c.rows, isEmpty);
      expect(c.loading, isFalse);
      c.dispose();
    });

    test('a response that arrives after a newer request is discarded', () async {
      final api = FakeApi.install();
      final first = Completer<Object?>();
      var calls = 0;
      installDashboardApi(api, entries: (req) {
        calls++;
        if (calls == 1) return first.future;
        return {
          'isOk': true,
          'data': [entryFixture('new', date: '2026-08-03')],
          'extent': null,
          'machineNames': <String, String>{},
        };
      });
      final c = make();
      final slow = c.load(); // in flight: September
      c.setRange(['2026-08-01', '2026-08-31']); // newer request answers first
      await pumpEventQueue();
      expect(c.rows.single['_id'], 'new');

      first.complete({
        'isOk': true,
        'data': [entryFixture('old'), entryFixture('old2')],
        'extent': null,
        'machineNames': <String, String>{},
      });
      await slow;
      await pumpEventQueue();
      expect(c.rows.single['_id'], 'new', reason: 'the slow, stale answer must not overwrite the newer one');
      expect(c.loading, isFalse);
      c.dispose();
    });
  });

  group('period', () {
    test('default period is named after the month; a quick range keeps its own name', () async {
      final api = FakeApi.install();
      installDashboardApi(api);
      final c = make();
      await c.load();
      expect(c.isDefaultRange, isTrue);
      expect(c.periodLabel, 'September 2026');

      c.setRange(['2026-09-09', '2026-09-15']); // last 7 days
      await pumpEventQueue();
      expect(c.isDefaultRange, isFalse);
      expect(c.periodLabel, 'Last 7 days');
      expect(c.filtersActive, isTrue);

      c.resetRange();
      await pumpEventQueue();
      expect(c.range, ['2026-09-01', '2026-09-30']);
      expect(c.isDefaultRange, isTrue);
      expect(api.called('GET', '/api/v1/processes/entries'), hasLength(3));
      c.dispose();
    });

    test('a period longer than 5 years is refused without a request', () async {
      final api = FakeApi.install();
      installDashboardApi(api);
      final c = make();
      await c.load();
      expect(c.setRange(['2015-01-01', '2026-09-15']), isFalse);
      expect(c.range, ['2026-09-01', '2026-09-30']);
      expect(api.called('GET', '/api/v1/processes/entries'), hasLength(1));
      expect(c.setRange(['2021-09-16', '2026-09-15']), isTrue);
      c.dispose();
    });

    test('a new period keeps machine picks but drops a clicked date / month', () async {
      final api = FakeApi.install();
      installDashboardApi(api);
      final c = make();
      await c.load();
      c.toggle('machine', 'm1');
      c.toggle('date', '2026-09-02');
      c.toggle('month', '2026-09');
      c.setRange(['2026-08-01', '2026-08-31']);
      expect(c.filters['machine'], ['m1']);
      expect(c.filters['date'], isEmpty);
      expect(c.filters['month'], isEmpty);
      await pumpEventQueue();
      c.dispose();
    });
  });

  group('cross-filtering', () {
    test('rowsFor(dim) leaves that dimension unfiltered, rowsFor(null) applies everything', () async {
      final api = FakeApi.install();
      installDashboardApi(api);
      final c = make();
      await c.load();
      c.toggle('machine', 'm1');
      c.toggle('operator', 'Asha');

      expect(c.filtered.map((r) => r['_id']), ['e1']);
      // The machine chart still sees every machine of the picked operator...
      expect(c.rowsFor('machine').map((r) => r['_id']), ['e1', 'e3']);
      // ...the operator chart every operator of the picked machine...
      expect(c.rowsFor('operator').map((r) => r['_id']), ['e1', 'e2']);
      // ...and a dimension with no pick is simply the filtered rows.
      expect(c.rowsFor('item').map((r) => r['_id']), ['e1']);
      expect(c.summary['totalQty'], 700);

      c.toggle('machine', 'm1'); // toggling again removes it
      expect(c.filters['machine'], isEmpty);
      expect(c.filtered.map((r) => r['_id']), ['e1', 'e3']);
      c.dispose();
    });

    test('setFilter replaces, clearAll resets picks and period', () async {
      final api = FakeApi.install();
      installDashboardApi(api);
      final c = make();
      await c.load();
      c.setFilter('machine', ['m1', 'm2']);
      expect(c.activeFilterCount, 2);
      c.setFilter('machine', ['m2']);
      expect(c.filters['machine'], ['m2']);
      c.setRange(['2026-09-09', '2026-09-15']);
      await pumpEventQueue();

      c.clearAll();
      await pumpEventQueue();
      expect(c.activeFilterCount, 0);
      expect(c.hasActiveFilters, isFalse);
      expect(c.range, ['2026-09-01', '2026-09-30']);
      expect(c.filtersActive, isFalse);
      c.dispose();
    });

    test('active chips carry the dimension label and readable value', () async {
      final api = FakeApi.install();
      installDashboardApi(api);
      final c = make();
      await c.load();
      c.toggle('machine', 'm2');
      c.toggle('operator', '');
      expect(c.activeFilters.map((f) => f.label), ['Machine: 7B', 'Operator: (no operator)']);
      c.dispose();
    });
  });

  group('filter options', () {
    test('come from the loaded rows plus current picks; machines in sheet order', () async {
      final api = FakeApi.install();
      installDashboardApi(api, entries: (_) => {
            'isOk': true,
            'data': [
              entryFixture('a', machine: 'm2', operator: 'Zed'),
              entryFixture('b', machine: 'm1', operator: 'Asha'),
              entryFixture('c', machine: 'm9', operator: '', itemName: ''), // deactivated machine, no operator / part
            ],
            'extent': null,
            'machineNames': {'m9': 'Old 12'},
          });
      final c = make();
      await c.load();
      c.setFilter('operator', ['Ghost']); // a pick that no loaded row has

      final o = c.filterOptions;
      expect(o['machine']!.map((m) => m['label']), ['7A', '7B', 'Old 12']);
      expect(o['operator']!.map((m) => m['label']), ['(no operator)', 'Asha', 'Ghost', 'Zed']);
      expect(o['item']!.map((m) => m['label']), contains('(no part)'));
      expect(o['operator']!.firstWhere((m) => m['label'] == '(no operator)')['value'], '');
      c.dispose();
    });

    test('long periods bucket the trend axis by month', () async {
      final api = FakeApi.install();
      installDashboardApi(api, entries: (_) => {
            'isOk': true,
            'data': [
              for (var i = 0; i < 70; i++) entryFixture('r$i', date: eng.isoDate(DateTime(2026, 1, 1).add(Duration(days: i)))),
            ],
            'extent': null,
            'machineNames': <String, String>{},
          });
      final c = make();
      await c.load();
      expect(c.ctx.bucket, 'month');
      c.dispose();
    });
  });
}
