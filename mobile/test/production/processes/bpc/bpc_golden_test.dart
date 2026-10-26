import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/processes/bpc/bpc_calc.dart';
import 'package:indo/features/production/processes/bpc/bpc_spec.dart';
import 'package:indo/features/production/processes/bpc/bpc_validation.dart';
import 'package:indo/features/production/processes/bpc/bpc_values.dart';
import 'package:indo/features/production/shared/limit_notice.dart' show EntryNotice, bpcWords, stoppageNotice;
import 'package:indo/features/production/shared/production_entry_validation.dart' show overlapErrors, slotsFullErrors;
import 'package:indo/features/production/shared/production_sheet_calc.dart';
import 'package:indo/features/production/shared/quantity_rules.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';

import '../../calc/golden_support.dart';

/// Parity of the Dart port with the REAL web JS (utils/bpcSheet.js,
/// bpcValidation.js, the page's pure handlers and bpcColumns.jsx), over
/// fixtures written by tool/gen_bpc_golden.mjs. See mobile/docs/PROCESS_PORTING.md.
/// BPC_FIXTURE_DIR points a soak run at freshly generated fixtures
/// (`SEED=.. SCALE=..` — see tool/gen_bpc_golden.mjs).
final dir = Platform.environment['BPC_FIXTURE_DIR'] ?? 'test/production/processes/bpc/fixtures';

const spec = bpcSpec;

Map<String, dynamic> m(Object? v) => Map<String, dynamic>.from(v as Map);
List<Map<String, dynamic>> rows(Object? v) => [for (final r in v as List) r == null ? <String, dynamic>{} : m(r)];
Map<String, String> strings(Object? v) => Map<String, String>.from((v as Map).map((k, x) => MapEntry('$k', '$x')));

/// A web form value as the phone's form holds it: typed figures as text.
Object? asText(Object? v) => v is num ? jsNumStr(v) : v;

void main() {
  group('bpcRowCalc matches the web', () {
    final cases = loadFixture('row_calc.json', dir: dir) as List;
    test('${cases.length} rows (the six paper rows first)', () {
      expect(cases.length, greaterThan(500));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final row = c['row'] == null ? null : m(c['row']);
        expect(diff(bpcRowCalc(row), c['out']), isNull, reason: 'case $i ${showCase(c['row'])}');
      }
    });

    test('the keys the framework relies on are always there', () {
      for (final c in cases.take(60)) {
        final out = bpcRowCalc(c['row'] == null ? null : m(c['row']));
        for (final k in ['shiftHours', 'actualQty', 'pctOk', 'totalStoppageMin', 'idealQty', 'idealQtyFloor', 'idealQtyPerHour', 'effectiveHours']) {
          expect(out.containsKey(k), isTrue, reason: k);
        }
      }
    });

    test('Ideal is not rounded down; Ideal/Hours = 3600 ÷ Std; Effective counts every piece', () {
      final c = bpcRowCalc({
        'itemName': 'BODY',
        'machineOnTime': '15:00',
        'machineOffTime': '16:00',
        'totalCycleSec': 35,
        'actualQty': 90,
        'okQty': 80,
      });
      expect(c['idealQty'], closeTo(102.8571429, 1e-6));
      expect(c['idealQtyFloor'], 102);
      expect(c['idealQtyPerHour'], closeTo(3600 / 35, 1e-9));
      expect(c['effectiveHours'], closeTo(90 * 35 / 3600, 1e-9));
      expect(c['rejectedQty'], 10);
    });
  });

  group('helpers and lists match the web', () {
    final f = loadFixture('helpers.json', dir: dir) as Map;
    test('isStatusOnly / rejectSplitTotal over ${(f['rows'] as List).length} rows', () {
      for (final c in f['rows'] as List) {
        final row = m(c['row']);
        expect(bpcIsStatusOnly(row), c['statusOnly'], reason: showCase(row));
        expect(diff(rejectSplitTotal(row), c['splitTotal']), isNull, reason: showCase(row));
      }
    });

    test('reasons, idle fields, the day\'s entry limit, statuses and words are the web\'s', () {
      expect(bpcRejectReasons, f['rejectReasons']);
      expect([for (final (k, l) in bpcStoppageFields) {'key': k, 'label': l}], f['stoppageFields']);
      expect(bpcMaxEntriesPerDay, f['maxEntriesPerDay']);
      expect(spec.maxEntriesPerDay, f['maxEntriesPerDay']);
      expect(bpcNonWorkingStatuses, f['nonWorking']);
      final tw = f['timeWords'] as Map;
      expect([spec.timeWords.start, spec.timeWords.end, spec.timeWords.owner], [tw['start'], tw['end'], tw['owner']]);
      final w = f['words'] as Map;
      expect([bpcWords.who, bpcWords.canMake, bpcWords.shift], [w['who'], w['canMake'], w['shift']]);
    });

    test('isBpcProcess tells BEFORE from AFTER POWDER COATING', () {
      for (final c in f['processes'] as List) {
        expect(isBpcProcess(m(c['process'])), c['isBpc'], reason: '${c['process']}');
      }
    });

    test('every formula text is the web\'s, and no more', () {
      final formulas = loadFixture('formulas.json', dir: dir) as Map;
      expect(bpcFormulas.keys.toSet(), formulas.keys.toSet());
      for (final e in formulas.entries) {
        expect(bpcFormulas[e.key], e.value, reason: '${e.key}');
      }
      expect(spec.formulas, same(bpcFormulas));
    });
  });

  group('bpcDayCalc matches the web', () {
    final cases = loadFixture('day_calc.json', dir: dir) as List;
    test('${cases.length} operator-days — each entry its own, combined once on the lock', () {
      expect(cases.length, greaterThan(250));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final input = [for (final r in c['rows'] as List) r == null ? null : m(r)];
        final sorted = sortByMachineOn(input);
        expect([for (final r in sorted) r['_id']], c['order'], reason: 'order $i');
        expect(diff(bpcDayCalc(sorted), c['out']), isNull, reason: 'case $i ${showCase(c['rows'])}');
        expect(diff(spec.dayCalc(sorted), c['out']), isNull, reason: 'spec $i');
      }
    });
  });

  group('validateBpcEntry matches the web', () {
    final cases = loadFixture('validation.json', dir: dir) as List;
    test('${cases.length} blocks', () {
      expect(cases.length, greaterThan(500));
      var withErrors = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final saved = c['saved'] == null ? null : m(c['saved']);
        final actual = spec.validateEntry(m(c['values']), saved: saved);
        if (actual.isNotEmpty) withErrors++;
        expect(diff(actual, c['errors']), isNull, reason: 'case $i ${showCase(c['values'])} saved=${c['saved']}');
      }
      // The set exercises both outcomes.
      expect(withErrors, greaterThan(100));
      expect(withErrors, lessThan(cases.length - 20));
    });

    test('firstError scrolls to the same field as the web', () {
      final f = loadFixture('first_error.json', dir: dir) as Map;
      expect(bpcFieldOrder, f['order']);
      expect(spec.fieldOrder, f['order']);
      expect(bpcMinuteKeys, f['minuteKeys']);
      for (final c in f['cases'] as List) {
        final list = [for (final e in c['errors'] as List) e == null ? <String, String>{} : Map<String, String>.from(e as Map)];
        final dart = spec.firstError(list);
        final web = c['first'];
        if (web == null) {
          expect(dart, isNull, reason: '${c['errors']}');
        } else {
          expect({'index': dart?['index'], 'field': dart?['field']}, {'index': web['index'], 'field': web['field']}, reason: '${c['errors']}');
        }
      }
    });
  });

  group('values and payload match the page', () {
    test('toPayload is the web body (worker for machine, the reject split, status-only blanking)', () {
      final cases = loadFixture('payload.json', dir: dir) as List;
      expect(cases.length, greaterThan(200));
      var withSplit = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = bpcToPayload(m(c['values']), isEdit: c['isEdit'] as bool, processId: c['processId']);
        if (((c['payload'] as Map)['rejectBreakdown'] as Map?)?.isNotEmpty ?? false) withSplit++;
        expect(diff(actual, c['payload']), isNull, reason: 'case $i ${showCase(c['values'])} edit=${c['isEdit']}');
      }
      expect(withSplit, greaterThan(50), reason: 'the reject split must be exercised');
    });

    test('the spec sends the page\'s process last', () {
      final body = spec.finishPayload(spec.toPayload(spec.emptyEntry(), isEdit: false), process: {'_id': 'p9'});
      expect(body['process'], 'p9');
      expect(body['slot'], 'auto');
      expect(body.containsKey('machine'), isFalse);
      expect(body.containsKey('worker'), isTrue);
    });

    test('toFormValues is the web\'s, typed fields as text', () {
      final cases = loadFixture('to_form_values.json', dir: dir) as List;
      final typed = {...bpcNumberFields, ...bpcTextFields, ...bpcTimeFields};
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = spec.toFormValues(m(c['row']), now: DateTime(2026, 1, 1));
        final expected = m(c['out']);
        for (final k in typed) {
          expected[k] = asText(expected[k]);
        }
        expected['rejectBreakdown'] = (expected['rejectBreakdown'] as Map).map((k, v) => MapEntry(k, asText(v)));
        expect(diff(actual, expected), isNull, reason: 'case $i ${showCase(c['row'])}');
      }
    });

    test('quantityFormValues keeps this sheet\'s reasons; the default is still the CNC list', () {
      final cases = loadFixture('quantity_form_values.json', dir: dir) as List;
      Map<String, dynamic> norm(Object? o) {
        final out = m(o);
        out['actualQty'] = asText(out['actualQty']);
        out['rejectBreakdown'] = (out['rejectBreakdown'] as Map).map((k, v) => MapEntry('$k', asText(v)));
        return out;
      }

      var bpcSplits = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final row = m(c['row']);
        final bpc = quantityFormValues(row, bpcRejectReasons);
        if ((bpc['rejectBreakdown'] as Map).isNotEmpty) bpcSplits++;
        expect(diff(bpc, norm(c['bpc'])), isNull, reason: 'bpc $i ${showCase(row)}');
        expect(diff(quantityFormValues(row), norm(c['cnc'])), isNull, reason: 'cnc $i ${showCase(row)}');
      }
      expect(bpcSplits, greaterThan(20));
    });

    test('hasAnyEntryData and the block tint follow the web', () {
      final cases = loadFixture('has_data.json', dir: dir) as List;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        if (c.containsKey('list')) {
          expect(spec.hasAnyEntryData(rows(c['list'])), c['anyData'], reason: 'list $i');
          continue;
        }
        final v = m(c['values']);
        expect(spec.entryHasData(v), c['blockHasData'], reason: 'block $i ${showCase(v)}');
        expect(spec.hasAnyEntryData([v]), c['anyData'], reason: 'any $i ${showCase(v)}');
      }
    });

    test('picking an item copies its Standard Time per Piece', () {
      final f = loadFixture('item_select.json', dir: dir) as Map;
      final items = rows(f['items']);
      for (final c in f['cases'] as List) {
        final actual = spec.applyItemSelection(m(c['values']), c['itemId'] as String, items);
        final expected = m(c['out']);
        expected['totalCycleSec'] = asText(expected['totalCycleSec']);
        expect(diff(actual, expected), isNull, reason: '${c['itemId']}');
      }
    });

    test('empty entry, new block, draft merge and a reject box change', () {
      final now = DateTime(2026, 10, 26);
      final e = spec.emptyEntry(now: now);
      expect(e['date'], '2026-10-26');
      expect(e['workingMode'], 'Working');
      expect(e['machine'], '');
      expect(e['slot'], 1);
      expect(e['machineStatus'], isEmpty);
      expect(e['rejectBreakdown'], <String, dynamic>{});
      for (final k in [...bpcNumberFields, ...bpcTextFields, ...bpcTimeFields]) {
        expect(e[k], '', reason: k);
      }
      expect(spec.newBlockAfter([{...e, 'date': '2026-10-20', 'machine': 'op1'}], now: now), {...e, 'date': '2026-10-20'});
      expect(spec.newBlockAfter(const [], now: now)['date'], '2026-10-26');
      final merged = spec.mergeDraftEntry({'machine': 'op1', 'itemName': 'BODY'}, now: now);
      expect(merged['machine'], 'op1');
      expect(merged['setupMin'], '');
      expect(merged['rejectBreakdown'], <String, dynamic>{});
      final changed = spec.applyRejectChange({...e, 'rejectBreakdown': {'Other': '1'}}, 'TAP Broken Casting', '2');
      expect(changed['rejectBreakdown'], {'Other': '1', 'TAP Broken Casting': '2'});
    });
  });

  group('the page\'s popups and time rules in this sheet\'s words', () {
    Object? enc(EntryNotice n) => [
          n.message,
          {
            'title': n.title,
            'details': [
              for (final d in n.details) {'label': d.label, 'value': d.value, if (d.highlight) 'highlight': true},
            ],
            'hint': n.hint,
          },
        ];

    test('Save on an incomplete entry: no quantity popup, the operator\'s words, operators named by id', () {
      final cases = loadFixture('first_over_limit.json', dir: dir) as List;
      expect(cases.length, greaterThan(100));
      var hits = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final blocks = rows(c['blocks']);
        final errors = [for (final e in c['errors'] as List) strings(e)];
        final out = spec.firstOverLimit(blocks, errors, machineNames: strings(c['machineName']));
        final ctx = 'case $i ${showCase(c)}';
        if (c['out'] == null) {
          expect(out, isNull, reason: ctx);
          continue;
        }
        hits++;
        final e = c['out'] as Map;
        expect(out, isNotNull, reason: ctx);
        expect(out!.index, e['index'], reason: ctx);
        // TOTAL QTY beating Ideal is OEE Review's business, never a limit popup.
        expect(out.field, 'stoppageTotal', reason: ctx);
        expect(out.field, e['field'], reason: ctx);
        expect(out.notice.returnFocus, isFalse, reason: ctx);
        final pair = e['notice'] as List;
        final opts = Map<String, dynamic>.from(pair[1] as Map)..remove('returnFocus');
        expect(diff(enc(out.notice), [pair[0], opts]), isNull, reason: ctx);
      }
      expect(hits, greaterThan(20), reason: 'the generator must exercise the popup path');
    });

    test('an idle box typed past the Machine Shift Time: the web\'s popup', () {
      for (final c in loadFixture('stoppage_notice.json', dir: dir) as List) {
        final out = stoppageNotice(limitMin: c['limitMin'], totalMin: c['totalMin'], words: bpcWords);
        expect(diff(enc(out), c['out']), isNull, reason: '$c');
      }
    });

    test('overlap ("for this operator") and the $bpcMaxEntriesPerDay-entries-a-day rule', () {
      final cases = loadFixture('time_rules.json', dir: dir) as List;
      var overlaps = 0, fulls = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final entries = rows(c['entries']);
        final occupied = {for (final e in (c['occupied'] as Map).entries) '${e.key}': rows(e.value)};
        final saved = c['saved'] == null ? null : m(c['saved']);
        final editSlot = (c['editSlot'] as num?)?.toInt();
        final names = strings(c['names']);
        final overlap = overlapErrors(entries, occupied, editSlot: editSlot, saved: saved, words: spec.timeWords);
        final full = slotsFullErrors(
          entries,
          occupied,
          editSlot: editSlot,
          saved: saved,
          max: spec.maxEntriesPerDay!,
          who: (id) => names[id] ?? 'This ${spec.machineNoun}',
        );
        overlaps += overlap.where((e) => e.isNotEmpty).length;
        fulls += full.where((e) => e.isNotEmpty).length;
        expect(diff(overlap, c['overlap']), isNull, reason: 'overlap $i ${showCase(c)}');
        expect(diff(full, c['full']), isNull, reason: 'full $i ${showCase(c)}');
      }
      expect(overlaps, greaterThan(10));
      expect(fulls, greaterThan(10));
    });
  });

  group('the table matches bpcColumns.jsx', () {
    final f = loadFixture('table_cells.json', dir: dir) as Map;
    final cols = spec.columns({'rejectedQty'}).where(const SheetEnv(showVendor: true));
    final all = [...cols.left, ...cols.middle];

    test('the same columns, in the same order and words', () {
      final web = <Map<String, String>>[];
      for (final c in f['columns'] as List) {
        web.add({'key': '${c['key'] == 'rejectedQty' ? 'rejectedQty' : c['key']}', 'label': '${c['label']}'});
        for (final s in (c['subs'] as List?) ?? const []) {
          web.add({'key': '${s['key']}', 'label': '${s['label']}'});
        }
      }
      expect([for (final c in all) {'key': c.key, 'label': c.label}], web);
      // Vendor Name hides on a page whose process has no vendors.
      expect(spec.columns(const {}).where(const SheetEnv(showVendor: false)).middle.any((c) => c.key == 'vendorName'), isFalse);
      // Operator and Date are the frozen, merged pair; nothing else merges.
      expect([for (final c in cols.left) c.key], ['date', 'machine']);
      expect([for (final c in cols.middle) if (c.merge != ColMerge.none) c.key], isEmpty);
    });

    test('every cell reads as the web\'s (${(f['cases'] as List).length} rows)', () {
      var checked = 0;
      for (final c in f['cases'] as List) {
        final row = m(c['row']);
        final data = CellData(
          row: row,
          calc: spec.rowCalc(row),
          day: m(c['day']),
          machineName: (c['machineName'] as String?) ?? '—',
        );
        final web = Map<String, String>.from(c['cells'] as Map);
        for (final col in all) {
          final want = web[col.key];
          expect(want, isNotNull, reason: 'web has no ${col.key}');
          if (col.key == 'remarks') {
            // The web draws an eye (no text) when there is a Reason/Remarks, else a dash.
            expect(want == '—', c['generalRemark'] == false, reason: 'remarks ${showCase(row)}');
            expect(spec.remarkParts(row).any((p) => p['key'] == 'general'), c['generalRemark'], reason: showCase(row));
            continue;
          }
          expect(col.text(data), want, reason: '${col.key} ${showCase(row)}');
          checked++;
        }
      }
      expect(checked, greaterThan(5000));
    });
  });
}
