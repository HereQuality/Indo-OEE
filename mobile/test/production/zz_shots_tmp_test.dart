import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/production_dashboard_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';
import 'dashboard_shell_fixtures.dart';

const fonts = '/Users/hqepldev/development/flutter/bin/cache/artifacts/material_fonts';
const out = '/private/tmp/claude-501/-Users-hqepldev-HQEPL-Indo-OEE/e9180972-c896-4ddb-8c61-79505a1720e3/scratchpad/shots';

Future<void> loadFonts() async {
  Future<ByteData> b(String f) async => ByteData.view(Uint8List.fromList(await File('$fonts/$f').readAsBytes()).buffer);
  final r = FontLoader('Roboto')
    ..addFont(b('Roboto-Regular.ttf'))
    ..addFont(b('Roboto-Bold.ttf'))
    ..addFont(b('Roboto-Medium.ttf'));
  await r.load();
  final m = FontLoader('MaterialIcons')..addFont(b('MaterialIcons-Regular.otf'));
  await m.load();
}

void main() {
  setUpAll(loadFonts);
  setUp(() {
    pinDashboardClock();
    SharedPreferences.setMockInitialValues({});
  });
  tearDown(unpinDashboardClock);

  Future<void> shot(WidgetTester tester, String name, Size size, {bool dark = false}) async {
    final api = FakeApi.install();
    installDashboardApi(api);
    await pumpScreen(tester, const ProductionDashboardScreen(), size: size, dark: dark);
    await expectLater(find.byType(MaterialApp), matchesGoldenFile(Uri.file('$out/$name.png')));
  }

  testWidgets('shots', (tester) async {
    await shot(tester, 'ipad-land-light', const Size(1024, 768));
    await shot(tester, 'ipad-land-dark', const Size(1024, 768), dark: true);
    await shot(tester, 'ipad-port-light', const Size(820, 1180));
    await shot(tester, 'phone-light', const Size(390, 844));
    await shot(tester, 'phone-dark', const Size(390, 844), dark: true);
  });
}
