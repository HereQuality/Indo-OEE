// Area 4 - vendor picker, planned-shift lock (Process Master), over-100% Admin-review banner/flag and the
// limit popups on VMC / CNC.
//   mobile/e2e/dev_run.sh integration_test/limits_vendor_shift_review_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/api.dart';
import 'support/e2e.dart';
import 'support/procs.dart';
import 'support/ui.dart';

final vmc = procCfgs.firstWhere((p) => p.label == 'VMC');
final cnc = procCfgs.firstWhere((p) => p.label == 'CNC');
num _n(dynamic v) => v is num ? v : num.tryParse('$v') ?? double.nan;

Future<void> openForm(WidgetTester t, ProcCfg p) async {
  await launchAndSignIn(t, username: 'e2e_admin', password: e2ePasswords['e2e_admin']!);
  await openProcess(t, p.label);
  await tapKey(t, 'sheet-add');
}

void main() {
  initE2e();

  testWidgets('VMC vendor picker offers only this process\'s vendors; the choice is saved with its name', (t) async {
    final admin = await E2eApi.login('e2e_admin');
    const tag = 'E2E-VMC-vendor';
    await admin.deleteTagged(vmc.sheet, tag);
    await openForm(t, vmc);
    await pickOption(t, 'machine', vmc.machine);
    await tapKey(t, 'entry0/vendor');
    await pumpFor(t, const Duration(milliseconds: 800));
    expect(find.descendant(of: find.byType(ListTile), matching: find.text('Bharat Tooling Co')), findsOneWidget);
    expect(find.text('Alpha Platers'), findsNothing, reason: 'Alpha Platers is not ticked for VMC');
    expect(find.text('Shree Coaters'), findsNothing);
    await shot(t, 'vendor_picker');
    await tapText(t, 'Bharat Tooling Co', within: find.byType(ListTile));
    await pumpFor(t);
    expect(find.text('Bharat Tooling Co'), findsWidgets);
    await pickOption(t, 'operator', vmc.operator);
    await pickOption(t, 'itemName', vmc.item);
    await typeTime(t, 'machineOnTime', '08:00');
    await typeTime(t, 'machineOffTime', '12:00');
    await typeBox(t, 'okQty', '50');
    await typeBox(t, 'rejectedQty', '1');
    await typeBox(t, 'remarks', tag);
    await tapSave(t);
    await expectToast(t, 'Entry added successfully!');
    final row = (await admin.rowsTagged(vmc.sheet, tag)).single;
    expect(row['vendorName'], 'Bharat Tooling Co');
    expect(row['vendor'], isNotNull);
    await admin.deleteTagged(vmc.sheet, tag);
  });

  testWidgets('planned shift: locked read-only at the Process Master hours; unlocked it is typed by hand', (t) async {
    final admin = await E2eApi.login('e2e_admin');
    const tag = 'E2E-VMC-shift';
    await admin.deleteTagged(vmc.sheet, tag);
    final procs = await admin.list('/processes');
    final proc = procs.firstWhere((x) => x['processName'] == 'VMC');
    final pid = '${proc['_id']}';
    try {
      // locked (seed default): 12 hr, read-only, with the reason
      await openForm(t, vmc);
      await pickOption(t, 'machine', vmc.machine);
      await pumpFor(t, const Duration(seconds: 1));
      await ensureBuilt(t, boxField('plannedOperatorShiftHours'));
      await t.ensureVisible(boxField('plannedOperatorShiftHours'));
      await pumpFor(t, const Duration(milliseconds: 400));
      expect(find.textContaining('locked in Process Master'), findsWidgets);
      expect(t.widget<TextField>(boxField('plannedOperatorShiftHours')).enabled, isFalse);
      expect(boxText(t, 'plannedOperatorShiftHours'), anyOf('12', '12.00', '12.0'));
      await shot(t, 'shift_locked');
      await leaveEditor(t);

      // Admin unlocks it in Process Master
      final r = await admin.put('/processes/$pid', {'plannedShiftLocked': false});
      expect(r.status, 200, reason: 'unlock the setting: ${r.message}');
      await goBack(t);
      await openProcess(t, vmc.label); // reload the process list (the setting is read when the page opens)
      await tapKey(t, 'sheet-add');
      await pickOption(t, 'machine', vmc.machine);
      await pumpFor(t, const Duration(seconds: 1));
      expect(t.widget<TextField>(boxField('plannedOperatorShiftHours')).enabled, isTrue);
      await pickOption(t, 'operator', vmc.operator);
      await pickOption(t, 'itemName', vmc.item);
      await typeTime(t, 'machineOnTime', '08:00');
      await typeTime(t, 'machineOffTime', '12:00');
      await typeBox(t, 'plannedOperatorShiftHours', '9');
      await typeBox(t, 'okQty', '40');
      await typeBox(t, 'rejectedQty', '0');
      await typeBox(t, 'remarks', tag);
      await shot(t, 'shift_unlocked');
      await tapSave(t);
      await expectToast(t, 'Entry added successfully!');
      final row = (await admin.rowsTagged(vmc.sheet, tag)).single;
      expect(_n(row['plannedOperatorShiftHours']), 9);
    } finally {
      await admin.put('/processes/$pid', {'plannedShiftLocked': true});
      await admin.deleteTagged(vmc.sheet, tag);
    }
  });

  testWidgets('over 100%: the live review banner shows, the row is saved held for Admin review with the server figures', (t) async {
    final admin = await E2eApi.login('e2e_admin');
    const tag = 'E2E-VMC-over100';
    await admin.deleteTagged(vmc.sheet, tag);
    await openForm(t, vmc);
    await pickOption(t, 'machine', vmc.machine);
    await pickOption(t, 'operator', vmc.operator);
    await pickOption(t, 'itemName', vmc.item);
    await typeTime(t, 'machineOnTime', '08:00');
    await typeTime(t, 'machineOffTime', '16:00');
    await typeBox(t, 'setupMin', '120'); // net run 6 h: ideal for the run is 120, so 160 pieces is ~133 %
    await typeBox(t, 'okQty', '160');
    await typeBox(t, 'rejectedQty', '0');
    await pumpFor(t, const Duration(seconds: 1));
    expect(find.byKey(const ValueKey<String>('entry0/oeeCheck')), findsOneWidget, reason: 'the Admin review warning is live');
    expect(find.textContaining('review'), findsWidgets);
    await typeBox(t, 'remarks', tag);
    await shot(t, 'over100_form');
    await tapSave(t);
    await expectToast(t, 'Entry added successfully!');
    final row = (await admin.rowsTagged(vmc.sheet, tag)).single;
    final review = row['review'];
    expect(review is Map && review['status'] == 'pending', isTrue, reason: 'held for review: ${row['review']}');
    final oee = Map<String, dynamic>.from(row['oee'] as Map);
    expect(_n(oee['performance']) > 1, isTrue, reason: 'performance above 100%: $oee');
    expect(_n(oee['quality']), closeTo(1.0, 0.0001));
    await pumpFor(t, const Duration(seconds: 2));
    await shot(t, 'over100_list');
    // the list marks it (review column / badge)
    expect(find.textContaining(RegExp('review', caseSensitive: false)), findsWidgets, reason: 'the list shows the review mark');
    await admin.deleteTagged(vmc.sheet, tag);
  });

  for (final p in [vmc, cnc]) {
    testWidgets('${p.label}: stoppage over the shift allowance raises the limit popup', (t) async {
      await openForm(t, p);
      await pickOption(t, 'machine', p.machine);
      await pickOption(t, 'operator', p.operator);
      await pickOption(t, 'itemName', p.item);
      await typeTime(t, 'machineOnTime', '08:00');
      await typeTime(t, 'machineOffTime', '10:00'); // 120 min allowed
      await typeBox(t, 'setupMin', '999');
      await pumpUntilFound(t, find.byKey(const ValueKey<String>('entry-notice')), reason: 'the stoppage limit popup');
      await shot(t, 'limit_stoppage_${p.label}');
      await tapKey(t, 'entry-notice/ok', scroll: false);
      expect(boxText(t, 'setupMin').length, lessThan(3), reason: 'the over-limit keystroke was refused');
    });
  }
}
