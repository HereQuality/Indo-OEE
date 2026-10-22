// Parity of the Wave-1 shared pieces against the REAL web JS (fixtures from
// tool/gen_web_parity_golden.mjs): vendorsFor.js, plannedShift.js,
// limitNotice.js, and the review / over-100% / working-status helpers.
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/process/process_spec.dart' show DetailMetric;
import 'package:indo/features/production/sheet/editor/entry_editor_logic.dart' as logic;
import 'package:indo/features/production/shared/limit_notice.dart';
import 'package:indo/features/production/shared/planned_shift.dart';
import 'package:indo/features/production/shared/production_sheet_calc.dart' as calc;
import 'package:indo/features/production/shared/vendors.dart';
import 'package:indo/features/production/sheet/table/shared_columns.dart';

import '../calc/golden_support.dart';

const _dir = 'test/production/web_parity/fixtures';

List<Map<String, dynamic>> _maps(Object? v) => [for (final e in (v as List)) Map<String, dynamic>.from(e as Map)];
Object? _enc(EntryNotice n) => [
      n.message,
      {
        'title': n.title,
        // The JS leaves `highlight` off a plain line.
        'details': [
          for (final d in n.details) {'label': d.label, 'value': d.value, if (d.highlight) 'highlight': true},
        ],
        'hint': n.hint,
      },
    ];

Object? _expectedNotice(Object? jsPair) {
  // JS: [message, options]; drop returnFocus / okText extras the Dart side models separately.
  final pair = jsPair as List;
  final o = Map<String, dynamic>.from(pair[1] as Map)..remove('returnFocus');
  return [pair[0], o];
}

void main() {
  test('vendorsFor.js parity', () {
    final cases = loadFixture('vendors.json', dir: _dir) as List;
    expect(cases.length, greaterThan(300));
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final vendors = _maps(c['vendors']);
      final machines = _maps(c['machines']);
      final ctx = 'case $i ${showCase(c)}';
      expect(diff([for (final v in vendorsForProcess(vendors, c['processId'])) v['_id']], c['forProcess']), isNull, reason: ctx);
      expect(diff([for (final v in vendorsForMachine(vendors, machines, c['machineId'])) v['_id']], c['forMachine']), isNull, reason: ctx);
      expect(anyVendorFor(vendors, (c['processIds'] as List)), c['any'], reason: ctx);
    }
  });

  test('plannedShift.js parity (lockedHours / shiftSettingOf / shiftSettingForMachine)', () {
    final cases = loadFixture('planned_shift.json', dir: _dir) as List;
    expect(cases.length, greaterThan(250));
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final ctx = 'case $i ${showCase(c)}';
      final process = c['process'] == null ? null : Map<String, dynamic>.from(c['process'] as Map);
      expect(diff(lockedHoursOf(process), c['locked']), isNull, reason: ctx);
      Object? settingMap(ShiftSetting? s) => s == null ? null : {'locked': s.locked, 'hours': s.hours};
      expect(diff(settingMap(shiftSettingOf(process)), c['setting']), isNull, reason: ctx);
      expect(
        diff(settingMap(shiftSettingForMachine(c['machineId'], _maps(c['machines']), _maps(c['processes']))), c['forMachine']),
        isNull,
        reason: ctx,
      );
    }
  });

  test('limitNotice.js parity (qtyNotice / stoppageNotice)', () {
    final cases = loadFixture('limit_notice.json', dir: _dir) as List;
    expect(cases.length, greaterThan(150));
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final ctx = 'case $i ${showCase(c)}';
      final words = c['worker'] == true ? workerWords : machineWords;
      final q = qtyNotice(
        calc: Map<String, dynamic>.from(c['calc'] as Map),
        entered: c['entered'],
        machine: c['machine'] as String,
        words: words,
        label: (c['label'] as String?) ?? 'OK + Rejected',
      );
      expect(diff(_enc(q), _expectedNotice(c['qty'])), isNull, reason: ctx);
      final s = stoppageNotice(limitMin: c['limitMin'], totalMin: c['totalMin'], machine: c['machine'] as String, words: words);
      expect(diff(_enc(s), _expectedNotice(c['stoppage'])), isNull, reason: ctx);
    }
  });

  test('limitNotice.js parity (firstOverLimit on real CNC rows)', () {
    final cases = loadFixture('first_over_limit.json', dir: _dir) as List;
    var hits = 0;
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final ctx = 'case $i ${showCase(c)}';
      final blocks = _maps(c['blocks']);
      final errors = [for (final e in (c['errors'] as List)) Map<String, String>.from((e as Map).map((k, v) => MapEntry('$k', '$v')))];
      final names = Map<String, String>.from(c['machineName'] as Map);
      final out = firstOverLimit(blocks, errors, calc.rowCalc, qtyKey: 'actualQty', machineName: names);
      final expected = c['out'];
      if (expected == null) {
        expect(out, isNull, reason: ctx);
        continue;
      }
      hits++;
      expect(out, isNotNull, reason: ctx);
      final e = expected as Map;
      expect(out!.index, e['index'], reason: ctx);
      expect(out.field, e['field'], reason: ctx);
      expect(out.notice.returnFocus, isFalse, reason: ctx);
      expect(diff(_enc(out.notice), _expectedNotice(e['notice'])), isNull, reason: ctx);
    }
    // The generator must actually exercise the popup path, or this proves nothing.
    expect(hits, greaterThan(10));
  });

  test('ReviewBadge text / tone / hover parts parity', () {
    final cases = loadFixture('review.json', dir: _dir) as List;
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final ctx = 'case $i ${showCase(c)}';
      final row = <String, dynamic>{'review': c['review']};
      final out = c['out'] as Map;
      expect(reviewText(row), out['text'], reason: ctx);
      final tone = out['tone'] as String;
      final style = reviewStyle(row);
      if (tone.isEmpty) {
        expect(style, isNull, reason: ctx);
      } else {
        expect(style!.pill, isTrue);
        final want = tone.contains('warning') ? 'warn' : tone.contains('success') ? 'ok' : 'danger';
        expect(style.mark.name, want, reason: ctx);
      }
      final info = reviewInfo(row);
      expect(info.over, out['over'], reason: ctx);
      expect(info.by, out['by'], reason: ctx);
      expect(info.remark, out['remark'], reason: ctx);
    }
  });

  test('pctOver (red above 100%) and metricsOver100 parity', () {
    final cases = loadFixture('over_100.json', dir: _dir) as List;
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final ctx = 'case $i ${showCase(c)}';
      expect(isOver100(c['v']), c['over'], reason: ctx);
      expect(calc.metricsOver100(Map<String, dynamic>.from(c['calc'] as Map)), c['keys'], reason: ctx);
    }
  });

  test('Machine Working Status text parity', () {
    final cases = loadFixture('working_status.json', dir: _dir) as List;
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      expect(machineStatusText(Map<String, dynamic>.from(c['row'] as Map)), c['out'], reason: 'case $i ${showCase(c)}');
    }
  });

  test('CNC toPayload: machineStatus / workingMode / vendor match the page body', () {
    final cases = loadFixture('payload_fields.json', dir: _dir) as List;
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final v = {...logic.emptyEntry(now: DateTime(2026, 4, 6)), ...Map<String, dynamic>.from(c['values'] as Map)};
      // The form holds a Working entry as 'Working'; an unset mode is the default.
      if (v['workingMode'] == null) v.remove('workingMode');
      final p = logic.toPayload({...logic.emptyEntry(), ...v}, isEdit: false);
      final out = c['out'] as Map;
      // A value the JS leaves undefined/null falls back exactly as the page does.
      final want = {'machineStatus': out['machineStatus'], 'workingMode': out['workingMode'], 'vendor': out['vendor']};
      final got = {'machineStatus': p['machineStatus'], 'workingMode': p['workingMode'], 'vendor': p['vendor']};
      expect(diff(got, want), isNull, reason: 'case $i ${showCase(c)}');
    }
  });

  test('the detail rows carry the same text', () {
    final r = <String, dynamic>{
      'review': {'status': 'pending', 'flagged': [{'metric': 'availability', 'value': 1.05}]},
    };
    final rows = reviewRows(r);
    expect((rows.first as DetailMetric).value, 'Pending review');
    expect(rows.length, 2); // + "Over 100%: Availability 105.00%"
  });
}
