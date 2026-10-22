import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart' as eng;
import 'package:indo/features/production/process_master/process_master_logic.dart';
import 'package:indo/features/production/process_master_screen.dart';
import 'package:indo/models/menu_models.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../support/fake_api.dart';
import '../calc/golden_support.dart';

const _dir = 'test/production/process_master/fixtures';

void main() {
  group('golden parity with ProcessMaster.jsx', () {
    test('validate', () {
      final cases = loadFixture('validate.json', dir: _dir) as List;
      expect(cases.length, greaterThan(300));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final v = Map<String, dynamic>.from(c['values'] as Map);
        expect(diff(validateProcess(v), c['errors']), isNull, reason: 'case $i $v');
      }
    });

    test('payload', () {
      final cases = loadFixture('payload.json', dir: _dir) as List;
      expect(cases.length, greaterThan(200));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final got = processPayload(Map<String, dynamic>.from(c['values'] as Map));
        final want = c['payload'] as Map;
        expect(diff(got, want), isNull, reason: 'case $i ${c['values']}');
      }
    });

    test('openEdit mapping, dashboard summary, planned shift text', () {
      final cases = loadFixture('state.json', dir: _dir) as List;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final p = Map<String, dynamic>.from(c['process'] as Map);
        final got = valuesFromProcess(p);
        final want = Map<String, dynamic>.from(c['values'] as Map);
        // The box text holds the hours as typed; the web keeps the number.
        expect(num.parse('${got['plannedShiftHours']}'), want['plannedShiftHours'], reason: 'hours case $i');
        got.remove('plannedShiftHours');
        want.remove('plannedShiftHours');
        expect(diff(got, want), isNull, reason: 'case $i $p');
        expect(dashboardSummary(p), c['dashboard'], reason: 'dashboard case $i');
        expect(plannedShiftText(p), c['shift'], reason: 'shift case $i');
      }
    });

    test('machine picker choices', () {
      final cases = loadFixture('machines.json', dir: _dir) as List;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final machines = [for (final m in c['machines'] as List) Map<String, dynamic>.from(m as Map)];
        final active = [for (final m in c['active'] as List) Map<String, dynamic>.from(m as Map)];
        final got = [for (final m in machineChoices(machines, active, c['here'] as String)) m['_id']];
        expect(got, c['ids'], reason: 'case $i');
      }
    });

    test('the defaults are the dashboard defaults', () {
      final d = loadFixture('defaults.json', dir: _dir) as Map;
      expect(initialProcessValues()['stats'], d['stats']);
      expect(initialProcessValues()['charts'], d['charts']);
      expect(eng.defaultStats, d['stats']);
    });
  });

  group('screen', () {
    const machines = [
      {'_id': 'm1', 'machineName': 'Free Machine'},
      {'_id': 'm2', 'machineName': 'Taken Machine', 'process': 'p9'},
      {'_id': 'm3', 'machineName': 'Own Machine', 'process': 'p1'},
      {'_id': 'm4', 'machineName': 'Orphan Machine', 'process': 'pGone'},
    ];
    Map<String, dynamic> p1() => {
          '_id': 'p1',
          'processName': 'VMC',
          'description': 'Vertical',
          'isActive': true,
          'machines': [
            {'_id': 'm3', 'machineName': 'Own Machine'},
          ],
          'stats': ['totalQty', 'okQty'],
          'charts': ['oeeTrend'],
          'dataEntryMenu': '/hqepl/production/vmc-data-entry',
          'dataEntryMenuLabel': 'VMC Data Entry',
          'plannedShiftLocked': true,
          'plannedShiftHours': 7.5,
        };

    FakeApi backend({bool canReview = true}) {
      SharedPreferences.setMockInitialValues({});
      final api = FakeApi.install();
      api.on('POST', '/api/v1/processes/search', (_) => {
            'isOk': true,
            'data': [
              {
                'count': 2,
                'data': [
                  p1(),
                  {'_id': 'p2', 'processName': 'PRESS', 'isActive': false, 'machines': <Object>[], 'plannedShiftLocked': false},
                ],
              },
            ],
          });
      api.on('GET', '/api/v1/oee-review/access', (_) => {'isOk': true, 'data': {'canReview': canReview}});
      api.list('/api/v1/machines', machines);
      api.list('/api/v1/processes', [
        {'_id': 'p1'},
        {'_id': 'p9'},
      ]);
      api.on('GET', '/api/v1/processes/p1', (_) => {'isOk': true, 'data': p1()});
      api.list('/api/v1/menu-groups', [
        {'menuGroupName': 'CNC Data Entry', 'menuUrl': '/hqepl/production/cnc-data-entry', 'isActive': true, 'isLink': true},
        {'menuGroupName': 'Not a link', 'menuUrl': '/x', 'isActive': true, 'isLink': false},
      ]);
      api.list('/api/v1/menus', [
        {'menuName': 'VMC Data Entry', 'menuUrl': '/hqepl/production/vmc-data-entry', 'isActive': true},
        {'menuName': 'Off', 'menuUrl': '/off', 'isActive': false},
      ]);
      return api;
    }

    testWidgets('Super Admin sees machines, dashboard, linked page and planned shift; edit/delete per permissions', (t) async {
      backend();
      await pumpScreen(t, const ProcessMasterScreen());
      expect(find.text('VMC'), findsOneWidget);
      expect(find.text('Own Machine'), findsOneWidget);
      expect(find.text('2 KPI tiles · 1 graphs'), findsOneWidget);
      expect(find.text('VMC Data Entry'), findsOneWidget);
      expect(find.text('Locked · 7.5 hr'), findsOneWidget);
      expect(find.text('Unlocked · manual'), findsOneWidget);
      expect(find.text('None assigned'), findsOneWidget);
      expect(find.text('Inactive'), findsOneWidget);
      expect(find.byKey(const ValueKey('process/edit/p1')), findsOneWidget);
      expect(find.byKey(const ValueKey('process/add')), findsOneWidget);
    });

    testWidgets('a non-admin sees neither the Dashboard nor the Data Entry Page rows, and only the permitted buttons', (t) async {
      backend();
      await pumpScreen(
        t,
        const ProcessMasterScreen(),
        user: testUser(superAdmin: false),
        perms: const PagePerms(view: true, edit: true),
      );
      expect(find.text('VMC'), findsOneWidget);
      expect(find.text('Dashboard'), findsNothing);
      expect(find.text('Data Entry Page'), findsNothing);
      expect(find.text('Planned Shift'), findsWidgets);
      expect(find.byKey(const ValueKey('process/edit/p1')), findsOneWidget);
      expect(find.byKey(const ValueKey('process/delete/p1')), findsNothing);
      expect(find.byKey(const ValueKey('process/add')), findsNothing);
    });

    testWidgets('search and "Active only" go to the server like the web', (t) async {
      final api = backend();
      await pumpScreen(t, const ProcessMasterScreen());
      var body = api.called('POST', '/api/v1/processes/search').last.body as Map;
      expect(body['isActive'], true);
      expect(body['per_page'], 100);
      await t.enterText(find.byKey(const ValueKey('process/search')), 'pre');
      await t.pump(const Duration(milliseconds: 500));
      await t.pumpAndSettle();
      body = api.called('POST', '/api/v1/processes/search').last.body as Map;
      expect(body['match'], 'pre');
      await t.tap(find.byKey(const ValueKey('process/active-only')));
      await t.pumpAndSettle();
      body = api.called('POST', '/api/v1/processes/search').last.body as Map;
      expect(body['isActive'], false);
    });

    testWidgets('Add: the web messages show after Save; only free machines are offered; POSTs the web payload', (t) async {
      final api = backend();
      api.on('POST', '/api/v1/processes', (r) => {'isOk': true, 'data': r.body, 'message': 'Process created successfully'});
      await pumpScreen(t, const ProcessMasterScreen());
      await t.tap(find.byKey(const ValueKey('process/add')));
      await t.pumpAndSettle();
      expect(find.text('Add Process'), findsOneWidget);
      await t.tap(find.byKey(const ValueKey('process/save')));
      await t.pumpAndSettle();
      expect(find.text('Process name is required!'), findsOneWidget);

      await t.enterText(find.byKey(const ValueKey('process/name')), '  Traub  ');
      await t.pump();
      await t.tap(find.byKey(const ValueKey('process/machines')));
      await t.pumpAndSettle();
      expect(find.text('Free Machine'), findsOneWidget);
      expect(find.text('Orphan Machine'), findsOneWidget); // its process is gone, so it counts as free
      expect(find.text('Taken Machine'), findsNothing); // in another active process
      expect(find.text('Own Machine'), findsNothing); // belongs to p1, and we are adding
      await t.tap(find.byKey(const ValueKey('multi-picker/m1')));
      await t.tap(find.byKey(const ValueKey('multi-picker/done')));
      await t.pumpAndSettle();
      expect(find.text('Free Machine'), findsOneWidget);

      await t.tap(find.byKey(const ValueKey('process/save')));
      await t.pumpAndSettle();
      final sent = api.called('POST', '/api/v1/processes').single.body as Map;
      expect(sent['processName'], 'Traub');
      expect(sent['machineIds'], ['m1']);
      expect(sent['plannedShiftLocked'], true);
      expect(sent['plannedShiftHours'], 12);
      expect(sent['stats'], eng.defaultStats);
      expect(sent['charts'], eng.defaultCharts);
      expect(sent['isActive'], true);
      expect(sent['dataEntryMenu'], '');
      expect(find.text('Add Process'), findsNothing); // back on the list
    });

    testWidgets('planned shift hours are checked (more than 0, at most 24) and the 8 / 12 / 24 presets fill the box', (t) async {
      final api = backend();
      api.on('POST', '/api/v1/processes', (r) => {'isOk': true, 'data': r.body});
      await pumpScreen(t, const ProcessMasterScreen());
      await t.tap(find.byKey(const ValueKey('process/add')));
      await t.pumpAndSettle();
      await t.enterText(find.byKey(const ValueKey('process/name')), 'A');
      await t.ensureVisible(find.byKey(const ValueKey('process/shift-hours')));
      await t.enterText(find.byKey(const ValueKey('process/shift-hours')), '25');
      await t.tap(find.byKey(const ValueKey('process/save')));
      await t.pumpAndSettle();
      expect(find.text('Shift hours must be more than 0 and at most 24'), findsOneWidget);
      await t.ensureVisible(find.byKey(const ValueKey('process/shift-8')));
      await t.tap(find.byKey(const ValueKey('process/shift-8')));
      await t.pumpAndSettle();
      expect(find.text('Shift hours must be more than 0 and at most 24'), findsNothing);
      await t.tap(find.byKey(const ValueKey('process/save')));
      await t.pumpAndSettle();
      expect((api.called('POST', '/api/v1/processes').single.body as Map)['plannedShiftHours'], 8);
    });

    testWidgets('Edit loads the process, keeps its own machine selectable, links a page (admin) and PUTs', (t) async {
      final api = backend();
      api.on('PUT', '/api/v1/processes/p1', (r) => {'isOk': true, 'data': r.body});
      await pumpScreen(t, const ProcessMasterScreen());
      await t.tap(find.byKey(const ValueKey('process/edit/p1')));
      await t.pumpAndSettle();
      expect(find.text('Update Process'), findsOneWidget);
      expect(t.widget<TextField>(find.descendant(of: find.byKey(const ValueKey('process/name')), matching: find.byType(TextField))).controller!.text, 'VMC');
      expect(find.text('Own Machine'), findsOneWidget);
      expect(find.text('VMC Data Entry'), findsOneWidget);
      await t.scrollUntilVisible(find.byKey(const ValueKey('process/dashboard-summary')), 200, scrollable: find.byType(Scrollable).first);
      expect(find.text('2 KPI tiles · 1 graphs'), findsOneWidget);
      await t.scrollUntilVisible(find.byKey(const ValueKey('process/machines')), -200, scrollable: find.byType(Scrollable).first);

      await t.tap(find.byKey(const ValueKey('process/machines')));
      await t.pumpAndSettle();
      expect(find.text('Own Machine'), findsNWidgets(2)); // the field's chip and the sheet's row
      await t.tap(find.byKey(const ValueKey('multi-picker/m1')));
      await t.tap(find.byKey(const ValueKey('multi-picker/done')));
      await t.pumpAndSettle();

      await t.ensureVisible(find.byKey(const ValueKey('process/menu')));
      await t.tap(find.byKey(const ValueKey('process/menu')));
      await t.pumpAndSettle();
      expect(find.text('CNC Data Entry'), findsOneWidget);
      expect(find.text('Not a link'), findsNothing);
      expect(find.text('Off'), findsNothing);
      await t.tap(find.text('CNC Data Entry'));
      await t.pumpAndSettle();

      await t.tap(find.byKey(const ValueKey('process/save')));
      await t.pumpAndSettle();
      final sent = api.called('PUT', '/api/v1/processes/p1').single.body as Map;
      expect(sent['machineIds'], ['m1', 'm3']);
      expect(sent['dataEntryMenu'], '/hqepl/production/cnc-data-entry');
      expect(sent['dataEntryMenuLabel'], 'CNC Data Entry');
      expect(sent['plannedShiftHours'], 7.5);
      expect(sent['stats'], ['totalQty', 'okQty']);
    });

    testWidgets('without review access the planned shift is read-only (badge), and a non-admin cannot pick the page or the dashboard', (t) async {
      backend(canReview: false);
      await pumpScreen(t, const ProcessMasterScreen(), user: testUser(superAdmin: false), perms: PagePerms.all);
      await t.tap(find.byKey(const ValueKey('process/edit/p1')));
      await t.pumpAndSettle();
      await t.ensureVisible(find.byKey(const ValueKey('process/shift')));
      expect(find.byKey(const ValueKey('process/shift-lock')), findsNothing);
      expect(find.byKey(const ValueKey('process/shift-hours')), findsNothing);
      expect(find.text('Locked · 7.5 hr'), findsOneWidget);
      expect(find.textContaining('Only Admin or Super Admin can change this.'), findsOneWidget);
      expect(find.byKey(const ValueKey('process/menu')), findsNothing);
      expect(find.byKey(const ValueKey('process/menu-readonly')), findsOneWidget);
      expect(find.byKey(const ValueKey('process/dashboard')), findsNothing);
    });

    testWidgets('Remove asks first, then DELETEs and reloads', (t) async {
      final api = backend();
      api.on('DELETE', '/api/v1/processes/p1', (_) => {'isOk': true, 'message': 'Process deactivated successfully'});
      await pumpScreen(t, const ProcessMasterScreen());
      await t.tap(find.byKey(const ValueKey('process/delete/p1')));
      await t.pumpAndSettle();
      expect(find.text('Are you sure?'), findsOneWidget);
      await t.tap(find.text('Close'));
      await t.pumpAndSettle();
      expect(api.called('DELETE', '/api/v1/processes/p1'), isEmpty);
      await t.tap(find.byKey(const ValueKey('process/delete/p1')));
      await t.pumpAndSettle();
      await t.tap(find.text('Yes, Delete It!'));
      await t.pumpAndSettle();
      expect(api.called('DELETE', '/api/v1/processes/p1'), hasLength(1));
      expect(api.called('POST', '/api/v1/processes/search').length, 2); // reloaded
    });
  });
}
