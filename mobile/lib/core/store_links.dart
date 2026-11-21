import 'package:flutter/foundation.dart';

/// Store listing ids for this app and the one place that turns them into a
/// URL (the same links as the web portal's badges, client/src/utils/
/// appStoreLinks.js) — shared by UpdateRequiredScreen (force update) and SoftUpdateBanner
/// (soft update) so the two can never drift apart.
class StoreLinks {
  StoreLinks._();

  /// android/app/build.gradle.kts `applicationId`.
  static const androidPackageId = 'com.hqepl.indo_oee';

  /// App Store Connect's numeric Apple ID for Indo OEE (the store URL needs
  /// this, not the bundle id `com.hqepl.indo`). Works for an unlisted app too:
  /// anyone with the link can open the listing.
  static const iosAppStoreId = '6825675790';

  static bool get hasStoreLink => appStoreUri() != null;

  /// Play Store / App Store listing for the current platform; null on
  /// desktop/web builds, which have no store listing.
  static Uri? appStoreUri() {
    if (kIsWeb) return null;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return Uri.parse('https://play.google.com/store/apps/details?id=$androidPackageId&pcampaignid=web_share');
      case TargetPlatform.iOS:
        return iosAppStoreId.isEmpty ? null : Uri.parse('https://apps.apple.com/us/app/indo-oee/id$iosAppStoreId');
      default:
        return null;
    }
  }
}
