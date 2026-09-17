import { useCallback, useEffect, useState } from "react";
import dayjs from "dayjs";

const readSeen = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
};

const writeSeen = (key, entry) => {
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // localStorage unavailable — worst case the popup reappears more than once/day.
  }
};

/**
 * hooks/useOncePerDayPopup.js
 * ──────────────────────────────
 * Shared "show this once today, then stay hidden until the content
 * changes" gate used by both MaintenanceAnnouncementModal and
 * AnnouncementModal. Kept content-agnostic (just a storage key + a
 * version string) so App.jsx can sequence multiple such popups —
 * one at a time, never stacked on top of each other — instead of each
 * popup deciding independently whether to show.
 *
 * `ready` gates whether this popup has anything to show at all (e.g. a
 * valid scheduledAt, or isLive+message). `version` is compared against
 * what was last dismissed (typically the doc's updatedAt) so editing the
 * content resurfaces it even if already dismissed today.
 */
export function useOncePerDayPopup(storageKey, ready, version) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!ready || !version) {
      setPending(false);
      return;
    }
    const today = dayjs().format("YYYY-MM-DD");
    const seen = readSeen(storageKey);
    if (seen && seen.day === today && seen.version === version) {
      setPending(false);
      return;
    }
    setPending(true);
  }, [storageKey, ready, version]);

  const dismiss = useCallback(() => {
    writeSeen(storageKey, { day: dayjs().format("YYYY-MM-DD"), version });
    setPending(false);
  }, [storageKey, version]);

  return [pending, dismiss];
}
