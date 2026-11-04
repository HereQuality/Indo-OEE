// KPI / Company Level Objective models read what controllers/kpi.controller.js sends.
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/kpi/kpi_models.dart';
import 'package:indo/features/kpi/kpi_widgets.dart';

void main() {
  test('an objective with its months, a deleted process and Excel-loaded months', () {
    final o = KpiObjective.from({
      '_id': 'o1',
      'objective': 'Increase OK output',
      'department': {'_id': 'd1', 'departmentName': 'Production'},
      'year': 2026,
      'processes': [
        {'_id': 'p1', 'processName': 'CNC'},
        'p9',
      ],
      'baseline': {'value': 1000, 'uom': 'Qty'},
      'target': {'value': 1500, 'uom': 'Qty'},
      'targetPeriod': 'Yearly',
      'okQtyUom': '%',
      'owner': 'Plant Head',
      'months': [
        {'month': 1, 'okQty': 1200, 'cumulative': 1200, 'pctOfTarget': 80, 'status': 'Near', 'source': 'excel'},
        {'month': 2, 'okQty': 0, 'cumulative': 1200, 'pctOfTarget': null, 'status': null, 'source': null},
      ],
      'yearOkQty': 1200,
      'yearPct': 80,
      'yearStatus': 'Near',
    });
    expect(o.departmentName, 'Production');
    expect(o.processes.map((p) => p.name), ['CNC', '']);
    expect(o.yearly, isTrue);
    expect(o.okQtyUom, '%');
    expect(o.months.first.source, 'excel');
    expect(o.months[1].status, isNull);
    expect(o.yearStatus, 'Near');
  });

  test('a company summary and the figures it is shown with', () {
    final s = CompanySummary.from({
      'year': 2026,
      'objectives': [
        {'_id': 'c1', 'objective': 'Grow sales', 'year': 2026, 'target': {'value': 200000, 'uom': 'Qty'}, 'baseline': {'value': 5, 'uom': '%'}, 'achievedPct': 116.95, 'status': 'On track'},
      ],
      'byMonth': [for (var m = 1; m <= 12; m++) {'month': m, 'okQty': m == 10 ? 232715 : 0, 'source': m == 3 ? 'excel' : null}],
      'byYear': [{'year': 2026, 'okQty': 233902}],
      'yearOkQty': 233902,
      'totalOkQty': 233902,
      'avgAchievementPct': null,
      'kpiObjectiveCount': 0,
      'kpiOnTrack': 0,
      'kpiBehind': 0,
    });
    expect(s.objectives.single.status, 'On track');
    expect(s.byMonth[9].okQty, 232715);
    expect(s.byMonth[2].source, 'excel');
    expect(fmtQty(s.totalOkQty), '2,33,902');
    expect(fmtPct(s.objectives.single.achievedPct), '117.0%');
    expect(measureText(s.objectives.single.baseline), '5.0%');
    expect(measureText(const Measure()), '—');
    expect(deltaPct(120, 100), 20);
    expect(deltaPct(120, 0), isNull);
  });
}
