import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/features/production/production_sheet_screen.dart';
import 'package:indo/features/production/sheet/sheet_model.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';
import 'package:indo/features/production/sheet/table/sheet_table.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';
import 'sheet_list_test.dart' show byKey, install, open, oldDay, row, today, yesterday;

/// Rows shaped like what production really holds: nulls, missing fields, numbers
/// as int / double / numeric text, junk text, unknown keys, populated ids, dates
/// as ISO strings, machines that are no longer listed, legacy entries.
List<Map<String, dynamic>> messyRows() => [
      row('good'),
      row('nulls', slot: 2, extra: {
        'operator': null,
        'itemName': null,
        'drawingNo': null,
        'machineOnTime': null,
        'machineOffTime': null,
        'actualQty': null,
        'okQty': null,
        'rejectedQty': null,
        'rejectBreakdown': null,
        'totalCycleSec': null,
        'plannedOperatorShiftHours': null,
        'remarks': null,
        'unlockedUntil': null,
      }),
      row('bare', slot: 3, extra: {
        'operator': '',
        'itemName': '',
        'machineOnTime': '',
        'machineOffTime': '',
        'actualQty': '',
        'okQty': '',
      }),
      row('strings', machine: 'm2', extra: {
        'actualQty': ' 400 ',
        'okQty': '390.5',
        'rejectedQty': '9.5',
        'totalCycleSec': '60',
        'lunchMin': '30',
        'setupMin': 'abc',
        'plannedOperatorShiftHours': '9',
        'machineOnTime': '8',
        'machineOffTime': '16.30',
        'rejectBreakdown': {'Tool Mark': '5', 'Other': null, 'Never Heard Of It': 3, 'Dimension Out': 'x'},
      }),
      row('doubles', slot: 2, machine: 'm2', extra: {'actualQty': 400.75, 'okQty': 1e21, 'rejectedQty': -3, 'totalCycleSec': 1e-7, 'plannedOperatorShiftHours': 24.0}),
      row('junk', slot: 3, machine: 'm2', extra: {
        'actualQty': 'NaN',
        'okQty': 'Infinity',
        'rejectedQty': {'a': 1},
        'totalCycleSec': [],
        'machineOnTime': 25,
        'machineOffTime': '99:99',
        'lunchMin': true,
        'remarks': 12345,
        'rejectOtherRemark': ['x'],
        'otherMinRemark': {'y': 1},
        'excludedOps': 'drillingSec',
        'cycleOpsSec': 'nope',
        'rejectBreakdown': [1, 2, 3],
        'someNewServerField': {'deep': [1, 2, {'x': null}]},
      }),
      row('breakdownStr', machine: 'm3', extra: {'rejectBreakdown': 'Tool Mark: 5', 'excludedOps': [1, null, 'drillingSec'], 'remarks': 'Line one\nline two 🙂 ' * 30}),
      // Machine populated as an object, and a machine that is not in the list at all.
      row('populated', machine: 'm1', slot: 3, extra: {
        'machine': {'_id': 'm1', 'machineName': '7A'},
        'otherMin': 12,
        'otherMinRemark': 'Power dip',
        'rejectBreakdown': {'Other': 4},
        'rejectOtherRemark': 'Burrs',
      }),
      row('ghostA', machine: 'ghost1', slot: 1),
      row('ghostB', machine: 'ghost2', slot: 1),
      row('ghostA2', machine: 'ghost1', slot: 2, extra: {'operator': 'Ravi'}),
      row('nullMachine', extra: {'machine': null}),
      row('badSlot', slot: 1, extra: {'slot': 'abc'}),
      row('nanSlot', slot: 1, extra: {'slot': 'NaN'}),
      row('floatSlot', slot: 1, extra: {'slot': 2.5}),
      row('nullSlot', slot: 1, extra: {'slot': null}),
      // Lock states.
      row('lockBad', date: oldDay, extra: {'unlockedUntil': 'not a date'}),
      row('lockNum', date: oldDay, machine: 'm2', extra: {'unlockedUntil': 12345}),
      row('lockEmpty', date: oldDay, machine: 'm2', slot: 2, extra: {'unlockedUntil': ''}),
      row('unlocked', date: oldDay, slot: 2, extra: {'unlockedUntil': DateTime.now().add(const Duration(hours: 5)).toUtc().toIso8601String()}),
      row('expired', date: oldDay, slot: 3, extra: {'unlockedUntil': '2020-01-01T00:00:00.000Z'}),
      // Dates.
      row('yday', date: yesterday, machine: 'm3'),
      row('weirdDate', extra: {'date': '2025-13-45T00:00:00.000Z'}),
      row('textDate', extra: {'date': 'abcdefghijk'}),
      row('shortDate', extra: {'date': '2025-01'}), // dropped: not a date
      {'date': '${today}T00:00:00.000Z', 'machine': 'm1', 'slot': 1}, // no _id: dropped
      row('dupe'),
      row('dupe'),
      row('empty', slot: 2, machine: 'm3', extra: {}),
    ];

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  Future<void> useCards(WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({'sheet_view_mode': 'cards'});
  }

  // Opens every entry / popover the rows offer and checks nothing throws.
  Future<void> poke(WidgetTester tester) async {
    for (final id in ['good', 'nulls', 'junk', 'populated', 'breakdownStr', 'lockBad']) {
      final toggle = byKey('toggle-$id');
      if (toggle.evaluate().isEmpty) continue;
      await tester.ensureVisible(toggle);
      await tester.tap(toggle);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'expanding $id');
    }
    for (final k in ['remarks-junk', 'remarks-populated']) {
      final pill = byKey(k);
      if (pill.evaluate().isEmpty) continue;
      await tester.ensureVisible(pill);
      await tester.longPress(byKey('toggle-${k.substring(8)}'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'long press $k');
      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
    }
  }

  testWidgets('cards: messy production rows render without an exception (phone, iPad, light, dark)', (tester) async {
    await useCards(tester);
    for (final cfg in [
      (const Size(390, 844), false, 1.0),
      (const Size(820, 1180), false, 1.0),
      (const Size(360, 640), true, 1.6),
    ]) {
      install(pages: {1: messyRows()});
      await open(tester, size: cfg.$1, dark: cfg.$2, textScale: cfg.$3);
      expect(tester.takeException(), isNull, reason: 'first paint at ${cfg.$1}');
      expect(find.text('7A'), findsWidgets);
      // Two ghost machines keep their own cards (no duplicate GlobalKeys).
      await poke(tester);
      await tester.dragFrom(const Offset(180, 500), const Offset(0, -2000));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'scrolled at ${cfg.$1}');
      await tester.pumpWidget(const SizedBox.shrink());
    }
  });

  testWidgets('table: messy production rows render without an exception, breakdowns open, phone and iPad', (tester) async {
    for (final cfg in [
      (const Size(390, 844), false, 1.0),
      (const Size(820, 1180), true, 1.0),
      (const Size(360, 640), true, 1.6),
    ]) {
      install(pages: {1: messyRows()});
      await open(tester, size: cfg.$1, dark: cfg.$2, textScale: cfg.$3);
      expect(tester.takeException(), isNull, reason: 'first paint at ${cfg.$1}');
      for (final id in ['cycle', 'rejectedQty', 'planned', 'downtime']) {
        final chevron = byKey('expand-$id-closed');
        if (chevron.evaluate().isEmpty) continue;
        // Scroll the header sideways until the chevron is on screen.
        for (var i = 0; i < 25 && tester.getCenter(chevron).dx > cfg.$1.width - 120; i++) {
          await tester.dragFrom(Offset(cfg.$1.width / 2, 300), const Offset(-260, 0));
          await tester.pumpAndSettle();
        }
        await tester.tap(chevron);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: 'opening $id at ${cfg.$1}');
      }
      // Eyes (remark popovers) for rows that carry remarks.
      for (final k in ['eye-reject-populated', 'eye-downtime-populated', 'eye-general-junk', 'eye-general-breakdownStr']) {
        final eye = byKey(k);
        if (eye.evaluate().isEmpty) continue;
        await tester.ensureVisible(eye);
        await tester.tap(eye, warnIfMissed: false);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: k);
        await tester.tapAt(const Offset(10, 10));
        await tester.pumpAndSettle();
      }
      await tester.dragFrom(Offset(cfg.$1.width / 2, 300), const Offset(0, -3000));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'scrolled at ${cfg.$1}');
      await tester.pumpWidget(const SizedBox.shrink());
    }
  });

  testWidgets('every table column key is unique whichever breakdowns are open', (tester) async {
    for (var mask = 0; mask < 16; mask++) {
      final open = <String>{for (var i = 0; i < 4; i++) if (mask & (1 << i) != 0) expandIds[i]};
      final cols = buildSheetColumns(open);
      final keys = [...cols.left, ...cols.middle].map((c) => c.key).toList();
      expect(keys.toSet().length, keys.length, reason: 'duplicate column key with $open');
    }
  });

  testWidgets('table rows are 40 px on a phone and 44 px on an iPad', (tester) async {
    expect(TableMetrics.rowHeight(false), 40);
    expect(TableMetrics.rowHeight(true), 44);
    install();
    await open(tester);
    expect(tester.getSize(byKey('trow-r1')).height, 40);
    await tester.pumpWidget(const SizedBox.shrink());
    await open(tester, size: const Size(820, 1180));
    expect(tester.getSize(byKey('trow-r1')).height, 44);
  });

  testWidgets('sorting keeps one machine together even when its id is not in the machine list', (tester) async {
    final rows = [
      for (final r in messyRows())
        if (r['_id'] != null) {...r, 'date': '${r['date']}'.length >= 10 ? '${r['date']}'.substring(0, 10) : '${r['date']}'},
    ];
    final days = buildSheetDays(
      rows: rows.where((r) => '${r['date']}'.length >= 10).toList(),
      filters: SheetFilters.empty,
      search: '',
      machineName: const {'m1': '7A', 'm2': '7B'},
      rankOf: (id) => id == 'm1' ? 0 : (id == 'm2' ? 1 : 1 << 30),
    );
    for (final d in days) {
      final ids = d.machines.map((m) => m.machineId).toList();
      expect(ids.toSet().length, ids.length, reason: 'a machine appears twice on ${d.date}: $ids');
    }
    expect(slotOf('abc'), 0);
    expect(slotOf('NaN'), 0);
    expect(slotOf(double.infinity), 0);
    expect(slotOf(2.5), 2);
    expect(slotOf(null), 0);
    expect(slotOf('3'), 3);
  });

  testWidgets('0 rows, 1 row and 2000 rows', (tester) async {
    install(pages: {1: []});
    await open(tester);
    expect(find.textContaining('No entries for'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());

    install(pages: {1: [row('only')]});
    await open(tester);
    expect(byKey('trow-only'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());

    final big = [
      for (var i = 0; i < 2000; i++)
        row('big$i', date: DateTime.utc(2025, 1, 1).add(Duration(days: i % 200)).toIso8601String().substring(0, 10), machine: 'm${1 + i % 2}', slot: 1 + (i % 3), operator: 'Op ${i % 40}'),
    ];
    for (final cards in [false, true]) {
      SharedPreferences.setMockInitialValues({'sheet_view_mode': cards ? 'cards' : 'table'});
      install(pages: {1: big});
      final watch = Stopwatch()..start();
      // A response this big is decoded on another isolate (real time, not fake).
      await pumpScreen(tester, const ProductionSheetScreen(), settle: false);
      for (var k = 0; k < 12 && find.byKey(const ValueKey('sheet-skeleton')).evaluate().isNotEmpty; k++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 500)));
        await tester.pump(const Duration(milliseconds: 50));
      }
      await tester.pumpAndSettle();
      await tester.dragFrom(const Offset(180, 500), const Offset(0, -6000));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: cards ? 'cards' : 'table');
      expect(watch.elapsedMilliseconds, lessThan(20000));
      await tester.pumpWidget(const SizedBox.shrink());
    }
  });

  testWidgets('the Add button steps aside while the keyboard is up and the search field takes text', (tester) async {
    install();
    await open(tester);
    expect(find.byType(FloatingActionButton), findsOneWidget);

    await tester.tap(byKey('sheet-search'));
    await tester.pump();
    final field = tester.widget<TextField>(byKey('sheet-search'));
    expect(field.keyboardType, TextInputType.text);
    expect(field.autocorrect, isFalse);
    expect(field.textInputAction, TextInputAction.search);

    // The keyboard opens.
    tester.view.viewInsets = const FakeViewPadding(bottom: 320);
    await tester.pumpAndSettle();
    expect(find.byType(FloatingActionButton), findsNothing);
    expect(tester.takeException(), isNull);

    await tester.enterText(byKey('sheet-search'), '12abc 1.2.3 0000000000 ünï');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.enterText(byKey('sheet-search'), '');
    await tester.pump(const Duration(milliseconds: 400));

    // Rotate to landscape with the keyboard still up: almost no room, still no error.
    tester.view.physicalSize = const Size(844, 390);
    tester.view.viewInsets = const FakeViewPadding(bottom: 230);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    tester.view.resetViewInsets();
    tester.view.physicalSize = const Size(390, 844);
    await tester.pumpAndSettle();
    expect(find.byType(FloatingActionButton), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('search field: monkey typing, clear button, submit closes the keyboard', (tester) async {
    install(pages: {1: messyRows()});
    await open(tester);
    for (final text in ['a', '12abc', '1.2.3', '0000000000', ' ', 'RAVI', 'Bracket D-100', '🙂', '\u0000', '\n']) {
      await tester.enterText(byKey('sheet-search'), text);
      await tester.pump(const Duration(milliseconds: 350));
      expect(tester.takeException(), isNull, reason: 'typing "$text"');
    }
    await tester.enterText(byKey('sheet-search'), 'ravi');
    await tester.pump();
    await tester.tap(find.byTooltip('Clear search'));
    await tester.pump(const Duration(milliseconds: 350));
    expect(tester.widget<TextField>(byKey('sheet-search')).controller!.text, '');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('Filters holds the period: an active period shows as a removable chip, counts in the badge and Clear resets it', (tester) async {
    final api = install();
    await open(tester);
    expect(byKey('chip-range'), findsNothing);

    await tester.tap(byKey('sheet-filter-btn'));
    await tester.pumpAndSettle();
    await tester.tap(byKey('quick-last7'));
    await tester.pumpAndSettle();
    await tester.tap(byKey('filters-apply'));
    await tester.pumpAndSettle();
    expect(byKey('chip-range'), findsOneWidget);
    expect(find.descendant(of: byKey('sheet-filter-btn'), matching: find.byType(Icon)), findsWidgets);
    expect(find.text('1'), findsWidgets, reason: 'the badge counts the period');
    final applied = api.called('GET', Endpoints.productionSheet).last;
    expect(applied.query['from'], isNot(applied.query['to']));

    // The chip's own x puts the period back to the default.
    await tester.tap(find.descendant(of: byKey('chip-range'), matching: find.byIcon(Icons.close_rounded)));
    await tester.pumpAndSettle();
    expect(byKey('chip-range'), findsNothing);

    await tester.tap(byKey('sheet-filter-btn'));
    await tester.pumpAndSettle();
    await tester.tap(byKey('quick-today'));
    await tester.pumpAndSettle();
    await tester.tap(byKey('filters-apply'));
    await tester.pumpAndSettle();
    expect(byKey('chip-range'), findsOneWidget);
    await tester.tap(byKey('sheet-clear'));
    await tester.pumpAndSettle();
    expect(byKey('chip-range'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('iPad toolbar is one row: search, Filters, Table | Cards, Add Entry', (tester) async {
    install();
    await open(tester, size: const Size(820, 1180));
    final ys = [
      tester.getCenter(byKey('sheet-search')).dy,
      tester.getCenter(byKey('sheet-filter-btn')).dy,
      tester.getCenter(byKey('sheet-view-toggle')).dy,
      tester.getCenter(byKey('sheet-add')).dy,
    ];
    for (final y in ys) {
      expect(y, closeTo(ys.first, 1.5));
    }
    expect(tester.getSize(byKey('sheet-filter-btn')).height, lessThanOrEqualTo(44));
    expect(tester.takeException(), isNull);
  });

  testWidgets('smoke: dark, 360x640, text 1.6 on both views with Filters and the multi-select open', (tester) async {
    for (final cards in [false, true]) {
      SharedPreferences.setMockInitialValues({'sheet_view_mode': cards ? 'cards' : 'table'});
      install(pages: {1: messyRows()});
      await open(tester, dark: true, size: const Size(360, 640), textScale: 1.6);
      await tester.tap(byKey('sheet-filter-btn'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tap(byKey('pick-operator'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'multi-select with the keyboard up');
      tester.view.resetViewInsets();
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
    }
  });
}

