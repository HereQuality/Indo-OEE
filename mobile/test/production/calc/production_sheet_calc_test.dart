import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/shared/production_sheet_calc.dart';

import 'golden_support.dart';

Map<String, dynamic> _row(Map<String, dynamic> extra) => {
      'itemName': 'Part A',
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'totalCycleSec': '90',
      ...extra,
    };

Map<String, dynamic> _m(dynamic v) => Map<String, dynamic>.from(v as Map);

void main() {
  group('golden: rowCalc (Dart == the real JS)', () {
    final cases = loadFixture('row_calc.json') as List;
    test('${cases.length} rows', () {
      expect(cases.length, greaterThan(600));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final row = c['row'] == null ? null : _m(c['row']);
        final d = diff(rowCalc(row), c['out']);
        expect(d, isNull, reason: 'case $i ${showCase(c['row'])}');
      }
    });
    test('null row -> empty map', () => expect(rowCalc(null), isEmpty));
    test('every value is a double or null (never an int)', () {
      for (final c in cases) {
        final row = c['row'] == null ? null : _m(c['row']);
        for (final v in rowCalc(row).values) {
          expect(v == null || v is double, isTrue, reason: 'value $v (${v.runtimeType}) for ${showCase(c['row'])}');
        }
      }
    });
  });

  group('golden: dayCalc / sortByMachineOn', () {
    final cases = loadFixture('day_calc.json') as List;
    test('${cases.length} machine-days', () {
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final rows = [for (final r in c['rows'] as List) r == null ? null : _m(r)];
        final sorted = sortByMachineOn(rows);
        expect([for (final r in sorted) r['_id']], c['order'], reason: 'order of case $i ${showCase(c['rows'])}');
        for (final r in sorted) {
          expect(rows.any((x) => identical(x, r)), isTrue, reason: 'sortByMachineOn must return the same row instances');
        }
        expect(diff(dayCalc(rows), c['out']), isNull, reason: 'dayCalc case $i ${showCase(c['rows'])}');
        expect(diff([for (final r in sorted) rowCalc(r)], c['calcs']), isNull, reason: 'rowCalc order case $i');
      }
    });
    test('null input reads as no rows', () {
      expect(sortByMachineOn(null), isEmpty);
      expect(dayCalc(null), isEmpty);
    });
  });

  group('rowCalc by hand', () {
    test('8 h at 90 s -> 320 pieces, 40 per hour (the two real sheet checks)', () {
      final a = rowCalc(_row({'plannedDownMin': '0'}));
      expect(a['idealQty'], 320);
      expect(a['idealQtyPerHour'], 40);
      final b = rowCalc(_row({'machineOnTime': '09:00', 'machineOffTime': '12:00', 'plannedDownMin': '90'}));
      expect(b['idealQty'], 120);
      expect(b['idealQtyPerHour'], 40);
      expect(b['totalStoppageMin'], 90);
    });

    test('ideal quantity is floored, rejected = actual - OK, OK% and effective hours', () {
      final r = rowCalc(_row({'totalCycleSec': '97', 'actualQty': '100', 'okQty': '90'}));
      expect(r['idealQty'], 296); // 28800 / 97 = 296.9
      expect(r['rejectedQty'], 10);
      expect(r['actualQty'], 100);
      expect(r['pctOk'], closeTo(0.9, 1e-12));
      expect(r['effectiveHours'], closeTo(90 * 97 / 3600, 1e-12));
      expect(r['setupEfficiency'], closeTo((90 * 97 / 3600) / 8, 1e-12));
    });

    test('OK above actual clamps rejected at 0', () {
      expect(rowCalc(_row({'actualQty': '100', 'okQty': '150'}))['rejectedQty'], 0);
    });

    test('legacy row without actualQty: rejected is the stored figure, actual = OK + rejected', () {
      final r = rowCalc(_row({'okQty': '400', 'rejectedQty': '20'}));
      expect(r['rejectedQty'], 20);
      expect(r['actualQty'], 420);
      expect(r['pctOk'], closeTo(400 / 420, 1e-12));
      final none = rowCalc(_row({}));
      expect(none['actualQty'], isNull);
      expect(none['pctOk'], isNull);
      expect(none['rejectedQty'], isNull);
    });

    test('no Part Name -> no cycle, ideal or effective time (the shift still shows)', () {
      final r = rowCalc(_row({'itemName': '  ', 'okQty': '5', 'actualQty': '6'}));
      expect(r['totalCycleSec'], isNull);
      expect(r['idealQty'], isNull);
      expect(r['effectiveHours'], isNull);
      expect(r['shiftHours'], 8);
      expect(r['rejectedQty'], 1);
    });

    test('cycle time: own total minus unticked ops; op sum; legacy fields', () {
      expect(
        rowCalc(_row({'totalCycleSec': '50', 'drillingSec': '10', 'boringSec': '20', 'excludedOps': ['drillingSec']}))['totalCycleSec'],
        40,
      );
      expect(rowCalc(_row({'totalCycleSec': '', 'drillingSec': '10', 'boringSec': '20', 'excludedOps': ['drillingSec']}))['totalCycleSec'], 20);
      expect(rowCalc(_row({'totalCycleSec': '', 'cycleTimeSec': '33'}))['totalCycleSec'], 33);
      expect(rowCalc(_row({'totalCycleSec': '', 'cycleOpsSec': [10, '20', null, 'x']}))['totalCycleSec'], 30);
      expect(rowCalc(_row({'totalCycleSec': '', 'cycleOpsSec': []}))['totalCycleSec'], isNull);
    });

    test('overnight shift wraps past midnight', () {
      final r = rowCalc(_row({'machineOnTime': '22:00', 'machineOffTime': '06:00', 'totalCycleSec': '36'}));
      expect(r['shiftHours'], 8);
      expect(r['idealQty'], 800);
    });

    test('stoppage total sums all ten columns, ignoring junk', () {
      final r = rowCalc({
        'plannedDownMin': '5',
        'setupMin': '10',
        'noManPowerMin': '1',
        'materialShiftingMin': '2',
        'noMaterialMin': '3',
        'bdMechMin': '4',
        'bdEleMin': '5',
        'noPowerMin': '6',
        'lunchMin': 30,
        'otherMin': 'abc',
      });
      expect(r['totalStoppageMin'], 66);
    });
  });

  group('dayCalc by hand', () {
    Map<String, dynamic> shift(String id, String on, String off, [Map<String, dynamic> extra = const {}]) =>
        {'_id': id, 'itemName': 'P', 'machineOnTime': on, 'machineOffTime': off, 'totalCycleSec': '45', ...extra};

    test('one 8 h entry: unutilized, OEE figures and no gap', () {
      final out = dayCalc([shift('a', '06:00', '14:00', {'okQty': '600', 'actualQty': '620', 'lunchMin': '30', 'setupMin': '10'})]).single;
      const eff = 600 * 45 / 3600;
      expect(out['unutilized'], closeTo((12 - (8 - 30 / 60)) / 11, 1e-12));
      expect(out['unreportedMin'], closeTo(8 * 60 - eff * 60 - 40, 1e-9));
      expect(out['oeeLosses'], closeTo(eff / (8 - 40 / 60), 1e-12));
      expect(out['oeeLunch'], closeTo(eff / (8 - 30 / 60), 1e-12));
      expect(out['oeeLunchCot'], closeTo(eff / (8 - 30 / 60 - 10 / 60), 1e-12));
      expect(out['gapMin'], isNull);
    });

    test('rows come back sorted by Machine ON; day figures are shared, gap is per row', () {
      final out = dayCalc([
        shift('late', '14:00', '22:00', {'okQty': '100'}),
        shift('early', '06:00', '13:30', {'okQty': '200'}),
      ]);
      expect(out.length, 2);
      expect(out[0]['gapMin'], 30); // early ends 13:30, late starts 14:00
      expect(out[1]['gapMin'], isNull);
      expect(out[0]['oeeLosses'], out[1]['oeeLosses']);
      expect(out[0]['unreportedMin'], out[1]['unreportedMin']);
      expect(out[0]['unutilized'], isNot(out[1]['unutilized']));
    });

    test('overlapping shifts read as no gap (0), never negative', () {
      final out = dayCalc([shift('a', '06:00', '14:00'), shift('b', '13:00', '18:00')]);
      expect(out[0]['gapMin'], 0);
    });

    test('nothing with a shift time -> every combined figure is blank', () {
      final out = dayCalc([shift('a', '', ''), shift('b', 'zz', '')]);
      for (final o in out) {
        expect(o['unutilized'], isNull);
        expect(o['unreportedMin'], isNull);
        expect(o['oeeLosses'], isNull);
        expect(o['oeeLunch'], isNull);
        expect(o['oeeLunchCot'], isNull);
      }
    });

    test('rows without a valid ON time sort last, in input order; ties keep input order', () {
      final rows = [
        shift('x', '', '10:00'),
        shift('t1', '08:00', '09:00'),
        shift('y', 'abc', ''),
        shift('t2', '8', '10:00'),
        shift('first', '07:00', '08:00'),
      ];
      expect([for (final r in sortByMachineOn(rows)) r['_id']], ['first', 't1', 't2', 'x', 'y']);
      expect([for (final r in sortByMachineOn([null, rows[1], null])) r['_id']], ['t1']);
    });
  });

  group('normalizeTime / spanMinutes / totalCycleSec', () {
    test('every input form people type', () {
      const cases = {
        '9': '09:00',
        '09': '09:00',
        '930': '09:30',
        '0930': '09:30',
        '9:30': '09:30',
        '9.30': '09:30',
        '21:30': '21:30',
        ' 21:30 ': '21:30',
        '23:59': '23:59',
        '0': '00:00',
        '0000': '00:00',
      };
      cases.forEach((raw, want) => expect(normalizeTime(raw), want, reason: raw));
    });

    test('rejects what is not a time', () {
      for (final raw in ['', ' ', 'abc', '24:00', '2400', '9:5', '9:60', '12345', '9.3', '1:2:3', '9 30', null]) {
        expect(normalizeTime(raw), isNull, reason: '$raw');
      }
      expect(normalizeTime(930), '09:30'); // typed number
      expect(normalizeTime(9.3), isNull); // "9.3" has a 1-digit minute
    });

    test('golden: normalizeTime', () {
      final j = loadFixture('time_and_dates.json') as Map;
      final cases = j['normalizeTime'] as List;
      for (final c in cases) {
        final raw = (c as Map)['raw'];
        expect(normalizeTime(raw), c['out'], reason: 'normalizeTime(${showCase(raw)})');
      }
    });

    test('golden: spanMinutes', () {
      final j = loadFixture('time_and_dates.json') as Map;
      for (final c in j['spanMinutes'] as List) {
        c as Map;
        expect(diff(spanMinutes(c['on'], c['off']), c['out']), isNull, reason: 'spanMinutes(${c['on']}, ${c['off']})');
      }
    });

    test('spanMinutes wraps past midnight and needs both times', () {
      expect(spanMinutes('08:00', '16:30'), 510);
      expect(spanMinutes('22:00', '06:00'), 480);
      expect(spanMinutes('23:59', '00:00'), 1);
      expect(spanMinutes('08:00', '08:00'), 0);
      expect(spanMinutes('', '08:00'), isNull);
      expect(spanMinutes('08:00', 'x'), isNull);
    });

    test('golden: totalCycleSec', () {
      final j = loadFixture('time_and_dates.json') as Map;
      for (final c in j['totalCycleSec'] as List) {
        c as Map;
        expect(diff(totalCycleSec(c['ops'] as List?), c['out']), isNull, reason: 'totalCycleSec(${showCase(c['ops'])})');
      }
    });
  });

  group('fmtNum / fmtPct', () {
    test('golden: fmtNum (2, 0, 1 and 3 digits) and fmtPct', () {
      final cases = (loadFixture('formatting.json') as Map)['fmt'] as List;
      for (final c in cases) {
        c as Map;
        final v = c['v'];
        final arg = v;
        expect(fmtNum(arg), c['num'], reason: 'fmtNum(${showCase(v)})');
        expect(fmtNum(arg, 0), c['num0'], reason: 'fmtNum(${showCase(v)}, 0)');
        expect(fmtNum(arg, 1), c['num1'], reason: 'fmtNum(${showCase(v)}, 1)');
        expect(fmtNum(arg, 3), c['num3'], reason: 'fmtNum(${showCase(v)}, 3)');
        expect(fmtPct(arg), c['pct'], reason: 'fmtPct(${showCase(v)})');
      }
    });

    test('fmtNum', () {
      expect(fmtNum(null), '');
      expect(fmtNum(double.nan), '');
      expect(fmtNum(double.infinity), '');
      expect(fmtNum('5'), ''); // a string is not a number (Number.isFinite)
      expect(fmtNum(5), '5');
      expect(fmtNum(5.0), '5');
      expect(fmtNum(-3.0), '-3');
      expect(fmtNum(1.5), '1.5');
      expect(fmtNum(100.5), '100.5');
      expect(fmtNum(1234.5678), '1234.57');
      expect(fmtNum(0.125), '0.13'); // exact tie rounds up, like toFixed
      expect(fmtNum(1.005), '1'); // 1.005 is really 1.00499999...
      expect(fmtNum(0.001), '0');
      expect(fmtNum(99.999), '100');
      expect(fmtNum(-2.5), '-2.5');
      expect(fmtNum(1e21), '1e+21');
      expect(fmtNum(1234.5678, 1), '1234.6');
      expect(fmtNum(0.1 + 0.2), '0.3');
      // Web quirk kept on purpose: a digit-less toFixed result loses trailing zeros.
      expect(fmtNum(10.4, 0), '1');
      expect(fmtNum(2.6, 0), '3');
    });

    test('fmtPct', () {
      expect(fmtPct(null), '');
      expect(fmtPct(double.nan), '');
      expect(fmtPct(0), '0.00%');
      expect(fmtPct(1), '100.00%');
      expect(fmtPct(0.1234), '12.34%');
      expect(fmtPct(0.87654), '87.65%');
      expect(fmtPct(1.2), '120.00%');
      expect(fmtPct(-0.05), '-5.00%');
      expect(fmtPct('0.5'), '');
    });
  });

  group('JS number primitives', () {
    test('golden: toFixed', () {
      final cases = (loadFixture('formatting.json') as Map)['toFixed'] as List;
      for (final c in cases) {
        c as Map;
        expect(jsToFixed((c['v'] as num).toDouble(), c['d'] as int), c['out'], reason: '${c['v']}.toFixed(${c['d']})');
      }
    });

    test('golden: String(number)', () {
      final cases = (loadFixture('formatting.json') as Map)['numStr'] as List;
      for (final c in cases) {
        c as Map;
        expect(jsNumStr(c['v'] as num), c['out'], reason: 'String(${c['v']})');
      }
    });

    test('golden: Number(string)', () {
      final cases = (loadFixture('formatting.json') as Map)['parse'] as List;
      for (final c in cases) {
        c as Map;
        expect(diff(jsToNumber(c['s']), c['out']), isNull, reason: 'Number(${showCase(c['s'])})');
      }
    });

    test('num() semantics: blank is no value, junk is NaN, whitespace is 0', () {
      expect(jsNumber(null), isNull);
      expect(jsNumber(''), isNull);
      expect(jsNumber('  '), 0);
      expect(jsNumber('12.5'), 12.5);
      expect(jsNumber(7), 7);
      expect(jsNumber('abc')!.isNaN, isTrue);
      expect(jsNumber('1e2'), 100);
      expect(jsNumber('0x10'), 16);
      expect(jsNumber(true), 1);
      expect(isNum(double.nan), isFalse);
      expect(isNum(double.infinity), isFalse);
      expect(isNum('5'), isFalse);
      expect(isNum(5), isTrue);
      expect(isNum(null), isFalse);
    });

    test('toFixed negative zero, ties and rounding like JS', () {
      expect(jsToFixed(-0.0, 2), '0.00');
      expect(jsToFixed(-0.001, 2), '-0.00');
      expect(jsToFixed(0.5, 0), '1');
      expect(jsToFixed(2.5, 0), '3');
      expect(jsToFixed(-2.5, 0), '-3');
      expect(jsToFixed(1.005, 2), '1.00');
      expect(jsToFixed(1e21, 2), '1e+21');
      expect(jsToFixed(12.3456, 2), '12.35');
    });

    test('Math.round rounds half toward +infinity', () {
      expect(jsRound(2.5), 3);
      expect(jsRound(-2.5), -2);
      expect(jsRound(0.49999999999999994), 0);
      expect(jsRound(-0.4), 0);
      expect(jsRound(1.4999), 1);
    });

    test('String(number) layout', () {
      expect(jsNumStr(-0.0), '0');
      expect(jsNumStr(320.0), '320');
      expect(jsNumStr(0.1 + 0.2), '0.30000000000000004');
      expect(jsNumStr(1e21), '1e+21');
      expect(jsNumStr(1e-7), '1e-7');
      expect(jsNumStr(0.000001), '0.000001');
      expect(jsNumStr(123456789012345680000.0), '123456789012345680000');
      expect(jsNumStr(double.nan), 'NaN');
      expect(jsNumStr(double.negativeInfinity), '-Infinity');
    });
  });

  group('dates', () {
    test('golden: isoDay', () {
      final cases = (loadFixture('time_and_dates.json') as Map)['isoDay'] as List;
      for (final c in cases) {
        c as Map;
        final d = DateTime(c['y'] as int, c['m'] as int, c['d'] as int, c['hh'] as int, 30);
        expect(isoDay(d), c['out'], reason: '${c['y']}-${c['m']}-${c['d']}');
      }
    });

    test('isoDay pads and uses the local calendar day', () {
      expect(isoDay(DateTime(2026, 4, 6)), '2026-04-06');
      expect(isoDay(DateTime(2026, 12, 31, 23, 59)), '2026-12-31');
      expect(isoDay(DateTime(2026, 1, 1, 0, 0)), '2026-01-01');
    });

    test('golden: daysOfMonth', () {
      final cases = (loadFixture('time_and_dates.json') as Map)['daysOfMonth'] as List;
      for (final c in cases) {
        c as Map;
        expect(daysOfMonth(c['s'] as String), c['out'], reason: 'daysOfMonth("${c['s']}")');
      }
    });

    test('daysOfMonth lengths and bounds', () {
      expect(daysOfMonth('2026-02').length, 28);
      expect(daysOfMonth('2024-02').length, 29);
      expect(daysOfMonth('2100-02').length, 28);
      expect(daysOfMonth('2000-02').length, 29);
      expect(daysOfMonth('2026-04').length, 30);
      expect(daysOfMonth('2026-12').length, 31);
      expect(daysOfMonth('2026-04').first, '2026-04-01');
      expect(daysOfMonth('2026-04').last, '2026-04-30');
      expect(daysOfMonth('2026-4').first, '2026-04-01');
      expect(daysOfMonth(''), isEmpty);
      expect(daysOfMonth('nope'), isEmpty);
    });

    test('golden: displayDay / isSunday / rowKey / cycleOpLabel', () {
      final j = loadFixture('time_and_dates.json') as Map;
      for (final c in j['displayDay'] as List) {
        c as Map;
        expect(displayDay(c['s'] as String), c['out'], reason: 'displayDay("${c['s']}")');
      }
      for (final c in j['isSunday'] as List) {
        c as Map;
        expect(isSunday(c['s'] as String), c['out'], reason: 'isSunday("${c['s']}")');
      }
      for (final c in j['rowKey'] as List) {
        c as Map;
        expect(rowKey(c['a'], c['b'], c['c']), c['out']);
      }
      for (final c in j['cycleOpLabels'] as List) {
        c as Map;
        final f = cycleOpFields.firstWhere((f) => f['key'] == c['key']);
        expect(cycleOpLabel(f), c['label']);
      }
    });

    test('isSunday / displayDay / rowKey', () {
      expect(isSunday('2026-04-05'), isTrue);
      expect(isSunday('2026-04-06'), isFalse);
      expect(isSunday('2024-02-25'), isTrue);
      expect(isSunday('nope'), isFalse);
      expect(isSunday(''), isFalse);
      expect(displayDay('2026-04-06'), '06/04/2026');
      expect(rowKey('2026-04-06', 'm1', 2), '2026-04-06|m1|2');
    });
  });

  group('remarkParts', () {
    test('golden', () {
      final cases = loadFixture('remarks.json') as List;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final r = c['r'] == null ? null : _m(c['r']);
        expect(diff(remarkParts(r), c['out']), isNull, reason: 'case $i ${showCase(c['r'])}');
      }
    });

    test('labelled, in form order, empty ones left out', () {
      final parts = remarkParts({
        'rejectOtherRemark': 'burr',
        'rejectBreakdown': {'Other': '4'},
        'otherMinRemark': 'power cut',
        'otherMin': '15',
        'remarks': 'general',
      });
      expect([for (final p in parts) p['key']], ['reject', 'downtime', 'general']);
      expect(parts[0]['title'], 'Reject · Other');
      expect(parts[0]['figure'], '4 pcs');
      expect(parts[1]['title'], 'Downtime · Other');
      expect(parts[1]['figure'], '15 min');
      expect(parts[2]['figure'], '');
      expect(remarkParts({}), isEmpty);
      expect(remarkParts(null), isEmpty);
    });
  });

  test('constants match the web sheet', () {
    final c = (loadFixture('time_and_dates.json') as Map)['constants'] as Map;
    expect(slotsPerDay, c['SLOTS_PER_DAY']);
    expect(cycleOps, c['CYCLE_OPS']);
    expect(rejectReasons, c['REJECT_REASONS']);
    expect(workingStatuses, c['WORKING_STATUSES']);
    expect(diff([for (final f in cycleOpFields) Map<String, dynamic>.from(f)], c['CYCLE_OP_FIELDS']), isNull);
    expect(diff([for (final f in stoppageFields) Map<String, dynamic>.from(f)], c['STOPPAGE_FIELDS']), isNull);
  });
}
