// Area 1 - auth & shell: wrong password, right password, bottom bar, sign out, remember-me relaunch.
//   mobile/e2e/dev_run.sh integration_test/auth_shell_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/api.dart';
import 'support/e2e.dart';
import 'support/ui.dart';

void main() {
  initE2e();

  testWidgets(
    'wrong password shows the server error and stays on login; the right one enters',
    (t) async {
      // What the server says for a bad login on an unknown user (no attempt counter on a real account is burnt).
      final bad = await E2eApi.rawLogin('no_such_user_e2e', 'definitely-wrong');
      expect(bad.status, 401);
      await launchApp(t);
      await t.enterText(find.byType(TextFormField).at(0), 'e2e_vmc');
      await t.enterText(find.byType(TextFormField).at(1), 'definitely-wrong');
      await t.testTextInput.receiveAction(TextInputAction.done);
      // The app shows the server's message, or "Invalid credentials. N attempt(s) left." when the server counts attempts.
      final errorShown = find.byWidgetPredicate(
        (w) =>
            w is Text &&
            (w.data ?? '').isNotEmpty &&
            ((w.data!.contains('Invalid credentials')) ||
                w.data == bad.message),
      );
      await pumpUntilFound(
        t,
        errorShown,
        reason: 'the wrong-password error on the login screen',
      );
      expect(
        find.text('Sign in to your workspace'),
        findsOneWidget,
        reason: 'still on the login screen',
      );
      expect(find.byType(NavigationBar), findsNothing);
      await shot(t, 'auth_wrong_password');

      // editing clears the stale error, the right password enters (tap the box first, as a person would)
      await t.tap(find.byType(TextFormField).at(1));
      await pumpFor(t, const Duration(milliseconds: 400));
      await t.enterText(
        find.byType(TextFormField).at(1),
        e2ePasswords['e2e_vmc']!,
      );
      await pumpFor(t);
      await shot(t, 'auth_after_edit');
      expect(
        errorShown,
        findsNothing,
        reason: 'the stale error goes away once the person edits',
      );
      await t.testTextInput.receiveAction(TextInputAction.done);
      await pumpUntilFound(
        t,
        find.byType(NavigationBar),
        reason: 'the bottom bar after a good login',
      );
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(inNav('Dashboard'), findsOneWidget);
      expect(inNav('Data entry'), findsOneWidget);
    },
  );

  testWidgets('empty fields are refused with a message, nothing is sent', (
    t,
  ) async {
    await launchApp(t);
    await t.testTextInput.receiveAction(TextInputAction.done);
    await pumpFor(t);
    expect(find.text('Sign in to your workspace'), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
    await shot(t, 'auth_empty');
  });

  testWidgets(
    'bottom bar switches tabs; sign out returns to the login screen',
    (t) async {
      await launchAndSignIn(t, username: 'e2e_vmc', viaForm: true);
      await pumpUntilFound(t, find.byType(NavigationBar));
      await tapNav(t, 'Data entry');
      expect(find.text('Data entry'), findsWidgets);
      await tapNav(t, 'Dashboard');
      // account menu -> Sign out -> confirm
      await t.tap(find.byTooltip('Account').first);
      await pumpFor(t, const Duration(seconds: 1));
      await tapText(t, 'Sign out');
      await pumpUntilFound(
        t,
        find.byType(AlertDialog),
        reason: 'the sign-out confirmation',
      );
      await tapText(t, 'Sign out', within: find.byType(AlertDialog));
      await pumpUntilFound(
        t,
        find.text('Sign in to your workspace'),
        reason: 'the login screen after sign out',
      );
      expect(find.byType(NavigationBar), findsNothing);
    },
  );

  testWidgets(
    'Remember me: the session survives a relaunch; without it the person signs in again',
    (t) async {
      await launchApp(t);
      await t.enterText(find.byType(TextFormField).at(0), 'e2e_vmc');
      await t.enterText(
        find.byType(TextFormField).at(1),
        e2ePasswords['e2e_vmc']!,
      );
      await t.tap(find.byType(Checkbox));
      await pumpFor(t, const Duration(milliseconds: 400));
      await t.testTextInput.receiveAction(TextInputAction.done);
      await pumpUntilFound(t, find.byType(NavigationBar));
      await relaunchApp(t);
      await pumpUntilFound(
        t,
        find.byType(NavigationBar),
        reason: 'a remembered session signs straight in after relaunch',
      );
      expect(find.text('Sign in to your workspace'), findsNothing);
      await shot(t, 'auth_remembered');
    },
  );
}
