import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:indo/features/profile/profile_rules.dart';
import 'package:indo/features/profile/profile_screen.dart';
import 'package:indo/providers/auth_provider.dart';
import 'package:provider/provider.dart';

import '../support/fake_api.dart';

const _mePath = '/api/v1/auth/me';
const _pwPath = '/api/v1/auth/me/password';
const _checkPath = '/api/v1/auth/check-username';
const _tall = Size(600, 2600); // everything built, no scrolling in tests

// 1x1 transparent PNG.
final _png = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=');

Map<String, dynamic> _operatorExtra() => {
      'mobileNumber': '9876543210',
      'emailOffice': 'a@b.co',
      'address': '12 Main Road',
      'departmentIds': [
        {'_id': 'd1', 'departmentName': 'Assembly'},
        {'_id': 'd2', 'departmentName': 'Quality'},
      ],
      'skills': [
        {'label': 'CNC'},
        'Welding',
      ],
      'joiningDate': '2024-03-05T00:00:00.000Z',
      'remark': 'Night shift lead',
    };

/// Fake backend that keeps the account like the server would.
class _Server {
  _Server(this.api, this.current) {
    api.on('GET', _mePath, (_) => {'isOk': true, 'data': current});
    api.on('PUT', _mePath, (r) {
      final b = Map<String, dynamic>.from(r.body as Map)..remove('files');
      if (b['removeProfilePic'] == 'true') current = {...current, 'profilePic': null};
      b.remove('removeProfilePic');
      current = {...current, ...b};
      return {'isOk': true, 'data': current};
    });
    api.on('PUT', _pwPath, (_) => {'isOk': true, 'message': 'Password changed successfully'});
    api.on('GET', _checkPath, (r) => {'status': 'success', 'available': r.query['username'] != 'taken1'});
  }
  final FakeApi api;
  Map<String, dynamic> current;
}

Finder _field(String label) => find.descendant(
      of: find.ancestor(of: find.text(label), matching: find.byType(Column)).first,
      matching: find.byType(TextField),
    );

Future<_Server> _pump(
  WidgetTester tester, {
  bool operator = true,
  Size size = _tall,
  bool dark = false,
  double textScale = 1,
  Map<String, dynamic> extra = const {},
}) async {
  final api = FakeApi.install();
  final user = testUser(superAdmin: !operator, extra: operator ? {..._operatorExtra(), ...extra} : {'email': 'root@corp.com', ...extra});
  final server = _Server(api, {...user.raw});
  await pumpScreen(tester, const ProfileScreen(), user: user, size: size, dark: dark, textScale: textScale);
  return server;
}

AuthProvider _auth(WidgetTester tester) => tester.element(find.byType(ProfileScreen)).read<AuthProvider>();

void main() {
  tearDown(() => debugProfileImagePicker = null);

  group('rules', () {
    test('password rules and messages match the web, in the web order', () {
      expect(passwordProblem(current: 'x', next: 'Abcdefg1', confirm: 'Abcdefg1'), isNull);
      expect(passwordProblem(current: 'x', next: 'Abcdefg1', confirm: 'Abcdefg2')!.message, "New password and confirmation don't match.");
      expect(passwordProblem(current: 'x', next: 'Ab1', confirm: 'Ab1')!.message, 'New password must be at least 8 characters.');
      expect(passwordProblem(current: 'x', next: 'abcdefgh1', confirm: 'abcdefgh1')!.message,
          'Password must contain at least one uppercase letter, one lowercase letter, and one number.');
      expect(PasswordChecks.of('Abcdefg1').ok, isTrue);
    });

    test('username / mobile / photo helpers', () {
      expect(normalizeUsername('Ab Cd_1@-!'), 'abcd_1@-');
      expect(normalizeMobile('98 76-54321098765'), '9876543210');
      expect(photoSizeError(3 * 1024 * 1024), 'Profile picture must be less than 2MB');
      expect(photoSizeError(1024), isNull);
      expect(imageMime(null, 'a.png').subtype, 'png');
      expect(uploadFilename('image', 'jpeg'), 'image.jpg');
    });
  });

  testWidgets('shows an operator profile with departments, skills and no Save bar until edited', (tester) async {
    await _pump(tester);
    expect(find.text('Test User'), findsWidgets);
    expect(find.text('Manager'), findsWidgets);
    expect(find.text('Assembly, Quality'), findsOneWidget);
    expect(find.text('CNC'), findsOneWidget);
    expect(find.text('Welding'), findsOneWidget);
    expect(find.text('Night shift lead'), findsOneWidget);
    expect(tester.widget<TextField>(_field('Full name *')).controller!.text, 'Test User');
    expect(tester.widget<TextField>(_field('Mobile number (optional)')).controller!.text, '9876543210');
    expect(find.text('Save changes'), findsNothing);
  });

  testWidgets('SuperAdmin sees name + read-only email + username and saves {name, username}', (tester) async {
    final s = await _pump(tester, operator: false);
    expect(find.text('Mobile number (optional)'), findsNothing);
    expect(tester.widget<TextField>(_field('Email')).enabled, isFalse);

    await tester.enterText(_field('Full name *'), 'Root Person');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    final put = s.api.called('PUT', _mePath).single;
    expect((put.body as Map)['name'], 'Root Person');
    expect((put.body as Map)['username'], 'tester');
    expect((put.body as Map).containsKey('employeeName'), isFalse);
    expect(_auth(tester).user!.raw['name'], 'Root Person');
    expect(find.text('Save changes'), findsNothing); // clean again
  });

  testWidgets('editing shows the sticky bar; Save sends the web payload; Discard reverts', (tester) async {
    final s = await _pump(tester);
    await tester.enterText(_field('Full name *'), 'Asha Kumar');
    await tester.enterText(_field('Address (optional)'), '');
    await tester.pumpAndSettle();
    expect(find.text('Save changes'), findsOneWidget);

    await tester.tap(find.text('Discard'));
    await tester.pumpAndSettle();
    expect(find.text('Save changes'), findsNothing);
    expect(tester.widget<TextField>(_field('Full name *')).controller!.text, 'Test User');

    await tester.enterText(_field('Full name *'), 'Asha Kumar');
    await tester.enterText(_field('Mobile number (optional)'), '99887 7665 5x44');
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(_field('Mobile number (optional)')).controller!.text, '9988776655');
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();

    final put = s.api.called('PUT', _mePath).single;
    final body = Map<String, dynamic>.from(put.body as Map);
    expect(body['employeeName'], 'Asha Kumar');
    expect(body['mobileNumber'], '9988776655');
    expect(body['emailOffice'], 'a@b.co');
    expect(body['address'], '12 Main Road');
    expect(body['username'], 'tester');
    expect(body.containsKey('name'), isFalse);
    expect(_auth(tester).user!.name, 'Asha Kumar');
  });

  testWidgets('validation blocks the request and shows inline errors', (tester) async {
    final s = await _pump(tester);
    await tester.enterText(_field('Full name *'), '   ');
    await tester.enterText(_field('Office email (optional)'), 'nope');
    await tester.enterText(_field('Username'), 'ab');
    await tester.pumpAndSettle();
    expect(find.text('Min. 3 characters'), findsWidgets);
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    expect(find.text('Full name is required'), findsOneWidget);
    expect(find.text('Enter a valid email'), findsOneWidget);
    expect(s.api.called('PUT', _mePath), isEmpty);
  });

  testWidgets('username is filtered and availability is checked after a 400 ms pause', (tester) async {
    final s = await _pump(tester);
    await tester.enterText(_field('Username'), 'New Name!');
    await tester.pump(); // one frame: the 400 ms debounce has not fired yet
    expect(tester.widget<TextField>(_field('Username')).controller!.text, 'newname');
    expect(find.text('Checking…'), findsOneWidget);
    expect(s.api.called('GET', _checkPath), isEmpty);
    await tester.pump(const Duration(milliseconds: 450));
    await tester.pumpAndSettle();
    expect(s.api.called('GET', _checkPath).single.query['username'], 'newname');
    expect(find.text('Username available'), findsOneWidget);

    await tester.enterText(_field('Username'), 'taken1');
    await tester.pump(const Duration(milliseconds: 450));
    await tester.pumpAndSettle();
    expect(find.text('Username already taken'), findsOneWidget);
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    expect(s.api.called('PUT', _mePath), isEmpty); // known-taken names are not sent
  });

  testWidgets('a picked photo is uploaded as multipart profilePic with the save', (tester) async {
    final s = await _pump(tester);
    debugProfileImagePicker = (_) async => XFile.fromData(_png, name: 'me.png', mimeType: 'image/png');

    await tester.tap(find.text('Change photo'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Choose from gallery'));
    await tester.pumpAndSettle();
    expect(find.text('New photo selected. Save changes to upload it.'), findsOneWidget);
    expect(find.text('Save changes'), findsOneWidget);

    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    final put = s.api.called('PUT', _mePath).single;
    final body = Map<String, dynamic>.from(put.body as Map);
    expect(body['files'], ['profilePic']);
    expect(body['employeeName'], 'Test User');
    expect(find.text('New photo selected. Save changes to upload it.'), findsNothing);
  });

  testWidgets('Remove photo confirms, then sends removeProfilePic', (tester) async {
    final s = await _pump(tester, extra: {'profilePic': 'https://cdn.example.com/me.png'});
    await tester.tap(find.text('Change photo'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Remove photo'));
    await tester.pumpAndSettle();
    expect(find.text('Remove Profile Picture?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(s.api.called('PUT', _mePath), isEmpty);

    await tester.tap(find.text('Change photo'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Remove photo'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Yes, Remove'));
    await tester.pumpAndSettle();
    final body = Map<String, dynamic>.from(s.api.called('PUT', _mePath).single.body as Map);
    expect(body['removeProfilePic'], 'true');
    expect(_auth(tester).user!.profilePic, isNull);
  });

  testWidgets('photos over 2 MB are rejected', (tester) async {
    await _pump(tester);
    debugProfileImagePicker = (_) async => XFile.fromData(List<int>.filled(2 * 1024 * 1024 + 1, 1).toUint8(), name: 'big.jpg');
    await tester.tap(find.text('Change photo'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Choose from gallery'));
    await tester.pumpAndSettle();
    expect(find.text('Save changes'), findsNothing);
  });

  testWidgets('change password: web rules inline, then PUT with current + new', (tester) async {
    final s = await _pump(tester);
    final button = find.widgetWithText(FilledButton, 'Change password');
    expect(tester.widget<FilledButton>(button).onPressed, isNull);

    await tester.enterText(_field('Current password *'), 'Old12345');
    await tester.enterText(_field('New password *'), 'Abcdefg1');
    await tester.enterText(_field('Confirm new password *'), 'Abcdefg2');
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pumpAndSettle();
    expect(find.text("New password and confirmation don't match."), findsOneWidget);

    await tester.enterText(_field('New password *'), 'abcdefgh1');
    await tester.enterText(_field('Confirm new password *'), 'abcdefgh1');
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pumpAndSettle();
    expect(find.textContaining('one uppercase letter'), findsWidgets);
    expect(s.api.called('PUT', _pwPath), isEmpty);

    await tester.enterText(_field('New password *'), 'Abcdefg1');
    await tester.enterText(_field('Confirm new password *'), 'Abcdefg1');
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pumpAndSettle();
    expect(s.api.called('PUT', _pwPath).single.body, {'currentPassword': 'Old12345', 'newPassword': 'Abcdefg1'});
    expect(tester.widget<TextField>(_field('New password *')).controller!.text, isEmpty);
  });

  testWidgets('a wrong current password from the server is shown on that field', (tester) async {
    final s = await _pump(tester);
    s.api.on('PUT', _pwPath, (_) => FakeResponse({'isOk': false, 'message': 'Current password is incorrect.'}, status: 400));
    await tester.enterText(_field('Current password *'), 'nope');
    await tester.enterText(_field('New password *'), 'Abcdefg1');
    await tester.enterText(_field('Confirm new password *'), 'Abcdefg1');
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Change password'));
    await tester.pumpAndSettle();
    expect(find.text('Current password is incorrect.'), findsOneWidget);
  });

  testWidgets('leaving with unsaved edits asks first', (tester) async {
    await _pump(tester);
    await tester.enterText(_field('Full name *'), 'Changed');
    await tester.pumpAndSettle();
    final nav = tester.state<NavigatorState>(find.byType(Navigator));
    await nav.maybePop();
    await tester.pumpAndSettle();
    expect(find.text('Discard changes?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.text('Discard changes?'), findsNothing);
    expect(tester.widget<TextField>(_field('Full name *')).controller!.text, 'Changed');
  });

  testWidgets('pull to refresh re-reads /auth/me', (tester) async {
    final s = await _pump(tester, size: const Size(390, 844));
    final before = s.api.called('GET', _mePath).length;
    await tester.fling(find.byType(ListView), const Offset(0, 500), 1000);
    await tester.pumpAndSettle();
    expect(s.api.called('GET', _mePath).length, before + 1);
  });

  testWidgets('dark mode, 360x640 and text scale 1.6 do not overflow (operator + super admin)', (tester) async {
    await _pump(tester, size: const Size(360, 640), dark: true, textScale: 1.6);
    expect(tester.takeException(), isNull);
    await tester.scrollUntilVisible(find.text('Full name *'), 200, scrollable: find.byType(Scrollable).first);
    await tester.enterText(_field('Full name *'), 'A very long changed name for the overflow check');
    await tester.pumpAndSettle();
    expect(find.text('Save changes'), findsOneWidget);
    await tester.drag(find.byType(ListView), const Offset(0, -3000));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    await _pump(tester, operator: false, size: const Size(360, 640), dark: true, textScale: 1.6);
    expect(tester.takeException(), isNull);
  });
}

extension on List<int> {
  Uint8List toUint8() => Uint8List.fromList(this);
}
