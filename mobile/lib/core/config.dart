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
  ///
  /// Runs on the UI thread for every response, including a month of dashboard
  /// entries (tens of thousands of values), so it edits the decoded JSON IN
  /// PLACE and only allocates when a string really changes. (Rebuilding every
  /// list and map, as this once did, froze the UI for a few frames per load and
  /// doubled the memory held by the payload.) Returns [v] itself unless a
  /// container turns out to be unmodifiable, in which case that one is copied.
  static dynamic upgradeUrls(dynamic v) {
    final plain = 'http://$apiHost';
    if (apiOrigin == plain) return v;
    return _upgrade(v, plain);
  }

  static dynamic _upgrade(dynamic v, String plain) {
    if (v is String) {
      return v.startsWith(plain) && (v.length == plain.length || !RegExp(r'[\w.-]').hasMatch(v[plain.length]))
          ? apiOrigin + v.substring(plain.length)
          : v;
    }
    if (v is List) {
      var list = v;
      for (var i = 0; i < list.length; i++) {
        final item = list[i];
        if (item is! String && item is! List && item is! Map) continue; // numbers, bools, null
        final next = _upgrade(item, plain);
        if (identical(next, item)) continue;
        try {
          list[i] = next;
        } on UnsupportedError {
          list = List<dynamic>.of(list);
          list[i] = next;
        }
      }
      return list;
    }
    if (v is Map) {
      List<MapEntry<dynamic, dynamic>>? changed;
      v.forEach((k, val) {
        if (val is! String && val is! List && val is! Map) return;
        final next = _upgrade(val, plain);
        if (!identical(next, val)) (changed ??= []).add(MapEntry(k, next));
      });
      final edits = changed;
      if (edits == null) return v;
      try {
        for (final e in edits) {
          v[e.key] = e.value;
        }
        return v;
      } on UnsupportedError {
        return {...v, for (final e in edits) e.key: e.value};
      }
    }
    return v;
  }
}
