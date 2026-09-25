import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/app/main_shell.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';

NavigationBar _bar(WidgetTester t) => t.widget<NavigationBar>(find.byType(NavigationBar));

Future<void> _settle(WidgetTester t) async {
  // The tabs load data and show skeletons: step time instead of pumpAndSettle.
  for (var i = 0; i < 6; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
      (_) async => null,
    );
  });

  testWidgets('bottom bar: Dashboard + Data entry; tapping and swiping change tab', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, const MainShell());
    await _settle(tester);

    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.descendant(of: find.byType(NavigationBar), matching: find.text('Dashboard')), findsOneWidget);
    expect(find.descendant(of: find.byType(NavigationBar), matching: find.text('Data entry')), findsOneWidget);
    // No sidebar / hamburger anywhere.
    expect(find.byType(Drawer), findsNothing);
    expect(find.byIcon(Icons.menu_rounded), findsNothing);
    expect(_bar(tester).selectedIndex, 0);

    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Data entry')));
    await _settle(tester);
    await tester.pump(const Duration(milliseconds: 400));
    expect(_bar(tester).selectedIndex, 1);

    // Swipe back to the first tab with a finger drag on the page.
    await tester.drag(find.byType(PageView), const Offset(500, 0));
    await tester.pump(const Duration(milliseconds: 600));
    expect(_bar(tester).selectedIndex, 0);
    await tester.drag(find.byType(PageView), const Offset(-500, 0));
    await tester.pump(const Duration(milliseconds: 600));
    expect(_bar(tester).selectedIndex, 1);
  });

  testWidgets('smoke: iPad landscape, phone small, dark, text scale 1.6', (tester) async {
    for (final size in [const Size(1024, 768), const Size(360, 640)]) {
      FakeApi.install();
      await pumpScreen(tester, const MainShell(), size: size, dark: true, textScale: 1.6);
      await _settle(tester);
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(tester.takeException(), isNull, reason: '$size');
    }
  });
}
