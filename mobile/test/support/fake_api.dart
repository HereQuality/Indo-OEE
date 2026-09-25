import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/api_client.dart';
import 'package:indo/core/theme/app_theme.dart';
import 'package:indo/core/widgets/page_permissions.dart';
import 'package:indo/models/app_user.dart';
import 'package:indo/models/menu_models.dart';
import 'package:indo/providers/auth_provider.dart';
import 'package:indo/providers/company_provider.dart';
import 'package:indo/providers/menu_provider.dart';
import 'package:indo/providers/theme_provider.dart';
import 'package:indo/providers/unread_provider.dart';
import 'package:provider/provider.dart';

/// A recorded request.
class FakeRequest {
  FakeRequest(this.method, this.path, this.query, this.body);
  final String method;
  final String path;
  final Map<String, dynamic> query;
  final dynamic body;
  @override
  String toString() => '$method $path $query $body';
}

typedef FakeHandler = FutureOr<Object?> Function(FakeRequest req);

/// Stands in for the backend in widget tests. Register routes with [on]; a
/// route answers with a JSON-encodable value (or throws to fail). Anything
/// unregistered answers 404 `{isOk:false}` and is recorded in [misses] so a
/// test can assert nothing unexpected was called.
///
///   final api = FakeApi.install();
///   api.on('GET', '/api/v1/machines', (r) => {'isOk': true, 'data': [ ... ]});
///   api.on('POST', '/api/v1/machines', (r) => {'isOk': true, 'data': r.body});
class FakeApi implements HttpClientAdapter {
  FakeApi._();

  final Map<String, FakeHandler> _routes = {};
  final List<FakeRequest> requests = [];
  final List<FakeRequest> misses = [];

  /// Routes the shared Dio through this fake and clears any earlier state.
  static FakeApi install() {
    final f = FakeApi._();
    final dio = ApiClient.instance.dio;
    dio.httpClientAdapter = f;
    return f;
  }

  /// [method] is GET/POST/PUT/PATCH/DELETE; [path] the URL path with no query.
  void on(String method, String path, FakeHandler handler) => _routes['${method.toUpperCase()} $path'] = handler;

  /// Convenience: `{isOk:true, data: [...]}` for a GET list.
  void list(String path, List<Object?> items) => on('GET', path, (_) => {'isOk': true, 'data': items});

  Iterable<FakeRequest> called(String method, String path) =>
      requests.where((r) => r.method == method.toUpperCase() && r.path == path);

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    final path = options.uri.path;
    dynamic body = options.data;
    if (body is FormData) {
      body = {for (final e in body.fields) e.key: e.value, 'files': body.files.map((f) => f.key).toList()};
    }
    final req = FakeRequest(options.method, path, Map<String, dynamic>.from(options.uri.queryParameters), body);
    requests.add(req);
    final h = _routes['${options.method} $path'];
    if (h == null) {
      misses.add(req);
      return _json({'isOk': false, 'message': 'No fake route for ${options.method} $path'}, 404);
    }
    try {
      final out = await h(req);
      if (out is FakeResponse) return _json(out.body, out.status);
      return _json(out, 200);
    } catch (e) {
      return _json({'isOk': false, 'message': e.toString()}, 500);
    }
  }

  static ResponseBody _json(Object? body, int status) => ResponseBody.fromString(
        jsonEncode(body),
        status,
        headers: {
          Headers.contentTypeHeader: ['application/json; charset=utf-8'],
        },
      );
}

/// Return from a handler to answer with a specific HTTP status.
class FakeResponse {
  FakeResponse(this.body, {this.status = 200});
  final Object? body;
  final int status;
}

/// A signed-in user for tests.
AppUser testUser({bool superAdmin = true, Map<String, dynamic> extra = const {}}) => AppUser({
      '_id': 'u1',
      'roleType': superAdmin ? 'SuperAdmin' : 'Operator',
      'name': 'Test User',
      'employeeName': 'Test User',
      'username': 'tester',
      'roleId': superAdmin ? null : 'r1',
      'roleSlug': superAdmin ? null : 'manager',
      'roleName': superAdmin ? null : 'Manager',
      'preferences': {'themeMode': 'light', 'showDashboardClock': true, 'shortcuts': <String>[]},
      ...extra,
    });

/// Pumps [screen] the way the real app shows it: real providers (signed in as
/// [user]), the app theme, a phone-sized surface, and [perms] as the page's
/// permissions. Returns the [FakeApi] already installed.
///
///   final api = FakeApi.install();  // register routes first
///   await pumpScreen(tester, const MachineMasterScreen());
Future<void> pumpScreen(
  WidgetTester tester,
  Widget screen, {
  AppUser? user,
  PagePerms perms = PagePerms.all,
  Size size = const Size(390, 844),
  bool dark = false,
  double textScale = 1.0,
  bool settle = true,
  List<MenuGroup> menus = const [],
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  final auth = AuthProvider()
    ..status = AuthStatus.authenticated
    ..user = user ?? testUser();
  final menu = MenuProvider()..setForTest(isAdmin: auth.user!.isSuperAdmin, groups: menus);
  final theme = ThemeProvider();

  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: auth),
        ChangeNotifierProvider<MenuProvider>.value(value: menu),
        ChangeNotifierProvider<ThemeProvider>.value(value: theme),
        ChangeNotifierProvider<UnreadProvider>(create: (_) => UnreadProvider()),
        ChangeNotifierProvider<CompanyProvider>(create: (_) => CompanyProvider()),
      ],
      child: MaterialApp(
        theme: dark ? AppTheme.dark() : AppTheme.light(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: PagePermissions(perms: perms, child: screen),
      ),
    ),
  );
  if (settle) {
    await tester.pumpAndSettle(const Duration(milliseconds: 100), EnginePhase.sendSemanticsUpdate, const Duration(seconds: 5));
  }
}
