import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/processes/press/press_spec.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';

final now = DateTime(2026, 10, 22);

Map<String, dynamic> row() => {
      '_id': 'r1',
      'date': '2026-10-20',
      'machine': 'm1',
      'slot': 2,
      'item': 'i1',
      'operator': 'Ravi',
      'itemName': 'Bracket',
      'standardTimeMin': 2,
      'pcsPerStandardTime': 10,
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'okQty': 2000,
      'rejectedQty': 100,
      'plannedOperatorShiftHours': 8.5,
      'lunchMin': 30,
      'otherMin': 15,
      'otherMinRemark': 'belt broke',
      'remarks': 'steady',
      'review': {'status': 'pending'},
    };

void main() {
  test('emptyEntry has the web keys, blank, dated today', () {
    final e = pressSpec.emptyEntry(now: now);
    expect(e['date'], '2026-10-22');
    expect(e['slot'], 1);
    expect(e['workingMode'], 'Working');
    expect(e['machineStatus'], isEmpty);
    expect(e['excludedOps'], isEmpty);
    for (final k in ['operator', 'itemName', 'operation', 'drawingNo', 'setupNo', 'standardTimeMin', 'pcsPerStandardTime', 'okQty', 'rejectedQty', 'plannedOperatorShiftHours', 'lunchMin', 'plannedDownMin', 'otherMin', 'otherMinRemark', 'machineOnTime']) {
      expect(e[k], '', reason: k);
    }
    expect(e.containsKey('actualQty'), isFalse, reason: 'PRESS has no Actual box');
    expect(e.containsKey('rejectBreakdown'), isFalse, reason: 'PRESS has no reject split');
    expect(pressSpec.entryHasData(e), isFalse);
    expect(pressSpec.hasAnyEntryData([e]), isFalse);
  });

  test('toFormValues turns stored numbers into box text and the shift into H.MM', () {
    final v = pressSpec.toFormValues(row(), now: now);
    expect(v['okQty'], '2000');
    expect(v['standardTimeMin'], '2');
    expect(v['plannedOperatorShiftHours'], '8.30');
    expect(v['lunchMin'], '30');
    expect(v['setupMin'], '');
    expect(v['slot'], 2);
    expect(v['item'], 'i1');
    expect(v['_id'], 'r1');
    expect(pressSpec.validateEntry(v), isEmpty);
    // Saved and loaded unchanged: the payload carries the same figures back.
    final p = pressSpec.toPayload(v, isEdit: true);
    expect(p['plannedOperatorShiftHours'], 8.5);
    expect(p['_id'], 'r1');
    expect(p['slot'], 2);
    expect(pressSpec.toPayload(v, isEdit: false)['slot'], 'auto');
    expect(pressSpec.toPayload(v, isEdit: false).containsKey('_id'), isFalse);
  });

  test('picking a Part copies its standard time and Drawing No.; Operation / Setup No. stay', () {
    final items = [
      {'_id': 'i1', 'itemName': 'Bracket', 'drawingNo': 'D-1', 'standardTimeMin': 2, 'pcsPerStandardTime': 10},
      {'_id': 'i2', 'itemName': 'Plain'},
    ];
    final start = {...pressSpec.emptyEntry(now: now), 'operation': 'Blank', 'setupNo': '2', 'excludedOps': ['standardTimeMin']};
    final v = pressSpec.applyItemSelection(start, 'i1', items);
    expect(v['item'], 'i1');
    expect(v['itemName'], 'Bracket');
    expect(v['drawingNo'], 'D-1');
    expect(v['standardTimeMin'], '2');
    expect(v['pcsPerStandardTime'], '10');
    expect(v['excludedOps'], isEmpty);
    expect(v['operation'], 'Blank');
    expect(v['setupNo'], '2');
    // A Part with no standard time leaves them blank.
    final plain = pressSpec.applyItemSelection(v, 'i2', items);
    expect(plain['standardTimeMin'], '');
    expect(plain['drawingNo'], '');
    // Cleared, and an unknown id.
    final cleared = pressSpec.applyItemSelection(v, '', items);
    expect([cleared['item'], cleared['itemName'], cleared['drawingNo']], ['', '', '']);
    expect(pressSpec.applyItemSelection(v, 'zz', items)['item'], '');
    // The picker's grey line is the cycle time from the standard time.
    expect(pressSpec.itemSubtitle(items.first), isNull, reason: 'the web label is the plain part name');
    expect(pressSpec.itemSubtitle(items.last), isNull);
  });

  test('new blocks copy the date; drafts are topped up; typed work is detected', () {
    final first = {...pressSpec.emptyEntry(now: now), 'date': '2026-10-01', 'machine': 'm1'};
    expect(pressSpec.newBlockAfter([first], now: now)['date'], '2026-10-01');
    expect(pressSpec.newBlockAfter([], now: now)['date'], '2026-10-22');
    final merged = pressSpec.mergeDraftEntry({'machine': 'm2', 'okQty': '5'}, now: now);
    expect(merged['okQty'], '5');
    expect(merged['rejectedQty'], '');
    expect(merged['excludedOps'], isEmpty);
    expect(pressSpec.hasAnyEntryData([first]), isTrue, reason: 'a machine alone counts');
    expect(pressSpec.entryHasData({...pressSpec.emptyEntry(now: now), 'machine': 'm1'}), isFalse);
    expect(pressSpec.entryHasData({...pressSpec.emptyEntry(now: now), 'remarks': 'x'}), isTrue);
    expect(pressSpec.entryHasData({...pressSpec.emptyEntry(now: now), 'workingMode': 'Non Working'}), isTrue);
  });

  test('the table lists the web columns in sheet order, with the stoppage breakdown behind Total Stoppage', () {
    final closed = pressSpec.columns({});
    expect([for (final c in closed.left) c.key], ['date', 'machine']);
    expect([for (final c in closed.middle) c.key], [
      'operator', 'machineStatus', 'itemName', 'vendorName', 'operation', 'drawingNo', 'setupNo', 'standardTimeMin', 'pcsPerStandardTime',
      'cycle', 'on', 'off', 'shift', 'idealQty', 'okQty', 'rejectedQty', 'pctOk', 'plannedShift', 'totalStoppage',
      'setupEff', 'effective', 'unreported', 'availability', 'performance', 'quality', 'oeeLosses', 'oeeLunch', 'oeeLunchCot',
      'review', 'remarks',
    ]);
    expect(closed.middle.any((c) => c.key == 'unutilized'), isFalse);
    expect(closed.expandSummary, {'downtime': 'totalStoppage'});
    final open = pressSpec.columns({'downtime'});
    expect([for (final c in open.middle) if (c.sub) c.key], [
      'plannedDownMin', 'setupMin', 'noManPowerMin', 'materialShiftingMin', 'noMaterialMin', 'bdMechMin', 'bdEleMin', 'noPowerMin', 'lunchMin', 'otherMin',
    ]);
    expect(open.middle.firstWhere((c) => c.key == 'otherMin').remarkKind, 'downtime');
    // Every formula a column points at has a text.
    for (final c in [...closed.middle, ...open.middle]) {
      if (c.formulaKey != null) expect(pressSpec.formulas.containsKey(c.formulaKey), isTrue, reason: c.key);
    }
  });

  test('cells read the right figures', () {
    final r = row();
    final calc = pressSpec.rowCalc(r);
    final day = pressSpec.dayCalc([r]).single;
    final cd = CellData(row: r, calc: calc, day: day, machineName: 'PRESS 1');
    String cell(String key) => pressSpec.columns({'downtime'}).middle.firstWhere((c) => c.key == key).text(cd);
    expect(cell('cycle'), '12');
    expect(cell('idealQty'), '2400');
    expect(cell('okQty'), '2000');
    expect(cell('rejectedQty'), '100');
    expect(cell('shift'), '8:00');
    expect(cell('plannedShift'), '8:30');
    expect(cell('totalStoppage'), '45');
    expect(cell('otherMin'), '15');
    expect(cell('machineStatus'), 'Working');
    expect(cell('review'), 'Pending review');
    expect(cell('availability'), isNot('—'));
  });

  test('day-card figures, remarks and detail', () {
    final r = row();
    final calc = pressSpec.rowCalc(r);
    final f = pressSpec.figures(r, calc);
    expect(f.ok, 2000);
    expect(f.actual, 2100, reason: 'OK + Rejected');
    expect(f.shiftHours, 8);
    expect([for (final p in pressSpec.remarkParts(r)) p['key']], ['downtime', 'general']);
    final d = pressSpec.detail(r, calc, pressSpec.dayCalc([r]).single);
    expect(d.oee.map((o) => o.formulaKey), ['oeeLosses', 'oeeLunch', 'oeeLunchCot']);
    expect(d.groups.map((g) => g.title), ['Quantities', 'Time', 'Stoppage', 'Efficiency', 'Entry']);
  });
}
