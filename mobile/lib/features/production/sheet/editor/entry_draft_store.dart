import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Add-entry drafts (port of loadDraft / saveDraft / clearDraft in
/// client/src/pages/ProductionSheet.jsx). What was typed is kept when the form
/// is closed so an accidental close does not lose it; reopening "Add Entry"
/// within a minute brings it back. After that — or after a successful Save — it
/// is gone, so the form never comes back stale hours later.
class EntryDraftStore {
  EntryDraftStore._();

  static const key = 'productionEntryDraft';
  static const ttl = Duration(seconds: 60);

  /// The saved blocks, or null when there is no draft, it is older than [ttl],
  /// or it cannot be read (an expired / broken draft is removed).
  static Future<List<Map<String, dynamic>>?> load({DateTime? now}) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(key);
      if (raw == null || raw.isEmpty) return null;
      final parsed = jsonDecode(raw);
      final entries = parsed is Map ? parsed['entries'] : null;
      final savedAt = parsed is Map ? parsed['savedAt'] : null;
      final age = savedAt is num
          ? (now ?? DateTime.now()).millisecondsSinceEpoch - savedAt.toInt()
          : null;
      if (entries is! List || entries.isEmpty || age == null || age > ttl.inMilliseconds) {
        await prefs.remove(key);
        return null;
      }
      return [
        for (final e in entries)
          if (e is Map) Map<String, dynamic>.from(e),
      ];
    } catch (_) {
      return null;
    }
  }

  static Future<void> save(List<Map<String, dynamic>> entries, {DateTime? now}) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        key,
        jsonEncode({'entries': entries, 'savedAt': (now ?? DateTime.now()).millisecondsSinceEpoch}),
      );
    } catch (_) {
      // Storage unavailable — the draft is just skipped.
    }
  }

  static Future<void> clear() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(key);
    } catch (_) {
      // ignore
    }
  }
}
