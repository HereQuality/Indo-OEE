import React, { useContext, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Bell } from "lucide-react";
import { useSocket } from "../../context/SocketContext";
import { ThemeContext } from "../../context/ThemeContext";
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "../../api/notifications.api";

const formatTime = (value) => {
  if (!value) return "Now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Now";
  return date.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

/**
 * Components/Common/NotificationBell.jsx
 * ─────────────────────────────────────────
 * Lives in the top bar (Layouts/Layout.jsx). Uses the app's one shared
 * socket connection (SocketContext) — no separate connection of its own.
 * Currently only support-ticket events feed this, but it's generic
 * (title/message/type/referenceId) so anything else can push through it
 * later without changes here.
 */
export default function NotificationBell() {
  const { socket, connected } = useSocket();
  const { isDarkMode } = useContext(ThemeContext) || {};
  const navigate = useNavigate();
  const { roleSlug } = useParams();
  const containerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    getUnreadNotificationCount()
      .then((res) => setUnreadCount(res?.data?.unreadCount || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket || !connected) return undefined;

    const onNew = (notification) => {
      if (!notification) return;
      setNotifications((prev) => {
        const id = String(notification._id || "");
        if (id && prev.some((n) => String(n._id) === id)) return prev;
        return [notification, ...prev];
      });
      if (!notification.isRead) setUnreadCount((c) => c + 1);
    };

    socket.on("new_notification", onNew);
    return () => socket.off("new_notification", onNew);
  }, [socket, connected]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [isOpen]);

  const togglePanel = async () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      setLoading(true);
      try {
        const res = await getNotifications();
        setNotifications(res?.data?.data || []);
      } catch {
        setNotifications([]);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleMarkRead = async (id) => {
    try {
      await markNotificationRead(id);
      setNotifications((prev) => prev.map((n) => (String(n._id) === String(id) ? { ...n, isRead: true } : n)));
      setUnreadCount((c) => (c > 0 ? c - 1 : 0));
    } catch {
      /* ignore */
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      /* ignore */
    }
  };

  const panelBg = isDarkMode ? "#18181f" : "#ffffff";
  const border = isDarkMode ? "1px solid #272727" : "1px solid #e2e8f0";
  const textMuted = isDarkMode ? "#94a3b8" : "#64748b";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={togglePanel}
        className="relative h-9 w-9 flex items-center justify-center rounded-full transition"
        style={{ color: isDarkMode ? "#cbd5e1" : "#475569", background: "transparent" }}
        title="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex items-center justify-center rounded-full text-white"
            style={{ minWidth: 16, height: 16, fontSize: 9.5, fontWeight: 700, background: "#ef4444", padding: "0 3px" }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-xl shadow-lg"
          style={{ background: panelBg, border }}
        >
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: border }}>
            <div>
              <div className="text-sm font-bold" style={{ color: isDarkMode ? "#f1f1f1" : "#1e293b" }}>Notifications</div>
              <div className="text-xs" style={{ color: textMuted }}>Unread: {unreadCount}</div>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs font-medium"
                style={{ color: "#6366f1" }}
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="px-4 py-5 text-sm" style={{ color: textMuted }}>Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-5 text-sm" style={{ color: textMuted }}>No notifications yet.</div>
            ) : (
              notifications.map((item) => (
                <button
                  key={item._id}
                  type="button"
                  onClick={() => handleMarkRead(item._id)}
                  className="w-full px-4 py-3 text-left transition-colors"
                  style={{
                    borderBottom: border,
                    background: item.isRead ? "transparent" : (isDarkMode ? "rgba(99,102,241,0.08)" : "#eff6ff"),
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold" style={{ color: isDarkMode ? "#f1f1f1" : "#1e293b" }}>
                        {item.title}
                      </div>
                      <div className="mt-1 text-xs" style={{ color: textMuted }}>{item.message}</div>
                    </div>
                    {!item.isRead && <span className="mt-1 h-2 w-2 rounded-full flex-shrink-0" style={{ background: "#6366f1" }} />}
                  </div>
                  <div className="mt-2 text-[11px]" style={{ color: isDarkMode ? "#525252" : "#94a3b8" }}>
                    {formatTime(item.createdAt)}
                  </div>
                </button>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              navigate(`/${roleSlug}/notifications`);
            }}
            className="w-full py-2.5 text-center text-sm font-semibold"
            style={{ borderTop: border, color: "#6366f1", background: "transparent" }}
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}
