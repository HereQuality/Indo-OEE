// Unit + widget tests of the shared Wave-1 pieces on their own (no process).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/entry_form/entry_notice_dialog.dart';
import 'package:indo/features/production/shared/limit_notice.dart';
import 'package:indo/features/production/shared/planned_shift.dart';
import 'package:indo/features/production/shared/vendors.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';

void main() {
  group('planned shift helpers', () {
    final machines = [
      {'_id': 'm1', 'process': 'p1'},
      {'_id': 'm2', 'process': 'p2'},
    ];
    final processes = [
      {'_id': 'p1', 'plannedShiftHours': 7.5},
      {'_id': 'p2', 'plannedShiftLocked': false},
    ];

    test('a new entry takes the locked hours; the box text is H.MM', () {
      final s = plannedShiftFor(machineId: 'm1', machines: machines, processes: processes)!;
      expect(s.hours, 7.5);
      expect(s.boxText, '7.30');
      expect(plannedShiftDefault(s), '7.30');
    });

    test('an edited entry with a saved shift keeps it (no default, fromEntry)', () {
      final s = plannedShiftFor(machineId: 'm1', machines: machines, processes: processes, isEdit: true, savedPlanned: 9)!;
      expect(s.fromEntry, isTrue);
      expect(plannedShiftDefault(s), isNull);
      // An old entry saved without one takes the process's hours.
      final blank = plannedShiftFor(machineId: 'm1', machines: machines, processes: processes, isEdit: true, savedPlanned: null)!;
      expect(blank.fromEntry, isFalse);
      expect(plannedShiftDefault(blank), '7.30');
    });

    test('unlocked / unknown machine = no setting', () {
      expect(plannedShiftFor(machineId: 'm2', machines: machines, processes: processes), isNull);
      expect(plannedShiftFor(machineId: 'nope', machines: machines, processes: processes), isNull);
      expect(plannedShiftDefault(null), isNull);
    });

    test('the reason texts are the web\'s', () {
      const s = ShiftSetting(locked: true, hours: 12);
      expect(plannedShiftReason(s, '12:00'), 'Fixed at 12:00 hr — locked in Process Master');
      expect(plannedShiftReason(s.copyWith(fromEntry: true), '12:00'), 'Kept as this entry was saved — set by Process Master');
    });

    test('only an Admin may change the setting (server shiftChangeError)', () {
      final current = {'plannedShiftLocked': true, 'plannedShiftHours': 12};
      // Sending back what is there is fine for anyone.
      expect(shiftChangeAllowed(current: current, next: {'plannedShiftLocked': true, 'plannedShiftHours': 12}, isAdmin: false), isTrue);
      expect(shiftChangeAllowed(current: current, next: const {}, isAdmin: false), isTrue);
      // The hours or the lock changing is Admin-only.
      expect(shiftChangeAllowed(current: current, next: {'plannedShiftHours': 8}, isAdmin: false), isFalse);
      expect(shiftChangeAllowed(current: current, next: {'plannedShiftLocked': false}, isAdmin: false), isFalse);
      expect(shiftChangeAllowed(current: current, next: {'plannedShiftLocked': 'false'}, isAdmin: false), isFalse);
      expect(shiftChangeAllowed(current: current, next: {'plannedShiftHours': 8}, isAdmin: true), isTrue);
      // A process saved before the setting existed reads as locked at 12.
      expect(shiftChangeAllowed(current: const {}, next: {'plannedShiftHours': 12}, isAdmin: false), isTrue);
    });
  });

  test('vendorLabelFor: live name, else the saved one', () {
    final vendors = [
      {'_id': 'v1', 'name': 'Acme'},
    ];
    expect(vendorLabelFor(vendors, 'v1', 'old name'), 'Acme');
    expect(vendorLabelFor(vendors, 'v9', 'Gone Ltd'), 'Gone Ltd');
    expect(vendorLabelFor(vendors, '', 'Gone Ltd'), '');
  });

  test('SheetCol.style / shownWhen default to the current look and survive copies', () {
    final plain = SheetCol(key: 'a', label: 'A', width: 80, text: (_) => '1');
    expect(plain.style, isNull);
    expect(plain.shownWhen, isNull);
    final marked = SheetCol(
      key: 'b',
      label: 'B',
      width: 80,
      text: (_) => '2',
      style: (_) => CellStyle.danger,
      shownWhen: (env) => env.showVendor,
    );
    final copy = marked.withWidth(120).withExpand(const ColExpand(id: 'x', isOpen: false, label: 'X'));
    expect(copy.style, same(marked.style));
    expect(copy.shownWhen, same(marked.shownWhen));
    final cols = SheetColumns(left: const [], middle: [plain, marked]);
    expect(identical(cols.where(const SheetEnv(showVendor: true)), cols), isTrue);
    expect(cols.where(const SheetEnv(showVendor: false)).middle.map((c) => c.key), ['a']);
  });

  group('EntryNotices', () {
    Future<BuildContext> pumpHost(WidgetTester tester) async {
      EntryNotices.reset();
      late BuildContext ctx;
      await tester.pumpWidget(MaterialApp(home: Builder(builder: (c) {
        ctx = c;
        return const Scaffold(body: SizedBox());
      })));
      return ctx;
    }

    const notice = EntryNotice(
      title: 'Test title',
      message: 'Because.',
      details: [NoticeDetail('Limit', '10'), NoticeDetail('Entered', '12', highlight: true)],
      hint: 'Check it.',
    );

    testWidgets('draws the title, message, figures (the entered one in red), hint and OK', (tester) async {
      final ctx = await pumpHost(tester);
      final done = EntryNotices.show(ctx, notice);
      await tester.pumpAndSettle();
      expect(find.text('Test title'), findsOneWidget);
      expect(find.text('Because.'), findsOneWidget);
      expect(find.text('Limit'), findsOneWidget);
      expect(find.text('Check it.'), findsOneWidget);
      final entered = tester.widget<Text>(find.byKey(const ValueKey('entry-notice/value/Entered')));
      final limit = tester.widget<Text>(find.byKey(const ValueKey('entry-notice/value/Limit')));
      expect(entered.style!.color, Theme.of(tester.element(find.byType(Dialog))).colorScheme.error);
      expect(limit.style!.color, isNot(entered.style!.color));
      await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
      await tester.pumpAndSettle();
      await done;
      expect(find.byKey(const ValueKey('entry-notice')), findsNothing);
      expect(EntryNotices.isOpen, isFalse);
    });

    testWidgets('asked again while open (one per keystroke) it stays one dialog', (tester) async {
      final ctx = await pumpHost(tester);
      final a = EntryNotices.show(ctx, notice);
      final b = EntryNotices.show(ctx, notice);
      final c = EntryNotices.show(ctx, notice);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('entry-notice')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
      await tester.pumpAndSettle();
      await Future.wait([a, b, c]);
      expect(find.byKey(const ValueKey('entry-notice')), findsNothing);
      // ...and it can be raised again once closed.
      final again = EntryNotices.show(ctx, notice);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('entry-notice')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
      await tester.pumpAndSettle();
      await again;
    });

    testWidgets('a long notice scrolls at large text and never overflows (360x640, 1.6x)', (tester) async {
      tester.view.physicalSize = const Size(360, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      EntryNotices.reset();
      late BuildContext ctx;
      await tester.pumpWidget(MaterialApp(
        builder: (c, child) => MediaQuery(data: MediaQuery.of(c).copyWith(textScaler: const TextScaler.linear(1.6)), child: child!),
        home: Builder(builder: (c) {
          ctx = c;
          return const Scaffold(body: SizedBox());
        }),
      ));
      final done = EntryNotices.show(ctx, qtyNotice(calc: {'idealQty': 480, 'shiftHours': 8, 'totalCycleSec': 60}, entered: 700, machine: 'Lathe 7B-Long-Name', label: 'Actual Quantity'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      // The OK button is reachable by scrolling the dialog.
      await tester.ensureVisible(find.byKey(const ValueKey('entry-notice/ok')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('entry-notice/ok')));
      await tester.pumpAndSettle();
      await done.timeout(const Duration(seconds: 5));
    });
  });
}
