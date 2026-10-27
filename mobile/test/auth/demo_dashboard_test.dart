import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/auth/demo_dashboard_screen.dart';
import 'package:indo/features/auth/login_screen.dart';

import '../support/fake_api.dart';

void main() {
  testWidgets('login offers "Try demo"; it opens the sample dashboard without calling the server', (tester) async {
    final api = FakeApi.install();
    await pumpScreen(tester, const LoginScreen());
    final requestsBefore = api.requests.length;

    await tester.ensureVisible(find.text('Try demo'));
    await tester.tap(find.text('Try demo'));
    await tester.pumpAndSettle();

    expect(find.byType(DemoDashboardScreen), findsOneWidget);
    expect(find.textContaining('demo with sample data'), findsOneWidget, reason: 'says it is sample data');
    expect(api.requests.length, requestsBefore, reason: 'the demo makes no requests');
    expect(api.misses, isEmpty);
  });

  testWidgets('"Back to sign in" returns to the login screen', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, const LoginScreen());
    await tester.ensureVisible(find.text('Try demo'));
    await tester.tap(find.text('Try demo'));
    await tester.pumpAndSettle();

    // Below the fold on a phone, and the list builds lazily: scroll to it.
    await tester.scrollUntilVisible(find.text('Back to sign in'), 300, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Back to sign in'));
    await tester.pumpAndSettle();

    expect(find.byType(DemoDashboardScreen), findsNothing);
    expect(find.text('Sign in to your workspace'), findsOneWidget);
  });

  testWidgets('the headline numbers follow OEE = A x P x Q of the sample machines', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, const DemoDashboardScreen());

    // Averages of the six sample machines: A 80.8%, P 88.5%, Q 97.2%; OEE is their product.
    expect(find.text('80.8%'), findsOneWidget);
    expect(find.text('88.5%'), findsOneWidget);
    expect(find.text('97.2%'), findsOneWidget);
    expect(find.text('69.5%'), findsOneWidget);
    expect(find.text('Powder Coating-01'), findsOneWidget);
  });

  for (final c in const [
    ('phone light', Size(390, 844), false, 1.0),
    ('phone dark, big text', Size(390, 844), true, 1.6),
    ('small phone, big text', Size(320, 568), false, 1.6),
    ('iPad portrait', Size(820, 1180), false, 1.0),
    ('iPad landscape dark', Size(1180, 820), true, 1.0),
  ]) {
    testWidgets('demo dashboard lays out without overflow: ${c.$1}', (tester) async {
      FakeApi.install();
      await pumpScreen(tester, const DemoDashboardScreen(), size: c.$2, dark: c.$3, textScale: c.$4);
      expect(tester.takeException(), isNull);
      expect(find.text('Demo dashboard'), findsOneWidget);
    });
  }
}
