/// The one place the app learns where its backend lives.
///
/// The app is front end only: it talks to the same backend as the web client.
/// Override for staging / a local server at build time:
///   flutter run --dart-define=API_BASE_URL=http://10.0.2.2:5000
class AppConfig {
  AppConfig._();

  static const String defaultApiBaseUrl = 'https://indo.hqepl.com';

  static final String apiBaseUrl = _trimSlash(
    const String.fromEnvironment('API_BASE_URL', defaultValue: defaultApiBaseUrl),
  );

  static const String appName = 'Indo OEE';

  static Uri get _api => Uri.parse(apiBaseUrl);
  static String get apiHost => _api.hasPort ? '${_api.host}:${_api.port}' : _api.host;
  static String get apiOrigin => '${_api.scheme}://$apiHost';

  static String _trimSlash(String v) => v.trim().replaceAll(RegExp(r'/+$'), '');

  /// Uploaded files (company logo, profile pictures, ticket attachments) come
  /// back from the server as absolute URLs. Behind the production reverse proxy
  /// they are minted as "http://indo.hqepl.com/uploads/…", which iOS (ATS) and
  /// Android (cleartext) refuse to load. Anything pointing at our own backend
  /// host is rewritten onto [apiBaseUrl]'s scheme; other hosts are untouched.
  /// Relative paths stored in the DB ("uploads/x.png", "x.png") are resolved.
  static String? toBackendUrl(String? value) {
    if (value == null || value.isEmpty) return value;
    if (RegExp(r'^(data:|blob:)', caseSensitive: false).hasMatch(value)) return value;
    if (RegExp(r'^https?://', caseSensitive: false).hasMatch(value)) {
      final u = Uri.tryParse(value);
      if (u != null) {
        final host = u.hasPort ? '${u.host}:${u.port}' : u.host;
        if (host == apiHost && u.scheme != _api.scheme) {
          return '$apiOrigin${u.path}${u.hasQuery ? '?${u.query}' : ''}${u.hasFragment ? '#${u.fragment}' : ''}';
        }
      }
      return value;
    }
    final rel = value.replaceFirst(RegExp(r'^/+'), '');
    return rel.startsWith('uploads/') ? '$apiBaseUrl/$rel' : '$apiBaseUrl/uploads/$rel';
  }

  /// Rewrites every `http://<our host>` string inside a decoded JSON value
  /// onto the backend's scheme (mirrors the web app's response transformer).
  static dynamic upgradeUrls(dynamic v) {
    final plain = 'http://$apiHost';
    if (apiOrigin == plain) return v;
    if (v is String) {
      return v.startsWith(plain) && (v.length == plain.length || !RegExp(r'[\w.-]').hasMatch(v[plain.length]))
          ? apiOrigin + v.substring(plain.length)
          : v;
    }
    if (v is List) return v.map(upgradeUrls).toList();
    if (v is Map) return v.map((k, val) => MapEntry(k, upgradeUrls(val)));
    return v;
  }
}
