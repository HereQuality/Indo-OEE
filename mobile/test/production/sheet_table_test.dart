import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:indo/features/production/sheet/table/sheet_table.dart';
import 'package:indo/models/menu_models.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'sheet_list_test.dart' show byKey, install, open, oldDay, row, sheetGets, today, yesterday;

/// Scrolls the table sideways (a real drag on a row) until [key] sits between the
/// frozen Date + Machine columns and the frozen Actions column, then taps it.
Future<void> tapK(WidgetTester tester, String key) async {
  final vw = tester.view.physicalSize.width;
  for (var i = 0; i < 30; i++) {
    final lo = tester.getTopRight(byKey('head-machine')).dx + 14;
    final actions = tester.getTopLeft(byKey('head-actions')).dx;
    final hi = (actions < vw - 1 ? actions : vw) - 14;
    final x = tester.getCenter(byKey(key)).dx;
    if (x > lo && x < hi) break;
    await tester.dragFrom(Offset(vw / 2, 400), Offset((hi + lo) / 2 - x, 0));
    await tester.pumpAndSettle();
  }
  await tester.tap(byKey(key));
  await tester.pumpAndSettle();
}

/// Taps a control of the frozen Actions column (no sideways scrolling needed).
Future<void> tapA(WidgetTester tester, String key) async {
  await tester.tap(byKey(key));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('the table is the default: every web column, one row per entry, values from rowCalc', (tester) async {
    final api = install();
    await open(tester);
    expect(byKey('sheet-table-list'), findsOneWidget);
    for (final key in ['date', 'machine', 'operator', 'itemName', 'drawingNo', 'cycle', 'on', 'off', 'shift', 'idealQty', 'actualQty', 'okQty', 'rejectedQty', 'pctOk', 'plannedShift', 'unutilized', 'totalStoppage', 'effective', 'unreported', 'gap', 'setupEff', 'oeeLosses', 'oeeLunch', 'oeeLunchCot', 'remarks', 'actions']) {
      expect(byKey('head-$key'), findsOneWidget, reason: 'column $key');
    }
    expect(find.text('Part Name'), findsOneWidget);
    expect(find.text('OEE considering losses (%)'), findsOneWidget);
    // Both entries, their machines, operators and part.
    expect(find.text('7A'), findsWidgets);
    expect(find.text('7B'), findsWidgets);
    expect(find.text('Ravi'), findsOneWidget);
    expect(find.text('Asha'), findsOneWidget);
    expect(find.text('Bracket'), findsWidgets);
    expect(find.text('D-100'), findsWidgets);
    // 8h shift at 60 s/part: ideal 480 (rowCalc), actual 400.
    expect(find.text('480'), findsWidgets);
    expect(find.text('400'), findsWidgets);
    expect(find.text('8'), findsWidgets);
    expect(byKey('trow-r1'), findsOneWidget);
    expect(byKey('trow-r2'), findsOneWidget);
    expect(byKey('sheet-view-toggle'), findsOneWidget);
    expect(byKey('sheet-add'), findsOneWidget);
    expect(api.misses, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('chevrons open the breakdown columns and the remark eyes sit beside their figure', (tester) async {
    install(pages: {
      1: [
        row('r1', extra: {
          'rejectBreakdown': {'Tool Mark': 6, 'Other': 4},
          'rejectOtherRemark': 'Burrs on the edge',
          'otherMin': 12,
          'otherMinRemark': 'Power dip',
          'remarks': 'Operator changed shift',
          'drillingSec': 20,
        }),
      ],
    });
    await open(tester);
    expect(find.text('Drilling (sec)'), findsNothing);
    expect(find.text('Tool Mark'), findsNothing);
    expect(byKey('eye-general-r1'), findsOneWidget);
    expect(byKey('eye-reject-r1'), findsNothing);

    await tapK(tester, 'expand-cycle-closed');
    expect(find.text('Drilling (sec)'), findsOneWidget);
    expect(find.text('Clamp/Declamp (sec)'), findsOneWidget);
    expect(byKey('expand-cycle-open'), findsOneWidget);
    expect(byKey('expand-cycle-open-end'), findsOneWidget);

    await tapK(tester, 'expand-rejectedQty-closed');
    expect(find.text('Tool Mark'), findsOneWidget);
    expect(find.text('Porosity / Blow Hole'), findsOneWidget);
    expect(byKey('eye-reject-r1'), findsOneWidget);
    await tapK(tester, 'eye-reject-r1');
    expect(find.text('Burrs on the edge'), findsOneWidget);
    expect(find.text('Operator changed shift'), findsNothing, reason: 'the reject eye shows only its own remark');
    await tester.tapAt(const Offset(20, 40));
    await tester.pumpAndSettle();

    await tapK(tester, 'expand-downtime-closed');
    expect(find.text('Breakdown Mechanical'), findsOneWidget);
    expect(byKey('eye-downtime-r1'), findsOneWidget);
    await tapK(tester, 'eye-downtime-r1');
    expect(find.text('Power dip'), findsOneWidget);
    await tester.tapAt(const Offset(20, 40));
    await tester.pumpAndSettle();

    await tapK(tester, 'eye-general-r1');
    expect(find.text('Operator changed shift'), findsOneWidget);
    expect(find.text('Burrs on the edge'), findsNothing, reason: 'the Remarks column shows the general remark only');
    await tester.tapAt(const Offset(20, 40));
    await tester.pumpAndSettle();
    await tapK(tester, 'expand-downtime-open-end');
    expect(find.text('Breakdown Mechanical'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Date + Machine and Actions stay frozen while the columns scroll; a header info icon shows its formula', (tester) async {
    install();
    await open(tester);
    final dateX = tester.getTopLeft(byKey('head-date')).dx;
    final machineX = tester.getTopLeft(byKey('head-machine')).dx;
    final opX = tester.getTopLeft(byKey('head-operator')).dx;
    final actionsX = tester.getTopLeft(byKey('head-actions')).dx;

    await tester.dragFrom(const Offset(200, 300), const Offset(-700, 0));
    await tester.pumpAndSettle();
    expect(tester.getTopLeft(byKey('head-date')).dx, dateX);
    expect(tester.getTopLeft(byKey('head-machine')).dx, machineX);
    expect(tester.getTopLeft(byKey('head-operator')).dx, lessThan(opX - 300));
    expect(tester.getTopLeft(byKey('head-actions')).dx, actionsX);
    // The body rows keep their frozen cells too.
    expect(tester.getTopLeft(find.byKey(const ValueKey('r1:date'))).dx, dateX);

    await tapK(tester, 'formula-shift');
    expect(find.textContaining('MOD(Machine OFF Time'), findsOneWidget);
    await tester.tapAt(const Offset(20, 40));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('a date shows once per run; edit and delete are in the Actions column; locked rows lose them (Super Admin gets Unlock)', (tester) async {
    final api = install(pages: {
      1: [
        row('r1'),
        row('r2', slot: 2, machine: 'm1', operator: 'Ravi 2'),
        row('r9', date: oldDay, machine: 'm2', operator: 'Old Timer'),
      ],
    });
    api.on('DELETE', '${Endpoints.productionSheetRow}/r1', (_) => {'isOk': true, 'message': 'Entry deleted successfully!'});
    api.on('PUT', '${Endpoints.productionSheetRow}/r9/unlock', (_) => {
          'isOk': true,
          'data': {'unlockedUntil': DateTime.now().add(const Duration(hours: 24)).toUtc().toIso8601String()},
        });
    await open(tester);
    // r1 and r2 share the date and the machine: the label is drawn once.
    expect(find.text('7A'), findsOneWidget);
    expect(byKey('edit-r1'), findsOneWidget);
    expect(byKey('delete-r2'), findsOneWidget);
    expect(byKey('edit-r9'), findsNothing);
    expect(byKey('delete-r9'), findsNothing);
    expect(byKey('unlock-r9'), findsOneWidget);

    await tapA(tester, 'delete-r1');
    expect(find.text('Delete entry'), findsOneWidget);
    await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.text('Delete')));
    await tester.pumpAndSettle();
    expect(api.called('DELETE', '${Endpoints.productionSheetRow}/r1').length, 1);
    expect(sheetGets(api).length, 2, reason: 'reloads the loaded pages after a delete');

    await tapA(tester, 'unlock-r9');
    await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.text('Unlock')));
    await tester.pumpAndSettle();
    expect(api.called('PUT', '${Endpoints.productionSheetRow}/r9/unlock').length, 1);
    expect(byKey('edit-r9'), findsOneWidget);
  });

  testWidgets('permissions: a view-only role sees no edit / delete / add; a non-admin sees the lock instead of Unlock', (tester) async {
    install(pages: {
      1: [row('r1'), row('r9', date: oldDay, machine: 'm2')],
    });
    await open(tester, perms: const PagePerms(view: true));
    expect(byKey('sheet-add'), findsNothing);
    expect(byKey('edit-r1'), findsNothing);
    expect(byKey('delete-r1'), findsNothing);
    expect(find.text('7A'), findsWidgets);
  });

  testWidgets('edit opens the editor; Table | Cards switches the view and remembers it', (tester) async {
    install();
    await open(tester);
    await tapA(tester, 'edit-r1');
    var editor = tester.widget<EntryEditorScreen>(find.byType(EntryEditorScreen));
    expect(editor.row?['_id'], 'r1');
    tester.state<NavigatorState>(find.byType(Navigator).first).pop();
    await tester.pumpAndSettle();

    await tester.tap(byKey('view-cards'));
    await tester.pumpAndSettle();
    expect(byKey('sheet-list'), findsOneWidget);
    expect(byKey('sheet-table-list'), findsNothing);
    expect(byKey('toggle-r1'), findsOneWidget);
    expect((await SharedPreferences.getInstance()).getString('sheet_view_mode'), 'cards');
    await tester.tap(byKey('view-table'));
    await tester.pumpAndSettle();
    expect(byKey('sheet-table-list'), findsOneWidget);
    expect((await SharedPreferences.getInstance()).getString('sheet_view_mode'), 'table');

    await tester.tap(byKey('sheet-add'));
    await tester.pumpAndSettle();
    editor = tester.widget<EntryEditorScreen>(find.byType(EntryEditorScreen));
    expect(editor.row, isNull);
  });

  testWidgets('pull down on the table refreshes the first page', (tester) async {
    final api = install();
    await open(tester);
    final before = sheetGets(api).length;
    await tester.dragFrom(const Offset(200, 300), const Offset(0, 320));
    await tester.pumpAndSettle();
    expect(sheetGets(api).length, greaterThan(before));
    expect(tester.takeException(), isNull);
  });

  testWidgets('infinite scroll asks for the next page of dates; search narrows the rows', (tester) async {
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
  });

  testWidgets('iPad 1024x768: full width table, Add Entry in the toolbar, editor as a dialog', (tester) async {
    install();
    await open(tester, size: const Size(1024, 768));
    expect(TableMetrics.rowHeight(true), 44);
    expect(tester.getSize(byKey('sheet-table-h')).width, greaterThan(900), reason: 'no 720 px cap');
    expect(find.byType(FloatingActionButton), findsNothing);
    expect(byKey('sheet-add'), findsOneWidget);
    expect(find.text('Filters'), findsOneWidget);
    expect(byKey('sheet-range'), findsNothing, reason: 'the period lives in Filters, not a separate button');
    expect(tester.getSize(byKey('trow-r1')).height, 44);

    await tester.tap(byKey('sheet-add'));
    await tester.pumpAndSettle();
    expect(find.byType(EntryEditorScreen), findsOneWidget);
    expect(find.byType(Dialog), findsOneWidget);
    expect(tester.getSize(find.byType(EntryEditorScreen)).width, lessThanOrEqualTo(900));
    tester.state<NavigatorState>(find.byType(Navigator).first).pop();
    await tester.pumpAndSettle();
    expect(find.byType(Dialog), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('phone 390x844: compact 40 px rows, FAB adds; dark / 360x640 / text 1.6 and iPad dark do not overflow', (tester) async {
    install();
    await open(tester);
    expect(tester.getSize(byKey('trow-r1')).height, 40);
    expect(byKey('sheet-add'), findsOneWidget);
    expect(find.byType(FloatingActionButton), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    await open(tester, dark: true, size: const Size(360, 640), textScale: 1.6);
    expect(tester.takeException(), isNull);
    await tapK(tester, 'expand-cycle-closed');
    await tapK(tester, 'expand-rejectedQty-closed');
    await tapK(tester, 'expand-downtime-closed');
    await tester.dragFrom(const Offset(180, 300), const Offset(-900, 0));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(byKey('sheet-filter-btn'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    tester.state<NavigatorState>(find.byType(Navigator).first).pop(); // dismiss the Filters sheet
    await tester.pumpAndSettle();
    await tester.tap(byKey('view-cards'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(const SizedBox.shrink());
    await open(tester, dark: true, size: const Size(1024, 768), textScale: 1.6);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await open(tester, size: const Size(768, 1024));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await open(tester, size: const Size(844, 390));
    expect(byKey('sheet-add'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await open(tester, dark: true, size: const Size(1366, 1024));
    expect(byKey('sheet-range'), findsNothing);
    expect(byKey('sheet-filter-btn'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
