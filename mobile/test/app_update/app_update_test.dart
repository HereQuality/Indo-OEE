import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/foundation.dart';
import 'package:indo/core/store_links.dart';
import 'package:indo/features/app_update/soft_update_overlay.dart';
import 'package:indo/features/app_update/update_required_screen.dart';
import 'package:indo/providers/app_update_provider.dart';
import 'package:provider/provider.dart';

AppUpdateProvider _provider(Map<String, dynamic>? status, {String? installed = '1.0.8', bool store = true}) =>
    AppUpdateProvider(
      readInstalledVersion: () async => installed,
      fetchStatus: () async => status,
      isStorePlatform: store,
      pollInterval: const Duration(hours: 1),
    );

void main() {
  group('compareVersions', () {
    test('numeric, not lexical', () {
      expect(AppUpdateProvider.compareVersions('1.2.0', '1.10.0'), lessThan(0));
      expect(AppUpdateProvider.compareVersions('1.10.0', '1.9.9'), greaterThan(0));
    });
    test('missing parts are 0 and build suffix is ignored', () {
      expect(AppUpdateProvider.compareVersions('1.3', '1.3.0'), 0);
      expect(AppUpdateProvider.compareVersions('1.0.8+11', '1.0.8'), 0);
    });
  });

  group('AppUpdateProvider', () {
    test('hard update: only when switch is on and installed < min', () async {
      final p = _provider({'isActive': true, 'minVersion': '1.0.9'});
      await p.bootstrap();
      expect(p.isForceUpdateRequired, isTrue);
      p.dispose();

      final off = _provider({'isActive': false, 'minVersion': '1.0.9'});
      await off.bootstrap();
      expect(off.isForceUpdateRequired, isFalse);
      off.dispose();

      final same = _provider({'isActive': true, 'minVersion': '1.0.8'});
      await same.bootstrap();
      expect(same.isForceUpdateRequired, isFalse);
      same.dispose();

      final blank = _provider({'isActive': true, 'minVersion': ''});
      await blank.bootstrap();
      expect(blank.isForceUpdateRequired, isFalse);
      blank.dispose();
    });

    test('soft update ignores the force switch and can be dismissed', () async {
      final p = _provider({'isActive': false, 'latestVersion': '1.1.0'});
      await p.bootstrap();
      expect(p.isSoftUpdateAvailable, isTrue);
      p.dismissSoftUpdate();
      expect(p.isSoftUpdateAvailable, isFalse);
      p.dispose();
    });

    test('soft bar is hidden while the hard block is showing', () async {
      final p = _provider({'isActive': true, 'minVersion': '1.0.9', 'latestVersion': '1.1.0'});
      await p.bootstrap();
      expect(p.isForceUpdateRequired, isTrue);
      expect(p.isSoftUpdateAvailable, isFalse);
      p.dispose();
    });

    test('fails open: no version, fetch error, or desktop never blocks', () async {
      final noVersion = _provider({'isActive': true, 'minVersion': '9.0.0'}, installed: null);
      await noVersion.bootstrap();
      expect(noVersion.isForceUpdateRequired, isFalse);
      noVersion.dispose();

      final failing = AppUpdateProvider(
        readInstalledVersion: () async => '1.0.0',
        fetchStatus: () async => throw Exception('offline'),
        isStorePlatform: true,
        pollInterval: const Duration(hours: 1),
      );
      await failing.bootstrap();
      expect(failing.loaded, isTrue);
      expect(failing.isForceUpdateRequired, isFalse);
      failing.dispose();

      final desktop = _provider({'isActive': true, 'minVersion': '9.0.0', 'latestVersion': '9.0.0'}, store: false);
      await desktop.bootstrap();
      expect(desktop.isForceUpdateRequired, isFalse);
      expect(desktop.isSoftUpdateAvailable, isFalse);
      desktop.dispose();
    });
  });

  group('StoreLinks', () {
    tearDown(() => debugDefaultTargetPlatformOverride = null);

    test('Android opens the Play Store listing', () {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      expect(StoreLinks.appStoreUri().toString(),
          'https://play.google.com/store/apps/details?id=com.hqepl.indo_oee&pcampaignid=web_share');
    });

    test('iOS opens the App Store listing', () {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      expect(StoreLinks.appStoreUri().toString(), 'https://apps.apple.com/us/app/indo-oee/id6825675790');
    });

    test('desktop has no store link', () {
      debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
      expect(StoreLinks.appStoreUri(), isNull);
    });
  });

  group('widgets', () {
    Widget host(AppUpdateProvider p, Widget child) =>
        ChangeNotifierProvider.value(value: p, child: MaterialApp(home: child));

    testWidgets('UpdateRequiredScreen shows versions and custom message', (tester) async {
      final p = _provider({'isActive': true, 'minVersion': '1.1.0', 'message': 'Please update now.'});
      await p.bootstrap();
      await tester.pumpWidget(host(p, const UpdateRequiredScreen()));
      expect(find.text('Update Required'), findsOneWidget);
      expect(find.text('Please update now.'), findsOneWidget);
      expect(find.text('1.0.8'), findsOneWidget);
      expect(find.text('1.1.0+'), findsOneWidget);
      p.dispose();
    });

    testWidgets('SoftUpdateOverlay shows the bar and Dismiss hides it', (tester) async {
      final p = _provider({'latestVersion': '1.1.0'});
      await p.bootstrap();
      await tester.pumpWidget(host(p, const SoftUpdateOverlay(child: Scaffold(body: Text('app')))));
      expect(find.text('Update available — v1.1.0 is out'), findsOneWidget);
      await tester.tap(find.text('Dismiss'));
      await tester.pump();
      expect(find.textContaining('Update available'), findsNothing);
      expect(find.text('app'), findsOneWidget);
      p.dispose();
    });
  });
}
