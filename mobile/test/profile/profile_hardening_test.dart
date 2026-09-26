import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/profile/profile_screen.dart';

import '../support/fake_api.dart';

Finder _mobile() => find.byWidgetPredicate((w) => w is TextField && w.keyboardType == const TextInputType.numberWithOptions(decimal: false, signed: false));

Future<void> _pump(WidgetTester tester, {Map<String, dynamic> extra = const {}, Size size = const Size(390, 844), bool dark = false, double textScale = 1}) async {
  final api = FakeApi.install();
  api.on('GET', '/api/v1/auth/me', (_) => {'isOk': true, 'data': {}});
  api.on('GET', '/api/v1/auth/check-username', (_) => {'available': true});
  await pumpScreen(tester, const ProfileScreen(), user: testUser(superAdmin: false, extra: extra), size: size, dark: dark, textScale: textScale);
}

void main() {
  testWidgets('mobile number: number pad only, digits typed appear, junk is dropped, never throws', (tester) async {
    await _pump(tester, extra: {'mobileNumber': null, 'emailOffice': 5, 'address': null});
    final f = _mobile();
    expect(f, findsOneWidget);
    Future<String> type(String t) async {
      await tester.enterText(f, t);
      await tester.pump();
      expect(tester.takeException(), isNull, reason: 'typing "$t"');
      return tester.widget<TextField>(f).controller!.text;
    }

    expect(await type('9'), '9');
    expect(await type('98765'), '98765');
    expect(await type('12abc'), '12');
    expect(await type('1.2.3'), '123');
    expect(await type('0000000000000'), '0000000000');
    expect(await type(''), '');
    expect(await type('+91 98765-43210'), '9198765432');
  });

  testWidgets('monkey over every text field: nothing throws', (tester) async {
    await _pump(tester, extra: {'mobileNumber': '12345', 'departmentIds': 'oops', 'skills': [null, 3, {}], 'joiningDate': 'x', 'remark': 9});
    final fields = find.byType(TextField);
    final n = tester.widgetList(fields).length;
    expect(n, greaterThan(5));
    for (var round = 0; round < 3; round++) {
      for (var i = 0; i < n; i++) {
        for (final t in ['1', '12abc', '1.2.3', '0000000000', 'Ab1!x', '', ' ', '\n']) {
          await tester.enterText(fields.at(i), t);
          await tester.pump(const Duration(milliseconds: 20));
          expect(tester.takeException(), isNull, reason: 'field $i "$t"');
        }
      }
    }
    await tester.pump(const Duration(seconds: 1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('keyboard up: Save bar rides above the keyboard and is tappable', (tester) async {
    await _pump(tester, size: const Size(360, 640));
    await tester.enterText(find.byType(TextField).first, 'Changed Name');
    await tester.pump();
    tester.view.viewInsets = const FakeViewPadding(bottom: 280);
    addTearDown(tester.view.resetViewInsets);
    await tester.pump(const Duration(milliseconds: 300));
    final save = find.text('Save changes');
    expect(save, findsOneWidget);
    expect(tester.getBottomLeft(save).dy, lessThanOrEqualTo(640 - 280));
    expect(tester.takeException(), isNull);
  });

  testWidgets('dark + 360x640 + text scale 1.6 does not overflow', (tester) async {
    await _pump(tester, size: const Size(360, 640), dark: true, textScale: 1.6);
    expect(tester.takeException(), isNull);
  });
}
