// Area 2 - access scoping per seeded role.
//   mobile/e2e/dev_run.sh integration_test/access_scoping_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/widgets/process_selector.dart';
import 'package:indo/features/production/data_entry_hub/data_entry_hub_card.dart';

import 'support/api.dart';
import 'support/e2e.dart';
import 'support/ui.dart';

List<String> hubCards() => [
  for (final e in find.byType(HubCard).evaluate())
    ((find
                    .descendant(
                      of: find.byWidget(e.widget),
                      matching: find.byType(Text),
                    )
                    .evaluate()
                    .first
                    .widget)
                as Text)
            .data ??
        '',
];

List<String> dashboardChips() => [
  for (final e
      in find
          .descendant(
            of: find.byType(ProcessSelector),
            matching: find.byType(Text),
          )
          .evaluate())
    (e.widget as Text).data ?? '',
];

Future<void> openHub(WidgetTester t) async {
  for (var i = 0; i < 4 && find.byType(HubCard).evaluate().isEmpty; i++) {
    await tapNav(t, 'Data entry');
    await pumpFor(t, const Duration(milliseconds: 800));
  }
  await pumpUntilFound(t, find.byType(HubCard), reason: 'hub cards');
  await pumpFor(t, const Duration(seconds: 1));
}

void main() {
  initE2e();

  testWidgets(
    'e2e_vmc: Dashboard + Data entry; hub lists ONLY VMC; dashboard chips ONLY VMC, no All machines',
    (t) async {
      await launchAndSignIn(t, username: 'e2e_vmc');
      await pumpUntilFound(t, find.byType(NavigationBar));
      expect(inNav('Dashboard'), findsOneWidget);
      expect(inNav('Data entry'), findsOneWidget);
      await pumpUntilFound(
        t,
        find.byType(ProcessSelector),
        reason: 'dashboard process chips',
      );
      await pumpFor(t, const Duration(seconds: 1));
      expect(dashboardChips(), [
        'VMC',
      ], reason: 'only VMC, and no "All machines"');
      expect(find.text('All machines'), findsNothing);
      await shot(t, 'scope_vmc_dashboard');
      await openHub(t);
      expect(hubCards(), ['VMC']);
      await shot(t, 'scope_vmc_hub');
    },
  );

  testWidgets(
    'e2e_multi: hub VMC/PRESS/CNC only; dashboard has them plus All machines',
    (t) async {
      await launchAndSignIn(t, username: 'e2e_multi');
      await pumpUntilFound(t, find.byType(ProcessSelector));
      await pumpFor(t, const Duration(seconds: 1));
      final chips = dashboardChips();
      expect(chips.toSet(), {'CNC', 'VMC', 'PRESS', 'All machines'});
      await openHub(t);
      expect(hubCards().toSet(), {'CNC', 'VMC', 'PRESS'});
      expect(hubCards(), hasLength(3));
      await shot(t, 'scope_multi_hub');
    },
  );

  testWidgets('e2e_admin: all 10 processes in the hub; RUBBER is disabled', (
    t,
  ) async {
    await launchAndSignIn(
      t,
      username: 'e2e_admin',
      password: e2ePasswords['e2e_admin']!,
    );
    await pumpUntilFound(t, find.byType(NavigationBar));
    await openHub(t);
    final cards = hubCards();
    expect(cards, hasLength(10));
    expect(cards.toSet(), {
      'CNC',
      'VMC',
      'SPM',
      'RIVET',
      'PRESS',
      'CONTACT',
      'TROBE',
      'SPRING FOR PINS',
      'AFTER POWDER COATING',
      'RUBBER',
    });
    // RUBBER: no entry screen. The seed gives it no Data Entry page, so the card reads "Not linked to a page"
    // (it reads "Not in the app yet" when a page is linked that the phone has no screen for).
    final rubber = find.descendant(
      of: find.byType(HubCard),
      matching: find.text('RUBBER'),
    );
    expect(
      find.descendant(
        of: find.byType(HubCard),
        matching: find.textContaining(
          RegExp('Not in the app yet|Not linked to a page'),
        ),
      ),
      findsOneWidget,
    );
    await t.ensureVisible(rubber.first);
    await pumpFor(t, const Duration(milliseconds: 300));
    await t.tap(rubber.first);
    await pumpFor(t, const Duration(seconds: 1));
    expect(
      find.byKey(const ValueKey<String>('sheet-add')),
      findsNothing,
      reason: 'tapping RUBBER opens nothing',
    );
    expect(find.byType(HubCard), findsWidgets);
    await shot(t, 'scope_admin_hub');
  });

  testWidgets(
    'e2e_viewonly: can open VMC, sees no Add / Edit / Delete; the server refuses a save (403)',
    (t) async {
      final admin = await E2eApi.login('e2e_admin');
      final tag = 'E2E-scope-viewonly';
      await admin.deleteTagged('/vmc-sheet', tag);
      final row = await seedVmcRow(
        admin,
        tag: tag,
        machine: 'VMC-3',
        operator: 'Kiran Joshi',
        on: '17:00',
        off: '19:00',
      );
      await launchAndSignIn(t, username: 'e2e_viewonly');
      await pumpUntilFound(t, find.byType(NavigationBar));
      await openHub(t);
      expect(hubCards(), ['VMC']);
      final card = find.descendant(
        of: find.byType(HubCard),
        matching: find.text('VMC'),
      );
      await t.tap(card.first);
      await pumpUntilFound(
        t,
        find.byKey(ValueKey<String>('trow-${row['_id']}')),
        reason: 'the seeded VMC row is listed (view works)',
      );
      expect(
        find.byKey(const ValueKey<String>('sheet-add')),
        findsNothing,
        reason: 'no Add entry for a view-only role',
      );
      expect(find.byKey(ValueKey<String>('edit-${row['_id']}')), findsNothing);
      expect(
        find.byKey(ValueKey<String>('delete-${row['_id']}')),
        findsNothing,
      );
      await shot(t, 'scope_viewonly_vmc');
      // the server also refuses a write
      final vo = await E2eApi.login('e2e_viewonly');
      final put = await vo.put('/vmc-sheet/row', {...row, 'remarks': 'hack'});
      expect(put.status, 403);
      await admin.deleteTagged('/vmc-sheet', tag);
    },
  );

  testWidgets('role isolation on the server: e2e_vmc cannot write CNC (403)', (
    t,
  ) async {
    final vmc = await E2eApi.login('e2e_vmc');
    final r = await vmc.put('/production-sheet/row', {
      'date': '2026-10-21',
      'machine': 'x',
    });
    expect(r.status, 403);
  });
}
