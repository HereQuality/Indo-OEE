// Direct HTTP access to the LOCAL e2e backend, used by the integration tests to
// verify what the real app saved (like mobile/e2e/verify_http.js does).
import 'dart:convert';
import 'dart:io';

import 'package:indo/core/config.dart';

import 'e2e.dart' show assertLocalBackend, e2eTokens;

/// Seeded throwaway passwords (see mobile/e2e/e2e_env.json; they exist nowhere else).
const Map<String, String> e2ePasswords = {
  'e2e_admin': 'E2e#Admin123',
  'e2e_vmc': 'E2e#Pass123',
  'e2e_multi': 'E2e#Pass123',
  'e2e_viewonly': 'E2e#Pass123',
  'e2e_roleadmin': 'E2e#Pass123',
};

class ApiResult {
  ApiResult(this.status, this.json);
  final int status;
  final dynamic json;
  Map<String, dynamic> get map => (json is Map ? Map<String, dynamic>.from(json as Map) : <String, dynamic>{});
  dynamic get data => map['data'];
  String get message => '${map['message'] ?? ''}';
}

class E2eApi {
  E2eApi._(this.token);
  final String token;
  static final Map<String, E2eApi> _cache = {};

  static Future<E2eApi> login(String username) async {
    assertLocalBackend();
    final hit = _cache[username];
    if (hit != null) return hit;
    final minted = e2eTokens()[username];
    if (minted != null) return _cache[username] = E2eApi._('${minted['token']}');
    final r = await _call('POST', '/auth/login', null, {'username': username, 'password': e2ePasswords[username]});
    if (r.status != 200 || r.map['token'] == null) throw StateError('API login failed for $username: ${r.status}');
    return _cache[username] = E2eApi._('${r.map['token']}');
  }

  /// A raw login attempt (any password), for checking what the server says.
  static Future<ApiResult> rawLogin(String username, String password) =>
      _call('POST', '/auth/login', null, {'username': username, 'password': password});

  static Future<ApiResult> _call(String method, String path, String? token, [Object? body]) async {
    assertLocalBackend();
    final client = HttpClient();
    try {
      final req = await client.openUrl(method, Uri.parse('${AppConfig.apiBaseUrl}/api/v1$path'));
      req.headers.contentType = ContentType.json;
      if (token != null) req.headers.set('authorization', 'Bearer $token');
      if (body != null) req.add(utf8.encode(jsonEncode(body)));
      final res = await req.close();
      final text = await res.transform(utf8.decoder).join();
      dynamic j;
      try {
        j = jsonDecode(text);
      } catch (_) {}
      return ApiResult(res.statusCode, j);
    } finally {
      client.close(force: true);
    }
  }

  Future<ApiResult> get(String path) => _call('GET', path, token);
  Future<ApiResult> put(String path, Object body) => _call('PUT', path, token, body);
  Future<ApiResult> delete(String path) => _call('DELETE', path, token);

  /// Every saved row of a sheet (`/production-sheet`, `/vmc-sheet`…) whose remarks contain [tag].
  Future<List<Map<String, dynamic>>> rowsTagged(String sheetBase, String tag) async {
    final out = <Map<String, dynamic>>[];
    for (var page = 1; page < 30; page++) {
      final r = await get('$sheetBase?from=2025-01-01&to=2028-12-31&page=$page');
      final list = (r.data is List) ? (r.data as List) : const [];
      for (final x in list) {
        final m = Map<String, dynamic>.from(x as Map);
        if ('${m['remarks'] ?? ''}'.contains(tag) || '${m['otherMinRemark'] ?? ''}'.contains(tag)) out.add(m);
      }
      final meta = r.map['meta'];
      final pages = meta is Map ? (meta['totalPages'] ?? meta['pages'] ?? 1) : 1;
      if (list.isEmpty || page >= (pages as num)) break;
    }
    return out;
  }

  Future<void> deleteTagged(String sheetBase, String tag) async {
    for (final r in await rowsTagged(sheetBase, tag)) {
      await delete('$sheetBase/row/${r['_id']}');
    }
  }

  Future<List<Map<String, dynamic>>> list(String path) async {
    final r = await get(path);
    final d = r.data;
    return d is List ? [for (final x in d) Map<String, dynamic>.from(x as Map)] : const [];
  }
}

/// Saves one valid VMC row as [api] (admin) on [date] (default: today in the device clock) and returns it.
Future<Map<String, dynamic>> seedVmcRow(
  E2eApi api, {
  required String tag,
  String machine = 'VMC-3',
  String operator = 'Kiran Joshi',
  String on = '08:00',
  String off = '10:00',
  String? date,
}) async {
  final machines = await api.list('/machines');
  final items = await api.list('/items');
  final m = machines.firstWhere((x) => x['machineName'] == machine);
  final it = items.firstWhere((x) => x['itemName'] == 'VMC Flange VF-24');
  final d = date ?? DateTime.now().toIso8601String().substring(0, 10);
  final r = await api.put('/vmc-sheet/row', {
    'date': d,
    'slot': 'auto',
    'machine': m['_id'],
    'operator': operator,
    'item': it['_id'],
    'itemName': it['itemName'],
    'machineOnTime': on,
    'machineOffTime': off,
    'plannedOperatorShiftHours': 12,
    'lunchMin': 0,
    'okQty': 50,
    'rejectedQty': 2,
    'remarks': tag,
  });
  if (r.status != 200) throw StateError('seedVmcRow failed: ${r.status} ${r.message}');
  return Map<String, dynamic>.from(r.data as Map);
}
