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
        {'month': 2, 'okQty': 900, 'rejectedQty': 100, 'qualityPct': 90, 'cumulative': 2100, 'pctOfTarget': null, 'status': null, 'source': 'entries'},
      ],
      'yearOkQty': 2100,
      'yearRejectedQty': 100,
      'yearQualityPct': 95.45,
      'yearPct': 80,
      'yearStatus': 'Near',
    });
    expect(o.departmentName, 'Production');
    expect(o.processes.map((p) => p.name), ['CNC', '']);
    expect(o.yearly, isTrue);
    expect(o.pctTarget, isFalse);
    expect(o.okQtyUom, '%');
    expect(o.months.first.source, 'excel');
    expect(o.months.first.qualityPct, isNull);
    expect(o.months[1].rejectedQty, 100);
    expect(o.months[1].qualityPct, 90);
    expect(o.months[1].status, isNull);
    expect(o.yearQualityPct, 95.45);
    expect(o.yearStatus, 'Near');
  });

  test('the department lines of the KPI page', () {
    final d = DepartmentSummary.from({'_id': 'd1', 'departmentName': 'Quality', 'objectives': 3, 'onTrack': 1, 'near': 1, 'behind': 1, 'okQty': 4200, 'avgPct': 86.5});
    expect(d.name, 'Quality');
    expect(d.status, 'Near');
    expect(DepartmentSummary.from({'_id': 'd2', 'departmentName': 'Sales', 'objectives': 0}).status, isNull);
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

  test('the business figures: a metric year, the figure in scope and the board formats', () {
    final s = CompanySummary.from({
      'year': 2026,
      'byMonth': [for (var m = 1; m <= 12; m++) {'month': m, 'okQty': m == 2 ? 500 : 0}],
      'byYear': [{'year': 2025, 'okQty': 900}, {'year': 2026, 'okQty': 500}],
      'yearOkQty': 500,
      'metrics': {
        'sales': {'months': [100, 300, null, null, null, null, null, null, null, null, null, null], 'year': 400, 'prevYear': 50, 'monthsWithData': 2},
        'labourProductivity': {'months': [10, 15, null, null, null, null, null, null, null, null, null, null], 'year': 12.5, 'prevYear': null, 'monthsWithData': 2},
      },
      'monthsWithFigures': [true, true, false],
      'monthly': [{'month': 2, 'values': {'sales': 300, 'salary': 20}, 'updatedByName': 'Mann'}],
    });
    final sales = s.metric('sales');
    expect(sales.at(0), 400);
    expect(sales.before(0), 50);
    expect(sales.at(2), 300);
    expect(sales.before(2), 100);
    expect(sales.before(1), isNull);
    expect(s.metric('electricityBill').at(0), isNull);
    expect(s.okQtyAt(0), 500);
    expect(s.okQtyBefore(0), 900);
    expect(s.okQtyAt(2), 500);
    expect(s.monthly.single.values['salary'], 20);
    expect(s.monthly.single.values['electricityBill'], isNull);
    expect(fmtMoneyShort(208980000), '208.98M');
    expect(fmtMoneyShort(629460), '629.46K');
    expect(fmtMoneyShort(950), '950');
    expect(fmtMoneyFull(1234567), '₹ 12,34,567');
    expect(fmtMetric(companyMetric('onTimeDelivery'), 87.48), '87.5%');
    expect(fmtMetric(companyMetric('inventoryTurnover'), 6.4), '6.40');
    expect(fmtMetric(companyMetric('customerComplaints'), 16), '16');
  });
}
