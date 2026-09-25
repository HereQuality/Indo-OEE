import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart' show engineClock;

import '../support/fake_api.dart';

/// "Today" for every sheet test: Friday 25 Sep 2026.
final DateTime kTestNow = DateTime(2026, 9, 25, 10, 30);

/// Pins the engine clock for the current test and restores it afterwards.
void pinClock() {
  engineClock = () => kTestNow;
  addTearDown(() => engineClock = DateTime.now);
}

/// Pumps a page with one "open" button and taps it: [open] shows the sheet.
Future<void> openSheet(
  WidgetTester tester,
  void Function(BuildContext context) open, {
  bool dark = false,
  Size size = const Size(390, 844),
  double textScale = 1.0,
}) async {
  FakeApi.install();
  await pumpScreen(
    tester,
    Builder(
      builder: (context) => Scaffold(
        body: Center(child: FilledButton(onPressed: () => open(context), child: const Text('open'))),
      ),
    ),
    dark: dark,
    size: size,
    textScale: textScale,
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

/// The vertical scrollable of an open sheet's main scroll view.
Finder mainScrollable() => find.descendant(of: find.byType(CustomScrollView), matching: find.byType(Scrollable)).first;

/// One production entry as the dashboard's rows look (see the entries API).
Map<String, dynamic> drillRow(
  String id, {
  String date = '2026-09-01',
  String machine = 'm1',
  String operator = 'Asha',
  String item = 'i1',
  String itemName = 'Bracket',
  int actual = 700,
  int ok = 690,
  Map<String, dynamic>? reject,
  Map<String, dynamic> extra = const {},
}) =>
    {
      '_id': id,
      'date': date,
      'machine': machine,
      'slot': 1,
      'operator': operator,
      'item': item,
      'itemName': itemName,
      'totalCycleSec': 36,
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': actual,
      'okQty': ok,
      'rejectedQty': actual - ok,
      'rejectBreakdown': reject ?? {'Dimension Out': actual - ok},
      'plannedOperatorShiftHours': 8,
      'lunchMin': 30,
      'setupMin': 10,
      ...extra,
    };

/// OK 690 + 600 on 7A, 380 on 7B; operators Asha / Ravi; parts Bracket / Flange.
List<Map<String, dynamic>> drillRows() => [
      drillRow('e1'),
      drillRow('e2', date: '2026-09-02', operator: 'Ravi', actual: 600, ok: 600, reject: {}),
      drillRow('e3', date: '2026-09-02', machine: 'm2', item: 'i2', itemName: 'Flange', actual: 400, ok: 380, reject: {'Other': 12, 'Burr': 8}, extra: {
        'rejectOtherRemark': 'scratches',
        'otherMin': 20,
        'otherMinRemark': 'waiting for crane',
        'remarks': 'night shift',
      }),
    ];
