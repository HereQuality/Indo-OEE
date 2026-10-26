import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/features/production/process/process_spec.dart';
import 'package:indo/features/production/processes/spm/spm_spec.dart';
import 'package:indo/features/production/sheet/table/shared_columns.dart' show machineStatusText;
import 'package:indo/features/production/sheet/table/sheet_columns.dart';
import 'package:indo/features/production/shared/production_sheet_calc.dart' show rejectReasons;

// The SPM list: endpoints, table columns, day-card figures, detail and remarks.

final row = <String, dynamic>{
  '_id': 'r1',
  'date': '2026-10-02',
  'machine': 'm1',
  'slot': 1,
  'operator': 'Ravi',
  'itemName': 'Bracket',
  'drawingNo': 'D-100',
  'noOfHoles': 4,
  'piecesPerCycle': 2,
  'strokeRequired': 1,
  'loadingSec': 5,
  'processSec': 20,
  'unloadingCleaningSec': 3,
  'otherOperationsSec': 2,
  'totalCycleSec': 30,
  'excludedOps': ['loadingSec'],
  'machineOnTime': '08:00',
  'machineOffTime': '16:00',
  'okQty': 400,
  'rejectedQty': 20,
  'plannedOperatorShiftHours': 9,
  'lunchMin': 30,
  'setupMin': 10,
  'otherMin': 15,
  'otherMinRemark': 'power cut',
  'remarks': 'late start',
  'machineStatus': <String>['No Planning'],
  'review': {'status': 'pending'},
};

CellData cell(Map<String, dynamic> r) {
  final calc = spmSpec.rowCalc(r);
  final day = spmSpec.dayCalc([r]).single;
  return CellData(row: r, calc: calc, day: day, machineName: 'SPM 1');
}

void main() {
  test('identity and endpoints', () {
    expect(spmSpec.key, 'spm');
    expect(spmSpec.routePath, '/production/spm-data-entry');
    expect(spmSpec.api.list, '${Endpoints.v1}/spm-sheet');
    expect(spmSpec.api.row, '${Endpoints.v1}/spm-sheet/row');
    expect(spmSpec.api.extent, '${Endpoints.v1}/spm-sheet/extent');
    expect(spmSpec.api.filterOptions, '${Endpoints.v1}/spm-sheet/filter-options');
    expect(spmSpec.api.occupied, '${Endpoints.v1}/spm-sheet/occupied');
    expect(spmSpec.draftKey, 'spmEntryDraft');
    expect(spmSpec.scopeItemsToProcess, isTrue);
    expect(spmSpec.ownsProcess({'dataEntryMenu': null}), isFalse);
  });

  test('columns follow spmColumns.jsx, with the breakdown folded behind Total Stoppage', () {
    final closed = spmSpec.columns({});
    expect([for (final c in closed.left) c.key], ['date', 'machine']);
    expect(
      [for (final c in closed.middle) c.key],
      [
        'operator', 'machineStatus', 'itemName', 'vendorName', 'drawingNo', 'noOfHoles', 'piecesPerCycle', 'strokeRequired', //
        'loadingSec', 'processSec', 'unloadingCleaningSec', 'otherOperationsSec', 'cycle', 'on', 'off', 'shift',
        'idealQty', 'actualQty', 'okQty', 'rejectedQty', 'pctOk', 'plannedShift', 'unutilized', 'totalStoppage',
        'effective', 'unreported', 'setupEff', 'availability', 'performance', 'quality', 'oeeLosses', 'oeeLunch',
        'oeeLunchCot', 'review', 'remarks',
      ],
    );
    final open = spmSpec.columns({'downtime'});
    expect(
      [for (final c in open.middle) if (c.sub) c.key],
      ['plannedDownMin', 'setupMin', 'noManPowerMin', 'materialShiftingMin', 'noMaterialMin', 'bdMechMin', 'bdEleMin', 'noPowerMin', 'lunchMin', 'otherMin'],
    );
    expect(closed.expandSummary['downtime'], 'totalStoppage');
    // Every calculated column's formula exists (Rejected = Actual − OK has one now).
    for (final c in [...closed.left, ...closed.middle, ...open.middle]) {
      if (c.formulaKey != null) expect(spmSpec.formulas.containsKey(c.formulaKey), isTrue, reason: c.key);
    }
    // Rejected opens into the Rejection Master reasons, in the web's order.
    final rej = spmSpec.columns({'rejectedQty'});
    expect([for (final c in rej.middle) if (c.sub) c.key], rejectReasons);
  });

  test('cells read the row, calc and day the way the web columns do', () {
    final d = cell(row);
    String text(String key) => [...spmSpec.columns({'downtime'}).middle].firstWhere((c) => c.key == key).text(d);
    expect(text('operator'), 'Ravi');
    expect(text('machineStatus'), 'Working — No Planning');
    expect(text('noOfHoles'), '4');
    expect(text('loadingSec'), '5');
    expect(text('cycle'), '25'); // 30 − the unticked Loading (5)
    expect(text('shift'), '8:00');
    expect(text('idealQty'), '1,152'.replaceAll(',', ''));
    expect(text('actualQty'), '420'); // OK + Rejected (an entry saved before Actual existed)
    expect(text('okQty'), '400');
    expect(text('rejectedQty'), '20');
    expect(text('plannedShift'), '9:00');
    expect(text('totalStoppage'), '55');
    expect(text('lunchMin'), '30');
    expect(text('otherMin'), '15');
    expect(text('review'), 'Pending review');
    expect(text('availability'), isNot('—'));
    expect(spmSpec.columns({}).left.firstWhere((c) => c.key == 'machine').text(d), 'SPM 1');

    expect(machineStatusText({...row, 'workingMode': 'Non Working'}), 'Non Working — No Planning');
    expect(machineStatusText({...row, 'workingMode': 'Working'}), 'Working — No Planning');
    expect(machineStatusText({'machineStatus': <String>[]}), 'Working');
  });

  test('day card figures: OK over Actual (OK + Rejected), % OK, shift hours', () {
    final calc = spmSpec.rowCalc(row);
    final f = spmSpec.figures(row, calc);
    expect(f.ok, 400);
    expect(f.actual, 420);
    expect(f.pctOk, closeTo(400 / 420, 1e-12));
    expect(f.shiftHours, 8);
    expect(spmSpec.rowCalc(row)['totalStoppageMin'], 55);
  });

  test('detail groups every figure and keeps the remarks', () {
    final calc = spmSpec.rowCalc(row);
    final day = spmSpec.dayCalc([row]).single;
    final detail = spmSpec.detail(row, calc, day);
    expect(detail.oee.map((o) => o.formulaKey), ['oeeLosses', 'oeeLunch', 'oeeLunchCot']);
    expect(detail.groups.map((g) => g.title), ['Part & cycle', 'Quantities', 'Time', 'Stoppage', 'Efficiency', 'Entry']);
    List<DetailRow> rows(String title) => detail.groups.firstWhere((g) => g.title == title).rows;
    final part = rows('Part & cycle');
    // The unticked operation is struck through and marked skipped.
    final loading = part.whereType<DetailSubRow>().firstWhere((r) => r.label == 'Loading');
    expect(loading.struck, isTrue);
    expect(loading.note, 'skipped');
    expect(part.whereType<DetailMetric>().any((m) => m.label == 'Total Cycle Time (Sec)' && m.value == '25'), isTrue);
    final others = rows('Stoppage').whereType<DetailSubRow>().firstWhere((r) => r.label == 'Others');
    expect(others.value, '15');
    expect(others.remarks.single['text'], 'power cut');
    final entry = rows('Entry').whereType<DetailMetric>();
    expect(entry.firstWhere((m) => m.label == 'Remarks').value, 'late start');
    // Web order (CNC's): the review badge sits with the efficiency figures, after Availability / Performance / Quality.
    expect(rows('Efficiency').whereType<DetailMetric>().firstWhere((m) => m.label == 'OEE Review').value, 'Pending review');
    expect(spmSpec.remarkParts(row).map((p) => p['key']), ['downtime', 'general']);
  });

  test('detail lists Actual, OK, the derived Rejected and its reasons (Other with its remark)', () {
    final r = {
      ...row,
      'actualQty': 420,
      'okQty': 400,
      'rejectedQty': null,
      'rejectBreakdown': {'Tool Mark': 12, 'Other': 8},
      'rejectOtherRemark': 'burr',
    };
    final qty = spmSpec.detail(r, spmSpec.rowCalc(r), const {}).groups.firstWhere((g) => g.title == 'Quantities');
    final lines = [
      for (final x in qty.rows)
        if (x is DetailMetric) '${x.label}=${x.value}' else if (x is DetailSubRow) '  ${x.label}=${x.value}',
    ];
    expect(lines, containsAllInOrder(['Actual Quantity=420', 'Actual OK Quantity=400', 'Rejected Quantity=20', '  Tool Mark=12', '  Other=8']));
    final other = qty.rows.whereType<DetailSubRow>().firstWhere((x) => x.label == 'Other');
    expect(other.remarks.single['text'], 'burr');
    expect(spmSpec.remarkParts(r).map((p) => p['key']), contains('reject'));
  });
}
