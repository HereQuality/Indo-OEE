import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/processes/spm/spm_calc.dart';
import 'package:indo/features/production/processes/spm/spm_spec.dart';
import 'package:indo/features/production/processes/spm/spm_validation.dart';
import 'package:indo/features/production/shared/production_entry_validation.dart' show withDecimalPlanned;

import '../../calc/golden_support.dart';

// Parity of the SPM port with the REAL web code: the fixtures are produced by
// tool/gen_spm_golden.mjs running client/src/utils/spmSheet.js, spmValidation.js
// (and the page helpers copied from SpmDataEntry.jsx / SpmEntryForm.jsx) under node.
// Regenerate with the recipe in mobile/docs/PROCESS_PORTING.md.

const dir = 'test/production/processes/spm/fixtures';

Map<String, dynamic> m(Object? x) => Map<String, dynamic>.from(x as Map);
List<Map<String, dynamic>> ml(Object? x) => [for (final e in x as List) m(e)];
List<dynamic> fixture(String name) {
  final f = loadFixture(name, dir: dir);
  return f is List ? f : [f];
}

void main() {
  test('rowCalc matches the web spmRowCalc on varied and hostile rows', () {
    final cases = fixture('row_calc.json');
    expect(cases.length, greaterThan(500));
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final row = m(c['row']);
      expect(diff(spmSpec.rowCalc(row), c['out']), isNull, reason: 'case $i ${showCase(row)}');
      expect(diff(spmCycleSec(row), c['cycle']), isNull, reason: 'cycle $i ${showCase(row)}');
    }
  });

  test('dayCalc matches the web spmDayCalc (Machine ON order, day-level figures)', () {
    final cases = fixture('day_calc.json');
    expect(cases.length, greaterThan(250));
    var multi = 0;
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final rows = ml(c['rows']);
      if (rows.length > 1) multi++;
      expect(diff(spmSpec.dayCalc(rows), c['out']), isNull, reason: 'case $i ${showCase(rows)}');
    }
    expect(multi, greaterThan(100));
  });

  test('validateSpmEntry matches the web message for message, key order included', () {
    final cases = fixture('validation.json');
    expect(cases.length, greaterThan(1000));
    var clean = 0;
    final seen = <String>{};
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final values = m(c['values']);
      final saved = c['saved'] == null ? null : m(c['saved']);
      final actual = spmSpec.validateEntry(values, saved: saved);
      expect(diff(actual, c['errors']), isNull, reason: 'case $i ${showCase(values)} saved ${showCase(saved)}');
      expect(actual.keys.toList(), (c['errors'] as Map).keys.toList(), reason: 'key order case $i');
      if (actual.isEmpty) clean++;
      seen.addAll(actual.values);
    }
    // The set is not all-valid and not all-invalid, and reaches the rules that matter.
    expect(clean, inInclusiveRange(40, cases.length - 100));
    for (final fragment in [
      'Date is required',
      'Machine No. is required',
      'Operator is required',
      'Part Name is required',
      'This Part has no Operation Times set',
      'Total Cycle Time must be more than 0',
      'This Part is missing No. of Holes',
      'Machine OFF Time must be after Machine ON Time',
      'Actual Quantity is required',
      'OK Quantity is required',
      "Actual can't be more than Ideal Quantity",
      "OK can't be more than Actual Quantity",
      'rejected piece(s) still have no reason',
      'Split is ',
      'Nothing was rejected',
      'Rejected quantities must be 0 or more',
      'Remark is required when "Other" is a reject reason',
      'Planned Operator Shift is required',
      'Enter hours as on the sheet, like 8.5 or 5.33',
      "can't be less than the Machine Shift",
      '0–1440',
      'but the Machine Shift is only',
      'Remark is required when Others downtime is entered',
    ]) {
      expect(seen.any((s) => s.contains(fragment)), isTrue, reason: 'no case produced "$fragment"');
    }
  });

  test('field order and the first incomplete field', () {
    final f = loadFixture('first_error.json', dir: dir) as Map;
    expect(spmSpec.fieldOrder, f['order']);
    expect(spmDowntimeKeys, f['downtimeKeys']);
    final cases = f['cases'] as List;
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final list = [
        for (final e in c['list'] as List) e == null ? <String, String>{} : {for (final x in (e as Map).entries) '${x.key}': '${x.value}'},
      ];
      expect(diff(spmSpec.firstError(list), c['out']), isNull, reason: 'case $i ${showCase(c['list'])}');
    }
  });

  test('the stoppage allowance is the Machine Shift and planned hours convert from H.MM', () {
    final cases = fixture('stoppage_limit.json');
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final v = m(c['values']);
      final decimal = withDecimalPlanned(v);
      expect(diff(spmStoppageLimit(decimal), c['limit']), isNull, reason: 'limit $i ${showCase(v)}');
      expect(diff(decimal['plannedOperatorShiftHours'], c['planned']), isNull, reason: 'planned $i ${showCase(v)}');
    }
  });

  test('toPayload is the web payload, key for key', () {
    final cases = fixture('payload.json');
    expect(cases.length, greaterThan(500));
    var edits = 0;
    for (var i = 0; i < cases.length; i++) {
      final c = cases[i] as Map;
      final values = m(c['values']);
      final isEdit = c['isEdit'] as bool;
      if (isEdit) edits++;
      expect(diff(spmSpec.toPayload(values, isEdit: isEdit), c['payload']), isNull, reason: 'case $i edit=$isEdit ${showCase(values)}');
    }
    expect(edits, greaterThan(150));
  });

  test('emptyEntry, toFormValues, Part pick, hasAnyEntryData and the block tint match the web', () {
    final empty = loadFixture('empty_entry.json', dir: dir) as Map;
    final day = DateTime.parse('${empty['day']}T09:30:00');
    expect(diff(spmSpec.emptyEntry(now: day), empty['out']), isNull);

    final fv = loadFixture('form_values.json', dir: dir) as Map;
    final fvDay = DateTime.parse('${fv['day']}T09:30:00');
    final forms = fv['cases'] as List;
    for (var i = 0; i < forms.length; i++) {
      final c = forms[i] as Map;
      expect(diff(spmSpec.toFormValues(m(c['row']), now: fvDay), c['out']), isNull, reason: 'form values $i ${showCase(c['row'])}');
    }

    final picks = fixture('item_pick.json');
    for (var i = 0; i < picks.length; i++) {
      final c = picks[i] as Map;
      final out = spmSpec.applyItemSelection(m(c['values']), c['itemId'] as String, ml(c['items']));
      expect(diff(out, c['out']), isNull, reason: 'pick $i ${c['itemId']} ${showCase(c['values'])}');
    }

    final data = fixture('has_data.json');
    var withData = 0;
    for (var i = 0; i < data.length; i++) {
      final c = data[i] as Map;
      final blocks = ml(c['blocks']);
      expect(spmSpec.hasAnyEntryData(blocks), c['any'], reason: 'any $i ${showCase(blocks)}');
      expect([for (final b in blocks) spmSpec.entryHasData(b)], c['data'], reason: 'tint $i ${showCase(blocks)}');
      if (c['any'] == true) withData++;
    }
    expect(withData, inInclusiveRange(30, data.length - 30));
  });

  test('isSpmProcess and the formula texts match the web', () {
    for (final c in fixture('is_spm_process.json')) {
      final p = (c as Map)['process'];
      expect(isSpmProcess(p == null ? null : m(p)), c['out'], reason: showCase(p));
    }
    final f = loadFixture('formulas.json', dir: dir) as Map;
    final web = m(f['formulas']);
    for (final e in web.entries) {
      expect(spmSpec.formulas[e.key], e.value, reason: 'formula ${e.key}');
    }
    // The only extra is the phone's own Stoppage Allowed info text; Rejected is typed here.
    expect(spmSpec.formulas.keys.toSet().difference(web.keys.toSet()), {'stoppageAllowed'});
    // Rejected is Actual − OK now, so its formula is part of the web map.
    expect(spmSpec.formulas['rejectedQty'], web['rejectedQty']);
    expect([for (final x in spmOpFields) {...x}], [for (final x in f['opFields'] as List) m(x)]);
    expect([for (final x in spmReferenceFields) {...x}], [for (final x in f['referenceFields'] as List) m(x)]);
  });

  test('new blocks copy the date, drafts are topped up', () {
    final now = DateTime(2026, 10, 22);
    final a = {...spmSpec.emptyEntry(now: now), 'date': '2026-10-05', 'machine': 'm1', 'operator': 'Ravi'};
    final next = spmSpec.newBlockAfter([a], now: now);
    expect(next['date'], '2026-10-05');
    expect(next['machine'], '');
    expect(next['operator'], '');
    expect(spmSpec.newBlockAfter(const [], now: now)['date'], '2026-10-22');
    // A draft saved before a field existed lacks it; list fields keep their shape.
    final draft = spmSpec.mergeDraftEntry({'machine': 'm1', 'okQty': '5', 'excludedOps': 'oops', 'machineStatus': null}, now: now);
    expect(draft['machine'], 'm1');
    expect(draft['okQty'], '5');
    expect(draft['workingMode'], 'Working');
    expect(draft['excludedOps'], isEmpty);
    expect(draft['machineStatus'], isEmpty);
    expect(draft['noOfHoles'], '');
    expect(draft['date'], '2026-10-22');
  });
}
