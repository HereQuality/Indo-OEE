import 'package:indo/features/production/dashboard/dashboard_engine.dart' as eng;

import '../support/fake_api.dart';

/// "Today" for every dashboard test: 15 Sep 2026, so the default period is
/// September 2026 and the quick ranges are deterministic.
void pinDashboardClock() => eng.engineClock = () => DateTime(2026, 9, 15, 10, 30);
void unpinDashboardClock() => eng.engineClock = DateTime.now;

const processVmc = 'p1';
const processPress = 'p2';

Map<String, dynamic> machineJson(String id, String name, {String? process, int? sequence}) => {
      '_id': id,
      'machineName': name,
      'isActive': true,
      'process': process,
      'sequence': ?sequence,
    };

List<Map<String, dynamic>> machinesFixture() => [
      machineJson('m1', '7A', process: processVmc),
      machineJson('m2', '7B', process: processVmc),
      machineJson('m3', 'P1', process: processPress),
      machineJson('m4', '9C'), // in no process
    ];

List<Map<String, dynamic>> processesFixture({Object? vmcStats, Object? vmcCharts}) => [
      {
        '_id': processVmc,
        'processName': 'VMC',
        'stats': ?vmcStats as List?,
        'charts': ?vmcCharts as List?,
        'machines': [machineJson('m1', '7A', process: processVmc), machineJson('m2', '7B', process: processVmc)],
      },
      {
        '_id': processPress,
        'processName': 'PRESS',
        'machines': [machineJson('m3', 'P1', process: processPress)],
      },
    ];

/// One production entry as GET /processes/entries returns it (ints stay ints —
/// the shell widens them).
Map<String, dynamic> entryFixture(
  String id, {
  String date = '2026-09-01',
  String machine = 'm1',
  String operator = 'Asha',
  String item = 'i1',
  String itemName = 'Bracket',
  int cycle = 36,
  int actual = 700,
  int ok = 690,
  Map<String, dynamic>? reject,
  int lunch = 30,
  int setup = 10,
}) =>
    {
      '_id': id,
      'date': date,
      'machine': machine,
      'slot': 1,
      'operator': operator,
      'item': item,
      'itemName': itemName,
      'totalCycleSec': cycle,
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': actual,
      'okQty': ok,
      'rejectedQty': actual - ok,
      'rejectBreakdown': reject ?? {'Dimension Out': actual - ok},
      'plannedOperatorShiftHours': 8,
      'lunchMin': lunch,
      'setupMin': setup,
    };

/// Total 1700 / OK 1670 / Rejected 30 across two machines, two operators, two parts.
List<Map<String, dynamic>> entriesFixture() => [
      entryFixture('e1'),
      entryFixture('e2', date: '2026-09-02', operator: 'Ravi', actual: 600, ok: 600, reject: {}),
      entryFixture('e3', date: '2026-09-02', machine: 'm2', item: 'i2', itemName: 'Flange', cycle: 60, actual: 400, ok: 380),
    ];

/// Registers the backend routes the dashboard uses. [entries] answers
/// `GET /processes/entries` (a function so a test can vary it per request).
void installDashboardApi(
  FakeApi api, {
  List<Map<String, dynamic>>? processes,
  List<Map<String, dynamic>>? machines,
  Object? Function(FakeRequest req)? entries,
}) {
  api.on('GET', '/api/v1/processes', (_) => {'isOk': true, 'data': processes ?? processesFixture()});
  api.on('GET', '/api/v1/machines', (_) => {'isOk': true, 'data': machines ?? machinesFixture()});
  api.on(
    'GET',
    '/api/v1/processes/entries',
    entries ??
        (_) => {
              'isOk': true,
              'data': entriesFixture(),
              'extent': {'from': '2026-01-05', 'to': '2026-09-14'},
              'machineNames': {'m1': '7A', 'm2': '7B'},
            },
  );
  api.on('PUT', '/api/v1/processes/$processVmc', (r) => {'isOk': true, 'data': r.body});
}
