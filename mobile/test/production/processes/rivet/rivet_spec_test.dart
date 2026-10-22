import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/features/production/processes/rivet/rivet_metrics.dart';
import 'package:indo/features/production/processes/rivet/rivet_spec.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';

void main() {
  final row = <String, dynamic>{
    'date': '2026-09-20',
    'machine': 'm1',
    'itemName': 'Rivet 4mm',
    'processType': 'Rivet',
    'noOfHoles': 4,
    'rivetLoadingSec': 10,
    'rivetProcessSec': 20,
    'rivetUnloadingCleaningSec': 10,
    'rivetOtherOperationsSec': 5,
    'totalCycleSec': 45,
    'excludedOps': ['rivetOtherOperationsSec'],
    'machineOnTime': '08:00',
    'machineOffTime': '16:00',
    'okQty': 300,
    'rejectedQty': 20,
    'plannedOperatorShiftHours': 9,
    'lunchMin': 30,
    'otherMin': 10,
    'otherMinRemark': 'crane',
    'remarks': 'fine',
    'review': {'status': 'pending'},
  };

  test('identity and endpoints', () {
    expect(rivetSpec.key, 'rivet');
    expect(rivetSpec.routePath, '/production/rivet-data-entry');
    expect(rivetSpec.draftKey, 'rivetEntryDraft');
    expect(rivetSpec.api.list, '${Endpoints.v1}/rivet-sheet');
    expect(rivetSpec.api.row, '${Endpoints.v1}/rivet-sheet/row');
    expect(rivetSpec.api.occupied, '${Endpoints.v1}/rivet-sheet/occupied');
    expect(rivetSpec.scopeItemsToProcess, isTrue);
  });

  test('the table has the web columns in order, with the stoppage breakdown', () {
    final closed = rivetSpec.columns({});
    expect(closed.left.map((c) => c.key), ['date', 'machine']);
    final keys = closed.middle.map((c) => c.key).toList();
    expect(keys.take(14), [
      'operator', 'machineStatus', 'itemName', 'vendorName', 'drawingNo', 'processType', 'noOfHoles',
      'rivetLoadingSec', 'rivetProcessSec', 'rivetUnloadingCleaningSec', 'rivetOtherOperationsSec', 'cycle', 'on', 'off',
    ]);
    expect(keys, containsAllInOrder(['okQty', 'rejectedQty', 'pctOk', 'plannedShift', 'unutilized', 'totalStoppage', 'effective', 'unreported', 'setupEff', 'availability', 'performance', 'quality', 'oeeLosses', 'oeeLunch', 'oeeLunchCot', 'review', 'remarks']));
    expect(keys.contains('plannedDownMin'), isFalse);
    final open = rivetSpec.columns({'downtime'});
    expect(open.middle.map((c) => c.key), containsAllInOrder(['totalStoppage', 'plannedDownMin', 'setupMin', 'noManPowerMin', 'materialShiftingMin', 'noMaterialMin', 'bdMechMin', 'bdEleMin', 'noPowerMin', 'lunchMin', 'otherMin', 'effective']));
    expect(open.expandSummary['downtime'], 'totalStoppage');
  });

  test('cells read the row, the calc and the day', () {
    final calc = rivetSpec.rowCalc(row);
    final day = rivetSpec.dayCalc([row]).single;
    String cell(String key) {
      final col = rivetSpec.columns({'downtime'}).middle.firstWhere((c) => c.key == key);
      return col.text(CellData(row: row, calc: calc, day: day, machineName: 'RV-1'));
    }

    expect(cell('cycle'), '40'); // 45 - 5 (Other Operations unticked)
    expect(cell('idealQty'), '720'); // 8 h * 3600 / 40
    expect(cell('okQty'), '300');
    expect(cell('rejectedQty'), '20');
    expect(cell('machineStatus'), 'Working');
    expect(cell('totalStoppage'), '40');
    expect(cell('lunchMin'), '30');
    expect(cell('plannedDownMin'), '0');
    expect(cell('review'), 'Pending review');
    expect(cell('plannedShift'), '9:00');
  });

  test('detail and day-card figures', () {
    final calc = rivetSpec.rowCalc(row);
    final detail = rivetSpec.detail(row, calc, rivetSpec.dayCalc([row]).single);
    expect(detail.groups.map((g) => g.title), ['Quantities', 'Time', 'Stoppage', 'Efficiency', 'Entry']);
    expect(detail.oee.map((o) => o.formulaKey), ['oeeLosses', 'oeeLunch', 'oeeLunchCot']);
    final figures = rivetSpec.figures(row, calc);
    expect(figures.ok, 300);
    expect(figures.actual, 320, reason: 'OK + Rejected, as rowCalc reads a row with no Actual');
    expect(figures.shiftHours, 8);
    expect(rivetSpec.remarkParts(row).map((p) => p['key']), ['downtime', 'general']);
  });

  test('metrics allow the whole Machine Shift as stoppage', () {
    final m = rivetSpec.metrics({...row, 'plannedOperatorShiftHours': '9.00'});
    expect(m, isA<RivetMetrics>());
    expect(m.stoppageLimit, 480);
    expect(m.minutesLimit('setupMin').max, 440);
    expect(rivetSpec.metrics({...row, 'machineOnTime': ''}).stoppageLimit, isNull);
  });
}
