import '../core/config.dart';

class UserPreferences {
  const UserPreferences({
    this.themeMode = 'light',
    this.showDashboardClock = true,
    this.shortcuts = const [],
  });

  final String themeMode; // 'light' | 'dark'
  final bool showDashboardClock;
  final List<String> shortcuts; // menu ids pinned on Home

  bool get isDark => themeMode == 'dark';

  factory UserPreferences.fromJson(dynamic json) {
    if (json is! Map) return const UserPreferences();
    return UserPreferences(
      themeMode: json['themeMode'] == 'dark' ? 'dark' : 'light',
      showDashboardClock: json['showDashboardClock'] != false,
      shortcuts: (json['shortcuts'] is List)
          ? (json['shortcuts'] as List).map((e) => e.toString()).toList()
          : const [],
    );
  }
}

/// The signed-in account (a SuperAdmin `User` or an `Operator`), exactly as
/// GET /auth/me returns it. [raw] keeps every field so screens can read what
/// they need without this class having to know about all of it.
class AppUser {
  AppUser(this.raw);

  final Map<String, dynamic> raw;

  String get id => (raw['_id'] ?? raw['id'] ?? '').toString();
  String get roleType => (raw['roleType'] ?? '').toString(); // SuperAdmin | Operator
  bool get isSuperAdmin => roleType == 'SuperAdmin';

  /// `roleId` is a plain id in /auth/me but can be a populated object
  /// ({_id, roleName}) in the login response — accept both.
  String? get roleId {
    final r = raw['roleId'];
    if (r is Map) return (r['_id'] ?? r['id'])?.toString();
    return r?.toString();
  }

  String? get roleSlug => raw['roleSlug']?.toString();

  String? get roleName {
    final n = raw['roleName'];
    if (n != null) return n.toString();
    final r = raw['roleId'];
    if (r is Map && r['roleName'] != null) return r['roleName'].toString();
    return isSuperAdmin ? 'Super Admin' : null;
  }

  String get username => (raw['username'] ?? '').toString();

  String get name {
    for (final k in ['employeeName', 'name']) {
      final v = raw[k]?.toString().trim();
      if (v != null && v.isNotEmpty) return v;
    }
    final full = '${raw['firstName'] ?? ''} ${raw['lastName'] ?? ''}'.trim();
    return full.isNotEmpty ? full : username;
  }

  String? get email {
    for (final k in ['emailOffice', 'email']) {
      final v = raw[k]?.toString();
      if (v != null && v.isNotEmpty) return v;
    }
    return null;
  }

  String? get mobileNumber => raw['mobileNumber']?.toString();
  String? get profilePic => AppConfig.toBackendUrl(raw['profilePic']?.toString());
  String? get redirectUrl => raw['redirectUrl']?.toString();

  UserPreferences get preferences => UserPreferences.fromJson(raw['preferences']);

  AppUser copyWithPreferences(dynamic prefs) =>
      AppUser({...raw, 'preferences': prefs is Map ? Map<String, dynamic>.from(prefs) : raw['preferences']});
}
