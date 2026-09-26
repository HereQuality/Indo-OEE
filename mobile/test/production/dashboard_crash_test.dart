import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/charts/chart_props.dart';
import 'package:indo/features/production/dashboard/charts/charts_registry.dart';
import 'package:indo/features/production/dashboard/dashboard_engine.dart' as eng;
import 'package:indo/features/production/dashboard/data/dashboard_models.dart';
import 'package:indo/features/production/dashboard/shell/dashboard_controller.dart';
import 'package:indo/features/production/dashboard/sheets/date_range_sheet.dart';
import 'package:indo/features/production/dashboard/sheets/drill_sheet.dart';
import 'package:indo/features/production/dashboard/sheets/filter_sheet.dart';
import 'package:indo/features/production/production_dashboard_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';
import 'dashboard_shell_fixtures.dart';

/// Production-shaped, deliberately messy rows: what a real Mongo collection
/// hands back after years of legacy sheets, half-filled entries and schema
/// changes. Numbers arrive as int / double / numeric text / null / missing;
/// names are missing or numeric; dates are odd; breakdowns are odd types.
Object? _num(Random r, num v) {
  switch (r.nextInt(12)) {
    case 0:
      return null;
    case 1:
      return '$v';
    case 2:
      return v.toDouble();
    case 3:
      return '';
    case 4:
      return 'abc';
    case 5:
      return -v;
    case 6:
      return 0;
    case 7:
      return ' $v ';
    default:
      return v.toInt();
  }
}

Object? _time(Random r, String ok) {
  switch (r.nextInt(9)) {
    case 0:
      return null;
    case 1:
      return '';
    case 2:
      return '25:99';
    case 3:
      return 'abc';
    case 4:
      return 800;
    case 5:
      return '8:00';
    default:
      return ok;
  }
}

Map<String, dynamic> messyRow(Random r, int i, {List<String> machines = const ['m1', 'm2', 'm3', 'ghost']}) {
  final day = 1 + r.nextInt(28);
  final month = 1 + r.nextInt(12);
  final dates = <Object?>[
    '2026-${month.toString().padLeft(2, '0')}-${day.toString().padLeft(2, '0')}',
    '2026-09-${day.toString().padLeft(2, '0')}',
    '2026-09-01',
    '2026-02-30',
    '2026-9-1',
    '',
    null,
    '2026-09-01T00:00:00.000Z',
    20260901,
    '2025-12-31',
    '2026-01-01',
  ];
  final row = <String, dynamic>{
    '_id': 'e$i',
    'date': dates[r.nextInt(dates.length)],
    'machine': r.nextInt(15) == 0 ? null : machines[r.nextInt(machines.length)],
    'slot': 1 + r.nextInt(3),
    'operator': [null, '', 'Asha', 'Ravi', 42, '  Sam  ', 'A very long operator name that keeps going and going'][r.nextInt(7)],
    'itemName': [null, '', 'Bracket', 'Flange', 7, 'Ø25 x 40 (rev-B)'][r.nextInt(6)],
    'item': r.nextBool() ? null : 'i${r.nextInt(3)}',
    'totalCycleSec': _num(r, 20 + r.nextInt(100)),
    'machineOnTime': _time(r, '08:00'),
    'machineOffTime': _time(r, '16:00'),
    'settingOnTime': _time(r, '08:00'),
    'settingOffTime': _time(r, '08:30'),
    'actualQty': _num(r, r.nextInt(3000)),
    'okQty': _num(r, r.nextInt(3000)),
    'rejectedQty': _num(r, r.nextInt(50)),
    'plannedOperatorShiftHours': _num(r, 8),
    'rejectReason': [null, '', 'Tool Mark', 'Other', 9][r.nextInt(5)],
    'rejectBreakdown': [
      null,
      <String, dynamic>{},
      {'Dimension Out': _num(r, 5)},
      {'': 3},
      {'0': 1, 'Tool Mark': 'x'},
      [1, 2],
      'oops',
      {'Other': 4, 'Surface Finish': 2.5},
    ][r.nextInt(8)],
    'excludedOps': [null, <String>[], ['drilling'], 'x'][r.nextInt(4)],
    'cycleOpsSec': [null, <num>[], [1, 2], 'x'][r.nextInt(4)],
    'remarks': [null, '', 'ok'][r.nextInt(3)],
    'unlockedUntil': null,
  };
  for (final k in ['plannedDownMin', 'setupMin', 'noManPowerMin', 'materialShiftingMin', 'noMaterialMin', 'bdMechMin', 'bdEleMin', 'noPowerMin', 'lunchMin', 'otherMin']) {
    if (r.nextInt(3) != 0) row[k] = _num(r, r.nextInt(120));
  }
  if (r.nextInt(6) == 0) row['extra_unknown_key'] = {'deep': [1, 2, 3]};
  if (r.nextInt(8) == 0) row.remove('actualQty');
  if (r.nextInt(10) == 0) row['actualQty'] = 1e15;
  if (r.nextInt(10) == 0) row['okQty'] = 1e-9;
  return row;
}

List<Map<String, dynamic>> messyRows(int n, {int seed = 7}) {
  final r = Random(seed);
  final rows = [for (var i = 0; i < n; i++) messyRow(r, i)];
  // Same shape the shell hands the engine: ints widened, string keys.
  return DashboardEntries.fromResponse({'data': rows}).rows;
}

DashboardCtx messyCtx() => const DashboardCtx(
      // 'ghost' is in no machine list; m3 has an empty name; m1 has a long name.
      machineName: {'m1': '7A', 'm2': '', 'm3': 'A machine with a very very long display name'},
      machineOrder: {'m1': 0, 'm2': 1, 'm3': 2},
      bucket: 'date',
    );

Future<void> _pumpChart(WidgetTester t, String key, List<Map<String, dynamic>> rows, {ChartView view = ChartView.chart, bool expanded = false, bool dark = true, double scale = 1.6, DashboardCtx? ctx, String bucket = 'date'}) async {
  final c = ctx ?? messyCtx();
  await pumpScreen(
    t,
    Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(12),
        child: Builder(
          builder: (context) {
            final body = Card(
              margin: EdgeInsets.zero,
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: dashboardCharts[key]!(DashboardChartProps(
                  rowsFor: (_) => rows,
                  ctx: DashboardCtx(machineName: c.machineName, machineOrder: c.machineOrder, bucket: bucket),
                  colors: DashboardColors.of(context),
                  filters: const {},
                  onToggle: (_, _) {},
                  onDrill: (_) {},
                  view: view,
                  expanded: expanded,
                )),
              ),
            );
            return expanded ? body : Align(alignment: Alignment.topCenter, child: SizedBox(height: 280, child: body));
          },
        ),
      ),
    ),
    dark: dark,
    size: const Size(360, 640),
    textScale: scale,
  );
}

void main() {
  setUp(() {
    pinDashboardClock();
    SharedPreferences.setMockInitialValues({});
  });
  tearDown(unpinDashboardClock);

  group('engine on messy production rows', () {
    test('summarize / summarizeBy / filters / options never throw and never yield NaN or Infinity', () {
      for (var seed = 0; seed < 25; seed++) {
        final rows = messyRows(120, seed: seed);
        final s = eng.summarize(rows);
        for (final e in s.entries) {
          final v = e.value;
          if (v is double) expect(v.isFinite, isTrue, reason: 'seed $seed ${e.key} = $v');
        }
        final ctl = DashboardController(machines: [
          {'_id': 'm1', 'machineName': '7A'},
          {'_id': 'm2'},
          {'_id': null, 'machineName': null},
        ]);
        ctl.rows = rows;
        expect(ctl.summary, isNotNull);
        expect(ctl.filterOptions['machine'], isNotNull);
        for (final d in eng.dimensions.keys) {
          eng.summarizeBy(rows, d, ctl.ctx);
        }
        // Cross-filter every option of every dimension.
        for (final dim in ['machine', 'operator', 'item']) {
          for (final o in ctl.filterOptions[dim]!) {
            ctl.toggle(dim, o['value']!);
            expect(ctl.filtered.length, lessThanOrEqualTo(rows.length));
            ctl.toggle(dim, o['value']!);
          }
        }
        ctl.dispose();
      }
    });

    test('period helpers survive odd ranges and extents', () {
      for (final range in [
        ['', ''],
        ['2026-09-01', '2026-09-01'],
        ['2026-02-30', '2026-03-01'],
        ['2026-13-01', '2026-13-30'],
        ['0001-01-01', '9999-12-31'],
      ]) {
        try {
          eng.describeRange(range);
          eng.quickRangeKey(range);
          eng.rangeDays(range);
        } on FormatException {
          // A documented failure mode; the sheets guard it.
        }
      }
      for (final ext in <Map<String, dynamic>?>[
        null,
        {},
        {'from': null, 'to': null},
        {'from': 'abc', 'to': 'xyz'},
        {'from': '0001-01-01', 'to': '9999-12-31'},
        {'from': '2030-01-01', 'to': '2020-01-01'},
      ]) {
        eng.yearsOfExtent(ext);
      }
    });
  });

  group('every chart on messy rows', () {
    for (final size in [0, 1, 40, 400]) {
      testWidgets('$size rows: chart + table, phone dark 1.6x, both buckets', (t) async {
        final rows = messyRows(size, seed: size + 3);
        for (final key in dashboardCharts.keys) {
          for (final view in ChartView.values) {
            for (final expanded in [false, true]) {
              await _pumpChart(t, key, rows, view: view, expanded: expanded, bucket: expanded ? 'month' : 'date');
              expect(t.takeException(), isNull, reason: '$key $view expanded=$expanded n=$size');
            }
          }
        }
      });
    }

    testWidgets('one machine, one day, zero quantities, huge quantities', (t) async {
      final zero = [
        {'_id': 'z1', 'date': '2026-09-01', 'machine': 'm1', 'actualQty': 0, 'okQty': 0, 'totalCycleSec': 0, 'machineOnTime': '08:00', 'machineOffTime': '08:00'},
      ];
      final huge = [
        {'_id': 'h1', 'date': '2026-09-01', 'machine': 'm1', 'actualQty': 1e15, 'okQty': 1e15, 'totalCycleSec': 1e-6, 'machineOnTime': '00:00', 'machineOffTime': '23:59', 'lunchMin': 1440},
      ];
      for (final rows in [zero, huge]) {
        final w = DashboardEntries.fromResponse({'data': rows}).rows;
        for (final key in dashboardCharts.keys) {
          for (final view in ChartView.values) {
            await _pumpChart(t, key, w, view: view);
            expect(t.takeException(), isNull, reason: key);
          }
        }
      }
    });
  });

  group('the whole Dashboard tab on messy server data', () {
    Future<FakeApi> pumpTab(WidgetTester t, {required Object? Function(FakeRequest) entries, List<Map<String, dynamic>>? processes, List<Map<String, dynamic>>? machines, Size size = const Size(390, 844), bool dark = false, double scale = 1.0}) async {
      final api = FakeApi.install();
      installDashboardApi(api, processes: processes, machines: machines, entries: entries);
      await pumpScreen(t, const ProductionDashboardScreen(), size: size, dark: dark, textScale: scale);
      return api;
    }

    Map<String, dynamic> payload(List<Map<String, dynamic>> rows, {Object? extent = const {'from': '2026-01-05', 'to': '2026-09-14'}, Object? names}) => {
          'isOk': true,
          'data': rows,
          'extent': extent,
          'machineNames': names ?? {'m1': '7A', 'm2': null, 'ghost': 'Retired 9Z'},
        };

    for (final n in [0, 1, 300]) {
      testWidgets('$n messy rows: phone + iPad, light + dark, text 1.6x', (t) async {
        for (final (size, dark, scale) in [
          (const Size(390, 844), false, 1.0),
          (const Size(360, 640), true, 1.6),
          (const Size(820, 1180), true, 1.0),
        ]) {
          await pumpTab(t, entries: (_) => payload(messyRows(n)), size: size, dark: dark, scale: scale);
          expect(t.takeException(), isNull, reason: '$n rows $size');
          // Scroll through the whole thing.
          final scroll = find.byType(CustomScrollView);
          if (scroll.evaluate().isNotEmpty) {
            for (var i = 0; i < 6; i++) {
              await t.drag(scroll.first, const Offset(0, -600));
              await t.pump(const Duration(milliseconds: 100));
            }
          }
          expect(t.takeException(), isNull, reason: '$n rows scrolled $size');
        }
      });
    }

    testWidgets('5000 rows still build', (t) async {
      await pumpTab(t, entries: (_) => payload(messyRows(5000, seed: 99)));
      expect(t.takeException(), isNull);
    });

    testWidgets('null / odd processes, machines, extents and machineNames payloads', (t) async {
      final weirdProcesses = <Map<String, dynamic>>[
        {'_id': 'p1', 'processName': null, 'machines': null, 'stats': 'x', 'charts': [1, null, 'oeeTrend', 'nope']},
        {'_id': 'p2', 'processName': 'PRESS', 'machines': [null, 5, {'_id': 'mm', 'machineName': null}, {}], 'stats': [], 'charts': null},
        {'processName': 'No id', 'machines': [{'_id': 'x1', 'machineName': 'X1'}]},
      ];
      for (final extent in <Object?>[null, 'x', {}, {'from': 5, 'to': null}, {'from': 'abc', 'to': '2026-99-99'}]) {
        await pumpTab(
          t,
          processes: weirdProcesses,
          machines: [
            {'_id': 'mm'},
            {'machineName': 'nameless-id'},
          ],
          entries: (_) => payload(messyRows(30), extent: extent, names: 'not a map'),
        );
        expect(t.takeException(), isNull, reason: 'extent $extent');
      }
    });

    testWidgets('server returns garbage bodies and errors', (t) async {
      for (final body in <Object?>[
        {'isOk': true},
        {'isOk': true, 'data': 'nope'},
        {'isOk': true, 'data': [null, 1, 'x', [], {}]},
        {'isOk': false, 'message': 'boom'},
      ]) {
        await pumpTab(t, entries: (_) => body);
        expect(t.takeException(), isNull, reason: '$body');
      }
    });

    testWidgets('tap every KPI tile (drill sheet), the Filters sheet and the period sheet on messy rows', (t) async {
      await pumpTab(t, entries: (_) => payload(messyRows(150, seed: 5)), size: const Size(360, 640), dark: true, scale: 1.6);
      expect(t.takeException(), isNull);
      final tiles = find.byWidgetPredicate((w) => w.key is ValueKey<String> && (w.key as ValueKey<String>).value.startsWith('kpi:'));
      final count = tiles.evaluate().length;
      for (var i = 0; i < count; i++) {
        final tile = tiles.at(i);
        await t.ensureVisible(tile);
        await t.pump();
        await t.tap(tile, warnIfMissed: false);
        await t.pumpAndSettle(const Duration(milliseconds: 100));
        expect(t.takeException(), isNull, reason: 'drill from KPI $i');
        // Close the sheet by tapping the barrier.
        await t.tapAt(const Offset(180, 4));
        await t.pumpAndSettle(const Duration(milliseconds: 100));
      }
      await t.tap(find.text('Filters'));
      await t.pumpAndSettle();
      expect(t.takeException(), isNull);
      // Monkey the search box.
      final search = find.byType(TextField);
      expect(search, findsOneWidget);
      for (final s in ['12abc', '1.2.3', '0000000000', '', '   ', 'Ø', '%', '(((', 'A very long operator'] ) {
        await t.enterText(search, s);
        await t.pump(const Duration(milliseconds: 50));
        expect(t.takeException(), isNull, reason: 'search "$s"');
      }
    });

    testWidgets('changing the process chip and the period while a load is in flight', (t) async {
      final api = FakeApi.install();
      installDashboardApi(api, entries: (r) async {
        await Future<void>.delayed(Duration(milliseconds: r.query['process'] == 'p2' ? 5 : 40));
        return payload(messyRows(20, seed: r.query['process'] == 'p2' ? 1 : 2));
      });
      await pumpScreen(t, const ProductionDashboardScreen(), settle: false);
      await t.pump(const Duration(milliseconds: 5));
      for (var i = 0; i < 3; i++) {
        for (final label in ['PRESS', 'VMC', 'All machines']) {
          final chip = find.text(label);
          if (chip.evaluate().isNotEmpty) await t.tap(chip.first, warnIfMissed: false);
          await t.pump(const Duration(milliseconds: 3));
        }
      }
      await t.pumpAndSettle(const Duration(milliseconds: 50));
      expect(t.takeException(), isNull);
    });
  });

  group('sheets on messy input', () {
    Future<void> openSheet(WidgetTester t, void Function(BuildContext) open, {Size size = const Size(360, 640), double scale = 1.6}) async {
      FakeApi.install();
      await pumpScreen(
        t,
        Builder(builder: (context) => Scaffold(body: Center(child: FilledButton(onPressed: () => open(context), child: const Text('open'))))),
        dark: true,
        size: size,
        textScale: scale,
      );
      await t.tap(find.text('open'));
      await t.pumpAndSettle();
    }

    testWidgets('drill sheet: every measure, every dimension tab, on messy rows', (t) async {
      final rows = messyRows(120, seed: 11);
      for (final stat in eng.statCatalog) {
        await openSheet(t, (c) => showDrillSheet(c, measure: eng.statMeasure(stat), rows: rows, ctx: messyCtx(), onPick: (_, _) {}));
        expect(t.takeException(), isNull, reason: 'drill ${stat['key']}');
        for (final label in ['By Operator', 'By Part', 'By Date', 'By Month', 'By Machine', 'Entries']) {
          final tab = find.text(label);
          if (tab.evaluate().isNotEmpty) {
            await t.tap(tab.first, warnIfMissed: false);
            await t.pumpAndSettle(const Duration(milliseconds: 100));
            expect(t.takeException(), isNull, reason: 'drill ${stat['key']} $label');
          }
        }
        await t.tapAt(const Offset(180, 4));
        await t.pumpAndSettle();
      }
      await openSheet(t, (c) => showDrillSheet(c, measure: eng.causeMeasure('otherMin'), rows: rows, ctx: messyCtx(), onPick: (_, _) {}));
      expect(t.takeException(), isNull);
      await openSheet(t, (c) => showDrillSheet(c, measure: eng.reasonMeasure('Other'), rows: const [], ctx: messyCtx(), onPick: (_, _) {}));
      expect(t.takeException(), isNull);
    });

    testWidgets('filter sheet: empty, huge and odd option lists', (t) async {
      final many = [for (var i = 0; i < 600; i++) {'value': 'v$i', 'label': i.isEven ? 'Label $i' : ''}];
      for (final options in <Map<String, List<Map<String, String>>>>[
        {},
        {'machine': [], 'operator': [], 'item': []},
        {'machine': many, 'operator': many, 'item': many},
      ]) {
        await openSheet(t, (c) => showFilterSheet(c, options: options, filters: const {'machine': ['gone'], 'month': ['2026-99'], 'date': ['nope']}, onFilterSet: (_, _) {}, onClearAll: () {}));
        expect(t.takeException(), isNull);
        await t.tap(find.text('Operator'));
        await t.pumpAndSettle();
        await t.tap(find.text('Part'));
        await t.pumpAndSettle();
        expect(t.takeException(), isNull);
      }
    });

    testWidgets('date sheet: odd ranges and extents', (t) async {
      for (final (range, extent) in <(List<String>, Map<String, dynamic>?)>[
        (['2026-09-01', '2026-09-30'], null),
        (['2026-09-01', '2026-09-30'], {'from': 'abc', 'to': null}),
        (['2026-01-31', '2026-03-01'], {'from': '2019-01-01', 'to': '2026-09-14'}),
        (['2026-09-30', '2026-09-01'], {'from': '2030-01-01', 'to': '2020-01-01'}),
      ]) {
        await openSheet(t, (c) => showDateRangeSheet(c, range: range, extent: extent, onChanged: (_) {}));
        expect(t.takeException(), isNull, reason: '$range $extent');
        for (final tab in ['Month', 'Year', 'Range']) {
          final f = find.text(tab);
          if (f.evaluate().isNotEmpty) {
            await t.tap(f.first, warnIfMissed: false);
            await t.pumpAndSettle(const Duration(milliseconds: 100));
            expect(t.takeException(), isNull, reason: '$range $tab');
          }
        }
      }
    });
  });
}
