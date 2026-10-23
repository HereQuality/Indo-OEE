// Smoke: real app + local backend. login -> bottom bar -> Dashboard shows.
//   mobile/e2e/run_e2e.sh
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'support/e2e.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('login -> bottom bar -> Dashboard', (tester) async {
    await launchAndSignIn(tester);

    // The signed-in root: bottom navigation with the two sections this role may open.
    await pumpUntilFound(
      tester,
      find.byType(NavigationBar),
      reason: 'the bottom navigation bar',
    );
    expect(
      find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text('Dashboard'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text('Data entry'),
      ),
      findsOneWidget,
    );

    // Dashboard is the first tab: it has loaded the seeded processes from the backend.
    await pumpUntilFound(
      tester,
      find.text('VMC'),
      reason: 'the VMC process card on the Dashboard',
    );

    // Switch to Data entry and back, as a person would.
    await tester.tap(
      find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text('Data entry'),
      ),
    );
    await tester.pump(const Duration(seconds: 1));
    await tester.tap(
      find.descendant(
        of: find.byType(NavigationBar),
        matching: find.text('Dashboard'),
      ),
    );
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('VMC'), findsWidgets);
  });
}
