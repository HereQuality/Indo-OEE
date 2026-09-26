import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/auth/login_screen.dart';

import '../support/fake_api.dart';

const _login = '/api/v1/auth/login';

Future<FakeApi> _pump(WidgetTester tester, {bool dark = false}) async {
  final api = FakeApi.install();
  await pumpScreen(tester, const LoginScreen(), dark: dark);
  return api;
}

/// 0 = username, 1 = password.
TextField _field(WidgetTester tester, int i) => tester.widgetList<TextField>(find.byType(TextField)).elementAt(i);

void main() {
  testWidgets('Sign in is tappable with empty fields and says what is missing', (tester) async {
    final api = await _pump(tester);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNotNull);

    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();

    expect(find.text('Username is required'), findsOneWidget);
    expect(find.text('Password is required'), findsOneWidget);
    expect(_field(tester, 0).focusNode!.hasFocus, isTrue, reason: 'focus goes to the first empty field');
    expect(api.called('POST', _login), isEmpty);
  });

  testWidgets('only the missing field is flagged, and it gets the focus', (tester) async {
    final api = await _pump(tester);
    await tester.enterText(find.byType(TextField).first, 'asha');
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();

    expect(find.text('Username is required'), findsNothing);
    expect(find.text('Password is required'), findsOneWidget);
    expect(_field(tester, 1).focusNode!.hasFocus, isTrue);
    expect(api.called('POST', _login), isEmpty);
  });

  testWidgets('a blank (spaces-only) username counts as missing', (tester) async {
    await _pump(tester);
    await tester.enterText(find.byType(TextField).first, '   ');
    await tester.enterText(find.byType(TextField).last, 'secret');
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Username is required'), findsOneWidget);
  });

  testWidgets('the keyboard "Next" key moves from username to password', (tester) async {
    await _pump(tester);
    await tester.showKeyboard(find.byType(TextField).first);
    await tester.testTextInput.receiveAction(TextInputAction.next);
    await tester.pump();
    expect(_field(tester, 1).focusNode!.hasFocus, isTrue);
  });

  testWidgets('a rejected sign-in shows the server message, and editing clears it', (tester) async {
    final api = await _pump(tester);
    api.on('POST', _login, (_) => FakeResponse({'message': 'Authentication failed', 'attemptsRemaining': 2}, status: 401));

    await tester.enterText(find.byType(TextField).first, 'asha');
    await tester.enterText(find.byType(TextField).last, 'wrong');
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();

    expect(api.called('POST', _login), hasLength(1));
    expect(find.text('Invalid credentials. 2 attempt(s) left.'), findsOneWidget);

    await tester.enterText(find.byType(TextField).last, 'wrong2');
    await tester.pump();
    expect(find.text('Invalid credentials. 2 attempt(s) left.'), findsNothing);
  });

  testWidgets('dark mode and a small phone with large text do not overflow', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, const LoginScreen(), dark: true, size: const Size(360, 640), textScale: 1.6);
    await tester.ensureVisible(find.text('Sign in')); // the page scrolls at this size
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Username is required'), findsOneWidget);
  });
}
