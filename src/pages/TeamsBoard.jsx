import React, { useState, useEffect, useContext, useMemo } from "react";
import {
    Container,
    Card,
    CardBody,
    Table,
    Modal,
    ModalHeader,
    ModalBody,
    ModalFooter,
    Input,
    Label,
    Button,
    Spinner,
} from "reactstrap";
import { Plus, Pencil, Trash2, Users, Search, X, Check, Network } from "lucide-react";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { updateReportingManager } from "../api/employees.api";
import { createTeam, updateTeam, deleteTeam } from "../api/teams.api";
import { useTeams, useInvalidateTeams } from "../hooks/useTeams";
import { useEmployees, useInvalidateEmployees } from "../hooks/useEmployees";

// Deterministic, muted tint/foreground pair for a name's initial-letter avatar.
// Soft tinted background + matching darker foreground reads as considered design
// rather than the loud, fully-saturated blocks of a default avatar palette.
const AVATAR_PALETTE = [
    { bg: "#EEF2FF", fg: "#4338CA" }, // indigo
    { bg: "#ECFDF5", fg: "#047857" }, // emerald
    { bg: "#FFF7ED", fg: "#C2410C" }, // amber
    { bg: "#FDF2F8", fg: "#BE185D" }, // rose
    { bg: "#EFF6FF", fg: "#1D4ED8" }, // blue
    { bg: "#F5F3FF", fg: "#6D28D9" }, // violet
    { bg: "#F0FDFA", fg: "#0F766E" }, // teal
];
const paletteFor = (str = "") => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
};

const initialState = {
    teamName: "",
    description: "",
    remark: "",
    memberIds: [], // array of employee objects { _id, employeeName, profilePic }
};

// Small round avatar — shows a profile pic if present, otherwise a soft tinted initial
const Avatar = ({ name, pic, size = 28, border = false, style = {} }) => {
    const { bg, fg } = paletteFor(name);
    return pic ? (
        <img
            src={pic}
            alt={name}
            style={{
                width: size,
                height: size,
                borderRadius: "50%",
                objectFit: "cover",
                border: border ? "2px solid #fff" : "none",
                ...style,
            }}
        />
    ) : (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: "50%",
                background: bg,
                color: fg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: size * 0.4,
                fontWeight: 600,
                border: border ? "2px solid #fff" : "none",
                ...style,
            }}
        >
            {name?.charAt(0)?.toUpperCase() || "?"}
        </div>
    );
};

// Popup for picking team members from the employee directory
const MemberPickerModal = ({ isOpen, toggle, employees, selectedIds, onDone }) => {
    const [tempSelected, setTempSelected] = useState(selectedIds);
    const [search, setSearch] = useState("");

    useEffect(() => {
        if (isOpen) {
            setTempSelected(selectedIds);
            setSearch("");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return employees;
        return employees.filter(
            (e) =>
                e.employeeName?.toLowerCase().includes(q) ||
                e.roleId?.roleName?.toLowerCase().includes(q)
        );
    }, [employees, search]);

    const toggleMember = (emp) => {
        setTempSelected((prev) =>
            prev.some((m) => m._id === emp._id)
                ? prev.filter((m) => m._id !== emp._id)
                : [...prev, emp]
        );
    };

    return (
        <Modal isOpen={isOpen} toggle={toggle} centered>
            <ModalHeader className="p-3 border-bottom" toggle={toggle}>
                Select Team Members
            </ModalHeader>
            <ModalBody>
                <div className="position-relative mb-3">
                    <Search size={16} className="position-absolute" style={{ left: 10, top: 10, opacity: 0.5 }} />
                    <Input
                        type="text"
                        placeholder="Search by name or role..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ paddingLeft: 32 }}
                    />
                </div>

                <div style={{ maxHeight: 320, overflowY: "auto" }}>
                    {filtered.length === 0 && (
                        <p className="text-muted text-center py-3 mb-0">No employees found.</p>
                    )}
                    {filtered.map((emp) => {
                        const checked = tempSelected.some((m) => m._id === emp._id);
                        return (
                            <div
                                key={emp._id}
                                onClick={() => toggleMember(emp)}
                                className="d-flex align-items-center gap-2 p-2 rounded"
                                style={{
                                    cursor: "pointer",
                                    background: checked ? "rgba(var(--bs-primary-rgb), 0.08)" : "transparent",
                                }}
                            >
                                <Avatar name={emp.employeeName} pic={emp.profilePic} size={32} />
                                <div className="flex-grow-1">
                                    <div className="fw-medium">{emp.employeeName}</div>
                                    {emp.roleId?.roleName && (
                                        <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                            {emp.roleId.roleName}
                                        </div>
                                    )}
                                </div>
                                <div
                                    style={{
                                        width: 20,
                                        height: 20,
                                        borderRadius: 4,
                                        border: checked ? "none" : "1.5px solid #ccc",
                                        background: checked ? "var(--bs-primary)" : "transparent",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        flexShrink: 0,
                                    }}
                                >
                                    {checked && <Check size={14} color="#fff" />}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </ModalBody>
            <ModalFooter className="p-3 border-top">
                <span className="me-auto text-muted" style={{ fontSize: "0.85rem" }}>
                    {tempSelected.length} selected
                </span>
                <Button color="light" onClick={toggle}>Cancel</Button>
                <Button color="primary" onClick={() => onDone(tempSelected)}>Done</Button>
            </ModalFooter>
        </Modal>
    );
};

// A single member tile in the popup — tinted top accent, ringed avatar, name, role chip, status pill
const MemberTile = ({ member, onClick }) => {
    const { bg, fg } = paletteFor(member.employeeName);
    const isInactive = member.isActive === false;

    return (
        <div
            className="member-tile"
            onClick={onClick}
            role="button"
            tabIndex={0}
            style={{
                position: "relative",
                border: "1px solid #E9EAEE",
                borderRadius: 16,
                padding: "24px 14px 18px",
                background: "#fff",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                cursor: "pointer",
                overflow: "hidden",
            }}
        >
            {/* Accent cap — ties the card to this person's avatar tint */}
            <div
                aria-hidden
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 4,
                    background: `linear-gradient(90deg, ${fg}, ${fg}99)`,
                }}
            />

            <div
                style={{
                    width: 68,
                    height: 68,
                    borderRadius: "50%",
                    padding: 3,
                    border: `1.5px solid ${bg}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                {member.profilePic ? (
                    <img
                        src={member.profilePic}
                        alt={member.employeeName}
                        style={{ width: 60, height: 60, borderRadius: "50%", objectFit: "cover" }}
                    />
                ) : (
                    <div
                        style={{
                            width: 60,
                            height: 60,
                            borderRadius: "50%",
                            background: bg,
                            color: fg,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "1.3rem",
                            fontWeight: 600,
                        }}
                    >
                        {member.employeeName?.charAt(0)?.toUpperCase() || "?"}
                    </div>
                )}
            </div>

            <div className="fw-semibold text-truncate mt-2" style={{ fontSize: "0.9rem", color: "#111827", maxWidth: "100%" }}>
                {member.employeeName}
            </div>
            {member.roleId?.roleName && (
                <span
                    className="text-truncate mt-1"
                    style={{
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        color: fg,
                        background: bg,
                        borderRadius: 999,
                        padding: "2px 10px",
                        maxWidth: "100%",
                    }}
                >
                    {member.roleId.roleName}
                </span>
            )}

            <span
                className="d-inline-flex align-items-center gap-1 mt-2"
                style={{
                    fontSize: "0.68rem",
                    fontWeight: 600,
                    letterSpacing: "0.02em",
                    padding: "2px 9px",
                    borderRadius: 999,
                    background: isInactive ? "#F3F4F6" : "#ECFDF5",
                    color: isInactive ? "#6B7280" : "#047857",
                }}
            >
                <span
                    className={isInactive ? "" : "status-dot-live"}
                    style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: isInactive ? "#9CA3AF" : "#22C55E",
                    }}
                />
                {isInactive ? "Inactive" : "Active"}
            </span>
        </div>
    );
};

// Popup shown when a team card is clicked — grid of member tiles (photo/initial + name + status)
const TeamMembersModal = ({ isOpen, toggle, team, onMemberClick, onShowChart }) => {
    const [search, setSearch] = useState("");

    useEffect(() => {
        if (isOpen) setSearch("");
    }, [isOpen]);

    if (!team) return null;
    const members = team.memberIds || [];
    const { bg, fg } = paletteFor(team.teamName);
    const activeCount = members.filter((m) => m.isActive !== false).length;

    const q = search.trim().toLowerCase();
    const filtered = q
        ? members.filter(
              (m) =>
                  m.employeeName?.toLowerCase().includes(q) ||
                  m.roleId?.roleName?.toLowerCase().includes(q)
          )
        : members;

    return (
        <Modal isOpen={isOpen} toggle={toggle} centered size="lg">
            <style>{`
                .member-tile:hover {
                    box-shadow: 0 8px 20px -4px rgba(16, 24, 40, 0.12);
                    border-color: #D1D5DB !important;
                    transform: translateY(-2px);
                }
                .member-tile { transition: box-shadow 0.18s ease, border-color 0.18s ease, transform 0.18s ease; }
                @keyframes statusPulse {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.45); }
                    50% { box-shadow: 0 0 0 3px rgba(34, 197, 94, 0); }
                }
                .status-dot-live { animation: statusPulse 2s ease-in-out infinite; }
                @media (prefers-reduced-motion: reduce) {
                    .status-dot-live { animation: none; }
                    .member-tile:hover { transform: none; }
                }
                .team-chart-btn:hover { border-color: ${fg}66 !important; color: ${fg} !important; background: ${bg} !important; }
            `}</style>

            <div
                className="position-relative"
                style={{
                    background: `linear-gradient(135deg, ${bg} 0%, #ffffff 85%)`,
                    padding: "22px 24px 40px",
                    borderBottom: "1px solid #F0F1F4",
                }}
            >
                <button
                    type="button"
                    aria-label="Close"
                    className="btn-close position-absolute"
                    style={{ top: 18, right: 20 }}
                    onClick={toggle}
                />
                <div className="text-uppercase text-muted" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.08em" }}>
                    Team
                </div>
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mt-1">
                    <div>
                        <div className="fw-bold" style={{ fontSize: "1.35rem", color: "#111827", lineHeight: 1.2 }}>
                            {team.teamName}
                        </div>
                        <div className="text-muted mt-1" style={{ fontSize: "0.82rem" }}>
                            {members.length} member{members.length !== 1 ? "s" : ""} · {activeCount} active
                        </div>
                    </div>
                    {members.length > 0 && (
                        <Button
                            size="sm"
                            className="team-chart-btn d-flex align-items-center gap-1 flex-shrink-0"
                            style={{
                                fontSize: "0.8rem",
                                fontWeight: 600,
                                background: "#fff",
                                color: "#374151",
                                border: "1px solid #E5E7EB",
                                borderRadius: 999,
                                padding: "7px 14px",
                            }}
                            onClick={() => onShowChart && onShowChart(team)}
                        >
                            <Network size={14} /> Team Chart
                        </Button>
                    )}
                </div>
            </div>

            <ModalBody className="p-4" style={{ marginTop: -22, background: "#FAFAFB" }}>
                {members.length > 6 && (
                    <div className="position-relative mb-3" style={{ maxWidth: 280 }}>
                        <Search size={15} className="position-absolute" style={{ left: 11, top: 9, opacity: 0.45 }} />
                        <Input
                            type="text"
                            bsSize="sm"
                            placeholder="Filter members..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ paddingLeft: 32, borderRadius: 8, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" }}
                        />
                    </div>
                )}
                <div style={{ maxHeight: "56vh", overflowY: "auto" }}>
                    {members.length === 0 ? (
                        <p className="text-muted text-center py-4 mb-0">This team has no members yet.</p>
                    ) : filtered.length === 0 ? (
                        <p className="text-muted text-center py-4 mb-0">No members match “{search}”.</p>
                    ) : (
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                                gap: 14,
                            }}
                        >
                            {filtered.map((m) => (
                                <MemberTile key={m._id} member={m} onClick={() => onMemberClick && onMemberClick(m, members)} />
                            ))}
                        </div>
                    )}
                </div>
            </ModalBody>
        </Modal>
    );
};

// Turns a flat list of members (each optionally carrying a populated reportingManagerId)
// into a forest of nodes ({ ...member, children: [...] }). Members whose manager isn't
// another member of this team (no manager, or manager outside the team) become roots.
const buildOrgTree = (members) => {
    const byId = {};
    (members || []).forEach((m) => {
        byId[m._id] = { ...m, children: [] };
    });

    const managerIdOf = (m) => {
        const primaryManager = Array.isArray(m.reportingManagerIds) ? m.reportingManagerIds[0] : m.reportingManagerIds;
        return primaryManager && typeof primaryManager === "object" ? primaryManager._id : primaryManager;
    };

    // Per-team, someone can look like a "root" simply because their real
    // manager isn't on that team's own member list. Once every team is
    // merged for the combined chart, that manager IS present too — and if
    // two such people end up pointing at each other (A's manager is B, B's
    // manager is A), the old logic attached both as children instead of
    // roots and neither, nor anyone under them, ever showed up. Walk each
    // member's own chain and only break it into a root when it loops back
    // to itself, so one bad pair doesn't swallow everyone downstream of it.
    const closesLoop = (startId) => {
        let current = managerIdOf(byId[startId]);
        const seen = new Set([startId]);
        while (current && byId[current]) {
            if (current === startId) return true;
            if (seen.has(current)) return false;
            seen.add(current);
            current = managerIdOf(byId[current]);
        }
        return false;
    };

    const roots = [];
    (members || []).forEach((m) => {
        const managerId = managerIdOf(m);
        if (managerId && managerId !== m._id && byId[managerId] && !closesLoop(m._id)) {
            byId[managerId].children.push(byId[m._id]);
        } else {
            roots.push(byId[m._id]);
        }
    });
    return roots;
};

// One box in the org chart — accent bar, ringed avatar, name, role and status dot. Clicking
// it opens the same "Member Profile" popup used from the grid view, so managers can be
// reassigned here too.
//
// Layout note: the tree is built with plain flexbox divs (not the classic <ul>/<li> +
// table-cell + ::before/::after trick). The table-cell technique looks fine in isolation,
// but its connector lines are positioned as percentages of each <li>'s own box, which
// breaks as soon as it sits inside something with its own list-style/box-sizing resets
// (Bootstrap's reboot, a scrollable modal body, etc.) — that's what caused the
// misaligned/overlapping branch lines. Flexbox naturally centers each subtree, so the
// connector math below only ever needs fixed offsets, not fragile percentage tricks.
const OrgChartNode = ({ node, members, onClick }) => {
    const isInactive = node.isActive === false;
    const { bg, fg } = paletteFor(node.employeeName);
    const hasChildren = node.children && node.children.length > 0;
    return (
        <div className="org-node">
            <div
                className="org-node-box"
                role="button"
                tabIndex={0}
                style={{ borderLeft: `3px solid ${fg}` }}
                onClick={() => onClick && onClick(node, members)}
            >
                <div style={{ padding: 2, borderRadius: "50%", border: `1.5px solid ${bg}`, display: "flex" }}>
                    <Avatar name={node.employeeName} pic={node.profilePic} size={34} />
                </div>
                <div className="text-start" style={{ minWidth: 0 }}>
                    <div className="fw-semibold text-truncate" style={{ fontSize: "0.85rem", color: "#111827" }}>
                        {node.employeeName}
                    </div>
                    {node.roleId?.roleName && (
                        <div className="text-truncate" style={{ fontSize: "0.72rem", color: "#6B7280" }}>
                            {node.roleId.roleName}
                        </div>
                    )}
                </div>
                <span
                    className={isInactive ? "" : "status-dot-live"}
                    style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: isInactive ? "#9CA3AF" : "#22C55E",
                    }}
                    title={isInactive ? "Inactive" : "Active"}
                />
            </div>
            {hasChildren && (
                <div className="org-node-children">
                    {node.children.map((child) => (
                        <div className="org-node-child" key={child._id}>
                            <OrgChartNode node={child} members={members} onClick={onClick} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// Popup shown from "Team Chart" — a reporting-line tree built from each member's
// Reporting Manager (see MemberProfileModal), rendered as a classic pure-CSS org chart.
const TeamChartModal = ({ isOpen, toggle, team, onMemberClick }) => {
    const members = team?.memberIds || [];
    const roots = useMemo(() => buildOrgTree(members), [members]);
    if (!team) return null;

    return (
        <Modal isOpen={isOpen} toggle={toggle} centered size="xl">
            <div
                className="position-relative d-flex align-items-center gap-3"
                style={{
                    padding: "20px 24px",
                    background: "linear-gradient(135deg, #F5F3FF 0%, #ffffff 80%)",
                    borderBottom: "1px solid #F0F1F4",
                }}
            >
                <div
                    className="d-flex align-items-center justify-content-center flex-shrink-0"
                    style={{ width: 40, height: 40, borderRadius: 12, background: "#EDE9FE", color: "#6D28D9" }}
                >
                    <Network size={19} />
                </div>
                <div>
                    <div className="fw-bold" style={{ fontSize: "1.05rem", color: "#111827", lineHeight: 1.25 }}>
                        {team.teamName} — Team Chart
                    </div>
                    <div className="text-muted" style={{ fontSize: "0.8rem" }}>
                        Click a member to view their profile or change their reporting manager
                    </div>
                </div>
                <button
                    type="button"
                    aria-label="Close"
                    className="btn-close position-absolute"
                    style={{ top: 20, right: 22 }}
                    onClick={toggle}
                />
            </div>
            <ModalBody className="p-4" style={{ maxHeight: "70vh", overflow: "auto", background: "#FCFCFD" }}>
                <style>{`
                    /* Scroll container: wide trees scroll horizontally instead of squashing
                       and overlapping their connector lines. */
                    .org-tree-scroll { overflow-x: auto; padding-bottom: 4px; }
                    .org-tree-wrap { display: flex; justify-content: center; min-width: max-content; margin: 0 auto; }

                    .org-node { display: flex; flex-direction: column; align-items: center; }

                    /* Row of a node's children, centered under the node above it. The 32px
                       margin-top is the vertical space the connector lines live in. */
                    .org-node-children {
                        display: flex;
                        justify-content: center;
                        position: relative;
                        margin-top: 32px;
                    }
                    /* Trunk dropping from the parent box down to the shared horizontal bar. */
                    .org-node-children::before {
                        content: '';
                        position: absolute;
                        top: -32px;
                        left: 50%;
                        width: 2px;
                        height: 16px;
                        background: #DBDFE7;
                        transform: translateX(-50%);
                    }

                    .org-node-child {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        padding: 0 18px;
                        position: relative;
                    }
                    /* Shared horizontal bar at the midpoint of the gap, one half-segment per
                       child — together they form one continuous line across all siblings. */
                    .org-node-child::before {
                        content: '';
                        position: absolute;
                        top: -16px;
                        left: 0;
                        right: 0;
                        height: 2px;
                        background: #DBDFE7;
                    }
                    .org-node-child:first-child::before { left: 50%; border-top-left-radius: 8px; }
                    .org-node-child:last-child::before { right: 50%; border-top-right-radius: 8px; }
                    .org-node-child:only-child::before { display: none; }
                    /* Vertical drop from the horizontal bar into this child's own box. */
                    .org-node-child::after {
                        content: '';
                        position: absolute;
                        top: -16px;
                        left: 50%;
                        width: 2px;
                        height: 16px;
                        background: #DBDFE7;
                        transform: translateX(-50%);
                    }

                    .org-node-box {
                        display: inline-flex;
                        align-items: center;
                        gap: 10px;
                        background: #fff;
                        border: 1px solid #E9EAEE;
                        border-radius: 12px;
                        padding: 9px 18px 9px 12px;
                        cursor: pointer;
                        white-space: nowrap;
                        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
                        transition: box-shadow 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
                    }
                    .org-node-box:hover {
                        box-shadow: 0 8px 18px -4px rgba(16, 24, 40, 0.12);
                        border-color: #D1D5DB;
                        transform: translateY(-2px);
                    }
                    @keyframes statusPulse {
                        0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.45); }
                        50% { box-shadow: 0 0 0 3px rgba(34, 197, 94, 0); }
                    }
                    .status-dot-live { animation: statusPulse 2s ease-in-out infinite; }
                    @media (prefers-reduced-motion: reduce) {
                        .status-dot-live { animation: none; }
                        .org-node-box:hover { transform: none; }
                    }
                `}</style>
                {members.length === 0 ? (
                    <p className="text-muted text-center py-4 mb-0">This team has no members yet.</p>
                ) : (
                    <div className="org-tree-scroll">
                        <div className="org-tree-wrap">
                            <div className="org-node">
                                <div
                                    className="org-node-box"
                                    style={{ background: "#F5F3FF", borderColor: "#DDD6FE", cursor: "default" }}
                                >
                                    <Avatar name={team.teamName} size={36} />
                                    <div className="text-start">
                                        <div
                                            className="text-uppercase"
                                            style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em", color: "#8B5CF6" }}
                                        >
                                            Team
                                        </div>
                                        <div className="fw-semibold" style={{ fontSize: "0.85rem", color: "#111827", lineHeight: 1.2 }}>
                                            {team.teamName}
                                        </div>
                                        <div style={{ fontSize: "0.72rem", color: "#6B7280" }}>
                                            {members.length} member{members.length !== 1 ? "s" : ""}
                                        </div>
                                    </div>
                                </div>
                                {roots.length > 0 && (
                                    <div className="org-node-children">
                                        {roots.map((root) => (
                                            <div className="org-node-child" key={root._id}>
                                                <OrgChartNode node={root} members={members} onClick={onMemberClick} />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </ModalBody>
        </Modal>
    );
};

// Popup shown from the "Org Chart" button on the Teams page header — a single combined
// reporting-line tree built across every team's members (deduped by employee, tagged with
// which team(s) they belong to). Reuses the same buildOrgTree/OrgChartNode pieces as the
// per-team chart above, just fed a merged member list instead of one team's memberIds.
const AllTeamsOrgChartModal = ({ isOpen, toggle, members, onMemberClick }) => {
    const roots = useMemo(() => buildOrgTree(members), [members]);
    const teamCount = useMemo(() => {
        const names = new Set();
        (members || []).forEach((m) => (m._teams || []).forEach((t) => names.add(t.name)));
        return names.size;
    }, [members]);

    return (
        <Modal isOpen={isOpen} toggle={toggle} centered size="xl">
            <div
                className="position-relative d-flex align-items-center gap-3"
                style={{
                    padding: "20px 24px",
                    background: "linear-gradient(135deg, #EFF6FF 0%, #ffffff 80%)",
                    borderBottom: "1px solid #F0F1F4",
                }}
            >
                <div
                    className="d-flex align-items-center justify-content-center flex-shrink-0"
                    style={{ width: 40, height: 40, borderRadius: 12, background: "#DBEAFE", color: "#1D4ED8" }}
                >
                    <Network size={19} />
                </div>
                <div>
                    <div className="fw-bold" style={{ fontSize: "1.05rem", color: "#111827", lineHeight: 1.25 }}>
                        Organization Chart — All Teams
                    </div>
                    <div className="text-muted" style={{ fontSize: "0.8rem" }}>
                        {members.length} people across {teamCount} team{teamCount !== 1 ? "s" : ""} · click anyone to view their profile or change their reporting manager
                    </div>
                </div>
                <button
                    type="button"
                    aria-label="Close"
                    className="btn-close position-absolute"
                    style={{ top: 20, right: 22 }}
                    onClick={toggle}
                />
            </div>
            <ModalBody className="p-4" style={{ maxHeight: "70vh", overflow: "auto", background: "#FCFCFD" }}>
                <style>{`
                    .org-tree-scroll { overflow-x: auto; padding-bottom: 4px; }
                    .org-tree-wrap { display: flex; justify-content: center; min-width: max-content; margin: 0 auto; }
                    .org-node { display: flex; flex-direction: column; align-items: center; }
                    .org-node-children {
                        display: flex;
                        justify-content: center;
                        position: relative;
                        margin-top: 32px;
                    }
                    .org-node-children::before {
                        content: '';
                        position: absolute;
                        top: -32px;
                        left: 50%;
                        width: 2px;
                        height: 16px;
                        background: #DBDFE7;
                        transform: translateX(-50%);
                    }
                    .org-node-child {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        padding: 0 18px;
                        position: relative;
                    }
                    .org-node-child::before {
                        content: '';
                        position: absolute;
                        top: -16px;
                        left: 0;
                        right: 0;
                        height: 2px;
                        background: #DBDFE7;
                    }
                    .org-node-child:first-child::before { left: 50%; border-top-left-radius: 8px; }
                    .org-node-child:last-child::before { right: 50%; border-top-right-radius: 8px; }
                    .org-node-child:only-child::before { display: none; }
                    .org-node-child::after {
                        content: '';
                        position: absolute;
                        top: -16px;
                        left: 50%;
                        width: 2px;
                        height: 16px;
                        background: #DBDFE7;
                        transform: translateX(-50%);
                    }
                    .org-node-box {
                        display: inline-flex;
                        align-items: center;
                        gap: 10px;
                        background: #fff;
                        border: 1px solid #E9EAEE;
                        border-radius: 12px;
                        padding: 9px 18px 9px 12px;
                        cursor: pointer;
                        white-space: nowrap;
                        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
                        transition: box-shadow 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
                    }
                    .org-node-box:hover {
                        box-shadow: 0 8px 18px -4px rgba(16, 24, 40, 0.12);
                        border-color: #D1D5DB;
                        transform: translateY(-2px);
                    }
                    @keyframes statusPulse {
                        0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.45); }
                        50% { box-shadow: 0 0 0 3px rgba(34, 197, 94, 0); }
                    }
                    .status-dot-live { animation: statusPulse 2s ease-in-out infinite; }
                    @media (prefers-reduced-motion: reduce) {
                        .status-dot-live { animation: none; }
                        .org-node-box:hover { transform: none; }
                    }
                `}</style>
                {members.length === 0 ? (
                    <p className="text-muted text-center py-4 mb-0">No teams have any members yet.</p>
                ) : (
                    <div className="org-tree-scroll">
                        <div className="org-tree-wrap">
                            <div className="org-node">
                                <div
                                    className="org-node-box"
                                    style={{ background: "#EFF6FF", borderColor: "#BFDBFE", cursor: "default" }}
                                >
                                    <div
                                        className="d-flex align-items-center justify-content-center flex-shrink-0"
                                        style={{ width: 36, height: 36, borderRadius: "50%", background: "#DBEAFE", color: "#1D4ED8" }}
                                    >
                                        <Network size={17} />
                                    </div>
                                    <div className="text-start">
                                        <div
                                            className="text-uppercase"
                                            style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em", color: "#2563EB" }}
                                        >
                                            Organization
                                        </div>
                                        <div className="fw-semibold" style={{ fontSize: "0.85rem", color: "#111827", lineHeight: 1.2 }}>
                                            All Teams
                                        </div>
                                        <div style={{ fontSize: "0.72rem", color: "#6B7280" }}>
                                            {members.length} member{members.length !== 1 ? "s" : ""}
                                        </div>
                                    </div>
                                </div>
                                {roots.length > 0 && (
                                    <div className="org-node-children">
                                        {roots.map((root) => (
                                            <div className="org-node-child" key={root._id}>
                                                <OrgChartNode node={root} members={members} onClick={onMemberClick} />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </ModalBody>
        </Modal>
    );
};

// Popup shown when a member tile is clicked — profile details + "Reporting Manager" picker.
// The dropdown is scoped to the member's own team (teammates only), matching how the
// Teams board groups people; picking a name sets that person as this member's manager.
const MemberProfileModal = ({ isOpen, toggle, member, teamMembers, allEmployees, onManagerChange, canEdit = true }) => {
    const [selectedManagerId, setSelectedManagerId] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen && member) {
            const primaryManager = Array.isArray(member.reportingManagerIds)
                ? member.reportingManagerIds[0]
                : member.reportingManagerIds;
            const currentManagerId =
                primaryManager && typeof primaryManager === "object" ? primaryManager._id : primaryManager || "";
            setSelectedManagerId(currentManagerId || "");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, member]);

    if (!member) return null;

    const { bg, fg } = paletteFor(member.employeeName);
    const isInactive = member.isActive === false;

    // Manager must be someone else on the SAME team — not org-wide.
    const candidateManagers = (teamMembers || []).filter((m) => m._id !== member._id);

    // Direct reports: anyone (across the whole org, not just this team) whose
    // reportingManagerIds includes this member — so it's accurate even when the
    // profile was opened from a single-team view.
    const directReports = (allEmployees && allEmployees.length ? allEmployees : teamMembers || []).filter((e) => {
        const ids = Array.isArray(e.reportingManagerIds) ? e.reportingManagerIds : (e.reportingManagerIds ? [e.reportingManagerIds] : []);
        return ids.some((m) => (typeof m === "object" ? m._id : m) === member._id);
    });

    const departmentNames = (member.departmentIds || []).map((d) => (typeof d === "object" ? d.departmentName : d)).filter(Boolean);
    const teamNames = (member.teamIds || []).map((t) => (typeof t === "object" ? t.teamName : t)).filter(Boolean);

    const handleChange = async (e) => {
        const newManagerId = e.target.value;
        setSelectedManagerId(newManagerId);
        setSaving(true);
        try {
            await onManagerChange(member, newManagerId || null);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} toggle={toggle} centered>
            <ModalHeader className="px-4 py-3 border-bottom" toggle={toggle}>
                Member Profile
            </ModalHeader>
            <ModalBody className="p-4">
                <div className="d-flex flex-column align-items-center text-center mb-4">
                    {member.profilePic ? (
                        <img
                            src={member.profilePic}
                            alt={member.employeeName}
                            style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover" }}
                        />
                    ) : (
                        <div
                            style={{
                                width: 72,
                                height: 72,
                                borderRadius: "50%",
                                background: bg,
                                color: fg,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "1.6rem",
                                fontWeight: 600,
                            }}
                        >
                            {member.employeeName?.charAt(0)?.toUpperCase() || "?"}
                        </div>
                    )}
                    <div className="fw-semibold mt-2" style={{ fontSize: "1.05rem", color: "#111827" }}>
                        {member.employeeName}
                    </div>
                    {/* Role/title always shows here regardless of whether anything
                        else below (dept/skills/team/phone) is filled in. */}
                    {member.roleId?.roleName && (
                        <div className="text-muted" style={{ fontSize: "0.85rem" }}>
                            {member.roleId.roleName}
                        </div>
                    )}
                    <span
                        className="d-inline-flex align-items-center gap-1 mt-2"
                        style={{
                            fontSize: "0.68rem",
                            fontWeight: 600,
                            letterSpacing: "0.02em",
                            padding: "2px 9px",
                            borderRadius: 999,
                            background: isInactive ? "#F3F4F6" : "#ECFDF5",
                            color: isInactive ? "#6B7280" : "#047857",
                        }}
                    >
                        <span
                            style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: isInactive ? "#9CA3AF" : "#22C55E",
                            }}
                        />
                        {isInactive ? "Inactive" : "Active"}
                    </span>
                </div>

                {/* Department / Role / Team / Phone / Direct reports — read-only info grid.
                    Phone only renders when the employee actually has one on file — an
                    empty "—" row for a field nobody filled in just adds noise. */}
                <div className="p-2.5 rounded-3 mb-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", padding: 10 }}>
                    <div className="row g-2" style={{ fontSize: "0.82rem" }}>
                        <div className="col-6">
                            <span className="text-muted d-block" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: 0.4 }}>DEPARTMENT</span>
                            <span className="fw-semibold">{departmentNames.length ? departmentNames.join(", ") : "—"}</span>
                        </div>
                        <div className="col-6">
                            <span className="text-muted d-block" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: 0.4 }}>ROLE</span>
                            <span className="fw-semibold">{member.roleId?.roleName || "—"}</span>
                        </div>
                        <div className="col-6">
                            <span className="text-muted d-block" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: 0.4 }}>TEAM(S)</span>
                            <span className="fw-semibold">{teamNames.length ? teamNames.join(", ") : "—"}</span>
                        </div>
                        <div className="col-6">
                            <span className="text-muted d-block" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: 0.4 }}>DIRECT REPORTS</span>
                            <span className="fw-semibold">{directReports.length}</span>
                        </div>
                        {member.mobileNumber && (
                            <div className="col-6">
                                <span className="text-muted d-block" style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: 0.4 }}>PHONE</span>
                                <span className="fw-semibold">{member.mobileNumber}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Skills — only shown here, never on the chart card itself */}
                {Array.isArray(member.skills) && member.skills.length > 0 && (
                    <div className="mb-3">
                        <Label className="fw-medium mb-1">Skills</Label>
                        <div className="d-flex flex-wrap gap-1">
                            {member.skills.map((s, i) => (
                                <span
                                    key={i}
                                    style={{ background: "#EEF2FF", color: "#4338CA", fontSize: "0.75rem", fontWeight: 600, padding: "3px 8px", borderRadius: 6 }}
                                >
                                    {s}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                <Label className="fw-medium">Reporting Manager</Label>
                <Input
                    type="select"
                    value={selectedManagerId}
                    onChange={handleChange}
                    disabled={!canEdit || saving || candidateManagers.length === 0}
                >
                    <option value="">— Top of the team (Team Lead) —</option>
                    {candidateManagers.map((m) => (
                        <option key={m._id} value={m._id}>
                            {m.employeeName}
                        </option>
                    ))}
                </Input>
                {!canEdit && (
                    <div className="text-muted mt-2" style={{ fontSize: "0.8rem" }}>
                        You have read-only access to this page and can't change the reporting manager.
                    </div>
                )}
                {canEdit && candidateManagers.length === 0 && (
                    <div className="text-muted mt-2" style={{ fontSize: "0.8rem" }}>
                        No other employees available to assign as manager.
                    </div>
                )}
                {saving && (
                    <div className="text-muted mt-2 d-flex align-items-center gap-2" style={{ fontSize: "0.8rem" }}>
                        <Spinner size="sm" /> Saving...
                    </div>
                )}
            </ModalBody>
        </Modal>
    );
};

// Add / Edit team modal (name + members)
const TeamFormModal = ({ isOpen, toggle, title, values, setValues, employees, onSubmit, isLoading, errors }) => {
    const [pickerOpen, setPickerOpen] = useState(false);

    return (
        <React.Fragment>
            <Modal isOpen={isOpen} toggle={toggle} centered>
                <ModalHeader className="p-3 border-bottom" toggle={toggle}>
                    {title}
                </ModalHeader>
                <form noValidate onSubmit={onSubmit}>
                    <ModalBody>
                        {/* Team Name */}
                        <div className="form-floating mb-3">
                            <Input
                                type="text"
                                placeholder=" "
                                value={values.teamName}
                                onChange={(e) => setValues({ ...values, teamName: e.target.value })}
                            />
                            <Label>Team Name <span className="text-danger">*</span></Label>
                            {errors.teamName && <p className="text-danger mb-0" style={{ fontSize: "0.8rem" }}>{errors.teamName}</p>}
                        </div>

                        {/* Description */}
                        <div className="form-floating mb-3">
                            <Input
                                type="textarea"
                                placeholder=" "
                                style={{ height: 80 }}
                                value={values.description}
                                onChange={(e) => setValues({ ...values, description: e.target.value })}
                            />
                            <Label>Description</Label>
                        </div>

                        {/* Remark */}
                        <div className="form-floating mb-3">
                            <Input
                                type="text"
                                placeholder=" "
                                value={values.remark}
                                onChange={(e) => setValues({ ...values, remark: e.target.value })}
                            />
                            <Label>Remark</Label>
                        </div>

                        {/* Members */}
                        <div className="mb-2">
                            <Label className="d-flex justify-content-between align-items-center">
                                <span>Team Members</span>
                                <button
                                    type="button"
                                    className="btn btn-sm btn-soft-primary d-flex align-items-center gap-1"
                                    onClick={() => setPickerOpen(true)}
                                >
                                    <Users size={14} /> Add Members
                                </button>
                            </Label>

                            {values.memberIds.length === 0 ? (
                                <p className="text-muted mb-0" style={{ fontSize: "0.85rem" }}>No members added yet.</p>
                            ) : (
                                <div className="d-flex flex-wrap gap-2 mt-1">
                                    {values.memberIds.map((m) => (
                                        <div
                                            key={m._id}
                                            className="d-flex align-items-center gap-1 px-2 py-1 rounded-pill"
                                            style={{ background: "#f1f2f7", fontSize: "0.8rem" }}
                                        >
                                            <Avatar name={m.employeeName} pic={m.profilePic} size={20} />
                                            <span>{m.employeeName}</span>
                                            <X
                                                size={13}
                                                style={{ cursor: "pointer" }}
                                                onClick={() =>
                                                    setValues({
                                                        ...values,
                                                        memberIds: values.memberIds.filter((x) => x._id !== m._id),
                                                    })
                                                }
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </ModalBody>
                    <ModalFooter className="p-3 border-top">
                        <Button color="light" type="button" onClick={toggle}>Cancel</Button>
                        <Button color="primary" type="submit" disabled={isLoading}>
                            {isLoading ? <Spinner size="sm" /> : "Save Team"}
                        </Button>
                    </ModalFooter>
                </form>
            </Modal>

            <MemberPickerModal
                isOpen={pickerOpen}
                toggle={() => setPickerOpen(false)}
                employees={employees}
                selectedIds={values.memberIds}
                onDone={(selected) => {
                    setValues({ ...values, memberIds: selected });
                    setPickerOpen(false);
                }}
            />
        </React.Fragment>
    );
};

const TeamsBoard = () => {
    const toast = useAlert();
    const { currentPagePermissions = { view: true, create: true, edit: true, delete: true } } = useContext(MenuContext) || {};
    const canEdit = currentPagePermissions.edit || currentPagePermissions.create;
    // Reporting-manager changes need the "edit" permission specifically —
    // having only "create" isn't enough to reassign someone's manager.
    const canEditManager = !!currentPagePermissions.edit;
    const invalidateTeams = useInvalidateTeams();
    const invalidateEmployees = useInvalidateEmployees();

    const { data: teams = [], isLoading: loading } = useTeams();
    const { data: employees = [] } = useEmployees();
    const [query, setQuery] = useState("");

    const [addOpen, setAddOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [membersOpen, setMembersOpen] = useState(false);
    const [membersTeam, setMembersTeam] = useState(null);

    const [chartOpen, setChartOpen] = useState(false);
    const [chartTeam, setChartTeam] = useState(null);

    const [allChartOpen, setAllChartOpen] = useState(false);

    const [profileOpen, setProfileOpen] = useState(false);
    const [profileMember, setProfileMember] = useState(null);
    const [profileTeamMembers, setProfileTeamMembers] = useState([]);
    // The combined "Organization Chart — All Teams" view is always read-only for
    // reporting manager, for everyone including admins — editing only happens
    // from a particular team's own Team Chart. True everywhere else.
    const [profileEditable, setProfileEditable] = useState(true);

    const [values, setValues] = useState(initialState);
    const [errors, setErrors] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const [editingId, setEditingId] = useState(null);
    const [removingId, setRemovingId] = useState(null);

    const filteredTeams = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return teams;
        return teams.filter((t) => t.teamName?.toLowerCase().includes(q));
    }, [teams, query]);

    // Merge every team's members into one deduped list for the combined org chart.
    // Someone on multiple teams appears once, tagged with each team they belong to.
    const allTeamsMembers = useMemo(() => {
        const byId = {};
        teams.forEach((team) => {
            const { bg, fg } = paletteFor(team.teamName);
            (team.memberIds || []).forEach((m) => {
                if (!byId[m._id]) byId[m._id] = { ...m, _teams: [] };
                if (!byId[m._id]._teams.some((t) => t.name === team.teamName)) {
                    byId[m._id]._teams.push({ name: team.teamName, bg, fg });
                }
            });
        });
        return Object.values(byId);
    }, [teams]);

    const resetForm = () => {
        setValues(initialState);
        setErrors({});
    };

    const validate = () => {
        const errs = {};
        if (!values.teamName.trim()) errs.teamName = "Team Name is required!";
        return errs;
    };

    const buildPayload = () => ({
        teamName: values.teamName,
        description: values.description,
        remark: values.remark,
        memberIds: values.memberIds.map((m) => m._id),
        isActive: true,
    });

    const openAdd = () => {
        resetForm();
        setAddOpen(true);
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        const errs = validate();
        setErrors(errs);
        if (Object.keys(errs).length > 0) return;

        setIsSubmitting(true);
        try {
            await createTeam(buildPayload());
            setAddOpen(false);
            resetForm();
            invalidateTeams();
            toast.success("Team created successfully!");
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed to create team");
        } finally {
            setIsSubmitting(false);
        }
    };

    const openEdit = (team) => {
        setEditingId(team._id);
        setValues({
            teamName: team.teamName || "",
            description: team.description || "",
            remark: team.remark || "",
            memberIds: (team.memberIds || []).map((m) => ({
                _id: m._id,
                employeeName: m.employeeName,
                profilePic: m.profilePic,
            })),
        });
        setErrors({});
        setEditOpen(true);
    };

    const handleUpdate = async (e) => {
        e.preventDefault();
        const errs = validate();
        setErrors(errs);
        if (Object.keys(errs).length > 0) return;

        setIsSubmitting(true);
        try {
            await updateTeam(editingId, buildPayload());
            setEditOpen(false);
            resetForm();
            setEditingId(null);
            invalidateTeams();
            toast.success("Team updated successfully!");
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed to update team");
        } finally {
            setIsSubmitting(false);
        }
    };

    const openMembers = (team) => {
        setMembersTeam(team);
        setMembersOpen(true);
    };

    const openChart = (team) => {
        setChartTeam(team);
        setChartOpen(true);
    };

    const openAllChart = () => {
        setAllChartOpen(true);
    };

    const openProfile = (member, teamMembers, editable = true) => {
        // `member` here is whatever the caller had on hand (often just the
        // thin { employeeName, profilePic } shape Team.memberIds populates
        // with) — swap in the FULL record from the employees list so
        // department/team/role/skills/phone actually show up.
        const full = (employees || []).find((e) => e._id === member._id) || member;
        const fullTeamMembers = (teamMembers || []).map(
            (m) => (employees || []).find((e) => e._id === m._id) || m
        );
        setProfileMember(full);
        setProfileTeamMembers(fullTeamMembers);
        setProfileEditable(editable);
        setProfileOpen(true);
    };

    const handleManagerChange = async (member, managerId) => {
        try {
            await updateReportingManager(member._id, managerId);
            toast.success(
                managerId
                    ? `Manager updated for ${member.employeeName}!`
                    : `Manager removed for ${member.employeeName}!`
            );
            invalidateTeams();
            invalidateEmployees();
            const newManagerIds = managerId ? [managerId] : [];
            // Keep the currently open team-members grid and the profile popup in sync
            // with the freshly-saved manager, without needing the user to reopen anything.
            setMembersTeam((prevTeam) => {
                if (!prevTeam) return prevTeam;
                const updatedMembers = (prevTeam.memberIds || []).map((m) =>
                    m._id === member._id ? { ...m, reportingManagerIds: newManagerIds } : m
                );
                return { ...prevTeam, memberIds: updatedMembers };
            });
            setProfileTeamMembers((prev) =>
                prev.map((m) => (m._id === member._id ? { ...m, reportingManagerIds: newManagerIds } : m))
            );
            setProfileMember((prev) => (prev ? { ...prev, reportingManagerIds: newManagerIds } : prev));
            setChartTeam((prevTeam) => {
                if (!prevTeam) return prevTeam;
                const updatedMembers = (prevTeam.memberIds || []).map((m) =>
                    m._id === member._id ? { ...m, reportingManagerIds: newManagerIds } : m
                );
                return { ...prevTeam, memberIds: updatedMembers };
            });
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed to update manager");
        }
    };

    const confirmDelete = (id) => {
        setRemovingId(id);
        setDeleteOpen(true);
    };

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            await deleteTeam(removingId);
            setDeleteOpen(false);
            invalidateTeams();
            toast.success("Team removed successfully!");
        } catch (err) {
            toast.error(err.response?.data?.message || "Failed to delete team");
        } finally {
            setIsDeleting(false);
        }
    };

    document.title = `Teams | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

    return (
        <React.Fragment>
            <div className="page-content">
                <Container fluid>
                    {/* Header */}
                    <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
                        <div>
                            <h4 className="mb-0">Teams</h4>
                        </div>
                        <div className="d-flex align-items-center gap-2">
                            <div className="position-relative">
                                <Search size={16} className="position-absolute" style={{ left: 10, top: 10, opacity: 0.5 }} />
                                <Input
                                    type="text"
                                    placeholder="Search teams..."
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    style={{ paddingLeft: 32, width: 220 }}
                                />
                            </div>
                            <Button
                                color="light"
                                className="d-flex align-items-center gap-1"
                                style={{ border: "1px solid #E5E7EB" }}
                                onClick={openAllChart}
                            >
                                <Network size={16} /> Org Chart
                            </Button>
                            {currentPagePermissions.create && (
                                <Button color="primary" className="d-flex align-items-center gap-1" onClick={openAdd}>
                                    <Plus size={16} /> Add Team
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Loading */}
                    {loading && (
                        <Card className="mb-0" style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #eef0f4" }}>
                            <div className="p-3">
                                {[0, 1, 2, 3].map((i) => (
                                    <div key={i} className="d-flex align-items-center gap-3 py-2">
                                        <div className="tb-skel" style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0 }} />
                                        <div className="flex-grow-1">
                                            <div className="tb-skel mb-1" style={{ width: "22%", height: 11 }} />
                                            <div className="tb-skel" style={{ width: "38%", height: 8 }} />
                                        </div>
                                        <div className="tb-skel" style={{ width: 90, height: 24, borderRadius: 6 }} />
                                    </div>
                                ))}
                            </div>
                            <style>{`
                                @keyframes tb-shimmer { 0% { background-position: -200px 0; } 100% { background-position: calc(200px + 100%) 0; } }
                                .tb-skel {
                                    background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 37%, #e5e7eb 63%);
                                    background-size: 400px 100%;
                                    animation: tb-shimmer 1.4s ease-in-out infinite;
                                    border-radius: 6px;
                                }
                            `}</style>
                        </Card>
                    )}

                    {/* Empty state */}
                    {!loading && filteredTeams.length === 0 && (
                        <Card>
                            <CardBody className="text-center text-muted py-5">
                                No teams found. {currentPagePermissions.create && 'Click "Add Team" to create one.'}
                            </CardBody>
                        </Card>
                    )}

                    {/* List */}
                    {!loading && filteredTeams.length > 0 && (
                        <Card className="mb-0" style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #eef0f4" }}>
                            <div className="table-responsive">
                                <Table className="mb-0 align-middle" hover>
                                    <thead style={{ background: "#f8fafc" }}>
                                        <tr>
                                            <th style={{ fontSize: "0.75rem", color: "#6B7280" }}>TEAM</th>
                                            <th style={{ fontSize: "0.75rem", color: "#6B7280" }}>TEAM LEAD</th>
                                            <th style={{ fontSize: "0.75rem", color: "#6B7280" }}>MEMBERS</th>
                                            <th style={{ fontSize: "0.75rem", color: "#6B7280" }} className="d-none d-md-table-cell">DESCRIPTION</th>
                                            <th style={{ fontSize: "0.75rem", color: "#6B7280", width: 90 }} className="text-end">ACTIONS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredTeams.map((team) => {
                                            const members = team.memberIds || [];
                                            const shown = members.slice(0, 4);
                                            const extra = members.length - shown.length;

                                            // The team's lead is whoever's Reporting Manager (set from
                                            // the profile popup) points to no one ELSE on this team —
                                            // matches "Top of the team (Team Lead)" in that dropdown.
                                            // Falls back to the legacy teamLeadId field for teams that
                                            // predate this and haven't had anyone's manager set yet.
                                            const memberIdSet = new Set(members.map((m) => m._id));
                                            const rootMembers = members.filter((m) => {
                                                const full = (employees || []).find((e) => e._id === m._id);
                                                const mgrIds = (full?.reportingManagerIds || []).map((x) => (typeof x === "object" ? x._id : x));
                                                return !mgrIds.some((id) => memberIdSet.has(id));
                                            });
                                            const derivedLead =
                                                rootMembers.length === 1 && members.length > 1
                                                    ? rootMembers[0]
                                                    : team.teamLeadId || null;

                                            return (
                                                <tr
                                                    key={team._id}
                                                    onClick={() => openMembers(team)}
                                                    style={{ cursor: "pointer" }}
                                                >
                                                    <td>
                                                        <div className="d-flex align-items-center gap-2">
                                                            <Avatar name={team.teamName} size={34} />
                                                            <span className="fw-semibold">{team.teamName}</span>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        {derivedLead ? (
                                                            <div className="d-flex align-items-center gap-2">
                                                                <Avatar name={derivedLead.employeeName} pic={derivedLead.profilePic} size={26} />
                                                                <span style={{ fontSize: "0.85rem" }}>{derivedLead.employeeName}</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-muted" style={{ fontSize: "0.8rem" }}>—</span>
                                                        )}
                                                    </td>
                                                    <td>
                                                        {members.length === 0 ? (
                                                            <span className="text-muted" style={{ fontSize: "0.8rem" }}>No members</span>
                                                        ) : (
                                                            <div className="d-flex align-items-center">
                                                                {shown.map((m, idx) => (
                                                                    <div key={m._id} style={{ marginLeft: idx === 0 ? 0 : -10 }}>
                                                                        <Avatar name={m.employeeName} pic={m.profilePic} size={28} border />
                                                                    </div>
                                                                ))}
                                                                {extra > 0 && (
                                                                    <div
                                                                        style={{
                                                                            marginLeft: -10,
                                                                            width: 28,
                                                                            height: 28,
                                                                            borderRadius: "50%",
                                                                            background: "#e4e6ec",
                                                                            color: "#555",
                                                                            fontSize: 10.5,
                                                                            fontWeight: 700,
                                                                            display: "flex",
                                                                            alignItems: "center",
                                                                            justifyContent: "center",
                                                                            border: "2px solid #fff",
                                                                        }}
                                                                    >
                                                                        +{extra}
                                                                    </div>
                                                                )}
                                                                <span className="text-muted ms-2" style={{ fontSize: "0.78rem" }}>
                                                                    {members.length} total
                                                                </span>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="d-none d-md-table-cell text-muted text-truncate" style={{ fontSize: "0.82rem", maxWidth: 260 }}>
                                                        {team.description || "—"}
                                                    </td>
                                                    <td className="text-end" onClick={(e) => e.stopPropagation()}>
                                                        <div className="d-flex justify-content-end gap-1">
                                                            {currentPagePermissions.edit && (
                                                                <button
                                                                    className="btn btn-sm btn-light btn-icon rounded-circle"
                                                                    title="Edit"
                                                                    onClick={() => openEdit(team)}
                                                                >
                                                                    <Pencil size={14} />
                                                                </button>
                                                            )}
                                                            {currentPagePermissions.delete && (
                                                                <button
                                                                    className="btn btn-sm btn-light btn-icon rounded-circle"
                                                                    title="Delete"
                                                                    onClick={() => confirmDelete(team._id)}
                                                                >
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
            </div>

            {/* Members view popup — opens when a team row is clicked */}
            <TeamMembersModal
                isOpen={membersOpen}
                toggle={() => setMembersOpen(false)}
                team={membersTeam}
                onMemberClick={openProfile}
                onShowChart={openChart}
            />

            {/* Team Chart popup — opens from the "Team Chart" button in the members view */}
            <TeamChartModal
                isOpen={chartOpen}
                toggle={() => setChartOpen(false)}
                team={chartTeam}
                onMemberClick={openProfile}
            />

            {/* Org Chart popup — opens from the "Org Chart" button in the page header, combines every
                team. Read-only by design: nobody, not even admins, can reassign a manager from here — 
                that only happens from a particular team's own Team Chart. */}
            <AllTeamsOrgChartModal
                isOpen={allChartOpen}
                toggle={() => setAllChartOpen(false)}
                members={allTeamsMembers}
                onMemberClick={(member, teamMembers) => openProfile(member, teamMembers, false)}
            />

            {/* Member profile popup — opens when a member tile is clicked; lets you set their manager,
                unless opened from the All-Teams Org Chart (profileEditable false) or the signed-in
                user lacks the "edit" permission on this page (canEditManager false). */}
            <MemberProfileModal
                isOpen={profileOpen}
                toggle={() => setProfileOpen(false)}
                member={profileMember}
                teamMembers={profileTeamMembers}
                allEmployees={employees}
                onManagerChange={handleManagerChange}
                canEdit={canEditManager && profileEditable}
            />

            {/* Add Modal */}
            <TeamFormModal
                isOpen={addOpen}
                toggle={() => { setAddOpen(false); resetForm(); }}
                title="Add Team"
                values={values}
                setValues={setValues}
                employees={employees}
                onSubmit={handleCreate}
                isLoading={isSubmitting}
                errors={errors}
            />

            {/* Edit Modal */}
            <TeamFormModal
                isOpen={editOpen}
                toggle={() => { setEditOpen(false); resetForm(); setEditingId(null); }}
                title="Edit Team"
                values={values}
                setValues={setValues}
                employees={employees}
                onSubmit={handleUpdate}
                isLoading={isSubmitting}
                errors={errors}
            />

            {/* Delete confirm */}
            <Modal isOpen={deleteOpen} toggle={() => setDeleteOpen(false)} centered>
                <ModalBody className="text-center py-4">
                    <div
                        className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle"
                        style={{ width: 56, height: 56, background: "#fde8e8" }}
                    >
                        <Trash2 size={24} className="text-danger" />
                    </div>
                    <h5>Are you sure?</h5>
                    <p className="text-muted mb-0">Do you really want to remove this team? This action cannot be undone.</p>
                </ModalBody>
                <ModalFooter className="border-top-0 justify-content-center pb-4">
                    <Button color="light" onClick={() => setDeleteOpen(false)} disabled={isDeleting}>Cancel</Button>
                    <Button color="danger" onClick={handleDelete} disabled={isDeleting}>
                        {isDeleting ? <Spinner size="sm" /> : "Yes, Delete It!"}
                    </Button>
                </ModalFooter>
            </Modal>
        </React.Fragment>
    );
};

export default TeamsBoard;