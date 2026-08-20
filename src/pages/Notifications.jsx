import React, { useEffect, useMemo, useState } from "react";
import { Container, Card, Input, Button, Spinner } from "reactstrap";
import { Search, CheckCheck, Bell } from "lucide-react";
import { useSocket } from "../context/SocketContext";
import {
    getNotifications,
    markNotificationRead,
    markAllNotificationsRead,
} from "../api/notifications.api";

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
 */
const Notifications = () => {
    const { socket, connected } = useSocket();
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

    const handleMarkRead = async (id) => {
        try {
            await markNotificationRead(id);
            setNotifications((prev) => prev.map((n) => (String(n._id) === String(id) ? { ...n, isRead: true } : n)));
        } catch {
            /* ignore */
        }
    };

    const handleMarkAllRead = async () => {
        try {
            await markAllNotificationsRead();
            setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        } catch {
            /* ignore */
        }
    };

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
                    <Card className="mb-0" style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #eef0f4" }}>
                        {filtered.map((n) => (
                            <div
                                key={n._id}
                                onClick={() => !n.isRead && handleMarkRead(n._id)}
                                className="d-flex align-items-start gap-3 px-3 py-3"
                                style={{
                                    borderBottom: "1px solid #f1f5f9",
                                    cursor: n.isRead ? "default" : "pointer",
                                    background: n.isRead ? "transparent" : "#eff6ff",
                                }}
                            >
                                <span
                                    style={{
                                        width: 8, height: 8, borderRadius: "50%", marginTop: 6, flexShrink: 0,
                                        background: n.isRead ? "transparent" : "#6366f1",
                                    }}
                                />
                                <div className="flex-grow-1">
                                    <div className="fw-semibold" style={{ fontSize: "0.9rem" }}>{n.title}</div>
                                    <div className="text-muted" style={{ fontSize: "0.85rem" }}>{n.message}</div>
                                    <div className="text-muted mt-1" style={{ fontSize: "0.72rem" }}>{formatDateTime(n.createdAt)}</div>
                                </div>
                                {!n.isRead && (
                                    <span
                                        style={{ fontSize: "0.72rem", fontWeight: 700, color: "#6366f1", whiteSpace: "nowrap" }}
                                    >
                                        Unread
                                    </span>
                                )}
                            </div>
                        ))}
                    </Card>
                )}
            </Container>
        </div>
    );
};

export default Notifications;
