import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/features/production/processes/bpc/bpc_spec.dart';
import 'package:indo/features/production/production_sheet_screen.dart';
import 'package:indo/features/production/sheet/sheet_model.dart';
import 'package:indo/features/production/sheet/widgets/entry_detail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../support/fake_api.dart';

/// The BEFORE POWDER COATING list page: the table in the sheet's order and
/// words, the day cards per operator, and the expanded entry.
const spec = bpcSpec;
const listPath = '${Endpoints.v1}/bpc-sheet';

final operators = <Map<String, dynamic>>[
  {'_id': 'op1', 'name': 'SUREKHA', 'processes': ['p1']},
];
final p1 = <String, dynamic>{'_id': 'p1', 'processName': 'BEFORE POWDER COATING', 'dataEntryMenu': '/hqepl/production/before-powder-coating-data-entry'};

/// Two paper rows of one operator's date: each entry keeps its own OEE.
final first = <String, dynamic>{
  '_id': 'e1', 'date': '2026-05-13', 'worker': 'op1', 'machine': 'op1', 'process': 'p1', 'slot': 1, 'operator': 'SUREKHA',
  'itemName': 'BODY', 'vendorName': 'Acme', 'machineOnTime': '08:15', 'machineOffTime': '15:00', 'totalCycleSec': 27,
  'actualQty': 796, 'okQty': 795, 'rejectedQty': 1, 'rejectBreakdown': {'Blow Holes Casting': 1}, 'rejectReason': 'Blow Holes Casting',
  'plannedOperatorShiftHours': 6.75, 'lunchMin': 30, 'remarks': 'first lot',
};
final second = <String, dynamic>{
  '_id': 'e2', 'date': '2026-05-13', 'worker': 'op1', 'machine': 'op1', 'process': 'p1', 'slot': 2, 'operator': 'SUREKHA',
  'itemName': 'BODY', 'machineOnTime': '15:00', 'machineOffTime': '18:00', 'totalCycleSec': 30,
  'actualQty': 345, 'okQty': 286, 'rejectedQty': 59, 'rejectBreakdown': {'Crack/Damage Casting': 50, 'Other': 9}, 'rejectOtherRemark': 'chipped',
  'plannedOperatorShiftHours': 3, 'otherMin': 5, 'otherMinRemark': 'no power',
};

FakeApi installList({List<Map<String, dynamic>>? rows}) {
  final api = FakeApi.install();
  api.list(Endpoints.machines, []);
  api.list(Endpoints.items, [
    {'_id': 'i1', 'itemName': 'BODY', 'totalCycleSec': 27, 'process': 'p1'},
  ]);
  api.list(Endpoints.machineOperators, operators);
  api.list(Endpoints.processes, [p1]);
  api.list(Endpoints.companyHolidays, []);
  api.list(Endpoints.vendors, [
    {'_id': 'v1', 'name': 'Acme', 'isActive': true, 'processes': ['p1']},
  ]);
  api.on('GET', Endpoints.weeklyOff, (_) => {'isOk': true, 'data': {'weeklyOffDays': [0]}});
  api.on('GET', '$listPath/extent', (_) => {'isOk': true, 'data': {'from': '2025-01-01', 'to': '2026-12-31'}});
  api.on('GET', '$listPath/filter-options', (_) => {
        'isOk': true,
        'data': {'machine': ['op1'], 'operator': <String>[], 'item': ['BODY']},
        'machineNames': {'op1': 'SUREKHA'},
      });
  api.on('GET', listPath, (_) => {
        'isOk': true,
        'data': rows ?? [first, second],
        'meta': {'page': 1, 'totalPages': 1, 'totalDays': 1},
        'machineNames': {'op1': 'SUREKHA'},
      });
  return api;
}

Finder k(String key) => find.byKey(ValueKey(key));

String cellText(WidgetTester tester, String key) =>
    tester.widget<Text>(find.descendant(of: k(key), matching: find.byType(Text)).first).data ?? '';

void main() {
  testWidgets('the table: Operator frozen beside Date, the sheet\'s columns and each entry\'s own OEE', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final api = installList();
    await pumpScreen(tester, const ProductionSheetScreen(spec: spec), size: const Size(3600, 900));
    expect(find.text('BEFORE POWDER COATING Data Entry'), findsWidgets);
    for (final key in [
      'date', 'machine', 'itemName', 'vendorName', 'workingMode', 'machineStatus', 'on', 'off', 'shift', 'cycle', 'totalQty', 'okQty',
      'rejectedQty', 'idealQty', 'idealQtyPerHour', 'plannedShift', 'setupMin', 'bdMechMin', 'lunchMin', 'otherMin', 'totalStoppage',
      'effective', 'unreported', 'availability', 'performance', 'quality', 'oeeLosses', 'oeeLunch', 'review', 'remarks',
    ]) {
      expect(k('head-$key'), findsOneWidget, reason: key);
    }
    // No machine-sheet columns here.
    for (final key in ['operator', 'drawingNo', 'unutilized', 'oeeLunchCot', 'setupEff', 'pctOk']) {
      expect(k('head-$key'), findsNothing, reason: key);
    }
    expect(cellText(tester, 'e1:idealQty'), '900');
    expect(cellText(tester, 'e2:idealQty'), '360');
    expect(cellText(tester, 'e1:effective'), '5.97');
    // Each entry's own OEE considering losses: the paper's 88.44%, and 2.875 h ÷
    // (3 h − 5 min Other) for the second.
    expect(cellText(tester, 'e1:oeeLosses'), '88.44%');
    expect(cellText(tester, 'e2:oeeLosses'), '98.57%');
    expect(cellText(tester, 'e1:oeeLunch'), '95.52%');
    expect(cellText(tester, 'e1:totalQty'), '796');
    expect(cellText(tester, 'e2:rejectedQty'), '59');
    // The operator filter travels as ?worker=, never ?machine=.
    expect(api.called('GET', listPath).every((r) => !r.query.containsKey('machine')), isTrue);
    expect(api.misses, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the cards: one per operator-day, no single "day OEE" when the entries differ', (tester) async {
    SharedPreferences.setMockInitialValues({'sheet_view_mode': 'cards'});
    installList();
    await pumpScreen(tester, const ProductionSheetScreen(spec: spec), size: const Size(390, 844));
    expect(find.text('SUREKHA'), findsWidgets);
    expect(find.textContaining('2 entries · OK 1081 / 1141'), findsOneWidget);
    expect(find.text('1 operator · 2 entries'), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp('Day OEE')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a single entry keeps its OEE chip on the card', (tester) async {
    SharedPreferences.setMockInitialValues({'sheet_view_mode': 'cards'});
    installList(rows: [first]);
    await pumpScreen(tester, const ProductionSheetScreen(spec: spec), size: const Size(390, 844));
    expect(find.bySemanticsLabel(RegExp(r'Day OEE considering losses 88\.44%')), findsOneWidget);
  });

  testWidgets('the expanded entry: the sheet\'s two OEE figures, its quantities, reasons and remarks', (tester) async {
    final calc = spec.rowCalc(second);
    final day = spec.dayCalc([second]).single;
    await pumpScreen(
      tester,
      Scaffold(
        body: SingleChildScrollView(
          child: EntryDetail(
            spec: spec,
            row: second,
            calc: calc,
            day: day,
            lockMessage: '',
            unlockedUntil: null,
            canEdit: false,
            canDelete: false,
            isAdmin: false,
            unlocking: false,
            deleting: false,
            onEdit: () {},
            onDelete: () {},
            onUnlock: () {},
          ),
        ),
      ),
      size: const Size(390, 2400),
    );
    for (final t in [
      'Considering losses',
      'Lunch only',
      'TOTAL QTY',
      'OK QTY',
      'Rejected QTY',
      'Crack/Damage Casting',
      'Ideal Quantity',
      'Ideal Quantity/Hours',
      'Machine Shift Time (Hours)',
      'Planned Operator Shift (Hours)',
      'Effective Machine Run Time (hours)',
      'Unreported Time (min)',
      'Total Idle Time (Min)',
      'Availability (%)',
      'Working Status',
      'Reasons For Not Working',
      'Reason/Remarks',
    ]) {
      expect(find.textContaining(t, findRichText: true), findsWidgets, reason: t);
    }
    expect(find.text('98.57%'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  test('the day results the list keys by entry are each entry\'s own', () {
    final days = spec.dayCalc(sortByMachineOnForTest([first, second]));
    expect((days[0]['oeeLosses'] as double) * 100, closeTo(88.44, 0.01));
    expect(days[1]['oeeLosses'] as double, closeTo(2.875 / (3 - 5 / 60), 1e-9));
  });
}

List<Json> sortByMachineOnForTest(List<Json> rows) => [...rows]..sort((a, b) => '${a['machineOnTime']}'.compareTo('${b['machineOnTime']}'));
