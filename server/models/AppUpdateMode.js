const mongoose = require("mongoose");

/**
 * models/AppUpdateMode.js
 * ────────────────────────
 * Single global force-update document (same lazy find-or-create shape as
 * models/MaintenanceMode.js / models/CompanySettings.js) — set from
 * Administration > Company > App Update.
 *
 * This only ever gates the MOBILE app (Components/Common/AppUpdateModeCard
 * on web only exists to configure it) — a browser always serves the
 * latest build on refresh, so there's no equivalent "old version stuck on
 * a device" problem to force-update on web.
 *
 *   - `isActive`           — master switch. While true, a mobile install
 *     below `minVersion` is blocked with a full-screen "Update Required"
 *     gate until it's updated.
 *   - `minVersion`         — plain "major.minor.patch" string (e.g.
 *     "1.3.0"), compared against the installed app's own version
 *     (package_info_plus) using numeric part-by-part comparison, not a
 *     string compare — see mobile/lib/providers/app_update_provider.dart's `_compareVersions`.
 *     ONE value for both Android and iOS — Flutter ships a single version
 *     number to both stores at once (same as `reportedVersion` below), so
 *     there was never a real case for these to differ; a blank value means
 *     nobody is blocked even while `isActive` is true.
 *   - `latestVersion`       — separate from `minVersion`. Drives a
 *     non-blocking, dismissible "update available" bar in the mobile app
 *     instead of the full-screen block. Same one-value-for-both-platforms
 *     reasoning as `minVersion`.
 *   - `reportedVersion` / `reportedAt` — NOT typed by an admin. Flutter
 *     ships one version number to both stores at once (pubspec.yaml's
 *     `version:` drives both Android's versionName and iOS's
 *     CFBundleShortVersionString), so this is a single field, set by
 *     mobile/scripts/report_version.sh calling
 *     POST /app-update/report-version (see releaseAuth.middleware.js) right
 *     after a real build — purely a "what did we actually just publish"
 *     reference shown next to the Minimum Version fields, so setting a
 *     sensible minimum doesn't require separately checking the store or
 *     the repo.
 *   - `message`            — optional custom copy for the block screen;
 *     falls back to a generic "please update" line when blank.
 */
const appUpdateModeSchema = new mongoose.Schema(
  {
    isActive: {
      type: Boolean,
      default: false,
    },
    minVersion: {
      type: String,
      trim: true,
      default: "",
      maxlength: [20, "Version string is too long"],
    },
    latestVersion: {
      type: String,
      trim: true,
      default: "",
      maxlength: [20, "Version string is too long"],
    },
    reportedVersion: {
      type: String,
      trim: true,
      default: "",
      maxlength: [20, "Version string is too long"],
    },
    reportedAt: {
      type: Date,
      default: null,
    },
    // Force-update block screen's own message only. See softMessage below
    // for the separate, non-blocking soft-update bar's message — one
    // admin-typed line was never going to fit both ("you must update" vs
    // "hey, one's out"), so they're deliberately different fields.
    message: {
      type: String,
      trim: true,
      default: "",
      maxlength: [500, "Message cannot exceed 500 characters"],
    },
    // Soft-update bottom bar's own message (see latestVersion above).
    // Falls back to a generic "Update available — vX.X.X is out" line when
    // blank — see mobile/lib/features/app_update/soft_update_banner.dart.
    softMessage: {
      type: String,
      trim: true,
      default: "",
      maxlength: [500, "Message cannot exceed 500 characters"],
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      refPath: "updatedByModel",
    },
    updatedByModel: {
      type: String,
      enum: ["User", "Operator"],
      default: "User",
    },
  },
  { timestamps: true }
);

const AppUpdateMode = mongoose.model("AppUpdateMode", appUpdateModeSchema);

let cachedId = null;

const getOrCreateAppUpdate = async () => {
  if (cachedId) {
    const existing = await AppUpdateMode.findById(cachedId);
    if (existing) return existing;
    cachedId = null; // was deleted out from under us somehow — recreate below
  }
  let doc = await AppUpdateMode.findOne({});
  if (!doc) doc = await AppUpdateMode.create({});
  cachedId = doc._id;
  return doc;
};

module.exports = { AppUpdateMode, getOrCreateAppUpdate };
