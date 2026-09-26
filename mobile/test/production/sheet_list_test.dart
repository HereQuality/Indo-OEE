import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/features/production/production_sheet_screen.dart';
import 'package:indo/features/production/shared/production_sheet_calc.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:indo/features/production/sheet/sheet_controller.dart';
import 'package:indo/features/production/sheet/sheet_model.dart';
import 'package:indo/features/production/sheet/sheet_period.dart';
import 'package:indo/features/production/sheet/widgets/sheet_format.dart';
import 'package:indo/models/menu_models.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';

final String today = isoDate(DateTime.now());
final String yesterday = isoDate(DateTime.now().subtract(const Duration(days: 1)));
const String oldDay = '2025-01-06';

Map<String, dynamic> row(
  String id, {
  String? date,
  String machine = 'm1',
  int slot = 1,
  String operator = 'Ravi',
  String part = 'Bracket',
  Map<String, dynamic> extra = const {},
}) =>
    {
      '_id': id,
      'date': '${date ?? today}T00:00:00.000Z',
      'machine': machine,
      'slot': slot,
      'item': 'i1',
      'operator': operator,
      'itemName': part,
      'drawingNo': 'D-100',
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': 400,
      'okQty': 390,
      'rejectedQty': 10,
      'rejectBreakdown': {'Tool Mark': 6, 'Dimension Out': 4},
      'plannedOperatorShiftHours': 9,
      'totalCycleSec': 60,
      'lunchMin': 30,
      'setupMin': 10,
      ...extra,
    };

/// Every route the screen calls. [pages] maps a page number to its rows;
/// [totalPages] is what meta reports.
FakeApi install({Map<int, List<Map<String, dynamic>>>? pages, int totalPages = 1}) {
  final api = FakeApi.install();
  final data = pages ?? {1: [row('r1'), row('r2', machine: 'm2', operator: 'Asha')]};
  api.on('GET', Endpoints.productionSheet, (r) {
    final p = int.tryParse('${r.query['page']}') ?? 1;
    return {
      'isOk': true,
      'data': data[p] ?? const [],
      'meta': {'page': p, 'totalPages': totalPages, 'totalDays': totalPages * 2},
    };
  });
  api.list(Endpoints.machines, [
    {'_id': 'm1', 'machineName': '7A'},
    {'_id': 'm2', 'machineName': '7B'},
  ]);
  api.list(Endpoints.items, [
    {'_id': 'i1', 'itemName': 'Bracket', 'drawingNo': 'D-100'},
  ]);
  api.list(Endpoints.machineOperators, [
    {'_id': 'o1', 'name': 'Ravi'},
    {'_id': 'o2', 'name': 'Asha'},
  ]);
  api.list(Endpoints.processes, []);
  api.list(Endpoints.companyHolidays, []);
  api.on('GET', Endpoints.weeklyOff, (_) => {'isOk': true, 'data': {'weeklyOffDays': [0]}});
  api.on('GET', Endpoints.productionSheetExtent, (_) => {'isOk': true, 'data': {'from': '2025-01-01', 'to': today}});
  api.on('GET', Endpoints.productionSheetFilterOptions, (_) => {
        'isOk': true,
        'data': {
          'machine': ['m1', 'm2'],
          'operator': ['Ravi', 'Asha'],
          'item': ['Bracket'],
        },
      });
  return api;
}

Iterable<FakeRequest> sheetGets(FakeApi api) => api.called('GET', Endpoints.productionSheet);

Finder byKey(String k) => find.byKey(ValueKey(k));

Future<void> open(WidgetTester tester, {PagePerms perms = PagePerms.all, Size size = const Size(390, 844), bool dark = false, double textScale = 1}) =>
    pumpScreen(tester, const ProductionSheetScreen(), perms: perms, size: size, dark: dark, textScale: textScale);

Future<void> tapKey(WidgetTester tester, String key) async {
  await tester.ensureVisible(byKey(key));
  await tester.pump();
  await tester.tap(byKey(key));
  await tester.pumpAndSettle();
}

void main() {
  // These tests cover the card view; the table is the default, so ask for cards.
  setUp(() => SharedPreferences.setMockInitialValues({'sheet_view_mode': 'cards'}));

  testWidgets('loads the first page of dates and draws one card per machine-day', (tester) async {
    final api = install();
    await open(tester);

    final first = sheetGets(api).first;
    expect(first.query['page'], '1');
    expect(first.query['from'], defaultEntryRange()[0]);
    expect(first.query['to'], defaultEntryRange()[1]);
    expect(first.query.containsKey('machine'), isFalse);

    expect(find.text('7A'), findsWidgets);
    expect(find.text('7B'), findsWidgets);
    expect(find.text('Ravi'), findsOneWidget);
    expect(find.text('Asha'), findsOneWidget);
    expect(find.text(longDay(today)), findsWidgets);
    expect(byKey('sheet-add'), findsOneWidget);
    expect(api.misses, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('empty period and error with retry', (tester) async {
    final api = install(pages: {1: []});
    await open(tester);
    expect(find.textContaining('No entries for'), findsOneWidget);

    var calls = 0;
    api.on('GET', Endpoints.productionSheet, (r) {
      calls++;
      if (calls == 1) throw Exception('boom');
      return {'isOk': true, 'data': [row('r1')], 'meta': {'page': 1, 'totalPages': 1, 'totalDays': 1}};
    });
    await tester.drag(find.byType(ListView).first, const Offset(0, 400));
    await tester.pumpAndSettle();
    expect(find.text('Try again'), findsOneWidget);
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('Try again'), findsNothing);
    expect(find.text('7A'), findsWidgets);
  });

  testWidgets('paging asks for the next page of dates; search narrows the loaded rows; filters go to the server', (tester) async {
    final api = install(
      pages: {
        1: [row('r1', date: today)],
        2: [row('r3', date: yesterday, machine: 'm2', operator: 'Asha')],
      },
      totalPages: 2,
    );
    await open(tester);
    expect(sheetGets(api).map((r) => r.query['page']), containsAll(['1', '2']));
    expect(find.text('Ravi'), findsOneWidget);
    expect(find.text('Asha'), findsOneWidget);

    await tester.enterText(byKey('sheet-search'), 'asha');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(find.text('Ravi'), findsNothing);
    expect(find.text('Asha'), findsOneWidget);
    await tester.enterText(byKey('sheet-search'), 'zzz');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(find.textContaining('No loaded entries match'), findsOneWidget);
    expect(sheetGets(api).length, 2, reason: 'search is client-side over the loaded rows');

    final c = SheetController();
    unawaited(c.applyQuery(['2026-01-01', '2026-01-31'], const SheetFilters(machine: ['m1', 'm2'], operator: ['Ravi'])));
    await tester.pumpAndSettle();
    final last = sheetGets(api).last;
    expect(last.query['from'], '2026-01-01');
    expect(last.query['machine'], 'm1,m2');
    expect(last.query['operator'], 'Ravi');
    expect(last.query['page'], '1');
    c.dispose();
  });

  testWidgets('expanding an entry shows the calculated figures (match rowCalc)', (tester) async {
    install();
    await open(tester);
    await tapKey(tester, 'toggle-r1');
    final r = row('r1');
    final calc = rowCalc({...r, 'date': today});
    expect(find.textContaining('Total Cycle Time (sec)', findRichText: true), findsOneWidget);
    expect(find.textContaining('% OK Quantity', findRichText: true), findsOneWidget);
    expect(find.text(pctStr(calc['pctOk'])), findsWidgets);
    expect(find.text(nStr(calc['idealQty'])), findsWidgets);
    expect(find.text(nStr(calc['totalStoppageMin'])), findsWidgets);
  });

  testWidgets('delete asks first and sends DELETE; a locked entry offers Unlock (Super Admin) that sends PUT', (tester) async {
    final api = install(pages: {
      1: [row('r1'), row('r9', date: oldDay, machine: 'm2', operator: 'Old Timer')],
    });
    api.on('DELETE', '${Endpoints.productionSheetRow}/r1', (_) => {'isOk': true, 'message': 'Entry deleted successfully!'});
    api.on('PUT', '${Endpoints.productionSheetRow}/r9/unlock', (_) => {
          'isOk': true,
          'data': {'unlockedUntil': DateTime.now().add(const Duration(hours: 24)).toUtc().toIso8601String()},
        });
    await open(tester);

    expect(byKey('locked-r9'), findsOneWidget);
    expect(byKey('locked-r1'), findsNothing);

    await tapKey(tester, 'toggle-r1');
    await tapKey(tester, 'delete-r1');
    expect(find.text('Delete entry'), findsOneWidget);
    expect(api.called('DELETE', '${Endpoints.productionSheetRow}/r1'), isEmpty);
    await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.text('Delete')));
    await tester.pumpAndSettle();
    expect(api.called('DELETE', '${Endpoints.productionSheetRow}/r1').length, 1);
    expect(sheetGets(api).length, 2, reason: 'reloads the loaded pages after a delete');

    await tapKey(tester, 'toggle-r9');
    expect(byKey('edit-r9'), findsNothing);
    expect(byKey('delete-r9'), findsNothing);
    await tapKey(tester, 'unlock-r9');
    await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.text('Unlock')));
    await tester.pumpAndSettle();
    expect(api.called('PUT', '${Endpoints.productionSheetRow}/r9/unlock').length, 1);
    expect(byKey('unlocked-r9'), findsOneWidget);
  });

  testWidgets('edit and add open the editor with the right arguments; saving refreshes the list', (tester) async {
    final api = install();
    await open(tester);

    await tapKey(tester, 'toggle-r1');
    await tapKey(tester, 'edit-r1');
    var editor = tester.widget<EntryEditorScreen>(find.byType(EntryEditorScreen));
    expect(editor.row?['_id'], 'r1');
    expect(editor.machines.map((m) => m['_id']), ['m1', 'm2']);
    expect(editor.items, isNotEmpty);
    expect(editor.operators.map((o) => o['name']), ['Ravi', 'Asha']);

    final before = sheetGets(api).length;
    tester.state<NavigatorState>(find.byType(Navigator).first).pop(true);
    await tester.pumpAndSettle();
    expect(sheetGets(api).length, before + 1);

    await tester.tap(byKey('sheet-add'));
    await tester.pumpAndSettle();
    editor = tester.widget<EntryEditorScreen>(find.byType(EntryEditorScreen));
    expect(editor.row, isNull);
    tester.state<NavigatorState>(find.byType(Navigator).first).pop();
    await tester.pumpAndSettle();
    expect(sheetGets(api).length, before + 1, reason: 'no refresh when nothing was saved');
  });

  testWidgets('view-only permission hides Add, Edit and Delete', (tester) async {
    install();
    await open(tester, perms: const PagePerms(view: true));
    expect(byKey('sheet-add'), findsNothing);
    await tapKey(tester, 'toggle-r1');
    expect(byKey('edit-r1'), findsNothing);
    expect(byKey('delete-r1'), findsNothing);
  });

  testWidgets('dark mode, 360x640 and text scale 1.6 do not overflow', (tester) async {
    install();
    await open(tester, dark: true, size: const Size(360, 640), textScale: 1.6);
    expect(tester.takeException(), isNull);
    await tapKey(tester, 'toggle-r1');
    expect(tester.takeException(), isNull);
    // The Filters sheet (period + machine / operator / part) has to fit too.
    await tester.tap(byKey('sheet-filter-btn'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('no separate date strip: the period lives in Filters with the other filters', (tester) async {
    install();
    await open(tester);
    expect(byKey('strip-label'), findsNothing);
    expect(byKey('sheet-range'), findsNothing);
    await tester.tap(byKey('sheet-filter-btn'));
    await tester.pumpAndSettle();
    expect(find.text('PERIOD'), findsOneWidget, reason: 'the section label is drawn upper-case');
    expect(find.text('Date range'), findsOneWidget);
    expect(find.text('Month'), findsOneWidget);
    expect(find.text('Year'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
