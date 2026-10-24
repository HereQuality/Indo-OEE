import React, { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Container, Card, Input, Button, Spinner } from "reactstrap";
import { Search, CheckCheck, Bell } from "lucide-react";
import { useSocket } from "../context/SocketContext";
import { ThemeContext } from "../context/ThemeContext";
import {
    getNotifications,
    markNotificationRead,
    markAllNotificationsRead,
} from "../api/notifications.api";
import { NOTIFICATIONS_CHANGED, announceNotificationsRead, prepareNotification, useNotificationLink } from "../utils/notifications";

const formatDateTime = (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString([], {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
};

/**
 * pages/Notifications.jsx
 * ─────────────────────────
 * "View all" destination from the bell dropdown. Open to anyone who's
 * logged in — everyone gets their own notifications regardless of role.
 * Clicking one marks it read and opens the page it's about, like the bell.
 */
const Notifications = () => {
    document.title = `Notifications | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

    const { socket, connected } = useSocket();
    const { isDarkMode } = useContext(ThemeContext) || {};
    const navigate = useNavigate();
    const linkOf = useNotificationLink();
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState("all"); // all | unread | read

    const load = () => {
        setLoading(true);
        getNotifications()
            .then((res) => setNotifications(res?.data?.data || []))
            .catch(() => setNotifications([]))
            .finally(() => setLoading(false));
    };

    useEffect(load, []);

    useEffect(() => {
        if (!socket || !connected) return undefined;
        const onNew = (n) => {
            if (!n) return;
            setNotifications((prev) => {
                const id = String(n._id || "");
                if (id && prev.some((item) => String(item._id) === id)) return prev;
                return [n, ...prev];
            });
        };
        socket.on("new_notification", onNew);
        return () => socket.off("new_notification", onNew);
    }, [socket, connected]);

    // Whatever the bell marks read while this page is open shows here too.
    useEffect(() => {
        const onChanged = (e) => {
            const { id, all } = e.detail || {};
            if (!id && !all) return;
            setNotifications((prev) => prev.map((n) => (all || String(n._id) === id ? { ...n, isRead: true } : n)));
        };
        window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
        return () => window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
    }, []);

    const handleMarkRead = async (id) => {
        try {
            await markNotificationRead(id);
            setNotifications((prev) => prev.map((n) => (String(n._id) === String(id) ? { ...n, isRead: true } : n)));
            announceNotificationsRead({ id: String(id) });
        } catch {
            /* ignore */
        }
    };

    const handleMarkAllRead = async () => {
        try {
            await markAllNotificationsRead();
            setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
            announceNotificationsRead({ all: true });
        } catch {
            /* ignore */
        }
    };

    const handleOpen = async (n) => {
        if (!n.isRead) handleMarkRead(n._id);
        const link = linkOf(n);
        if (!link) return;
        await prepareNotification(n);
        navigate(link);
    };

    // Theme-aware: under dark mode the card's text turns light (index.css),
    // so a fixed light-blue unread background left it white on pale blue.
    const rowBorder = isDarkMode ? "#272727" : "#f1f5f9";
    const unreadBg = isDarkMode ? "rgba(99,102,241,0.14)" : "#eff6ff";

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return notifications.filter((n) => {
            if (filter === "unread" && n.isRead) return false;
            if (filter === "read" && !n.isRead) return false;
            if (q && !`${n.title} ${n.message}`.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [notifications, search, filter]);

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    return (
        <div className="page-content">
            <Container fluid>
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
                    <div>
                        <h4 className="mb-0 d-flex align-items-center gap-2"><Bell size={20} /> Notifications</h4>
                        <span className="text-muted" style={{ fontSize: "0.85rem" }}>{unreadCount} unread</span>
                    </div>
                    {unreadCount > 0 && (
                        <Button color="light" className="d-flex align-items-center gap-1 border" onClick={handleMarkAllRead}>
                            <CheckCheck size={15} /> Mark all as read
                        </Button>
                    )}
                </div>

                <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
                    <div style={{ position: "relative", maxWidth: 320, flex: 1 }}>
                        <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "#9ca3af" }} />
                        <Input
                            placeholder="Search notifications..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ paddingLeft: 32 }}
                        />
                    </div>
                    <div className="btn-group">
                        {["all", "unread", "read"].map((f) => (
                            <Button
                                key={f}
                                size="sm"
                                color={filter === f ? "primary" : "light"}
                                className={filter !== f ? "border" : ""}
                                onClick={() => setFilter(f)}
                                style={{ textTransform: "capitalize" }}
                            >
                                {f}
                            </Button>
                        ))}
                    </div>
                </div>

                {loading ? (
                    <div className="text-center py-5"><Spinner size="sm" /></div>
                ) : filtered.length === 0 ? (
                    <Card className="p-5 text-center text-muted mb-0">No notifications found.</Card>
                ) : (
                    <Card className="mb-0" style={{ borderRadius: 12, overflow: "hidden", border: `1px solid ${isDarkMode ? "#272727" : "#eef0f4"}` }}>
                        {filtered.map((n) => {
                            const clickable = !n.isRead || !!linkOf(n);
                            return (
                                <div
                                    key={n._id}
                                    onClick={clickable ? () => handleOpen(n) : undefined}
                                    onKeyDown={clickable ? (e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            handleOpen(n);
                                        }
                                    } : undefined}
                                    role={clickable ? "button" : undefined}
                                    tabIndex={clickable ? 0 : undefined}
                                    className="d-flex align-items-start gap-3 px-3 py-3"
                                    style={{
                                        borderBottom: `1px solid ${rowBorder}`,
                                        cursor: clickable ? "pointer" : "default",
                                        background: n.isRead ? "transparent" : unreadBg,
                                    }}
                                >
                                    <span
                                        style={{
                                            width: 8, height: 8, borderRadius: "50%", marginTop: 6, flexShrink: 0,
                                            background: n.isRead ? "transparent" : "#6366f1",
                                        }}
                                    />
                                    <div className="flex-grow-1" style={{ minWidth: 0 }}>
                                        <div className="fw-semibold text-break" style={{ fontSize: "0.9rem" }}>{n.title}</div>
                                        <div className="text-muted text-break" style={{ fontSize: "0.85rem" }}>{n.message}</div>
                                        <div className="text-muted mt-1" style={{ fontSize: "0.72rem" }}>{formatDateTime(n.createdAt)}</div>
                                    </div>
                                    {!n.isRead && (
                                        <span
                                            style={{ fontSize: "0.72rem", fontWeight: 700, color: isDarkMode ? "#a5b4fc" : "#6366f1", whiteSpace: "nowrap" }}
                                        >
                                            Unread
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </Card>
                )}
            </Container>
        </div>
    );
};

export default Notifications;
