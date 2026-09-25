import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/settings/settings_screen.dart';
import 'package:indo/providers/auth_provider.dart';
import 'package:indo/providers/theme_provider.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';

const _prefsPath = '/api/v1/auth/me/preferences';

FakeApi _api() {
  final api = FakeApi.install();
  api.on('PUT', _prefsPath, (r) => {
        'isOk': true,
        'data': {'themeMode': 'light', 'showDashboardClock': true, 'shortcuts': <String>[], ...Map<String, dynamic>.from(r.body as Map)},
      });
  api.on('POST', '/api/v1/auth/logout', (_) => {'isOk': true});
  return api;
}

Future<void> _pump(WidgetTester tester, {bool dark = false, Size size = const Size(390, 844), double textScale = 1.0}) async {
  await pumpScreen(tester, const SettingsScreen(), dark: dark, size: size, textScale: textScale);
  // The app wires ThemeProvider to the session; pumpScreen does not.
  final ctx = tester.element(find.byType(SettingsScreen));
  ctx.read<ThemeProvider>().attach(ctx.read<AuthProvider>());
}

Future<void> _reveal(WidgetTester tester, Finder f) async {
  await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).first);
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    PackageInfo.setMockInitialValues(
      appName: 'Indo OEE',
      packageName: 'com.hqepl.indo',
      version: '1.2.3',
      buildNumber: '45',
      buildSignature: '',
    );
  });

  testWidgets('shows the account, appearance, dashboard and device sections', (tester) async {
    _api();
    await _pump(tester);
    expect(find.text('Test User'), findsWidgets);
    expect(find.text('Appearance'), findsOneWidget);
    expect(find.text('Real-time clock'), findsOneWidget);
    expect(find.text('About this device'), findsOneWidget);
    await _reveal(tester, find.text('1.2.3 (45)'));
    expect(find.text('1.2.3 (45)'), findsOneWidget);
    await _reveal(tester, find.text('Sign out'));
    expect(find.text('Sign out'), findsOneWidget);
  });

  testWidgets('Dark segment switches the theme and saves themeMode', (tester) async {
    final api = _api();
    await _pump(tester);
    final ctx = tester.element(find.byType(SettingsScreen));
    expect(ctx.read<ThemeProvider>().isDark, isFalse);

    await tester.tap(find.text('Dark'));
    await tester.pumpAndSettle();

    expect(ctx.read<ThemeProvider>().isDark, isTrue);
    final put = api.called('PUT', _prefsPath).single;
    expect(put.body, {'themeMode': 'dark'});
    expect(ctx.read<AuthProvider>().user!.preferences.isDark, isTrue);
  });

  testWidgets('clock switch saves showDashboardClock and reverts when the save fails', (tester) async {
    final api = _api();
    await _pump(tester);
    final ctx = tester.element(find.byType(SettingsScreen));

    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    expect(api.called('PUT', _prefsPath).single.body, {'showDashboardClock': false});
    expect(ctx.read<AuthProvider>().user!.preferences.showDashboardClock, isFalse);
    expect(tester.widget<Switch>(find.byType(Switch)).value, isFalse);

    api.on('PUT', _prefsPath, (_) => FakeResponse({'isOk': false, 'message': 'boom'}, status: 500));
    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();
    expect(tester.widget<Switch>(find.byType(Switch)).value, isFalse); // still the saved value
  });

  testWidgets('clear local data removes drafts and widget picks, keeps the theme', (tester) async {
    SharedPreferences.setMockInitialValues({
      'productionEntryDraft': '{}',
      'allMachinesDashboardWidgets': '{}',
      'theme': 'dark',
    });
    _api();
    await _pump(tester);
    await _reveal(tester, find.text('Clear local data'));
    await tester.tap(find.text('Clear local data'));
    await tester.pumpAndSettle();
    expect(find.text('Clear local data?'), findsOneWidget);
    await tester.tap(find.text('Clear'));
    await tester.pumpAndSettle();
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.containsKey('productionEntryDraft'), isFalse);
    expect(prefs.containsKey('allMachinesDashboardWidgets'), isFalse);
    expect(prefs.containsKey('theme'), isTrue);
  });

  testWidgets('sign out asks first, then ends the session', (tester) async {
    // AuthStorage.clear() talks to the keychain plugin, which has no host in tests.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'), (_) async => null);
    final api = _api();
    await _pump(tester);
    final ctx = tester.element(find.byType(SettingsScreen));
    await _reveal(tester, find.text('Sign out'));
    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(api.called('POST', '/api/v1/auth/logout'), isEmpty);

    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Sign out'));
    await tester.pumpAndSettle();
    expect(api.called('POST', '/api/v1/auth/logout'), hasLength(1));
    expect(ctx.read<AuthProvider>().status, AuthStatus.unauthenticated);
  });

  testWidgets('dark mode, 360x640 and text scale 1.6 do not overflow', (tester) async {
    _api();
    await _pump(tester, dark: true, size: const Size(360, 640), textScale: 1.6);
    expect(tester.takeException(), isNull);
    await tester.drag(find.byType(ListView), const Offset(0, -2000));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
