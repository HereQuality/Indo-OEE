import { useContext } from "react";
import { useParams } from "react-router-dom";
import { MenuContext } from "../context/MenuContext";
import { toRolePath } from "./roleUrl";
import { SHEET_PATHS } from "../Components/OeeReview/reviewShared";
import { reopenReview } from "../api/oeeReview.api";

/**
 * utils/notifications.js
 * ────────────────────────
 * What the bell (Components/Common/NotificationBell.jsx) and the
 * Notifications page share: the event that keeps the two in step, and where
 * a notification leads when it's clicked.
 */

// Fired whenever either one marks something read — detail { id } for one,
// { all: true } for all. The bell refetches its unread count; the page marks
// the same rows read in its list.
export const NOTIFICATIONS_CHANGED = "notifications-changed";
export const announceNotificationsRead = (detail) =>
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED, { detail }));

// The page each kind of notification is about, stored like a menu URL
// ("/hqepl/…") so toRolePath() swaps in whichever role slug is browsing.
// `type` is set by whoever creates the notification on the server
// (server/services/notification.service.js callers).
//
// An OEE review notification either asks an admin to review an entry (no
// `decision`: the review desk) or tells whoever saved it that it was approved /
// rejected (`decision`: that sheet's data entry page, with the entry's edit
// form opened — see hooks/useOpenEntryFromLink.js).
const pathOf = (n) => {
  const type = String(n?.type || "");
  if (type === "oeeReview") {
    const ref = n?.referenceId;
    if (ref?.decision && SHEET_PATHS[ref.sheet]) {
      const q = new URLSearchParams({ entry: ref.entry || "", ...(ref.date ? { date: ref.date } : {}) });
      return `${SHEET_PATHS[ref.sheet]}?${q}`;
    }
    return "/hqepl/production/oee-review";
  }
  if (/ticket|support/i.test(type)) return "/hqepl/support";
  return null;
};

// (url) → whether this role may open that page: Super Admin always; anyone else
// needs View on the page's menu in Manage Role. The same check PageGuard
// (Routes/RoleRoute.jsx) makes — a link that fails it only lands on No Access.
export const useCanOpenPage = () => {
  const { isAdmin, findMenuIdByUrl, getPermissionsForMenu } = useContext(MenuContext) || {};
  return (url) => {
    if (!url) return false;
    if (isAdmin) return true;
    // The permission check is on the page, not on its ?query.
    const menuId = findMenuIdByUrl?.(url.split("?")[0]);
    return !!menuId && !!getPermissionsForMenu?.(menuId)?.view;
  };
};

// (notification) → the URL to open, or null when there's nowhere to go — no
// page for its type, or one this role isn't granted. An operator is told an
// entry was decided even without access to OEE Review, and sending them there
// would only land them on No Access.
export const useNotificationLink = () => {
  const { roleSlug } = useParams();
  const canOpen = useCanOpenPage();
  return (n) => {
    const path = pathOf(n);
    if (!path || !roleSlug) return null;
    const url = toRolePath(path, roleSlug);
    return canOpen(url) ? url : null;
  };
};

// Run before following a notification's link. Opening a "your entry was
// rejected" one unlocks that entry for another 24 hours (so it can be
// corrected even if the first window, or the 2-working-day lock, has passed);
// a failure just means the entry opens as it is.
export const prepareNotification = async (n) => {
  const ref = n?.referenceId;
  if (String(n?.type) !== "oeeReview" || ref?.decision !== "rejected" || !ref.entry || !ref.sheet) return;
  try {
    await reopenReview(ref.sheet, ref.entry);
  } catch {
    /* the entry opens as it is */
  }
};
