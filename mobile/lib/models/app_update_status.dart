/// Mirrors server/controllers/appUpdate.controller.js's `serialize()` shape
/// (GET /app-update/status) and the web app's hooks/useAppUpdate.jsx.
class AppUpdateStatus {
  /// Force-update master switch. With [minVersion] set, an install below it
  /// is blocked by UpdateRequiredScreen.
  final bool isActive;
  final String minVersion;

  /// Copy for the force-update block screen ("" = default text).
  final String message;

  /// Target of the non-blocking "update available" bar. Independent of
  /// [isActive], which only governs the force-update block. "" = no bar.
  final String latestVersion;

  /// Copy for the soft-update bar ("" = default text). Separate from
  /// [message]: "you must update" and "a new one is out" read differently.
  final String softMessage;

  final DateTime? updatedAt;

  const AppUpdateStatus({
    required this.isActive,
    required this.minVersion,
    required this.message,
    required this.latestVersion,
    required this.softMessage,
    this.updatedAt,
  });

  static const empty = AppUpdateStatus(isActive: false, minVersion: '', message: '', latestVersion: '', softMessage: '');

  factory AppUpdateStatus.fromJson(Map<String, dynamic> json) {
    String str(String key) => (json[key] is String) ? (json[key] as String).trim() : '';
    final updated = json['updatedAt'];
    return AppUpdateStatus(
      isActive: json['isActive'] == true,
      minVersion: str('minVersion'),
      message: str('message'),
      latestVersion: str('latestVersion'),
      softMessage: str('softMessage'),
      updatedAt: updated is String ? DateTime.tryParse(updated) : null,
    );
  }
}
