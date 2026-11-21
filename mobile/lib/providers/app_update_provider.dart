import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/api/api_client.dart';
import '../core/api/endpoints.dart';
import '../core/api/socket_service.dart';
import '../models/app_update_status.dart';

/// Force update (hard) + update available (soft), configured by the Super
/// Admin on the web Company page (AppUpdateModeCard).
///
/// - [isForceUpdateRequired]: app/app.dart's `_AuthGate` shows
///   UpdateRequiredScreen INSTEAD of everything, login included — an old build
///   may not be able to talk to a changed API at all. No role bypass: a Super
///   Admin's phone can be on an old build too.
/// - [isSoftUpdateAvailable]: SoftUpdateOverlay shows a dismissible bar. Never
///   blocks anything.
///
/// Live via the `app-update:update` socket event once signed in. Before login
/// there is no socket, so the gate also re-checks on app resume (app.dart) and
/// on a short poll.
class AppUpdateProvider extends ChangeNotifier {
  AppUpdateProvider({
    Future<String?> Function()? readInstalledVersion,
    Future<Map<String, dynamic>?> Function()? fetchStatus,
    bool? isStorePlatform,
    this.pollInterval = const Duration(seconds: 30),
  })  : _readInstalledVersion = readInstalledVersion ?? _platformVersion,
        _fetchStatus = fetchStatus ?? _apiStatus,
        _isStorePlatform = isStorePlatform ?? _onStorePlatform();

  final Future<String?> Function() _readInstalledVersion;
  final Future<Map<String, dynamic>?> Function() _fetchStatus;
  final bool _isStorePlatform;
  /// Fallback re-check while no socket push can arrive (e.g. before login).
  final Duration pollInterval;

  AppUpdateStatus status = AppUpdateStatus.empty;
  bool loaded = false;

  String? _installedVersion;

  /// The running build's "major.minor.patch" (pubspec `version:` without the
  /// +build). Shown on the block screen as "your version".
  String? get installedVersion => _installedVersion;

  // Per process, deliberately not persisted: backgrounding keeps it, a cold
  // start brings the bar back if the update is still pending.
  bool _softUpdateDismissed = false;

  Timer? _timer;
  VoidCallback? _unsubSocket;
  bool _disposed = false;

  static Future<String?> _platformVersion() async => (await PackageInfo.fromPlatform()).version;

  static Future<Map<String, dynamic>?> _apiStatus() async {
    final data = (await Api.get(Endpoints.appUpdateStatus))['data'];
    return data is Map ? Map<String, dynamic>.from(data) : null;
  }

  // Only Android/iOS installs come from a store; desktop/web builds of this
  // project are never gated.
  static bool _onStorePlatform() =>
      !kIsWeb && (defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS);

  Future<void> bootstrap() async {
    SocketService.instance.connected.addListener(_bindSocket);
    _bindSocket();

    try {
      _installedVersion = await _readInstalledVersion();
    } catch (_) {
      // Fail open: a platform-channel hiccup must never lock everyone out.
      _installedVersion = null;
    }

    await refreshNow();
    _timer?.cancel();
    if (!_disposed) _timer = Timer.periodic(pollInterval, (_) => refreshNow());
  }

  // The socket only exists after login and is recreated on each sign-in, so
  // (re)attach whenever it (re)connects.
  void _bindSocket() {
    _unsubSocket?.call();
    _unsubSocket = null;
    if (!SocketService.instance.connected.value) return;
    _unsubSocket = SocketService.instance.on('app-update:update', (payload) {
      if (payload is Map) {
        status = AppUpdateStatus.fromJson(Map<String, dynamic>.from(payload));
        loaded = true;
        if (!_disposed) notifyListeners();
      }
    });
  }

  Future<void> refreshNow() async {
    try {
      final data = await _fetchStatus();
      if (data != null) status = AppUpdateStatus.fromJson(data);
    } catch (_) {
      // A failed check never blocks the app: keep the last known status
      // (initially "nothing required").
    } finally {
      loaded = true;
      if (!_disposed) notifyListeners();
    }
  }

  /// Numeric, part by part ("1.10.0" > "1.9.0"; "1.3" == "1.3.0"). Any
  /// "+build" suffix is ignored. Negative when [a] is older than [b].
  static int compareVersions(String a, String b) {
    List<int> parts(String v) => v.split('+').first.split('.').map((p) => int.tryParse(p.trim()) ?? 0).toList();
    final pa = parts(a);
    final pb = parts(b);
    final len = pa.length > pb.length ? pa.length : pb.length;
    for (var i = 0; i < len; i++) {
      final na = i < pa.length ? pa[i] : 0;
      final nb = i < pb.length ? pb[i] : 0;
      if (na != nb) return na.compareTo(nb);
    }
    return 0;
  }

  bool _isBelow(String target) {
    final installed = _installedVersion;
    if (!loaded || !_isStorePlatform || installed == null || installed.isEmpty || target.isEmpty) return false;
    return compareVersions(installed, target) < 0;
  }

  /// Hard update: switch on and this install is below the minimum.
  bool get isForceUpdateRequired => status.isActive && _isBelow(status.minVersion);

  /// Soft update: a newer build is out (independent of the force switch), not
  /// dismissed this session, and not already covered by the force block.
  bool get isSoftUpdateAvailable => !_softUpdateDismissed && !isForceUpdateRequired && _isBelow(status.latestVersion);

  void dismissSoftUpdate() {
    _softUpdateDismissed = true;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _unsubSocket?.call();
    SocketService.instance.connected.removeListener(_bindSocket);
    super.dispose();
  }
}
