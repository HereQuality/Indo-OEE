import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/theme/app_theme.dart';
import 'package:indo/features/auth/login_screen.dart';
import 'package:indo/providers/auth_provider.dart';
import 'package:indo/providers/company_provider.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';

/// The app has no brand of its own: logo and name are whatever the Super Admin
/// saved on the Company page (GET /companies/getCompanyDetails).
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late FakeApi api;
  late Map<String, Object?> server;
  var down = false;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    down = false;
    server = {'name': 'Acme Works', 'logo': 'http://indo.hqepl.com/uploads/acme.png', 'favicon': 'uploads/fav.ico'};
    api = FakeApi.install();
    api.on('GET', '/api/v1/companies/getCompanyDetails', (_) {
      if (down) throw Exception('offline');
      return {'isOk': true, 'data': server};
    });
  });

  group('CompanyProvider', () {
    test('takes name, logo and favicon from the server, on the backend\'s https origin', () async {
      final c = CompanyProvider();
      expect(c.name, isEmpty);
      expect(c.logo, isNull);
      await c.load();
      expect(c.loaded, isTrue);
      expect(c.name, 'Acme Works');
      expect(c.logo, 'https://indo.hqepl.com/uploads/acme.png'); // http -> https on our own host
      expect(c.favicon, 'https://indo.hqepl.com/uploads/fav.ico'); // relative path resolved
    });

    test('shows the last known brand at once and when the server cannot be reached', () async {
      await CompanyProvider().load(); // first launch, online

      down = true;
      final relaunch = CompanyProvider();
      await relaunch.load();
      expect(relaunch.name, 'Acme Works');
      expect(relaunch.logo, 'https://indo.hqepl.com/uploads/acme.png');
      expect(relaunch.loaded, isFalse); // never confirmed this launch
    });

    test('a later load picks up a changed logo; a removed logo is really removed', () async {
      final c = CompanyProvider();
      await c.load();
      expect(c.logo, endsWith('/acme.png'));

      server['logo'] = 'https://indo.hqepl.com/uploads/new-logo.png';
      await c.load();
      expect(c.logo, 'https://indo.hqepl.com/uploads/new-logo.png');

      server['logo'] = '';
      await c.load();
      expect(c.logo, isNull);
      expect(c.name, 'Acme Works');

      // ...and it stays removed after a relaunch with no network (cache cleared).
      down = true;
      final relaunch = CompanyProvider();
      await relaunch.load();
      expect(relaunch.logo, isNull);
      expect(relaunch.name, 'Acme Works');
    });

    test('a company with no branding at all leaves the app with none (nothing invented)', () async {
      server = {'name': '', 'logo': '', 'favicon': ''};
      final c = CompanyProvider();
      await c.load();
      expect(c.name, isEmpty);
      expect(c.logo, isNull);
      expect(c.favicon, isNull);
    });

    test('an unreachable server on a first launch leaves no brand and does not throw', () async {
      down = true;
      final c = CompanyProvider();
      await c.load();
      expect(c.name, isEmpty);
      expect(c.logo, isNull);
      expect(c.loaded, isFalse);
    });
  });

  group('Login screen', () {
    Future<void> pumpLogin(WidgetTester tester, {bool dark = false}) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>(create: (_) => AuthProvider()),
            ChangeNotifierProvider<CompanyProvider>(create: (_) => CompanyProvider()),
          ],
          child: MaterialApp(
            theme: dark ? AppTheme.dark() : AppTheme.light(),
            home: const LoginScreen(),
          ),
        ),
      );
      // Let the brand request answer and the image try to load. CachedNetworkImage
      // stores logos on disk through path_provider + sqflite, which have no native
      // side under `flutter test`: those plugin errors (a chain of them, at
      // different moments) are the ONLY thing allowed to be thrown here.
      for (var i = 0; i < 30; i++) {
        await tester.pump(const Duration(milliseconds: 50));
        Object? e;
        while ((e = tester.takeException()) != null) {
          expect(e.toString(), anyOf(contains('MissingPluginException'), contains('databaseFactory')));
        }
      }
    }

    testWidgets('shows the Super Admin\'s logo, loaded from the server address', (tester) async {
      await pumpLogin(tester);
      final img = tester.widget<CachedNetworkImage>(find.byType(CachedNetworkImage));
      expect(img.imageUrl, 'https://indo.hqepl.com/uploads/acme.png');
      expect(api.called('GET', '/api/v1/companies/getCompanyDetails'), isNotEmpty);
    });

    testWidgets('no logo set: shows the company name only, never a made-up mark', (tester) async {
      server = {'name': 'Acme Works', 'logo': '', 'favicon': ''};
      await pumpLogin(tester);
      expect(find.byType(CachedNetworkImage), findsNothing);
      expect(find.text('Acme Works'), findsOneWidget);
      expect(find.text('IN'), findsNothing);
      expect(find.text('Indo'), findsNothing);
    });

    testWidgets('neither set: no brand text at all, and the form is still there', (tester) async {
      server = {'name': '', 'logo': '', 'favicon': ''};
      await pumpLogin(tester);
      expect(find.byType(CachedNetworkImage), findsNothing);
      expect(find.text('IN'), findsNothing);
      expect(find.text('Indo'), findsNothing);
      expect(find.text('Sign in to your workspace'), findsOneWidget);
    });

    testWidgets('server down on first launch: the login form still works, no brand, no crash', (tester) async {
      down = true;
      await pumpLogin(tester);
      expect(find.text('Sign in to your workspace'), findsOneWidget);
      expect(find.text('IN'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('dark mode: the logo sits on a light plate so a dark logo stays visible', (tester) async {
      await pumpLogin(tester, dark: true);
      final plate = find.ancestor(of: find.byType(CachedNetworkImage), matching: find.byType(Container));
      expect(plate, findsWidgets);
      final decorated = tester
          .widgetList<Container>(plate)
          .map((c) => c.decoration)
          .whereType<BoxDecoration>()
          .where((d) => d.color == Colors.white);
      expect(decorated, isNotEmpty);
    });
  });
}
