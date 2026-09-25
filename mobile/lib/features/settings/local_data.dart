import 'package:shared_preferences/shared_preferences.dart';

/// What "Clear local data" removes: things the app only caches on this device.
/// Never the sign-in token (secure storage) and never the theme choice.
class LocalData {
  LocalData._();

  /// Unsent Add-Entry draft (production sheet).
  static const entryDraftKey = 'productionEntryDraft';

  /// "All machines" dashboard widget picks (kept per device, like the web's localStorage).
  static const dashboardWidgetsKey = 'allMachinesDashboardWidgets';

  static const clearableKeys = [entryDraftKey, dashboardWidgetsKey];

  /// Removes the cached items and returns how many were present.
  static Future<int> clear() async {
    final prefs = await SharedPreferences.getInstance();
    var removed = 0;
    for (final k in clearableKeys) {
      if (prefs.containsKey(k)) {
        await prefs.remove(k);
        removed++;
      }
    }
    return removed;
  }
}
