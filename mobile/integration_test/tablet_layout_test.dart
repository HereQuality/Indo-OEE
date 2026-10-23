// Area 6 - tablet / landscape sanity: hub, one entry form, dashboard, list. Run through
// mobile/e2e/run_tablet.sh, which resizes the emulator window with `wm size` / `wm density`
// (800x1280 portrait tablet, then 1280x800 landscape) and resets it afterwards. A layout overflow
// surfaces as a Flutter error and fails the test; screenshots land in mobile/e2e/shots/.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/widgets/kpi_tile.dart';
import 'package:indo/features/production/dashboard/widgets/process_selector.dart';
import 'package:indo/features/production/data_entry_hub/data_entry_hub_card.dart';

import 'support/api.dart';
import 'support/e2e.dart';
import 'support/ui.dart';

const _tag = String.fromEnvironment('E2E_SHOT_TAG', defaultValue: 'tablet');

/// Distinct left edges (rounded) of the widgets [f] finds = how many columns they sit in.
Set<int> columnsOf(WidgetTester t, Finder f) => {
  for (final e in f.evaluate())
    t.getTopLeft(find.byWidget(e.widget)).dx.round() ~/ 8,
};

/// Distinct top edges: how many rows.
Set<int> rowsOf(WidgetTester t, Finder f) => {
  for (final e in f.evaluate())
    t.getTopLeft(find.byWidget(e.widget)).dy.round() ~/ 8,
};

void noOverflow(WidgetTester t, String where) {
  final ex = t.takeException();
  expect(ex, isNull, reason: 'no layout overflow / error on $where: $ex');
}

void main() {
  initE2e();

  testWidgets('hub, entry form and dashboard lay out on a tablet-size window', (
    t,
  ) async {
    final admin = await E2eApi.login('e2e_admin');
    const tag = 'E2E-tablet-dash';
    await admin.deleteTagged('/vmc-sheet', tag);
    await seedVmcRow(
      admin,
      tag: tag,
      machine: 'VMC-3',
      on: '08:00',
      off: '12:00',
    ); // gives the dashboard something to draw
    try {
      await launchAndSignIn(
        t,
        username: 'e2e_admin',
        password: e2ePasswords['e2e_admin']!,
      );
      await pumpUntilFound(t, find.byType(NavigationBar));
      final size = t.view.physicalSize / t.view.devicePixelRatio;
      // ignore: avoid_print
      print('WINDOW dp ${size.width.round()}x${size.height.round()}');
      if (size.shortestSide < 600) {
        // The plain phone run (run_e2e.sh): nothing tablet-specific to check; run_tablet.sh covers it.
        // ignore: avoid_print
        print('SKIP tablet layout: window is ${size.width.round()}x${size.height.round()} dp (a phone)');
        return;
      }

      // dashboard
      await pumpFor(t, const Duration(seconds: 3));
      final wide =
          size.width >=
          700; // the dashboard's tablet breakpoint (tabletMinWidth)
      noOverflow(t, 'dashboard (all machines)');
      await shot(t, '${_tag}_dashboard');
      final vmcChip = find.descendant(
        of: find.byType(ProcessSelector),
        matching: find.text('VMC'),
      );
      await t.tap(vmcChip.first);
      await pumpFor(t, const Duration(seconds: 3));
      await pumpUntilFound(
        t,
        find.byType(KpiTile),
        reason: 'KPI tiles on the dashboard',
      );
      noOverflow(t, 'dashboard (VMC)');
      final tileCols = columnsOf(t, find.byType(KpiTile));
      // ignore: avoid_print
      print(
        'DASH tiles=${find.byType(KpiTile).evaluate().length} cols=${tileCols.length} width=${size.width.round()}',
      );
      expect(
        tileCols.length,
        greaterThanOrEqualTo(wide ? 4 : 2),
        reason: 'KPI tiles use the width (${size.width.round()} dp): $tileCols',
      );
      if (wide) {
        expect(
          find.text('Customize'),
          findsOneWidget,
          reason: 'the tablet header bar carries Customize for an admin',
        );
        expect(find.text('Filters'), findsWidgets);
        final charts = find.byWidgetPredicate(
          (w) =>
              w.key is ValueKey &&
              '${(w.key as ValueKey).value}'.startsWith('chart:'),
        );
        if (charts.evaluate().length >= 2) {
          expect(
            columnsOf(t, charts).length,
            greaterThanOrEqualTo(2),
            reason: 'graphs sit side by side on a tablet',
          );
        }
      }
      await shot(t, '${_tag}_dashboard_vmc');

      // hub: several columns
      await openProcess(t, 'CNC'); // goes through the hub
      await goBack(t);
      await pumpUntilFound(t, find.byType(HubCard));
      await pumpFor(t, const Duration(seconds: 1));
      noOverflow(t, 'hub');
      final hubCols = columnsOf(t, find.byType(HubCard)).length;
      expect(
        hubCols,
        size.width >= 900 ? 3 : 2,
        reason: 'hub grid columns at ${size.width.round()} dp',
      );
      expect(rowsOf(t, find.byType(HubCard)).length, greaterThanOrEqualTo(2));
      await shot(t, '${_tag}_hub');

      // list + entry form (a dialog on tablets)
      await openProcess(t, 'VMC');
      noOverflow(t, 'VMC list');
      await shot(t, '${_tag}_list');
      await tapKey(t, 'sheet-add');
      await pickOption(t, 'machine', 'VMC-2');
      await pickOption(t, 'operator', 'Anil Verma');
      await pickOption(t, 'itemName', 'VMC Bracket VB-10');
      await typeTime(t, 'machineOnTime', '08:00');
      await typeTime(t, 'machineOffTime', '12:00');
      await typeBox(t, 'okQty', '30');
      await typeBox(t, 'rejectedQty', '1');
      await pumpFor(t, const Duration(seconds: 1));
      noOverflow(t, 'entry form');
      // two columns: some pairs of boxes share a row
      final names = [
        'machine',
        'operator',
        'itemName',
        'machineOnTime',
        'machineOffTime',
        'okQty',
        'rejectedQty',
      ];
      final tops = <String, List<double>>{};
      for (final n in names) {
        final f = find.byKey(ValueKey<String>('entry0/$n'));
        if (f.evaluate().isEmpty) continue;
        final o = t.getTopLeft(f.first);
        tops[n] = [o.dx, o.dy];
      }
      var sideBySide = 0;
      for (final a in tops.entries) {
        for (final b in tops.entries) {
          if (a.key.compareTo(b.key) < 0 &&
              (a.value[1] - b.value[1]).abs() < 4 &&
              (a.value[0] - b.value[0]).abs() > 100)
            sideBySide++;
        }
      }
      // ignore: avoid_print
      print('FORM positions $tops sideBySide=$sideBySide');
      expect(
        sideBySide,
        greaterThanOrEqualTo(1),
        reason: 'the form is two columns on a tablet: $tops',
      );
      final formBox = t.getRect(
        find.byKey(const ValueKey<String>('entry0/okQty')).first,
      );
      expect(
        formBox.right,
        lessThanOrEqualTo(size.width + 0.5),
        reason: 'form fields stay on screen',
      );
      await shot(t, '${_tag}_form');
      await scrollForm(t, 700);
      noOverflow(t, 'entry form (lower)');
      await shot(t, '${_tag}_form_lower');
      await leaveEditor(t);
      await goBack(t);

      // Dashboard again with its filters sheet
      await tapNav(t, 'Dashboard');
      await pumpFor(t, const Duration(seconds: 2));
      final filters = find.text('Filters');
      if (filters.evaluate().isNotEmpty) {
        await t.tap(filters.first);
        await pumpFor(t, const Duration(seconds: 1));
        noOverflow(t, 'filters sheet');
        await shot(t, '${_tag}_filters');
      }
    } finally {
      await admin.deleteTagged('/vmc-sheet', tag);
    }
  });
}
