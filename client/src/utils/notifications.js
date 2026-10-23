import { useContext } from "react";
import { useParams } from "react-router-dom";
import { MenuContext } from "../context/MenuContext";
import { toRolePath } from "./roleUrl";

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
const pathOf = (n) => {
  const type = String(n?.type || "");
  if (type === "oeeReview") return "/hqepl/production/oee-review";
  if (/ticket|support/i.test(type)) return "/hqepl/support";
  return null;
};

// (notification) → the URL to open, or null when there's nowhere to go — no
// page for its type, or one this role isn't granted. The page check mirrors
// PageGuard (Routes/RoleRoute.jsx): an operator is told an entry was decided
// even without access to OEE Review, and sending them there would only land
// them on No Access.
export const useNotificationLink = () => {
  const { roleSlug } = useParams();
  const { isAdmin, findMenuIdByUrl, getPermissionsForMenu } = useContext(MenuContext) || {};
  return (n) => {
    const path = pathOf(n);
    if (!path || !roleSlug) return null;
    const url = toRolePath(path, roleSlug);
    if (isAdmin) return url;
    const menuId = findMenuIdByUrl?.(url);
    return menuId && getPermissionsForMenu?.(menuId)?.view ? url : null;
  };
};
