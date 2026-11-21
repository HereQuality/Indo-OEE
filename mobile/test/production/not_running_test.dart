import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/features/production/sheet/machine_day_status.dart';
import 'package:indo/features/production/sheet/sheet_model.dart';
import 'package:indo/features/production/production_sheet_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';
import 'sheet_list_test.dart' show byKey, install, open, row, today, yesterday;
import 'sheet_table_test.dart' show tapA;

const reasons = [
  {'value': 'holiday', 'label': 'Holiday', 'kind': 'planned'},
  {'value': 'noOrder', 'label': 'No order', 'kind': 'planned'},
  {'value': 'breakdown', 'label': 'Breakdown', 'kind': 'unplanned'},
  {'value': 'other', 'label': 'Other', 'kind': 'unplanned'},
];

Map<String, dynamic> mark(String date, String machine, {List<String> rs = const ['breakdown'], String label = 'Breakdown', String kind = 'unplanned', String remarks = 'Spindle motor burnt'}) => {
      'sheet': 'cnc',
      'date': date,
      'machine': machine,
      'reason': rs.first,
      'reasons': rs,
      'reasonLabel': label,
      'kind': kind,
      'remarks': remarks,
      'markedBy': {'name': 'Mann'},
      'updatedAt': '${date}T10:00:00.000Z',
    };

/// Today: 7A has an entry, 7B none. Yesterday: nothing (7A and 7B unfilled).
FakeApi setup({List<Map<String, dynamic>> marks = const []}) {
  final api = install(pages: {1: [row('r1')]}, dates: [today, yesterday]);
  api.list(Endpoints.machineDayStatusReasons, reasons);
  api.on('GET', Endpoints.machineDayStatus, (_) => {'isOk': true, 'data': marks});
  return api;
}

Future<void> tapK(WidgetTester tester, String key) async {
  // A lazy list builds a card only near the screen: scroll down to it.
  for (var i = 0; i < 20 && byKey(key).evaluate().isEmpty; i++) {
    await tester.drag(find.byKey(const ValueKey('sheet-list')), const Offset(0, -250));
    await tester.pumpAndSettle();
  }
  await tester.ensureVisible(byKey(key));
  await tester.pumpAndSettle();
  await tester.tap(byKey(key));
  await tester.pumpAndSettle();
}

void main() {
  group('cards', () {
    setUp(() => SharedPreferences.setMockInitialValues({'sheet_view_mode': 'cards'}));

    testWidgets('a marked placeholder reads "Not running · reason" with remarks, who and Undo', (tester) async {
      final api = setup(marks: [mark(yesterday, 'm1')]);
      await open(tester);
      final get = api.called('GET', Endpoints.machineDayStatus).last;
      expect(get.query['sheet'], 'cnc');
      expect(get.query['from'], yesterday);
      expect(get.query['to'], today);

      expect(byKey('notrunning-label-$yesterday|m1'), findsOneWidget);
      expect(find.text('Not running · Breakdown'), findsOneWidget);
      expect(find.text('Unplanned'), findsOneWidget);
      expect(find.text('Spindle motor burnt'), findsOneWidget);
      expect(find.text('Marked by Mann'), findsOneWidget);
      expect(byKey('placeholder-$yesterday|m1'), findsNothing);
      expect(byKey('notrunning-$yesterday|m2'), findsOneWidget);

      api.on('DELETE', Endpoints.machineDayStatus, (_) => {'isOk': true});
      api.on('GET', Endpoints.machineDayStatus, (_) => {'isOk': true, 'data': []});
      await tapK(tester, 'nr-undo-$yesterday|m1');
      final del = api.called('DELETE', Endpoints.machineDayStatus).single;
      expect(del.body, {'sheet': 'cnc', 'date': yesterday, 'machine': 'm1'});
      expect(byKey('placeholder-$yesterday|m1'), findsOneWidget);
      expect(api.misses, isEmpty);
    });

    testWidgets('a mark past the day it was saved is locked: no Edit or Undo', (tester) async {
      setup(marks: [{...mark(yesterday, 'm1'), 'locked': true}]);
      // An operator without Full access: locked.
      await pumpScreen(tester, const ProductionSheetScreen(), user: testUser(superAdmin: false));
      expect(byKey('notrunning-label-$yesterday|m1'), findsOneWidget);
      expect(byKey('nr-locked-$yesterday|m1'), findsOneWidget);
      expect(byKey('nr-edit-$yesterday|m1'), findsNothing);
      expect(byKey('nr-undo-$yesterday|m1'), findsNothing);
    });

    testWidgets('an Admin can still edit a locked mark', (tester) async {
      setup(marks: [{...mark(yesterday, 'm1'), 'locked': true}]);
      await open(tester); // Super Admin
      expect(byKey('nr-locked-$yesterday|m1'), findsNothing);
      expect(byKey('nr-edit-$yesterday|m1'), findsOneWidget);
    });

    testWidgets('multi reasons auto-fill remarks; picked machines are sent', (tester) async {
      final api = setup();
      Map<String, dynamic>? body;
      api.on('PUT', Endpoints.machineDayStatus, (r) {
        body = Map<String, dynamic>.from(r.body as Map);
        return {'isOk': true, 'message': 'Saved'};
      });
      await open(tester);
      await tapK(tester, 'notrunning-$yesterday|m1');
      expect(byKey('not-running-dialog'), findsOneWidget);

      await tapK(tester, 'nr-reason-breakdown');
      TextField field() => tester.widget<TextField>(find.descendant(of: byKey('nr-remarks'), matching: find.byType(TextField)));
      expect(field().controller!.text, 'Breakdown');
      await tester.enterText(find.descendant(of: byKey('nr-remarks'), matching: find.byType(TextField)), 'Breakdown — belt snapped');
      await tester.pump();
      await tapK(tester, 'nr-reason-holiday');
      expect(field().controller!.text, 'Holiday, Breakdown — belt snapped');

      // Only 7B is another unfilled machine that day.
      expect(byKey('nr-machine-m2'), findsOneWidget);
      expect(byKey('nr-machine-m1'), findsNothing);
      await tapK(tester, 'nr-select-all');
      expect(find.text('Clear'), findsOneWidget);

      await tapK(tester, 'nr-save');
      expect(body, isNotNull);
      expect(body!['sheet'], 'cnc');
      expect(body!['date'], yesterday);
      expect(body!['machines'], ['m1', 'm2']);
      expect(body!['reasons'], ['holiday', 'breakdown']);
      expect(body!['remarks'], 'Holiday, Breakdown — belt snapped');
      expect(byKey('not-running-dialog'), findsNothing);
    });

    testWidgets('Other without remarks is blocked; a server error is shown', (tester) async {
      final api = setup();
      api.on('PUT', Endpoints.machineDayStatus, (_) => throw StateError('no'));
      await open(tester);
      await tapK(tester, 'notrunning-$yesterday|m2');
      await tapK(tester, 'nr-save');
      expect(find.text('Pick a reason or write a description.'), findsOneWidget);
      expect(api.called('PUT', Endpoints.machineDayStatus), isEmpty);

      await tapK(tester, 'nr-reason-other');
      // The auto text is a remark; clearing it leaves nothing typed.
      await tester.enterText(find.descendant(of: byKey('nr-remarks'), matching: find.byType(TextField)), '');
      await tester.pump();
      await tapK(tester, 'nr-save');
      expect(byKey('nr-remarks-error'), findsOneWidget);
      expect(api.called('PUT', Endpoints.machineDayStatus), isEmpty);

      api.on('PUT', Endpoints.machineDayStatus, (_) => FakeResponse({'isOk': false, 'message': 'Future dates cannot be marked'}, status: 400));
      await tester.enterText(find.descendant(of: byKey('nr-remarks'), matching: find.byType(TextField)), 'Shifted to job work');
      await tester.pump();
      await tapK(tester, 'nr-save');
      expect(api.called('PUT', Endpoints.machineDayStatus), hasLength(1));
      expect(find.text('Future dates cannot be marked'), findsOneWidget);
      expect(byKey('not-running-dialog'), findsOneWidget);
    });

    testWidgets('phone 360 at 1.6x text: cards and dialog do not overflow', (tester) async {
      setup(marks: [mark(yesterday, 'm1', remarks: 'A long remark ' * 10)]);
      await open(tester, size: const Size(360, 780), textScale: 1.6);
      expect(tester.takeException(), isNull);
      await tapK(tester, 'notrunning-$yesterday|m2');
      await tapK(tester, 'nr-reason-breakdown');
      expect(tester.takeException(), isNull);
    });
  });

  testWidgets('a description with no reason saves as Other', (tester) async {
    SharedPreferences.setMockInitialValues({'sheet_view_mode': 'cards'});
    final api = setup();
    Map<String, dynamic>? body;
    api.on('PUT', Endpoints.machineDayStatus, (r) {
      body = Map<String, dynamic>.from(r.body as Map);
      return {'isOk': true};
    });
    await open(tester);
    await tapK(tester, 'notrunning-$yesterday|m2');
    await tester.enterText(find.descendant(of: byKey('nr-remarks'), matching: find.byType(TextField)), 'Shifted to job work');
    await tester.pump();
    await tapK(tester, 'nr-save');
    expect(body!['reasons'], ['other']);
    expect(body!['remarks'], 'Shifted to job work');
  });

  group('table', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    testWidgets('tablet 1024: marked row, Not running and Edit with no overflow', (tester) async {
      final api = setup(marks: [mark(yesterday, 'm1', rs: const ['holiday'], label: 'Holiday', kind: 'planned')]);
      await open(tester, size: const Size(1024, 768));
      expect(tester.takeException(), isNull);
      expect(byKey('notrunning-label-ph|$yesterday|m1'), findsOneWidget);
      expect(find.textContaining('Holiday', findRichText: true), findsWidgets);
      expect(byKey('nr-chip-ph|$yesterday|m1'), findsOneWidget);
      // The Status column sits right after Machine.
      expect(tester.getTopLeft(byKey('head-status')).dx, greaterThan(tester.getTopLeft(byKey('head-machine')).dx));
      expect(tester.getTopLeft(byKey('nr-edit-ph|$yesterday|m1')).dx, greaterThan(tester.getTopLeft(byKey('head-machine')).dx));

      await tapA(tester, 'nr-edit-ph|$yesterday|m1');
      expect(byKey('not-running-dialog'), findsOneWidget);
      expect(byKey('nr-machine-m2'), findsNothing); // editing one mark
      expect(tester.takeException(), isNull);
      await tapK(tester, 'nr-cancel');

      await tapA(tester, 'notrunning-ph|$yesterday|m2');
      expect(byKey('not-running-dialog'), findsOneWidget);
      expect(tester.takeException(), isNull);
      expect(api.misses, isEmpty);
    });

    testWidgets('phone 360 at 1.6x text: table placeholder actions fit', (tester) async {
      setup(marks: [mark(yesterday, 'm1')]);
      await open(tester, size: const Size(360, 780), textScale: 1.6);
      expect(tester.takeException(), isNull);
      expect(byKey('notrunning-ph|$yesterday|m2'), findsOneWidget);
      expect(byKey('nr-undo-ph|$yesterday|m1'), findsOneWidget);
    });
  });

  test('sheet keys, remarks auto text and worker day placeholders', () {
    expect(dayStatusSheetKey('final-assembly'), 'finalAssembly');
    expect(dayStatusSheetKey('powder-coating'), 'powder');
    expect(dayStatusSheetKey('raw-casting'), 'rawCasting');
    expect(dayStatusSheetKey('cnc'), 'cnc');

    expect(autoRemarks('', [], ['Breakdown']), 'Breakdown');
    expect(autoRemarks('typed', [], ['Breakdown']), 'Breakdown — typed');
    expect(autoRemarks('Breakdown — typed', ['Breakdown'], ['Breakdown', 'Other']), 'Breakdown, Other — typed');
    expect(autoRemarks('Breakdown', ['Breakdown'], []), '');
    expect(autoRemarks('changed it', ['Breakdown'], ['Holiday']), 'Holiday — changed it');

    final m = DayMark.fromJson({'date': '2026-11-02T00:00:00Z', 'machine': '', 'reason': 'holiday', 'reasonLabel': 'Holiday', 'markedBy': 'Asha'});
    expect(m.reasons, ['holiday']);
    expect(m.date, '2026-11-02');
    expect(m.markedBy, 'Asha');

    final days = buildSheetDays(
      rows: const [],
      filters: SheetFilters.empty,
      search: '',
      machineName: const {},
      rankOf: (_) => 0,
      dates: const ['2026-11-02'],
      dayPlaceholder: true,
    );
    expect(days.single.machines.single.machineId, '');
  });
}
