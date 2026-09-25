import 'package:dio/dio.dart';

import '../config.dart';
import '../storage/auth_storage.dart';

/// Error thrown by [Api] for any failed request. [message] is always safe to
/// show to the user (server message when there is one, otherwise a friendly
/// fallback).
class ApiException implements Exception {
  ApiException(this.message, {this.statusCode, this.body});

  final String message;
  final int? statusCode;
  final dynamic body;

  @override
  String toString() => message;
}

/// Centralised Dio instance (mirrors client/src/api/index.jsx): attaches the
/// bearer token, rewrites http->https upload links, and reacts to 401 / 403.
class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  /// 401 on a request that carried a token: the session is gone.
  void Function()? onUnauthorized;

  /// 403 saying the account is blocked / inactive.
  void Function()? onBlocked;

  /// Any other 403 (no permission for this action): show a toast.
  void Function(String message)? onForbidden;

  late final Dio dio = _build();

  Dio _build() {
    final d = Dio(
      BaseOptions(
        baseUrl: AppConfig.apiBaseUrl,
        connectTimeout: const Duration(seconds: 20),
        receiveTimeout: const Duration(seconds: 30),
        sendTimeout: const Duration(seconds: 60),
        headers: {'Content-Type': 'application/json', 'X-Client-Platform': 'mobile'},
      ),
    );

    d.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final token = AuthStorage.instance.token;
          if (token != null && token.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
        onResponse: (response, handler) {
          response.data = AppConfig.upgradeUrls(response.data);
          handler.next(response);
        },
        onError: (error, handler) {
          final status = error.response?.statusCode;
          final hadToken = error.requestOptions.headers['Authorization'] != null;
          if (status == 401 && hadToken) {
            onUnauthorized?.call();
          } else if (status == 403 && hadToken) {
            final data = error.response?.data;
            final msg = data is Map && data['message'] is String ? data['message'] as String : '';
            final lower = msg.toLowerCase();
            if (lower.contains('blocked') || lower.contains('inactive')) {
              onBlocked?.call();
            } else {
              onForbidden?.call(msg.isEmpty ? 'You do not have permission to perform this action.' : msg);
            }
          }
          handler.next(error);
        },
      ),
    );
    return d;
  }
}

/// Thin JSON helpers over [ApiClient.dio]. Every method returns the decoded
/// body as a `Map<String, dynamic>` (the server answers `{isOk, data,
/// message}`) and throws [ApiException] on a network error, a non-2xx status,
/// or `isOk == false`.
class Api {
  Api._();

  static Dio get dio => ApiClient.instance.dio;

  static Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) =>
      _run(() => dio.get(path, queryParameters: _clean(query)));

  static Future<Map<String, dynamic>> post(String path, {Object? body, Map<String, dynamic>? query}) =>
      _run(() => dio.post(path, data: body, queryParameters: _clean(query)));

  static Future<Map<String, dynamic>> put(String path, {Object? body, Map<String, dynamic>? query}) =>
      _run(() => dio.put(path, data: body, queryParameters: _clean(query)));

  static Future<Map<String, dynamic>> patch(String path, {Object? body}) =>
      _run(() => dio.patch(path, data: body));

  static Future<Map<String, dynamic>> delete(String path, {Object? body, Map<String, dynamic>? query}) =>
      _run(() => dio.delete(path, data: body, queryParameters: _clean(query)));

  /// multipart/form-data upload (profile picture, ticket attachments…).
  static Future<Map<String, dynamic>> postForm(String path, FormData form) =>
      _run(() => dio.post(path, data: form, options: Options(contentType: 'multipart/form-data')));

  static Future<Map<String, dynamic>> putForm(String path, FormData form) =>
      _run(() => dio.put(path, data: form, options: Options(contentType: 'multipart/form-data')));

  /// Drops null values so optional filters don't turn into `?x=null`.
  static Map<String, dynamic>? _clean(Map<String, dynamic>? q) {
    if (q == null) return null;
    return {
      for (final e in q.entries)
        if (e.value != null && '${e.value}'.isNotEmpty) e.key: e.value,
    };
  }

  static Future<Map<String, dynamic>> _run(Future<Response<dynamic>> Function() call) async {
    try {
      final res = await call();
      final data = res.data;
      final body = data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{'data': data};
      if (body['isOk'] == false) {
        throw ApiException(_messageOf(body) ?? 'Request failed.', statusCode: res.statusCode, body: body);
      }
      return body;
    } on DioException catch (e) {
      throw fromDio(e);
    }
  }

  static String? _messageOf(Map<dynamic, dynamic> body) {
    final m = body['message'] ?? body['error'];
    return m is String && m.isNotEmpty ? m : null;
  }

  /// Turns a [DioException] into a user-presentable [ApiException].
  static ApiException fromDio(DioException e) {
    final status = e.response?.statusCode;
    final data = e.response?.data;
    if (data is Map) {
      final m = _messageOf(data);
      if (m != null) return ApiException(m, statusCode: status, body: data);
    }
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.connectionError:
        return ApiException(
          "Can't reach the server (${AppConfig.apiHost}). Check your internet connection and try again.",
          statusCode: status,
        );
      default:
        break;
    }
    if (status == 401) return ApiException('Your session has expired. Please sign in again.', statusCode: status);
    if (status == 403) return ApiException('You do not have permission to do that.', statusCode: status);
    if (status == 404) return ApiException('Not found.', statusCode: status);
    if (status != null && status >= 500) return ApiException('Server error. Please try again.', statusCode: status);
    return ApiException('Something went wrong. Please try again.', statusCode: status);
  }
}

/// Pulls the `data` list out of a `{isOk, data: [...]}` response.
List<Map<String, dynamic>> asList(Map<String, dynamic> body, [String key = 'data']) {
  final v = body[key];
  if (v is List) {
    return v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }
  return const [];
}

/// Pulls the `data` object out of a `{isOk, data: {...}}` response.
Map<String, dynamic> asMap(Map<String, dynamic> body, [String key = 'data']) {
  final v = body[key];
  return v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
}
