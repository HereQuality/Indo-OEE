// Per process, as e2e_admin on the REAL app + local backend:
// open from the hub -> Add entry -> fill like an operator -> Save -> verify list + DB ->
// Edit -> Update -> verify -> Delete -> verify.
//   mobile/e2e/dev_run.sh integration_test/process_entries_test.dart --plain-name "VMC"
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/api.dart';
import 'support/e2e.dart';
import 'support/procs.dart';
import 'support/ui.dart';

num _n(dynamic v) => v is num ? v : num.tryParse('$v') ?? double.nan;

/// Powder Coating keeps Remarks in a folded card: open it first.
Future<void> openRemarks(WidgetTester t, ProcCfg p) async {
  if (p.hasMachineOperator) return;
  final fold = find.byKey(const ValueKey<String>('entry0/fold/remarks'));
  await ensureBuilt(t, fold);
  if (boxField('remarks').evaluate().isEmpty) await tapKey(t, 'entry0/fold/remarks');
}

Future<void> fillWorking(WidgetTester t, ProcCfg p, String tag, {String lunch = '30', String setup = '10'}) async {
  await pickOption(t, 'machine', p.machine);
  if (p.hasMachineOperator) await pickOption(t, 'operator', p.operator);
  await pickOption(t, 'itemName', p.item);
  for (final k in p.tapKeys) {
    await tapKey(t, k);
  }
  await typeTime(t, 'machineOnTime', p.on);
  await typeTime(t, 'machineOffTime', p.off);
  if (p.actual != null) await typeBox(t, 'actualQty', p.actual!);
  if (p.hasMachineOperator || p.actual == null) await typeBox(t, 'okQty', p.ok);
  if (p.rejected != null) await typeBox(t, 'rejectedQty', p.rejected!);
  if (p.hasMachineOperator) {
    await typeBox(t, 'lunchMin', lunch);
    await typeBox(t, 'setupMin', setup);
  }
  await openRemarks(t, p);
  await typeBox(t, 'remarks', tag);
}

void main() {
  initE2e();
  for (final p in procCfgs) {
    testWidgets('${p.label}: add, edit, delete through the UI', (t) async {
      final admin = await E2eApi.login('e2e_admin');
      final tag = p.tag('crud');
      await admin.deleteTagged(p.sheet, tag);
      await launchAndSignIn(t, username: 'e2e_admin', password: e2ePasswords['e2e_admin']!);
      await openProcess(t, p.label);
      await tapKey(t, 'sheet-add');
      await fillWorking(t, p, tag);
      await shot(t, 'crud_${p.label.split(' ').first}_filled');
      await tapSave(t);
      await shot(t, 'crud_${p.label.split(' ').first}_saved');
      // ignore: avoid_print
      print('AFTER SAVE texts=${find.byType(Text).evaluate().map((e) => (e.widget as Text).data).toList()}');
      await expectToast(t, 'Entry added successfully!');

      // DB / API row
      var rows = await admin.rowsTagged(p.sheet, tag);
      expect(rows, hasLength(1), reason: '${p.label}: exactly one saved row');
      final row = rows.single;
      expect('${row['remarks']}', contains(tag));
      expect(_n(row['okQty']), _n(p.ok), reason: 'okQty');
      if (p.rejected != null) expect(_n(row['rejectedQty']), _n(p.rejected), reason: 'rejectedQty');
      expect('${row['machineOnTime']}', p.on);
      expect('${row['machineOffTime']}', p.off);
      if (p.hasMachineOperator) {
        expect('${row['operator']}', p.operator);
        expect(_n(row['lunchMin']), 30);
        expect(_n(row['setupMin']), 10);
      }
      expect(_n(row['plannedOperatorShiftHours']), 12, reason: 'locked planned shift');
      p.expectField?.forEach((k, v) => expect('${row[k]}', v, reason: k));
      final id = '${row['_id']}';

      // the list shows it
      await pumpFor(t, const Duration(seconds: 2));
      await shot(t, 'crud_${p.label.split(' ').first}_list');
      expect(find.textContaining(p.item), findsWidgets, reason: 'the new row is listed (part name)');

      // edit: change remarks + one number
      await tapKey(t, 'edit-$id');
      await pumpUntilFound(t, find.text('Update Production Entry').evaluate().isEmpty ? find.widgetWithText(FilledButton, 'Update') : find.text('Update Production Entry'), reason: 'edit form');
      await openRemarks(t, p);
      await typeBox(t, 'remarks', '$tag edited');
      if (p.hasMachineOperator) await typeBox(t, 'setupMin', '15');
      await tapSave(t, update: true);
      await expectToast(t, 'Entry updated successfully!');
      rows = await admin.rowsTagged(p.sheet, tag);
      expect(rows, hasLength(1));
      expect('${rows.single['remarks']}', contains('edited'));
      if (p.hasMachineOperator) expect(_n(rows.single['setupMin']), 15);

      // delete
      await pumpFor(t, const Duration(seconds: 2));
      await tapKey(t, 'delete-$id');
      await tapText(t, 'Delete', within: find.byType(AlertDialog));
      await expectToast(t, 'deleted');
      expect(await admin.rowsTagged(p.sheet, tag), isEmpty, reason: 'row gone from the API');
    });
  }
}
