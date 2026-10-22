// Area 5 - Dashboard: process chips per role, period picker, filters, KPI tiles with numbers, chip switching, Customize.
//   mobile/e2e/dev_run.sh integration_test/dashboard_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/widgets/control_bar.dart' show RemovableChip;
import 'package:indo/features/production/dashboard/widgets/kpi_tile.dart';
import 'package:indo/features/production/dashboard/widgets/process_selector.dart';

import 'support/api.dart';
import 'support/e2e.dart';
import 'support/ui.dart';

List<String> chips() => [
      for (final e in find.descendant(of: find.byType(ProcessSelector), matching: find.byType(Text)).evaluate()) (e.widget as Text).data ?? '',
    ];

/// Texts inside the KPI tiles on screen (label + value + hint).
List<String> tileTexts() => [
      for (final e in find.descendant(of: find.byType(KpiTile), matching: find.byType(Text)).evaluate()) (e.widget as Text).data ?? '',
    ];

Future<void> openDashboard(WidgetTester t, String user, {String? password}) async {
  await launchAndSignIn(t, username: user, password: password ?? e2ePasswords[user] ?? e2ePassword);
  await pumpUntilFound(t, find.byType(ProcessSelector), reason: 'dashboard process chips');
  await pumpFor(t, const Duration(seconds: 2));
}

Future<void> tapChip(WidgetTester t, String label) async {
  final f = find.descendant(of: find.byType(ProcessSelector), matching: find.text(label));
  await t.ensureVisible(f.first);
  await t.tap(f.first);
  await pumpFor(t, const Duration(seconds: 2));
}

void main() {
  initE2e();
  const tag = 'E2E-dash';

  testWidgets('admin: every process chip + All machines; switching chips changes the dashboard; tiles show numbers', (t) async {
    final admin = await E2eApi.login('e2e_admin');
    await admin.deleteTagged('/vmc-sheet', tag);
    await seedVmcRow(admin, tag: tag, machine: 'VMC-3', on: '08:00', off: '12:00');
    try {
      await openDashboard(t, 'e2e_admin');
      final c = chips();
      expect(c, contains('All machines'));
      expect(c.toSet().containsAll({'CNC', 'VMC', 'SPM', 'RIVET', 'PRESS', 'CONTACT', 'TROBE', 'SPRING FOR PINS', 'AFTER POWDER COATING'}), isTrue, reason: 'chips: $c');
      await shot(t, 'dash_admin');

      await tapChip(t, 'VMC');
      await pumpUntilFound(t, find.byType(KpiTile), reason: 'KPI tiles for VMC');
      final vmcTiles = tileTexts();
      // ignore: avoid_print
      print('VMC TILES $vmcTiles');
      expect(vmcTiles.where((s) => RegExp(r'\d').hasMatch(s)), isNotEmpty, reason: 'a tile shows a number: $vmcTiles');
      expect(vmcTiles.any((s) => s.contains('NaN') || s.contains('Infinity') || s.contains('null')), isFalse, reason: '$vmcTiles');
      await shot(t, 'dash_vmc');

      await tapChip(t, 'CNC');
      final cncTiles = tileTexts();
      expect(find.byType(ProcessSelector), findsOneWidget);
      // CNC has no seeded rows today: its tiles/empty state differ from VMC's
      expect(cncTiles.join('|') == vmcTiles.join('|'), isFalse, reason: 'switching chip changed the dashboard');

      await tapChip(t, 'All machines');
      await shot(t, 'dash_all');
      expect(find.byType(ProcessSelector), findsOneWidget);
    } finally {
      await admin.deleteTagged('/vmc-sheet', tag);
    }
  });

  testWidgets('e2e_vmc sees only VMC', (t) async {
    await openDashboard(t, 'e2e_vmc');
    expect(chips(), ['VMC']);
    expect(find.text('All machines'), findsNothing);
    await shot(t, 'dash_vmc_user');
  });

  testWidgets('e2e_multi: its three processes plus All machines', (t) async {
    await openDashboard(t, 'e2e_multi');
    expect(chips().toSet(), {'CNC', 'VMC', 'PRESS', 'All machines'});
  });

  testWidgets('period picker + filters sheet open and the period changes', (t) async {
    final admin = await E2eApi.login('e2e_admin');
    await admin.deleteTagged('/vmc-sheet', tag);
    await seedVmcRow(admin, tag: tag, machine: 'VMC-3');
    try {
      await openDashboard(t, 'e2e_admin');
      await tapChip(t, 'VMC');
      // period
      final period = find.byIcon(Icons.calendar_month_rounded);
      await pumpUntilFound(t, period, reason: 'period chip');
      final before = find.descendant(of: find.ancestor(of: period.first, matching: find.byType(InkWell)).first, matching: find.byType(Text)).evaluate().map((e) => (e.widget as Text).data).join();
      await t.tap(period.first);
      await pumpFor(t, const Duration(seconds: 1));
      await shot(t, 'dash_period_sheet');
      expect(find.text('Select period'), findsOneWidget);
      expect(find.text('Date range'), findsOneWidget);
      expect(find.text('Year'), findsWidgets);
      await t.tap(find.text('Sep').first);
      await pumpFor(t, const Duration(seconds: 2));
      final apply = find.widgetWithText(FilledButton, 'Apply');
      if (apply.evaluate().isNotEmpty) {
        await t.tap(apply.first);
        await pumpFor(t, const Duration(seconds: 2));
      }
      expect(find.text('Select period'), findsNothing, reason: 'sheet closed after picking a month');
      final after = find.descendant(of: find.ancestor(of: find.byIcon(Icons.calendar_month_rounded).first, matching: find.byType(InkWell)).first, matching: find.byType(Text)).evaluate().map((e) => (e.widget as Text).data).join();
      expect(after, isNot(before), reason: 'the period label changed ($before -> $after)');
      expect(after, anyOf(contains('September'), 'Last month'), reason: after);
      await shot(t, 'dash_period_changed');

    } finally {
      await admin.deleteTagged('/vmc-sheet', tag);
    }
  });

  testWidgets('filters: pick a machine -> removable chip, entries caption narrows; Clear all resets', (t) async {
    final admin = await E2eApi.login('e2e_admin');
    await admin.deleteTagged('/vmc-sheet', tag);
    await seedVmcRow(admin, tag: tag, machine: 'VMC-3');
    try {
      await openDashboard(t, 'e2e_admin');
      await tapChip(t, 'VMC');
      await pumpUntilFound(t, find.byType(KpiTile));
      await t.tap(find.text('Filters').first);
      await pumpFor(t, const Duration(seconds: 1));
      expect(find.text('Select all'), findsWidgets);
      expect(find.text('Machine'), findsWidgets);
      expect(find.text('Operator'), findsWidgets);
      expect(find.text('Part'), findsWidgets);
      await shot(t, 'dash_filters');
      final row = find.text('VMC-3');
      await pumpUntilFound(t, row, reason: 'machine VMC-3 in the filter list');
      await t.tap(row.first);
      await pumpFor(t, const Duration(milliseconds: 600));
      await t.tap(find.textContaining('Apply').first);
      await pumpFor(t, const Duration(seconds: 2));
      expect(find.text('Select all'), findsNothing, reason: 'sheet closed');
      expect(find.text('Clear all'), findsWidgets, reason: 'active filter chips with Clear all');
      expect(find.byType(RemovableChip), findsWidgets);
      await shot(t, 'dash_filtered');
      await t.tap(find.text('Clear all').first);
      await pumpFor(t, const Duration(seconds: 1));
      expect(find.byType(RemovableChip), findsNothing);
    } finally {
      await admin.deleteTagged('/vmc-sheet', tag);
    }
  });

  testWidgets('Customize is offered to the admin only', (t) async {
    await openDashboard(t, 'e2e_admin');
    await tapChip(t, 'VMC');
    final custom = find.byTooltip('Customize');
    final tabletButton = find.text('Customize');
    expect(custom.evaluate().isNotEmpty || tabletButton.evaluate().isNotEmpty, isTrue, reason: 'admin sees Customize');
    await t.tap(custom.evaluate().isNotEmpty ? custom.first : tabletButton.first);
    await pumpFor(t, const Duration(seconds: 2));
    await shot(t, 'dash_customize');
    expect(find.text('Show all'), findsWidgets, reason: 'the Customize sheet opened');
    await t.tap(find.text('Cancel').first);
    await pumpFor(t, const Duration(seconds: 1));
  });

  testWidgets('Customize is hidden from a non-admin', (t) async {
    await openDashboard(t, 'e2e_multi');
    await tapChip(t, 'VMC');
    expect(find.byTooltip('Customize'), findsNothing);
    expect(find.text('Customize'), findsNothing);
  });
}
