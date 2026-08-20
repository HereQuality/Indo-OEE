import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    Container, Card, Table, Modal, ModalHeader, ModalBody, ModalFooter,
    Input, Label, Button, Spinner,
} from "reactstrap";
import {
    Plus, Search, Trash2, ImagePlus, X as XIcon, ArrowUpCircle,
    Send, Paperclip, Check, CheckCheck, Clock, CheckCircle2
} from "lucide-react";
import { MenuContext } from "../context/MenuContext";
import { AuthContext } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { useAlert } from "../context/AlertContext";
import {
    getTickets, getTicketDetails, createTicket, replyToTicket,
    forwardTicket, startProgress, askForConfirmation, verifyTicket,
    deleteTicket, markTicketMessagesRead,
} from "../api/tickets.api";

/* ── Colour maps ─────────────────────────────────────────────────────────── */
const STATUS_MAP = { Pending: { bg: "#DBEAFE", fg: "#1D4ED8" }, "In Progress": { bg: "#FEF3C7", fg: "#92400E" }, Confirmation: { bg: "#FCE7F3", fg: "#BE185D" }, Resolved: { bg: "#EDE9FE", fg: "#6D28D9" }, Closed: { bg: "#DCFCE7", fg: "#166534" } };
const PRIORITY_MAP = { Low: { bg: "#F3F4F6", fg: "#4B5563" }, Medium: { bg: "#FEF3C7", fg: "#92400E" }, High: { bg: "#FEE2E2", fg: "#991B1B" } };
const PLATFORM_MAP = { Web: { bg: "#DBEAFE", fg: "#1D4ED8" }, App: { bg: "#EDE9FE", fg: "#6D28D9" } };

const Pill = ({ map, value, fallback }) => {
    const c = map[value] || map[fallback] || { bg: "#e2e8f0", fg: "#475569" };
    return <span style={{ background: c.bg, color: c.fg, fontSize: "0.7rem", fontWeight: 700, padding: "3px 10px", borderRadius: 999, whiteSpace: "nowrap" }}>{value || fallback || "—"}</span>;
};

const fmt = v => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d) ? "" : d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

const MAX_IMG = 5;
const LIMIT = 5 * 1024 * 1024; // 5 MB

/* ── Client-side image compression ──────────────────────────────────────── */
const compress = file => new Promise(resolve => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = ev => {
        const img = new Image();
        img.src = ev.target.result;
        img.onload = () => {
            const MAX = 1200;
            let w = img.width, h = img.height;
            if (w > MAX || h > MAX) {
                if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                else { w = Math.round(w * MAX / h); h = MAX; }
            }
            const c = document.createElement("canvas");
            c.width = w; c.height = h;
            c.getContext("2d").drawImage(img, 0, 0, w, h);
            c.toBlob(blob => {
                if (!blob) { resolve(file); return; }
                resolve(new File([blob], file.name, { type: "image/jpeg", lastModified: Date.now() }));
            }, "image/jpeg", 0.72);
        };
    };
});

const processFiles = async (rawFiles) => {
    const out = [];
    for (const f of rawFiles) {
        if (f.type.startsWith("image/")) {
            out.push(await compress(f));
        } else {
            out.push(f);
        }
    }
    return out;
};

/* ── Create Ticket Modal ────────────────────────────────────────────────── */
const CreateModal = ({ isOpen, toggle, onCreated }) => {
    const toast = useAlert();
    const [form, setForm] = useState({ subject: "", description: "", priority: "Medium", platform: "Web" });
    const [imgs, setImgs] = useState([]); // File[]
    const [prevs, setPrevs] = useState([]);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const ref = useRef(null);

    useEffect(() => {
        if (isOpen) { setForm({ subject: "", description: "", priority: "Medium", platform: "Web" }); setImgs([]); setPrevs([]); setErr(""); }
    }, [isOpen]);
    useEffect(() => () => prevs.forEach(URL.revokeObjectURL), [prevs]);

    const addImgs = async files => {
        const incoming = Array.from(files || []).filter(f => f.type.startsWith("image/"));
        const valid = [];
        incoming.forEach(f => {
            if (f.size > LIMIT) toast.error(`"${f.name}" is larger than 5MB limit.`);
            else valid.push(f);
        });
        if (!valid.length) return;
        const done = await processFiles(valid);
        const next = [...imgs, ...done].slice(0, MAX_IMG);
        setImgs(next); setPrevs(next.map(URL.createObjectURL));
    };

    const removeImg = idx => {
        URL.revokeObjectURL(prevs[idx]);
        setImgs(i => i.filter((_, k) => k !== idx)); setPrevs(p => p.filter((_, k) => k !== idx));
    };

    const submit = async e => {
        e.preventDefault();
        if (!form.subject.trim() || !form.description.trim()) { setErr("Subject and description are required."); return; }
        setBusy(true);
        try { await createTicket(form, imgs); toast.success("Ticket raised!"); onCreated(); toggle(); }
        catch (ex) { setErr(ex?.response?.data?.message || "Failed to raise ticket."); }
        finally { setBusy(false); }
    };

    return (
        <Modal isOpen={isOpen} toggle={toggle} centered size="md">
            <ModalHeader toggle={toggle} style={{ fontWeight: 700 }}>Raise Support Ticket</ModalHeader>
            <form onSubmit={submit}>
                <ModalBody>
                    {err && <p className="text-danger mb-2" style={{ fontSize: "0.84rem" }}>{err}</p>}

                    <div className="mb-3">
                        <Label className="fw-semibold">Subject <span className="text-danger">*</span></Label>
                        <Input placeholder="Briefly describe the issue…" value={form.subject} required
                            onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} />
                    </div>

                    <div className="row g-3 mb-3">
                        <div className="col-6">
                            <Label className="fw-semibold d-block mb-1">Platform</Label>
                            <div className="d-flex gap-2">
                                {["Web", "App"].map(p => (
                                    <button key={p} type="button"
                                        onClick={() => setForm(f => ({ ...f, platform: p }))}
                                        style={{
                                            flex: 1, padding: "7px 0", borderRadius: 8, cursor: "pointer", transition: "all .15s",
                                            border: form.platform === p ? "2px solid #6366f1" : "1px solid #e2e8f0",
                                            background: form.platform === p ? "#eef2ff" : "var(--bs-body-bg,#f8fafc)",
                                            color: form.platform === p ? "#4f46e5" : "var(--bs-body-color,#64748b)",
                                            fontWeight: form.platform === p ? 700 : 400, fontSize: "0.87rem"
                                        }}>
                                        {p === "Web" ? "🖥 Web" : "📱 App"}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="col-6">
                            <Label className="fw-semibold d-block mb-1">Priority</Label>
                            <Input type="select" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                                <option>Low</option><option>Medium</option><option>High</option>
                            </Input>
                        </div>
                    </div>

                    <div className="mb-3">
                        <Label className="fw-semibold">Description <span className="text-danger">*</span></Label>
                        <Input type="textarea" style={{ height: 90 }} required value={form.description}
                            placeholder="Steps to reproduce, what you expected, etc."
                            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                    </div>

                    <div>
                        <div className="d-flex align-items-center justify-content-between mb-2">
                            <Label className="fw-semibold mb-0 d-flex align-items-center gap-1">
                                <ImagePlus size={14} /> Screenshots <span className="fw-normal text-muted" style={{ fontSize: "0.78rem" }}>(optional · Max 5mb)</span>
                            </Label>
                            <span className="text-muted" style={{ fontSize: "0.78rem" }}>{imgs.length}/{MAX_IMG}</span>
                        </div>
                        <div className="d-flex flex-wrap gap-2">
                            {imgs.length < MAX_IMG && (
                                <div onClick={() => ref.current?.click()} onDrop={e => { e.preventDefault(); addImgs(e.dataTransfer.files); }} onDragOver={e => e.preventDefault()}
                                    style={{
                                        width: 72, height: 72, border: "2px dashed #cbd5e1", borderRadius: 10, display: "flex", flexDirection: "column",
                                        alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#94a3b8", fontSize: "0.68rem",
                                        background: "var(--bs-body-bg,#f8fafc)"
                                    }}>
                                    <ImagePlus size={20} />
                                    <span className="mt-1">Upload</span>
                                    <input ref={ref} type="file" multiple accept="image/*" hidden onChange={e => addImgs(e.target.files)} />
                                </div>
                            )}
                            {prevs.map((src, i) => (
                                <div key={i} style={{ position: "relative", width: 72, height: 72 }}>
                                    <img src={src} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 10, border: "1px solid #e2e8f0" }} />
                                    <button type="button" onClick={() => removeImg(i)}
                                        style={{
                                            position: "absolute", top: -6, right: -6, background: "#ef4444", color: "#fff",
                                            border: "none", borderRadius: "50%", width: 20, height: 20, padding: 0,
                                            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer"
                                        }}>
                                        <XIcon size={11} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button color="light" className="border" type="button" onClick={toggle}>Cancel</Button>
                    <Button type="submit" disabled={busy} style={{ background: "#6366f1", border: "none", borderRadius: 8, fontWeight: 700, padding: "8px 24px", color: "#fff" }}>
                        {busy ? <Spinner size="sm" /> : "Create Ticket"}
                    </Button>
                </ModalFooter>
            </form>
        </Modal>
    );
};

/* ── Image lightbox ──────────────────────────────────────────────────────── */
const Lightbox = ({ url, onClose }) => url ? (
    <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center"
    }}>
        <button onClick={onClose} style={{
            position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,.15)",
            border: "none", borderRadius: "50%", width: 36, height: 36,
            display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", cursor: "pointer"
        }}>
            <XIcon size={18} />
        </button>
        <img onClick={e => e.stopPropagation()} src={url} alt="preview"
            style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8 }} />
    </div>
) : null;

/* ── Ticket Detail Modal ─────────────────────────────────────────────────── */
const DetailModal = ({ isOpen, toggle, ticketId, myId, isAdmin, canAct, canDeletePerm, onChanged }) => {
    const { socket, connected } = useSocket();
    const toast = useAlert();
    const [ticket, setTicket] = useState(null);
    const [loading, setLoading] = useState(false);
    const [reply, setReply] = useState("");
    const [files, setFiles] = useState([]);
    const [sending, setSending] = useState(false);
    const [busy, setBusy] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const [reason, setReason] = useState("");
    const [delConfirm, setDelConfirm] = useState(false);
    const [fwdConfirm, setFwdConfirm] = useState(false);
    const [lightbox, setLightbox] = useState(null);
    const scrollRef = useRef(null);

    const load = () => {
        if (!ticketId) return;
        setLoading(true);
        getTicketDetails(ticketId)
            .then(r => setTicket(r?.data?.data || null))
            .catch(() => { toast.error("Cannot load ticket."); setTicket(null); })
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        if (!isOpen || !ticketId) return;
        load();
        markTicketMessagesRead(ticketId).catch(() => { });
        setReply(""); setFiles([]); setRejecting(false); setReason("");
        setDelConfirm(false); setFwdConfirm(false); setLightbox(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, ticketId]);

    useEffect(() => {
        if (!isOpen || !ticketId || !socket || !connected) return;
        socket.emit("join_ticket", ticketId);
        const onMsg = msg => { setTicket(p => p ? { ...p, messages: [...(p.messages || []), msg] } : p); markTicketMessagesRead(ticketId).catch(() => { }); };
        const onUpd = () => load();
        const onRead = ({ readBy }) => { if (String(readBy) === String(myId)) return; setTicket(p => p ? { ...p, messages: (p.messages || []).map(m => String(m.senderId) === String(myId) ? { ...m, isRead: true } : m) } : p); };
        socket.on("new_message", onMsg); socket.on("ticket_updated", onUpd); socket.on("messages_read", onRead);
        return () => { socket.emit("leave_ticket", ticketId); socket.off("new_message", onMsg); socket.off("ticket_updated", onUpd); socket.off("messages_read", onRead); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, ticketId, socket, connected]);

    useEffect(() => { 
        const timer = setTimeout(() => {
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }, 50);
        return () => clearTimeout(timer);
    }, [ticket?.messages?.length, isOpen, ticketId]);

    const isCreator = ticket && String(ticket.raisedById) === String(myId);
    const showVerify = ticket?.status === "Confirmation" && isCreator;
    const canDel = ticket?.status === "Pending" && isCreator;
    
    // SuperAdmins handle "admin" tier tickets. Managers handle "agent" tier tickets.
    const canHandleThisTicket = isAdmin ? ticket?.tier === "admin" : (canAct && ticket?.tier === "agent");
    
    const canFwd = canHandleThisTicket && ticket?.tier === "agent" && ticket?.status !== "Closed";
    const canStart = canHandleThisTicket && ticket?.status === "Pending";
    const canAskConf = canHandleThisTicket && ticket?.status === "In Progress";

    const act = async (fn, successMsg, extra = {}) => {
        setBusy(true);
        try { await fn(); if (successMsg) toast.success(successMsg); load(); onChanged?.(); Object.entries(extra).forEach(([k, v]) => { if (k === "close") toggle(); }); }
        catch (ex) { toast.error(ex?.response?.data?.message || "Could not update."); }
        finally { setBusy(false); }
    };

    const handleSend = async e => {
        e.preventDefault();
        if (!reply.trim() && files.length === 0) return;
        setSending(true);
        try {
            const processed = await processFiles(files);
            const res = await replyToTicket(ticketId, reply.trim() || "(attachment)", processed);
            setTicket(res?.data?.data || ticket); // Update ticket state immediately with the latest data (including status changes)
            setReply(""); setFiles([]);
        } catch { toast.error("Failed to send."); }
        finally { setSending(false); }
    };

    return (
        <>
            <Modal isOpen={isOpen} toggle={toggle} centered size="xl"
                style={{ maxWidth: "min(960px, 96vw)" }}
                contentClassName="ticket-modal-content"
            >
                <ModalHeader toggle={toggle} style={{ padding: "14px 20px", borderBottom: "1px solid var(--bs-border-color,#e2e8f0)" }}>
                    <span style={{ fontSize: "1rem", fontWeight: 700 }}>
                        {ticket ? `${ticket.ticketId} — ${ticket.subject}` : "Ticket Detail"}
                    </span>
                </ModalHeader>

                <ModalBody className="p-0">
                    {!ticket ? (
                        <div className="text-center py-5"><Spinner size="sm" /></div>
                    ) : (
                        /* ── inner layout ── */
                        <div style={{ display: "flex", flexDirection: "column", height: "75vh", minHeight: 480 }}>

                            {/* Sub-header: badges + actions */}
                            <div style={{
                                display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "10px 16px",
                                borderBottom: "1px solid var(--bs-border-color,#e2e8f0)",
                                background: "var(--bs-secondary-bg,#f8fafc)"
                            }}>
                                <Pill map={STATUS_MAP} value={ticket.status} fallback="Pending" />
                                <Pill map={PLATFORM_MAP} value={ticket.platform} fallback="Web" />
                                <Pill map={PRIORITY_MAP} value={ticket.priority} fallback="Medium" />
                                <span className="text-muted" style={{ fontSize: "0.77rem" }}>by {ticket.raisedByName}</span>
                                {ticket.forwardedByName && <span className="text-muted" style={{ fontSize: "0.77rem" }}>· fwd by {ticket.forwardedByName}</span>}

                                <div className="ms-auto d-flex gap-2 flex-wrap">
                                    {canStart && (
                                        <button type="button" disabled={busy} onClick={() => act(() => startProgress(ticketId))}
                                            className="btn btn-warning btn-sm text-white d-flex align-items-center gap-1" style={{ borderRadius: 7, fontWeight: 600, fontSize: "0.8rem" }}>
                                            <Clock size={13} /> Start Progress
                                        </button>
                                    )}
                                    {canAskConf && (
                                        <button type="button" disabled={busy} onClick={() => act(() => askForConfirmation(ticketId))}
                                            className="btn btn-sm text-white d-flex align-items-center gap-1" style={{ background: "#7c3aed", border: "none", borderRadius: 7, fontWeight: 600, fontSize: "0.8rem" }}>
                                            <CheckCircle2 size={13} /> Ask Confirmation
                                        </button>
                                    )}
                                    {canFwd && !fwdConfirm && (
                                        <button type="button" disabled={busy} onClick={() => setFwdConfirm(true)}
                                            className="btn btn-light btn-sm border d-flex align-items-center gap-1" style={{ borderRadius: 7, fontSize: "0.8rem" }}>
                                            <ArrowUpCircle size={13} /> Forward to Admin
                                        </button>
                                    )}
                                    {canFwd && fwdConfirm && (
                                        <div className="d-flex align-items-center gap-1">
                                            <span style={{ fontSize: "0.76rem" }} className="text-warning">Forward?</span>
                                            <button type="button" className="btn btn-sm btn-primary" disabled={busy}
                                                onClick={() => act(() => forwardTicket(ticketId), "Forwarded to SuperAdmin!").then(() => setFwdConfirm(false))}>Yes</button>
                                            <button type="button" className="btn btn-sm btn-light border" onClick={() => setFwdConfirm(false)}>No</button>
                                        </div>
                                    )}
                                    {canDel && !delConfirm && (
                                        <button type="button" onClick={() => setDelConfirm(true)}
                                            className="btn btn-sm btn-light border text-danger d-flex align-items-center" style={{ borderRadius: 7 }}>
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                    {canDel && delConfirm && (
                                        <div className="d-flex align-items-center gap-1">
                                            <span style={{ fontSize: "0.76rem" }} className="text-muted">Delete?</span>
                                            <button type="button" className="btn btn-sm btn-danger" disabled={busy}
                                                onClick={() => act(() => deleteTicket(ticketId), "Ticket deleted.", { close: true }).then(() => setDelConfirm(false))}>Yes</button>
                                            <button type="button" className="btn btn-sm btn-light border" onClick={() => setDelConfirm(false)}>No</button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Body */}
                            <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

                                {/* Left: description */}
                                <div className="d-none d-md-block" style={{
                                    width: 260, flexShrink: 0, overflowY: "auto", padding: 16,
                                    borderRight: "1px solid var(--bs-border-color,#e2e8f0)"
                                }}>
                                    <p style={{ fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#6b7280", marginBottom: 8 }}>Description</p>
                                    <p style={{ fontSize: "0.88rem", whiteSpace: "pre-wrap", margin: 0 }}>{ticket.description}</p>

                                    {ticket.attachments?.length > 0 && (
                                        <div className="mt-3 pt-2" style={{ borderTop: "1px solid var(--bs-border-color,#e2e8f0)" }}>
                                            <p style={{ fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#6b7280", marginBottom: 8 }}>Attachments</p>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                                                {ticket.attachments.map((url, i) => {
                                                    const isImg = /\.(jpe?g|png|gif|webp)/i.test(url);
                                                    return isImg ? (
                                                        <div key={i} onClick={() => setLightbox(url)} style={{ cursor: "zoom-in" }}>
                                                            <img src={url} alt="" style={{ width: "100%", height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid var(--bs-border-color,#e2e8f0)" }} />
                                                        </div>
                                                    ) : (
                                                        <a key={i} href={url} target="_blank" rel="noreferrer"
                                                            className="d-flex align-items-center gap-1 text-primary" style={{ fontSize: "0.78rem", gridColumn: "1/-1" }}>
                                                            <Paperclip size={11} /> File {i + 1}
                                                        </a>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Right: chat */}
                                <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bs-secondary-bg,#f8fafc)" }}>
                                    <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 14 }}>
                                        {(ticket.messages || []).map((m, i) => {
                                            const mine = String(m.senderId) === String(myId);
                                            if (m.isSystem) return (
                                                <div key={i} className="text-center text-muted my-2" style={{ fontSize: "0.73rem" }}>
                                                    {m.senderName}: {m.message}
                                                </div>
                                            );
                                            return (
                                                <div key={i} className={`d-flex mb-3 ${mine ? "justify-content-end" : "justify-content-start"}`}>
                                                    <div style={{ maxWidth: "76%" }}>
                                                        {!mine && <div className="text-muted mb-1" style={{ fontSize: "0.7rem", fontWeight: 600 }}>{m.senderName}</div>}
                                                        <div style={{
                                                            background: mine ? "#6366f1" : "var(--bs-body-bg,#fff)",
                                                            color: mine ? "#fff" : "var(--bs-body-color,#1e293b)",
                                                            border: mine ? "none" : "1px solid var(--bs-border-color,#e2e8f0)",
                                                            borderRadius: 12, padding: "9px 13px", fontSize: "0.86rem",
                                                            boxShadow: "0 1px 3px rgba(0,0,0,.06)"
                                                        }}>
                                                            {m.message}
                                                            {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                                                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                                                                    {m.attachments.map((url, ai) => {
                                                                        const isImg = /\.(jpe?g|png|gif|webp)/i.test(url);
                                                                        return isImg ? (
                                                                            <div key={ai} onClick={() => setLightbox(url)} style={{ cursor: "zoom-in", borderRadius: 8, overflow: "hidden" }}>
                                                                                <img src={url} alt="" style={{ width: 80, height: 80, objectFit: "cover", display: "block" }} />
                                                                            </div>
                                                                        ) : (
                                                                            <a key={ai} href={url} target="_blank" rel="noreferrer"
                                                                                style={{ fontSize: "0.77rem", color: mine ? "#e0e7ff" : "#4338ca", textDecoration: "underline", display: "flex", alignItems: "center", gap: 4 }}>
                                                                                <Paperclip size={11} /> File
                                                                            </a>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, fontSize: "0.66rem", justifyContent: mine ? "flex-end" : "flex-start" }}>
                                                            <span className="text-muted">{fmt(m.createdAt)}</span>
                                                            {mine && (m.isRead
                                                                ? <CheckCheck size={12} style={{ color: "#3b82f6" }} title="Read" />
                                                                : <Check size={12} className="text-muted" title="Sent" />
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                    </div>

                                    {showVerify && (
                                        <div className="p-3 text-center" style={{ background: "#faf5ff", borderTop: "1px solid #e2e8f0" }}>
                                            {!rejecting ? (
                                                <>
                                                    <CheckCircle2 size={26} className="mb-2" style={{ color: "#7c3aed" }} />
                                                    <div className="fw-bold mb-1">Has your issue been resolved?</div>
                                                    <div className="text-muted mb-3" style={{ fontSize: "0.82rem" }}>The support team marked this as resolved. Please confirm.</div>
                                                    <div className="d-flex gap-2 justify-content-center">
                                                        <Button size="sm" disabled={busy} style={{ background: "#7c3aed", border: "none" }}
                                                            onClick={() => act(() => verifyTicket(ticketId, "Accept"), "Ticket closed!")}>
                                                            Accept &amp; Close
                                                        </Button>
                                                        <Button size="sm" color="light" className="border" onClick={() => setRejecting(true)}>Not Resolved</Button>
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="text-start">
                                                    <Label className="fw-medium">What's still wrong?</Label>
                                                    <Input type="textarea" style={{ height: 70 }} value={reason}
                                                        onChange={e => setReason(e.target.value)}
                                                        placeholder="Tell them what needs fixing…" />
                                                    <div className="d-flex gap-2 justify-content-end mt-2">
                                                        <Button size="sm" color="light" className="border" onClick={() => setRejecting(false)}>Cancel</Button>
                                                        <Button size="sm" color="danger" disabled={busy}
                                                            onClick={() => act(() => verifyTicket(ticketId, "Reject", reason.trim() || undefined)).then(() => { setRejecting(false); setReason(""); })}>
                                                            Reopen Ticket
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {ticket.status !== "Closed" && !showVerify && (
                                        <form onSubmit={handleSend} style={{ borderTop: "1px solid var(--bs-border-color,#e2e8f0)", padding: 8, background: "var(--bs-body-bg,#fff)" }}>
                                            {files.length > 0 && (
                                                <div className="d-flex flex-wrap gap-1 mb-2">
                                                    {files.map((f, idx) => (
                                                        <span key={idx} className="d-inline-flex align-items-center gap-1"
                                                            style={{ fontSize: "0.73rem", background: "#eef2ff", color: "#4338ca", borderRadius: 6, padding: "2px 8px" }}>
                                                            {f.name}
                                                            <XIcon size={11} style={{ cursor: "pointer" }} onClick={() => setFiles(p => p.filter((_, k) => k !== idx))} />
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="d-flex gap-2">
                                                <label className="btn btn-light border d-flex align-items-center justify-content-center" style={{ cursor: "pointer", marginBottom: 0 }}>
                                                    <Paperclip size={15} />
                                                    <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" hidden
                                                        onChange={e => {
                                                            const valid = [];
                                                            Array.from(e.target.files || []).forEach(f => {
                                                                if (f.size > LIMIT) toast.error(`"${f.name}" is larger than 5MB limit.`);
                                                                else valid.push(f);
                                                            });
                                                            setFiles(valid.slice(0, MAX_IMG));
                                                        }} />
                                                </label>
                                                <Input placeholder="Type a message…" value={reply} onChange={e => setReply(e.target.value)} />
                                                <Button color="primary" type="submit"
                                                    disabled={sending || (!reply.trim() && files.length === 0)}>
                                                    {sending ? <Spinner size="sm" /> : <Send size={15} />}
                                                </Button>
                                            </div>
                                        </form>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </ModalBody>
            </Modal>
            <Lightbox url={lightbox} onClose={() => setLightbox(null)} />
        </>
    );
};

/* ── Main Page ──────────────────────────────────────────────────────────── */
const Support = () => {
    const { currentPagePermissions = { view: true, create: true, edit: false, delete: false } } = useContext(MenuContext) || {};
    const { adminData } = useContext(AuthContext);
    const { socket, connected } = useSocket();
    const toast = useAlert();

    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [createOpen, setCreateOpen] = useState(false);
    const [activeId, setActiveId] = useState(null);
    const [deleteId, setDeleteId] = useState(null);
    const [forwardId, setForwardId] = useState(null);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");

    const canAct = !!currentPagePermissions.edit;
    const canDeletePerm = !!currentPagePermissions.delete;
    const myId = adminData?._id;

    const load = () => {
        setLoading(true);
        getTickets().then(r => setTickets(r?.data?.data || [])).catch(() => setTickets([])).finally(() => setLoading(false));
    };
    useEffect(load, []);

    useEffect(() => {
        if (!socket || !connected) return;
        const refresh = () => load();
        socket.on("refresh_unread_count", refresh);
        socket.on("ticket_updated", refresh);
        socket.on("new_message", refresh);
        return () => { socket.off("refresh_unread_count", refresh); socket.off("ticket_updated", refresh); socket.off("new_message", refresh); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socket, connected]);

    const sorted = useMemo(() => {
        const q = search.trim().toLowerCase();
        return [...tickets].filter(t => {
            if (statusFilter !== "all" && t.status !== statusFilter) return false;
            if (!q) return true;
            return [t.ticketId, t.subject, t.raisedByName, t.priority, t.status, t.platform, t.forwardedByName].filter(Boolean).some(v => String(v).toLowerCase().includes(q));
        }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }, [tickets, search, statusFilter]);

    const doDelete = async id => { try { await deleteTicket(id); toast.success("Deleted."); setDeleteId(null); load(); } catch (ex) { toast.error(ex?.response?.data?.message || "Could not delete."); } };
    const doForward = async id => { try { await forwardTicket(id); toast.success("Forwarded to SuperAdmin."); setForwardId(null); load(); } catch (ex) { toast.error(ex?.response?.data?.message || "Could not forward."); } };

    return (
        <div className="page-content">
            <Container fluid>
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
                    <h4 className="mb-0">Support Tickets</h4>
                    {currentPagePermissions.create !== false && (
                        <Button className="d-flex align-items-center gap-1" onClick={() => setCreateOpen(true)}
                            style={{ background: "#6366f1", border: "none", borderRadius: 8, fontWeight: 700, padding: "8px 20px", color: "#fff" }}>
                            <Plus size={16} /> New Ticket
                        </Button>
                    )}
                </div>

                {/* Filters */}
                <div className="d-flex flex-wrap gap-2 mb-3">
                    <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
                        <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "#9ca3af", pointerEvents: "none" }} />
                        <Input placeholder="Search tickets…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
                    </div>
                    <Input type="select" style={{ maxWidth: 170 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                        <option value="all">All statuses</option>
                        {["Pending", "In Progress", "Confirmation", "Resolved", "Closed"].map(s => <option key={s}>{s}</option>)}
                    </Input>
                </div>

                {loading ? (
                    <div className="text-center py-5"><Spinner size="sm" /> Loading…</div>
                ) : sorted.length === 0 ? (
                    <Card className="p-5 text-center text-muted mb-0">No tickets found.</Card>
                ) : (
                    <Card className="mb-0" style={{ borderRadius: 12, overflow: "hidden", border: "1px solid var(--bs-border-color,#eef0f4)" }}>
                        <div className="table-responsive">
                            <Table className="mb-0 align-middle" hover>
                                <thead style={{ background: "var(--bs-secondary-bg,#f8fafc)" }}>
                                    <tr>
                                        {["TICKET", "SUBJECT", "PLATFORM", canAct && "RAISED BY", "PRIORITY", "STATUS", "UPDATED", ""].filter(Boolean).map((h, i) => (
                                            <th key={i} style={{ fontSize: "0.72rem", color: "#6b7280", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sorted.map(t => {
                                        const creator = String(t.raisedById) === String(myId);
                                        const showDel = t.status === "Pending" && (creator || canDeletePerm);
                                        const showFwd = canAct && t.tier === "agent" && t.status !== "Closed";
                                        return (
                                            <tr key={t._id} onClick={() => setActiveId(t._id)} style={{ cursor: "pointer" }}>
                                                <td className="fw-semibold">
                                                    <span className="d-inline-flex align-items-center gap-2">
                                                        {t.hasUnread && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", flexShrink: 0 }} />}
                                                        {t.ticketId}
                                                    </span>
                                                </td>
                                                <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject}</td>
                                                <td><Pill map={PLATFORM_MAP} value={t.platform} fallback="Web" /></td>
                                                {canAct && <td style={{ fontSize: "0.84rem" }}>{t.raisedByName}</td>}
                                                <td><Pill map={PRIORITY_MAP} value={t.priority} fallback="Medium" /></td>
                                                <td><Pill map={STATUS_MAP} value={t.status} fallback="Pending" /></td>
                                                <td className="text-muted" style={{ fontSize: "0.79rem", whiteSpace: "nowrap" }}>{fmt(t.updatedAt)}</td>
                                                <td onClick={e => e.stopPropagation()}>
                                                    <div className="d-flex gap-1 align-items-center">
                                                        {showFwd && (
                                                            <button className="btn btn-sm btn-light btn-icon rounded-circle border" title="Forward" onClick={() => setForwardId(t._id)}>
                                                                <ArrowUpCircle size={14} className="text-primary" />
                                                            </button>
                                                        )}
                                                        {showDel && (
                                                            <button className="btn btn-sm btn-light btn-icon rounded-circle border" title="Delete" onClick={() => setDeleteId(t._id)}>
                                                                <Trash2 size={14} className="text-danger" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </Table>
                        </div>
                    </Card>
                )}
            </Container>

            <CreateModal isOpen={createOpen} toggle={() => setCreateOpen(false)} onCreated={load} />

            <DetailModal
                isOpen={!!activeId} toggle={() => setActiveId(null)}
                ticketId={activeId} myId={myId}
                isAdmin={adminData?.roleType === "SuperAdmin" || adminData?.role === "SuperAdmin" || adminData?.role === "HQEPL"}
                canAct={canAct} canDeletePerm={canDeletePerm}
                onChanged={load}
            />

            {/* Delete confirm */}
            <Modal isOpen={!!deleteId} toggle={() => setDeleteId(null)} centered size="sm">
                <ModalBody className="text-center py-4">
                    <Trash2 size={28} className="text-danger mb-2" />
                    <div className="fw-semibold">Delete this ticket?</div>
                    <div className="text-muted" style={{ fontSize: "0.82rem" }}>This cannot be undone.</div>
                </ModalBody>
                <ModalFooter className="justify-content-center">
                    <Button color="light" className="border" onClick={() => setDeleteId(null)}>Cancel</Button>
                    <Button color="danger" onClick={() => doDelete(deleteId)}>Delete</Button>
                </ModalFooter>
            </Modal>

            {/* Forward confirm */}
            <Modal isOpen={!!forwardId} toggle={() => setForwardId(null)} centered size="sm">
                <ModalBody className="text-center py-4">
                    <ArrowUpCircle size={28} className="text-primary mb-2" />
                    <div className="fw-semibold">Forward to SuperAdmin?</div>
                    <div className="text-muted" style={{ fontSize: "0.82rem" }}>SuperAdmin will receive full access to this ticket.</div>
                </ModalBody>
                <ModalFooter className="justify-content-center">
                    <Button color="light" className="border" onClick={() => setForwardId(null)}>Cancel</Button>
                    <Button color="primary" onClick={() => doForward(forwardId)}>Forward</Button>
                </ModalFooter>
            </Modal>
        </div>
    );
};

export default Support;
