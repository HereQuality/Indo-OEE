// The OEE Review rule on the phone / tablet, against the REAL web code
// (fixtures from tool/gen_oee_over_golden.mjs): an entry is held for Admin
// review when Availability, Performance, Quality OR any OEE / Productivity
// figure of its day is above 100% — and the entry form's banner says so.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/entry_form/entry_block.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/process/process_registry.dart';
import 'package:indo/features/production/processes/cnc/cnc_spec.dart' show cncSpec;
import 'package:indo/features/production/shared/production_sheet_calc.dart';
import 'package:indo/features/production/sheet/table/shared_columns.dart' show oeeFigureStyle, over100Style;
import 'package:indo/features/production/sheet/table/sheet_columns.dart' show CellStyle, CellStyleFn, ColTone, SheetCol;

import '../../support/fake_api.dart';
import '../calc/golden_support.dart';
import '../entry_form_harness.dart' show blankEntry, testItems, testMachines, testOperators;

const _dir = 'test/production/oee_review/fixtures';

List<Map<String, dynamic>> _maps(Object? v) => [for (final e in (v as List)) Map<String, dynamic>.from(e as Map)];

void main() {
  final golden = loadFixture('oee_over.json', dir: _dir) as Map<String, dynamic>;

  test('labels and figure keys are the web\'s', () {
    expect(oeeMetricLabels, golden['labels']);
    expect({for (final e in oeeFigureKeys.entries) e.key: e.value}, golden['figureKeys']);
  });

  test('metricsOver100: an OEE figure alone, tolerance, blanks', () {
    expect(
      metricsOver100({'availability': 1, 'performance': .95, 'quality': 1, 'oeeLosses': 1.025, 'oeeLunch': 1.025, 'oeeLunchCot': .99}),
      ['oeeLosses', 'oeeLunch'],
    );
    expect(metricsOver100({'productivity': 1.2, 'productivityLunch': 1.3}), ['productivity', 'productivityLunch']);
    expect(metricsOver100({'availability': 1.01, 'oeeLosses': 1.02}), ['availability', 'oeeLosses']);
    expect(
      metricsOver100({'availability': 1, 'oeeLosses': 1 + 1e-12, 'oeeLunch': null, 'oeeLunchCot': null, 'productivity': .5}),
      isEmpty,
    );
    expect(metricsOver100(null), isEmpty);
  });

  test('table cells: the OEE / Productivity day figures go red above 100%, nothing else does', () {
    SheetCol col(String key, {ColTone tone = ColTone.oee, CellStyleFn? style}) =>
        SheetCol(key: key, label: key, width: 100, tone: tone, text: (_) => '', style: style);
    for (final k in ['oeeLosses', 'oeeLunch', 'oeeLunchCot', 'productivity', 'productivityLunch']) {
      expect(oeeFigureStyle(col(k), {k: 1.0001}), CellStyle.danger, reason: k);
      expect(oeeFigureStyle(col(k), {k: 1.0}), isNull, reason: k);
      expect(oeeFigureStyle(col(k), {k: null}), isNull, reason: k);
    }
    expect(oeeFigureStyle(col('unreportedMin'), {'unreportedMin': 5}), isNull);
    expect(oeeFigureStyle(col('oeeLosses', tone: ColTone.calc), {'oeeLosses': 2}), isNull);
    expect(over100Style(1 + 1e-12), isNull);
  });

  group('golden: ProcessSpec.oeeOver100 (day figures + own figures) matches the web for all 18 processes', () {
    final sheets = golden['sheets'] as Map<String, dynamic>;
    test('every process is covered', () {
      expect({for (final s in ProcessRegistry.all) s.key}, sheets.keys.toSet());
    });
    for (final spec in ProcessRegistry.all) {
      test(spec.key, () {
        final sheet = sheets[spec.key] as Map<String, dynamic>;
        expect(spec.oeeFigureKind, sheet['kind']);
        var withOver = 0;
        final cases = sheet['cases'] as List;
        for (var i = 0; i < cases.length; i++) {
          final c = cases[i] as Map<String, dynamic>;
          final values = Map<String, dynamic>.from(c['values'] as Map);
          final got = spec.oeeOver100(values, saved: _maps(c['saved']));
          expect(got, c['over'], reason: '${spec.key} case $i $values');
          if (got.isNotEmpty) withOver++;
        }
        expect(withOver, greaterThan(0), reason: 'the fixture must exercise a breach');
      });
    }
  });

  // The web test's day: a morning entry (264 of an ideal 240/h) and an afternoon
  // entry at 95% — alone fine, but the day together is 492 / 480 = 102.5%.
  Map<String, dynamic> shift(String on, String off, int qty, {String? id}) => {
        ...blankEntry(machine: 'm1'),
        '_id': ?id,
        'date': '2026-10-20',
        'operator': 'Asha Kumar',
        'item': 'i1',
        'itemName': 'Flange 40',
        'totalCycleSec': '60',
        'machineOnTime': on,
        'machineOffTime': off,
        'actualQty': '$qty',
        'okQty': '$qty',
        'plannedOperatorShiftHours': '4',
      };
  final morning = {...shift('08:00', '12:00', 264, id: 'saved-1'), 'plannedOperatorShiftHours': 4.0};

  Future<void> pump(WidgetTester tester, Map<String, dynamic> entry, List<Map<String, dynamic>> saved, {Size size = const Size(390, 844)}) async {
    FakeApi.install();
    EntryBlock.contentBuilds.clear();
    await pumpScreen(
      tester,
      Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: ProductionEntryForm(
            spec: cncSpec,
            entries: [entry],
            errors: const [<String, String>{}],
            isSubmit: false,
            machines: testMachines,
            items: testItems,
            operators: testOperators,
            savedRows: saved,
            onChange: (_, _, _) {},
            onItemSelect: (_, _) {},
            onRejectChange: (_, _, _) {},
            onAdd: () {},
            onRemove: (_) {},
          ),
        ),
      ),
      size: size,
    );
    await tester.pumpAndSettle();
  }

  final banner = find.byKey(const ValueKey('entry0/oeeCheck'));
  final afternoon = shift('13:00', '17:00', 228);

  group('the form banner', () {
    testWidgets('fires on an OEE-only breach: a sibling entry of the same date pushes the day above 100%', (tester) async {
      expect(metricsOver100(cncSpec.metrics(afternoon).oeeCalc), isEmpty, reason: 'its own A / P / Q are fine');
      await pump(tester, afternoon, [morning]);
      await tester.ensureVisible(banner);
      expect(banner, findsOneWidget);
      final text = tester.widget<Text>(find.descendant(of: banner, matching: find.byType(Text)));
      expect(
        text.data,
        'OEE considering losses, OEE not considering losses but lunch, OEE not considering losses but lunch & setup time above 100% '
        '— this entry will still save, but goes to Admin review. Check the cycle time, quantities and stoppage.',
      );
    });

    testWidgets('no banner without the sibling, for another machine or another date, or when it is this entry\'s own saved copy', (tester) async {
      await pump(tester, afternoon, const []);
      expect(banner, findsNothing);
      await pump(tester, afternoon, [{...morning, 'machine': 'm2'}]);
      expect(banner, findsNothing);
      await pump(tester, afternoon, [{...morning, 'date': '2026-10-19'}]);
      expect(banner, findsNothing);
      // Editing an entry: its saved copy (here 400 pieces) is replaced by what is typed.
      await pump(tester, shift('13:00', '17:00', 228, id: 'saved-2'), [shift('13:00', '17:00', 400, id: 'saved-2')]);
      expect(banner, findsNothing);
    });

    testWidgets('a tablet layout shows it too', (tester) async {
      await pump(tester, afternoon, [morning], size: const Size(1024, 768));
      await tester.ensureVisible(banner);
      expect(banner, findsOneWidget);
    });
  });
}
