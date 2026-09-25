/// Mirrors client/src/utils/roleUrl.js. Menu URLs are stored in the DB with a
/// fixed first segment ("/hqepl/production/machines"); the mobile app ignores
/// that segment and routes on the remainder ("/production/machines").
String stripFirstSegment(String path) => path.replaceFirst(RegExp(r'^/[^/]+'), '');

/// Normalises a menu URL for matching: no query, no trailing slash, no role
/// slug. "/manager/production/machines/?x=1" -> "/production/machines".
String normalizeMenuPath(String? url) {
  if (url == null) return '';
  var u = url.split('?').first.replaceAll(RegExp(r'/+$'), '');
  if (u.isEmpty || u == '#') return '';
  return stripFirstSegment(u);
}

/// The URL slug a logged-in user is routed under (kept for parity with the
/// web app; the mobile app does not show URLs).
String? roleSlugFor({required String roleType, String? roleSlug}) {
  if (roleType == 'SuperAdmin') return 'hqepl';
  if (roleType == 'Operator') return (roleSlug == null || roleSlug.isEmpty) ? 'operator' : roleSlug;
  return null;
}
