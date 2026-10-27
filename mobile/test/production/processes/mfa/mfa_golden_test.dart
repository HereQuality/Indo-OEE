import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/processes/mfa/mfa_calc.dart';
import 'package:indo/features/production/processes/mfa/mfa_spec.dart';
import 'package:indo/features/production/processes/mfa/mfa_validation.dart';
import 'package:indo/features/production/processes/mfa/mfa_values.dart';
import 'package:indo/features/production/shared/limit_notice.dart' show EntryNotice;
import 'package:indo/features/production/shared/production_sheet_calc.dart';
import 'package:indo/features/production/sheet/table/sheet_columns.dart';

import '../../calc/golden_support.dart';

/// Parity of the Dart port with the REAL web JS (utils/mfaSheet.js,
/// mfaValidation.js, the shared quantityRules.js / limitNotice.js /
/// entryValidation.js, the page's pure handlers and Components/Production/
/// mfaColumns.jsx), over fixtures written by tool/gen_mfa_golden.mjs. See
/// mobile/docs/PROCESS_PORTING.md. MFA_FIXTURE_DIR points a soak run at
/// freshly generated fixtures (`SEED=.. SCALE=..`).
final dir = Platform.environment['MFA_FIXTURE_DIR'] ?? 'test/production/processes/mfa/fixtures';

const spec = mfaSpec;

Map<String, dynamic> m(Object? v) => Map<String, dynamic>.from(v as Map);
List<Map<String, dynamic>> rows(Object? v) => [for (final r in v as List) r == null ? <String, dynamic>{} : m(r)];

/// The web keeps a stored number as it is in its form values; the phone turns
/// it into the text its box shows.
Object? asText(Object? v) => v is num ? jsNumStr(v) : v;

Object? noticeJson(EntryNotice n) => [
      n.message,
      {
        'title': n.title,
        'details': [
          for (final d in n.details) {'label': d.label, 'value': d.value, if (d.highlight) 'highlight': true},
        ],
        'hint': n.hint,
      },
    ];

void main() {
  group('mfaRowCalc matches the web', () {
    final cases = loadFixture('row_calc.json', dir: dir) as List;
    test('${cases.length} rows', () {
      expect(cases.length, greaterThan(500));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final row = c['row'] == null ? null : m(c['row']);
        expect(diff(mfaRowCalc(row), c['out']), isNull, reason: 'case $i ${showCase(c['row'])}');
      }
    });

    test('the keys the framework relies on are always there', () {
      for (final c in cases.take(60)) {
        final out = spec.rowCalc(c['row'] == null ? <String, dynamic>{} : m(c['row']));
        for (final k in ['shiftHours', 'actualQty', 'pctOk', 'totalStoppageMin', 'idealQty', 'rejectedQty', 'effectiveHours']) {
          expect(out.containsKey(k), isTrue, reason: k);
        }
      }
    });
  });

  group('helpers and lists match the web', () {
    final f = loadFixture('helpers.json', dir: dir) as Map;
    test('isStatusOnly over ${(f['statusOnly'] as List).length} rows', () {
      for (final c in f['statusOnly'] as List) {
        final row = m(c['row']);
        expect(mfaIsStatusOnly(row), c['statusOnly'], reason: showCase(row));
      }
    });
    test('isMfaProcess: the linked page first, the name otherwise', () {
      for (final c in f['mfaProcess'] as List) {
        expect(isMfaProcess(m(c['process'])), c['mfa'], reason: showCase(c['process']));
      }
    });
    test('the idle fields, statuses, labels and notice words are the web\'s', () {
      final fields = loadFixture('fields.json', dir: dir) as Map;
      expect([for (final (k, l) in mfaIdleFields) {'key': k, 'label': l}], fields['idle']);
      expect(mfaNonWorkingStatuses, fields['nonWorking']);
      final labels = fields['labels'] as Map;
      expect([mfaStart, mfaEnd, mfaHours, mfaCycle, mfaIdealQty, mfaIdealQtyPerHour, mfaEffective],
          [labels['start'], labels['end'], labels['hours'], labels['cycle'], labels['idealQty'], labels['idealQtyPerHour'], labels['effective']]);
      expect(mfaMaxEntriesPerDay, fields['max']);
      final words = fields['words'] as Map;
      expect(mfaWords.who, words['who']);
      expect(mfaWords.canMake, words['canMake']);
      expect(mfaWords.shift, words['shift']);
    });
    test('every formula text is the web\'s, and only those', () {
      final formulas = loadFixture('formulas.json', dir: dir) as Map;
      expect(mfaFormulas.keys.toSet(), formulas.keys.toSet());
      for (final e in formulas.entries) {
        expect(mfaFormulas[e.key], e.value, reason: '${e.key}');
      }
      expect(spec.formulas, same(mfaFormulas));
    });
  });

  group('mfaDayCalc matches the web', () {
    final cases = loadFixture('day_calc.json', dir: dir) as List;
    test('${cases.length} worker-days', () {
      expect(cases.length, greaterThan(250));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final input = [for (final r in c['rows'] as List) r == null ? null : m(r)];
        final sorted = sortByMachineOn(input);
        expect([for (final r in sorted) r['_id']], c['order'], reason: 'order $i');
        expect(diff(mfaDayCalc(sorted), c['out']), isNull, reason: 'case $i ${showCase(c['rows'])}');
      }
    });

    test('the day card chip reads the sheet\'s own day figure (Productivity)', () {
      final c = (cases[1] as Map);
      final sorted = sortByMachineOn([for (final r in c['rows'] as List) m(r)]);
      final day = spec.dayCalc(sorted).single;
      expect(day['oeeLosses'], day['productivity']);
    });
  });

  group('validateMfaEntry matches the web', () {
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
      expect(mfaFieldOrder, f['order']);
      expect(mfaMinuteKeys, f['minuteKeys']);
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
    test('toPayload is the web body (worker for machine, process, status-only blanking)', () {
      final cases = loadFixture('payload.json', dir: dir) as List;
      expect(cases.length, greaterThan(200));
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = mfaToPayload(m(c['values']), isEdit: c['isEdit'] as bool, processId: c['processId']);
        expect(diff(actual, c['payload']), isNull, reason: 'case $i ${showCase(c['values'])} edit=${c['isEdit']}');
      }
    });

    test('toFormValues is the web\'s, typed fields as text', () {
      final cases = loadFixture('to_form_values.json', dir: dir) as List;
      final typed = {...mfaNumberFields, ...mfaTextFields, ...mfaTimeFields};
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final actual = mfaToFormValues(m(c['row']), now: DateTime(2026, 1, 1));
        final expected = m(c['out']);
        for (final k in typed) {
          expected[k] = asText(expected[k]);
        }
        expect(diff(actual, expected), isNull, reason: 'case $i ${showCase(c['row'])}');
      }
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

    test('picking a part copies its Total Cycle Time', () {
      final f = loadFixture('item_select.json', dir: dir) as Map;
      final items = rows(f['items']);
      for (final c in f['cases'] as List) {
        final actual = spec.applyItemSelection(m(c['values']), c['itemId'] as String, items);
        final expected = m(c['out']);
        expected['totalCycleSec'] = asText(expected['totalCycleSec']);
        expect(diff(actual, expected), isNull, reason: '${c['itemId']}');
      }
    });

    test('empty entry, new block, draft merge ', () {
      final now = DateTime(2026, 10, 26);
      final e = spec.emptyEntry(now: now);
      expect(e['date'], '2026-10-26');
      expect(e['workingMode'], 'Working');
      expect(e['machine'], '');
      expect(e['slot'], 1);
      expect(e['machineStatus'], isEmpty);
      for (final k in [...mfaNumberFields, ...mfaTextFields, ...mfaTimeFields]) {
        expect(e[k], '', reason: k);
      }
      expect(spec.newBlockAfter([{...e, 'date': '2026-10-20'}], now: now)['date'], '2026-10-20');
      expect(spec.newBlockAfter(const [], now: now)['date'], '2026-10-26');
      final merged = spec.mergeDraftEntry({'machine': 'w1', 'itemName': 'Frame'}, now: now);
      expect(merged['machine'], 'w1');
      expect(merged['okQty'], '');
      expect(merged['machineStatus'], <dynamic>[]);
    });
  });

  group('limit popups match the web', () {
    test('firstOverLimit as the page calls it: no quantity check, MFA\'s words, workers named by id', () {
      final cases = loadFixture('first_over_limit.json', dir: dir) as List;
      expect(cases.length, greaterThan(100));
      var hits = 0;
      for (var i = 0; i < cases.length; i++) {
        final c = cases[i] as Map;
        final blocks = rows(c['blocks']);
        final errors = [for (final e in c['errors'] as List) Map<String, String>.from((e as Map).map((k, v) => MapEntry('$k', '$v')))];
        final names = Map<String, String>.from(c['machineName'] as Map);
        final out = spec.firstOverLimit(blocks, errors, machineNames: names);
        final ctx = 'case $i ${showCase(c)}';
        if (c['out'] == null) {
          expect(out, isNull, reason: ctx);
          continue;
        }
        hits++;
        final e = c['out'] as Map;
        expect(out, isNotNull, reason: ctx);
        expect(out!.index, e['index'], reason: ctx);
        // OK + Rejected beating Ideal is OEE Review's business, never a limit popup.
        expect(out.field, 'stoppageTotal', reason: ctx);
        expect(out.field, e['field'], reason: ctx);
        expect(out.notice.returnFocus, isFalse, reason: ctx);
        final pair = e['notice'] as List;
        final opts = Map<String, dynamic>.from(pair[1] as Map)..remove('returnFocus');
        expect(diff(noticeJson(out.notice), [pair[0], opts]), isNull, reason: ctx);
      }
      expect(hits, greaterThan(20), reason: 'the generator must exercise the popup path');
    });
  });

  group('the table matches mfaColumns.jsx', () {
    final f = loadFixture('cells.json', dir: dir) as Map;
    final groups = [for (final g in f['groups'] as List) m(g)];
    final open = {for (final g in groups) g['key'] as String};
    final cols = spec.columns(open);
    final all = [...cols.left, ...cols.middle];

    test('every column, in the web order and wording, every breakdown opened', () {
      final web = [for (final c in f['columns'] as List) m(c)];
      expect([for (final c in all) c.key], [for (final c in web) c['key']]);
      expect([for (final c in all) c.label], [for (final c in web) c['label']]);
      // Each breakdown opens under the id and total the web gives it.
      for (final g in groups) {
        expect(cols.expandSummary[g['key']], g['summary'], reason: '${g['key']}');
        final summary = all.firstWhere((c) => c.key == g['summary']);
        expect(summary.expand?.id, g['key']);
        expect(summary.expand?.label, g['label']);
        final subs = [for (final c in all.where((c) => c.sub)) c.key];
        expect(subs, containsAll(g['columns'] as List), reason: '${g['key']}');
      }
      // Folded, only the totals show.
      final folded = spec.columns(const <String>{});
      expect([for (final c in folded.middle) c.key], isNot(contains('lunchMin')));
      // A header has its ⓘ whenever the sheet has a formula for it (web: formulas[c.key]).
      for (final c in all) {
        expect(c.formulaKey, mfaFormulas.containsKey(c.key) ? c.key : null, reason: c.key);
      }
    });

    test('${(f['rows'] as List).length} rows: every cell the web table shows', () {
      final names = Map<String, String>.from(f['machineName'] as Map);
      final input = [for (final c in f['rows'] as List) m(m(c)['row'])];
      // Day figures per worker and date, as the list controller works them out.
      final dayOf = <String, Map<String, dynamic>>{};
      final byDay = <String, List<Map<String, dynamic>>>{};
      for (final r in input) {
        (byDay['${r['machine']}|${r['date']}'] ??= []).add(r);
      }
      for (final group in byDay.values) {
        final sorted = sortByMachineOn(group);
        final out = spec.dayCalc(sorted);
        for (var i = 0; i < sorted.length; i++) {
          dayOf['${sorted[i]['_id']}'] = out[i];
        }
      }
      var checked = 0;
      for (final c in f['rows'] as List) {
        final row = m(m(c)['row']);
        final cells = m(m(c)['cells']);
        final data = CellData(row: row, calc: spec.rowCalc(row), day: dayOf['${row['_id']}']!, machineName: names['${row['machine']}'] ?? '');
        for (final e in cells.entries) {
          // The review badge and the general-remark eye are widgets on both
          // sides; review.json (web_parity) covers the badge's text.
          if (e.value is Map) continue;
          final col = all.firstWhere((col) => col.key == e.key);
          expect(col.text(data), e.value, reason: '${e.key} of ${showCase(row)}');
          checked++;
        }
      }
      expect(checked, greaterThan(1000));
    });
  });
}
