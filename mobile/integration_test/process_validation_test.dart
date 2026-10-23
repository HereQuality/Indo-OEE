// Per process, as e2e_admin: Non Working entry, required-field validation (inline error + focus +
// nothing saved), and the over-limit popup (CNC / VMC / SPM / RIVET / PRESS / Powder Coating).
//   mobile/e2e/dev_run.sh integration_test/process_validation_test.dart --plain-name "VMC"
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/api.dart';
import 'support/e2e.dart';
import 'support/procs.dart';
import 'support/ui.dart';

Future<int> _count(E2eApi api, ProcCfg p) async {
  var n = 0;
  for (var page = 1; page < 20; page++) {
    final r = await api.get(
      '${p.sheet}?from=2025-01-01&to=2028-12-31&page=$page',
    );
    final d = r.data;
    if (d is! List || d.isEmpty) break;
    n += d.length;
    final pages =
        (r.map['meta'] is Map ? r.map['meta']['totalPages'] : 1) as num;
    if (page >= pages) break;
  }
  return n;
}

/// Is the keyboard focus inside the form box `entry0/<name>`?
bool focusIn(String name) {
  final f = FocusManager.instance.primaryFocus;
  if (f == null) return false;
  final box = find.byKey(ValueKey<String>('entry0/$name'));
  if (box.evaluate().isEmpty) return false;
  final hit = find.descendant(
    of: box,
    matching: find.byWidgetPredicate(
      (w) =>
          (w is Focus && w.focusNode == f) ||
          (w is TextField && w.focusNode == f),
    ),
  );
  return hit.evaluate().isNotEmpty;
}

const _popupProcs = {
  'CNC',
  'VMC',
  'SPM',
  'RIVET',
  'PRESS',
  'AFTER POWDER COATING',
};

void main() {
  initE2e();
  for (final p in procCfgs) {
    final short = p.label.split(' ').first;

    testWidgets(
      '${p.label}: Non Working entry saves with only date + machine',
      (t) async {
        final admin = await E2eApi.login('e2e_admin');
        final tag = p.tag('nonworking');
        await admin.deleteTagged(p.sheet, tag);
        await launchAndSignIn(
          t,
          username: 'e2e_admin',
          password: e2ePasswords['e2e_admin']!,
        );
        await openProcess(t, p.label);
        await tapKey(t, 'sheet-add');
        await pickOption(t, 'machine', p.machine);
        if (p.hasMachineOperator) {
          await tapKey(t, 'entry0/workingMode/Non Working');
          await tapKey(t, 'entry0/machineStatus/No Planning');
        } else {
          await pickOption(t, 'workingMode', 'Non Working');
        }
        if (!p.hasMachineOperator) {
          final fold = find.byKey(
            const ValueKey<String>('entry0/fold/remarks'),
          );
          await ensureBuilt(t, fold);
          if (boxField('remarks').evaluate().isEmpty)
            await tapKey(t, 'entry0/fold/remarks');
        }
        await typeBox(t, 'remarks', tag);
        await shot(t, 'nonworking_$short');
        await tapSave(t);
        await expectToast(t, 'Entry added successfully!');
        final rows = await admin.rowsTagged(p.sheet, tag);
        expect(rows, hasLength(1));
        final row = rows.single;
        final mode = '${row['workingMode'] ?? row['workingStatus'] ?? ''}'
            .toLowerCase()
            .replaceAll(RegExp('[ _]'), '');
        expect(
          mode,
          contains('nonworking'),
          reason: 'row says Non Working: $row',
        );
        if (p.hasMachineOperator)
          expect('${row['machineStatus']}', contains('No Planning'));
        expect(
          row['okQty'] == null || row['okQty'] == 0 || row['okQty'] == '',
          isTrue,
          reason: 'no production on a non-working entry',
        );
        await admin.deleteTagged(p.sheet, tag);
      },
    );

    testWidgets(
      '${p.label}: required field missing -> inline error + focus, nothing saved',
      (t) async {
        final admin = await E2eApi.login('e2e_admin');
        final before = await _count(admin, p);
        await launchAndSignIn(
          t,
          username: 'e2e_admin',
          password: e2ePasswords['e2e_admin']!,
        );
        await openProcess(t, p.label);
        await tapKey(t, 'sheet-add');
        await pickOption(t, 'machine', p.machine);
        // Save with nothing else filled in.
        await tapSave(t);
        await pumpFor(t, const Duration(seconds: 1));
        expect(
          find.textContaining('Incomplete'),
          findsWidgets,
          reason: 'the block says it is incomplete',
        );
        expect(find.byType(AlertDialog), findsNothing);
        // first missing field (Operator, or the Part for Powder Coating) takes the focus
        final first = p.hasMachineOperator ? 'operator' : 'itemName';
        expect(focusIn(first), isTrue, reason: 'focus went to $first');
        await shot(t, 'validation_$short');
        expect(await _count(admin, p), before, reason: 'nothing was saved');
        // fill the first field only -> the next missing one is flagged, still nothing saved
        if (p.hasMachineOperator) {
          await pickOption(t, 'operator', p.operator);
          await pickOption(t, 'itemName', p.item);
          await tapSave(t);
          await pumpFor(t, const Duration(seconds: 1));
          expect(find.textContaining('Incomplete'), findsWidgets);
          expect(await _count(admin, p), before);
        }
      },
    );

    if (_popupProcs.contains(p.label)) {
      testWidgets(
        '${p.label}: a figure above the shift limit raises the popup',
        (t) async {
          final admin = await E2eApi.login('e2e_admin');
          final before = await _count(admin, p);
          await launchAndSignIn(
            t,
            username: 'e2e_admin',
            password: e2ePasswords['e2e_admin']!,
          );
          await openProcess(t, p.label);
          await tapKey(t, 'sheet-add');
          await pickOption(t, 'machine', p.machine);
          if (p.hasMachineOperator) await pickOption(t, 'operator', p.operator);
          await pickOption(t, 'itemName', p.item);
          await typeTime(t, 'machineOnTime', p.on);
          await typeTime(t, 'machineOffTime', p.off);
          // Powder Coating has no quantity ceiling on the web (Total Qty may beat Ideal and go to OEE Review:
          // PowderCoatingDataEntry.jsx qtyKey null) - its popup is the away-time (stoppage) one.
          if (p.label == 'AFTER POWDER COATING') {
            await typeBox(t, 'actualQty', '999999');
            await pumpFor(t, const Duration(seconds: 1));
            expect(
              find.byKey(const ValueKey<String>('entry-notice')),
              findsNothing,
              reason: 'no quantity popup for Powder Coating',
            );
            expect(boxText(t, 'actualQty'), '999999');
            await typeBox(t, 'actualQty', '100');
            await tapKey(t, 'entry0/fold/otherActivity');
            await typeBox(
              t,
              'otherActivityMin',
              '999',
            ); // 09:00-13:00 allows 240 min
          } else {
            await typeBox(
              t,
              p.actual != null ? 'actualQty' : 'okQty',
              '999999',
            );
          }
          await pumpUntilFound(
            t,
            find.byKey(const ValueKey<String>('entry-notice')),
            reason: 'the over-limit popup',
          );
          await shot(t, 'popup_$short');
          expect(
            find.byKey(const ValueKey<String>('entry-notice/title')),
            findsOneWidget,
          );
          await tapKey(t, 'entry-notice/ok', scroll: false);
          expect(
            find.byKey(const ValueKey<String>('entry-notice')),
            findsNothing,
          );
          expect(await _count(admin, p), before);
        },
      );
    }
  }
}
