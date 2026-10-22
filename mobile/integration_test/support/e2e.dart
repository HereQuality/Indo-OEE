// Helpers for on-device end-to-end tests that run the REAL app (lib/main.dart)
// against the local throwaway backend (mobile/e2e/start_backend.sh).
//
// The backend URL comes from --dart-define=API_BASE_URL=... (lib/core/config.dart);
// the login from --dart-define=E2E_USER / E2E_PASSWORD (run_e2e.sh fills them
// from mobile/e2e/e2e_env.json).
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:indo/core/config.dart';
import 'package:indo/core/storage/auth_storage.dart';
import 'package:indo/main.dart' as app;

const e2eUser = String.fromEnvironment('E2E_USER', defaultValue: 'e2e_vmc');
/// JSON {user: {token, roleType}} minted by mobile/e2e/mint_tokens.js (so tests need not log in each time).
const e2eTokensJson = String.fromEnvironment('E2E_TOKENS', defaultValue: '');

Map<String, dynamic> e2eTokens() => e2eTokensJson.isEmpty ? <String, dynamic>{} : jsonDecode(e2eTokensJson) as Map<String, dynamic>;

const e2ePassword = String.fromEnvironment('E2E_PASSWORD', defaultValue: 'E2e#Pass123');

/// Refuses to run against anything but a local test server, so a test can
/// never be pointed at production by a stray default.
void assertLocalBackend() {
  final host = Uri.parse(AppConfig.apiBaseUrl).host;
  const local = {'10.0.2.2', '127.0.0.1', 'localhost'};
  if (!local.contains(host)) {
    throw StateError(
      'E2E SAFETY: API_BASE_URL is "${AppConfig.apiBaseUrl}". e2e tests only run against '
      'http://10.0.2.2:<port> (Android emulator) or http://127.0.0.1:<port> (iOS simulator).',
    );
  }
}

/// Pumps frames until [finder] matches (or [timeout] passes, then fails with [reason]).
/// Never uses pumpAndSettle: the app has looping animations / polling.
Future<void> pumpUntilFound(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 30),
  String? reason,
}) async {
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 200));
    if (finder.evaluate().isNotEmpty) return;
  }
  throw TestFailure('Timed out after ${timeout.inSeconds}s waiting for ${reason ?? finder.description}');
}

/// Launches the real app signed out (any token left on the device is cleared).
Future<void> launchApp(WidgetTester tester) async {
  assertLocalBackend();
  await AuthStorage.instance.init();
  await AuthStorage.instance.clear();
  // A form left half-typed keeps a one-minute draft that the next form would restore: start clean.
  final prefs = await SharedPreferences.getInstance();
  for (final k in prefs.getKeys().where((k) => k.toLowerCase().contains('draft')).toList()) {
    await prefs.remove(k);
  }
  // lib/main.dart installs app-wide error handlers; the test binding insists its
  // own are back in place when a test ends, so put them back right after launch
  // (the app's handlers only log, which the test doesn't need).
  final onError = FlutterError.onError;
  final platformOnError = PlatformDispatcher.instance.onError;
  final errorWidgetBuilder = ErrorWidget.builder;
  app.main();
  await tester.pump(const Duration(milliseconds: 100));
  FlutterError.onError = onError;
  PlatformDispatcher.instance.onError = platformOnError;
  ErrorWidget.builder = errorWidgetBuilder;
  await pumpUntilFound(tester, find.text('Sign in to your workspace'), reason: 'the login screen');
}

/// Types the credentials on the login screen (field 0 = Username, field 1 = Password) and submits. Waits until the
/// login screen is gone (signed in), failing fast on the on-screen error.
Future<void> signIn(WidgetTester tester, {String username = e2eUser, String password = e2ePassword}) async {
  await tester.enterText(find.byType(TextFormField).at(0), username);
  await tester.enterText(find.byType(TextFormField).at(1), password);
  await tester.testTextInput.receiveAction(TextInputAction.done);
  final end = DateTime.now().add(const Duration(seconds: 30));
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 250));
    if (find.text('Sign in to your workspace').evaluate().isEmpty) return;
  }
  throw TestFailure('Still on the login screen after submitting as $username');
}

/// Launch + sign in in one go.
///
/// With minted tokens (run_e2e.sh / dev_run.sh) the person is signed in by storing a session token and
/// starting the app, like a remembered session; the real login form is exercised by auth_shell_test.dart.
/// (The server allows only 20 logins per 15 minutes per IP, so every test going through the form would hit 429.)
/// Pass [viaForm] to force the login form.
Future<void> launchAndSignIn(WidgetTester tester, {String username = e2eUser, String password = e2ePassword, bool viaForm = false}) async {
  final minted = e2eTokens()[username];
  if (viaForm || minted == null) {
    await launchApp(tester);
    await signIn(tester, username: username, password: password);
    return;
  }
  assertLocalBackend();
  await AuthStorage.instance.init();
  await AuthStorage.instance.clear();
  final prefs = await SharedPreferences.getInstance();
  for (final k in prefs.getKeys().where((k) => k.toLowerCase().contains('draft')).toList()) {
    await prefs.remove(k);
  }
  await AuthStorage.instance.save(token: '${minted['token']}', role: '${minted['roleType']}', remember: true);
  await relaunchApp(tester);
  await pumpUntilFound(tester, find.byType(NavigationBar), reason: 'the signed-in shell for $username');
}

/// Call first in every e2e `main()`: real-time frames (so adb screenshots show what the
/// test sees). Returns the binding.
IntegrationTestWidgetsFlutterBinding initE2e() {
  final b = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  b.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;
  return b;
}

/// Starts the app again WITHOUT clearing the stored session (a "relaunch": the stored token, if
/// "Remember me" was ticked, signs the person straight in). Expects the signed-in shell.
Future<void> relaunchApp(WidgetTester tester) async {
  assertLocalBackend();
  final onError = FlutterError.onError;
  final platformOnError = PlatformDispatcher.instance.onError;
  final errorWidgetBuilder = ErrorWidget.builder;
  app.main();
  await tester.pump(const Duration(milliseconds: 100));
  FlutterError.onError = onError;
  PlatformDispatcher.instance.onError = platformOnError;
  ErrorWidget.builder = errorWidgetBuilder;
}
