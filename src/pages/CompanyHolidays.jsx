import React, { useContext, useEffect, useRef, useState } from "react";
import { Container, Card, Input, Label, Button, Spinner, FormGroup } from "reactstrap";
import { CalendarOff, Pencil, Trash2, Plus, Repeat, CalendarDays, X } from "lucide-react";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import DeleteModal from "../Components/Common/DeleteModal";
import ConfirmAlert from "../Components/Common/ConfirmAlert";
import DatePicker from "../Components/DatePicker";
import {
    getCompanyHolidays,
    createCompanyHoliday,
    updateCompanyHoliday,
    deleteCompanyHoliday,
    getWeeklyOff,
    updateWeeklyOff,
} from "../api/companyHolidays.api";

const ACCENT = "#2563eb";

// Weekday values match Date#getDay() (0=Sunday..6=Saturday), the same
// convention server/models/CompanySettings.js stores weeklyOffDays in.
const WEEKDAYS = [
    { value: 0, label: "Sunday" },
    { value: 1, label: "Monday" },
    { value: 2, label: "Tuesday" },
    { value: 3, label: "Wednesday" },
    { value: 4, label: "Thursday" },
    { value: 5, label: "Friday" },
    { value: 6, label: "Saturday" },
];

const toDateStr = (v) => {
    if (!v) return "";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

// Recurring-yearly holidays only ever display their month/day (the year
// on the stored `date` is just whatever year it was first entered in —
// see server/models/CompanyHoliday.js) — showing that year back would
// read as "this holiday only applies in 2020", which isn't true.
const formatHolidayDate = (v, isRecurringYearly) => {
    if (!v) return "—";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString([], isRecurringYearly
        ? { day: "2-digit", month: "long", timeZone: "UTC" }
        : { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
};

/**
 * pages/CompanyHolidays.jsx
 * ───────────────────────────────────
 * Operator Management > Company Holidays — the global list of days the
 * company doesn't operate: a Weekly Off baseline (which weekday(s), if
 * any) plus specific named holidays (one-off or "every year"). Open to
 * any role granted access via Manage Role (see server/routes/
 * companyHoliday.routes.js), same permission model as Department/Role/
 * Operator — not a SuperAdmin-only platform setting.
 */
const CompanyHolidays = () => {
    const toast = useAlert();
    const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } = useContext(MenuContext) || {};

    const [holidays, setHolidays] = useState([]);
    const [loading, setLoading] = useState(true);

    const [weeklyOffDays, setWeeklyOffDays] = useState([]);
    const [weeklyOffLoading, setWeeklyOffLoading] = useState(true);
    const [savingDay, setSavingDay] = useState(null); // which weekday's toggle is mid-save
    const [confirmDay, setConfirmDay] = useState(null); // weekday awaiting add/remove confirmation, or null

    const [editing, setEditing] = useState(null); // holiday being edited, or null (inline form is in add mode)
    const [name, setName] = useState("");
    const [date, setDate] = useState("");
    const [isRecurringYearly, setIsRecurringYearly] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState("");
    const nameInputRef = useRef(null);
    const formCardRef = useRef(null);

    const [deleteTarget, setDeleteTarget] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);

    document.title = `Company Holidays | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

    const fetchHolidays = async () => {
        setLoading(true);
        try {
            const res = await getCompanyHolidays();
            setHolidays(res?.data?.data || []);
        } catch (err) {
            toast.error("Failed to load company holidays.");
        } finally {
            setLoading(false);
        }
    };

    const fetchWeeklyOff = async () => {
        setWeeklyOffLoading(true);
        try {
            const res = await getWeeklyOff();
            setWeeklyOffDays(res?.data?.data?.weeklyOffDays || []);
        } catch (err) {
            toast.error("Failed to load Weekly Off.");
        } finally {
            setWeeklyOffLoading(false);
        }
    };

    useEffect(() => { fetchHolidays(); fetchWeeklyOff(); }, []);

    // Confirmed via a popup first, then saves. Optimistic UI (flips
    // instantly, rolls back on failure) since it's a small enough write to
    // not need a pending spinner state on the whole row.
    const doToggleWeeklyOffDay = async (day) => {
        const next = weeklyOffDays.includes(day) ? weeklyOffDays.filter((d) => d !== day) : [...weeklyOffDays, day];
        const prev = weeklyOffDays;
        setWeeklyOffDays(next);
        setSavingDay(day);
        try {
            await updateWeeklyOff(next);
        } catch (err) {
            setWeeklyOffDays(prev);
            toast.error(err?.response?.data?.message || "Could not update Weekly Off.");
        } finally {
            setSavingDay(null);
        }
    };

    const confirmingAdd = confirmDay !== null && !weeklyOffDays.includes(confirmDay);
    const confirmDayLabel = confirmDay !== null ? WEEKDAYS.find((d) => d.value === confirmDay)?.label : "";

    const resetForm = () => {
        setEditing(null);
        setName("");
        setDate("");
        setIsRecurringYearly(false);
        setError("");
    };

    // Clicking a row's pencil loads it into the one always-visible form
    // above instead of opening a separate dialog — same form, just
    // switches from "Add" to "Update" mode (see handleSave).
    const openEdit = (holiday) => {
        setEditing(holiday);
        setName(holiday.name);
        setDate(toDateStr(holiday.date));
        setIsRecurringYearly(!!holiday.isRecurringYearly);
        setError("");
        formCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        nameInputRef.current?.focus();
    };

    // Enter-to-submit fallback: the MUI DatePicker's text field binds its
    // own keydown handling directly on the input (for arrow-key section
    // navigation), which can swallow the Enter keypress before the plain
    // <form onSubmit> ever sees it as a native submit. Listening in the
    // CAPTURE phase on the form fires before that inner handler gets a
    // chance to stop it, so Enter reliably saves from either field. The
    // MUI calendar popup itself is rendered in a portal outside this form,
    // so its own Enter-to-pick-a-day handling is untouched by this.
    const handleFormKeyDownCapture = (e) => {
        if (e.key !== "Enter" || e.target?.tagName === "BUTTON" || e.target?.type === "checkbox") return;
        e.preventDefault();
        if (!isSaving && name.trim() && date) handleSave(e);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!name.trim()) { setError("Name is required."); return; }
        if (!date) { setError("Date is required."); return; }
        setIsSaving(true);
        try {
            const payload = { name: name.trim(), date, isRecurringYearly };
            if (editing) {
                await updateCompanyHoliday(editing._id, payload);
                toast.success("Holiday updated.");
                resetForm();
            } else {
                const res = await createCompanyHoliday(payload);
                toast.success(res?.data?.message || "Holiday added.");
                // Add-add-add: the form stays right here, just clears and
                // hands focus back to Name so the next one can be typed
                // straight away — no dialog to reopen each time. Editing
                // an existing one (the `if` branch above) is a single
                // deliberate action instead, so that resets fully and
                // drops back to add mode.
                setName("");
                setDate("");
                setIsRecurringYearly(false);
                setError("");
                nameInputRef.current?.focus();
            }
            fetchHolidays();
        } catch (err) {
            setError(err?.response?.data?.message || "Could not save. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);
        try {
            await deleteCompanyHoliday(deleteTarget._id);
            toast.success(`"${deleteTarget.name}" deleted.`);
            setDeleteTarget(null);
            fetchHolidays();
        } catch (err) {
            toast.error(err?.response?.data?.message || "Could not delete.");
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="page-content">
            <Container fluid>
                <div
                    className="d-flex flex-wrap align-items-center gap-3 mb-4 p-3"
                    style={{ borderRadius: 16, background: "var(--panel-bg)", border: "1px solid var(--panel-border)", boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}
                >
                    <div className="d-flex align-items-center gap-2">
                        <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg,#2563eb,#3b82f6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <CalendarOff size={19} color="#fff" />
                        </div>
                        <div>
                            <h5 className="mb-0" style={{ color: "var(--panel-text)", fontWeight: 800 }}>Company Holidays</h5>
                            <div className="text-muted" style={{ fontSize: "0.78rem" }}>Weekly Off + specific dates the company doesn't operate</div>
                        </div>
                    </div>
                </div>

                <Card className="mb-4 p-3" style={{ borderRadius: 12, border: "1px solid #eef0f4" }}>
                    <div className="d-flex align-items-center gap-2 mb-1">
                        <CalendarDays size={16} style={{ color: ACCENT }} />
                        <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--panel-text)" }}>Weekly Off</span>
                    </div>
                    <p className="text-muted mb-3" style={{ fontSize: "0.78rem" }}>
                        Day(s) the company doesn't operate at all, every week.
                    </p>
                    {weeklyOffLoading ? (
                        <Spinner size="sm" />
                    ) : (
                        <div className="d-flex gap-2 flex-wrap">
                            {WEEKDAYS.map((d) => {
                                const active = weeklyOffDays.includes(d.value);
                                return (
                                    <button
                                        key={d.value}
                                        type="button"
                                        disabled={savingDay !== null || !currentPagePermissions.edit}
                                        onClick={() => setConfirmDay(d.value)}
                                        className="btn btn-sm"
                                        style={{
                                            borderRadius: 999,
                                            border: active ? "1.5px solid #dc2626" : "1px solid var(--panel-border)",
                                            background: active ? "#fef2f2" : "var(--panel-bg)",
                                            color: active ? "#b91c1c" : "var(--panel-text-muted)",
                                            fontWeight: 600,
                                            opacity: savingDay !== null && savingDay !== d.value ? 0.6 : 1,
                                            minWidth: 56,
                                        }}
                                    >
                                        {savingDay === d.value ? <Spinner size="sm" style={{ width: 12, height: 12 }} /> : d.label}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </Card>

                {(currentPagePermissions.create || editing) && (
                    <Card innerRef={formCardRef} className="mb-4 p-3" style={{ borderRadius: 12, border: editing ? "1.5px solid #2563eb" : "1px solid #eef0f4" }}>
                        <div className="d-flex align-items-center gap-2 mb-3">
                            <CalendarOff size={16} style={{ color: ACCENT }} />
                            <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--panel-text)" }}>{editing ? `Editing "${editing.name}"` : "Add Holiday"}</span>
                            {editing && (
                                <button
                                    type="button"
                                    onClick={resetForm}
                                    className="ms-auto btn btn-sm d-flex align-items-center gap-1"
                                    style={{ color: "var(--panel-text-muted)", fontSize: "0.78rem" }}
                                >
                                    <X size={13} />Cancel
                                </button>
                            )}
                        </div>
                        <form onSubmit={handleSave} onKeyDownCapture={handleFormKeyDownCapture}>
                            <div className="row g-3 align-items-end">
                                <div className="col-12 col-md-4">
                                    <Label className="fw-medium mb-1" for="holiday-name" style={{ fontSize: "0.82rem" }}>Name <span className="text-danger">*</span></Label>
                                    <Input
                                        id="holiday-name"
                                        innerRef={nameInputRef}
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="e.g. Independence Day"
                                    />
                                </div>
                                <div className="col-12 col-md-3">
                                    <Label className="fw-medium mb-1" for="holiday-date" style={{ fontSize: "0.82rem" }}>Date <span className="text-danger">*</span></Label>
                                    <DatePicker id="holiday-date" value={date} onChange={(e) => setDate(e.target.value)} />
                                </div>
                                <div className="col-12 col-md-3">
                                    <FormGroup check className="mb-0" style={{ paddingBottom: 6 }}>
                                        <Input
                                            type="checkbox"
                                            id="holiday-recurring-yearly"
                                            checked={isRecurringYearly}
                                            onChange={(e) => setIsRecurringYearly(e.target.checked)}
                                        />
                                        <Label check for="holiday-recurring-yearly" className="ms-1" style={{ fontSize: "0.85rem" }}>
                                            Repeats every year
                                        </Label>
                                    </FormGroup>
                                </div>
                                <div className="col-12 col-md-2">
                                    <Button color="primary" type="submit" className="w-100 d-flex align-items-center justify-content-center gap-1" disabled={isSaving || !name.trim() || !date}>
                                        {isSaving ? <Spinner size="sm" /> : (editing ? "Update" : <><Plus size={15} />Save</>)}
                                    </Button>
                                </div>
                            </div>
                            <p className="text-muted mt-2 mb-0" style={{ fontSize: "0.74rem" }}>
                                {editing
                                    ? "Untick \"Repeats every year\" for a one-off day (e.g. a specific plant shutdown)."
                                    : "Save keeps this ready for the next one — name, date, tab, Save, repeat."}
                            </p>
                            {error && <div className="text-danger mt-2" style={{ fontSize: "0.82rem" }}>{error}</div>}
                        </form>
                    </Card>
                )}

                {loading ? (
                    <div className="text-center py-5"><Spinner size="sm" /></div>
                ) : holidays.length === 0 ? (
                    <Card className="p-5 text-center text-muted mb-0">
                        No holidays configured yet.
                    </Card>
                ) : (
                    <Card className="mb-0" style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #eef0f4" }}>
                        <div className="d-flex flex-column">
                            {holidays.map((holiday, i) => (
                                <div
                                    key={holiday._id}
                                    className="d-flex align-items-center gap-3 p-3"
                                    style={{ borderBottom: i === holidays.length - 1 ? "none" : "1px solid var(--panel-border)" }}
                                >
                                    <span
                                        style={{
                                            width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                                            background: `${ACCENT}1f`, color: ACCENT,
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                        }}
                                    >
                                        <CalendarOff size={17} />
                                    </span>
                                    <div className="flex-grow-1" style={{ minWidth: 0 }}>
                                        <div className="d-flex align-items-center gap-2 flex-wrap">
                                            <span style={{ fontWeight: 700, fontSize: "0.92rem", color: "var(--panel-text)" }}>{holiday.name}</span>
                                            {holiday.isRecurringYearly && (
                                                <span
                                                    className="d-inline-flex align-items-center gap-1"
                                                    style={{ fontSize: "0.68rem", fontWeight: 700, color: "#7c3aed", background: "#7c3aed1a", borderRadius: 999, padding: "2px 8px" }}
                                                >
                                                    <Repeat size={11} />Every year
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-muted" style={{ fontSize: "0.8rem" }}>{formatHolidayDate(holiday.date, holiday.isRecurringYearly)}</div>
                                    </div>
                                    <div className="d-flex align-items-center gap-1 flex-shrink-0">
                                        {currentPagePermissions.edit && (
                                            <button
                                                type="button"
                                                onClick={() => openEdit(holiday)}
                                                title="Edit"
                                                style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "#16a34a1f", color: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center" }}
                                            >
                                                <Pencil size={13} />
                                            </button>
                                        )}
                                        {currentPagePermissions.delete && (
                                            <button
                                                type="button"
                                                onClick={() => setDeleteTarget(holiday)}
                                                title="Delete"
                                                style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "#e11d481f", color: "#e11d48", display: "flex", alignItems: "center", justifyContent: "center" }}
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                )}
            </Container>

            <ConfirmAlert
                isOpen={confirmDay !== null}
                variant={confirmingAdd ? "warning" : "info"}
                title={confirmingAdd ? `Mark ${confirmDayLabel} as Weekly Off?` : `Remove ${confirmDayLabel} from Weekly Off?`}
                message={
                    confirmingAdd
                        ? `${confirmDayLabel} will be treated as a company holiday every week, going forward.`
                        : `${confirmDayLabel} will no longer be treated as a company holiday.`
                }
                confirmText={confirmingAdd ? "Yes, mark as off" : "Yes, remove"}
                cancelText="Cancel"
                onConfirm={() => {
                    const day = confirmDay;
                    setConfirmDay(null);
                    doToggleWeeklyOffDay(day);
                }}
                onCancel={() => setConfirmDay(null)}
            />

            <DeleteModal
                show={!!deleteTarget}
                handleDelete={handleDelete}
                toggle={() => setDeleteTarget(null)}
                disabled={isDeleting}
                title="Delete this holiday?"
                message={`"${deleteTarget?.name}" will be permanently deleted.`}
                confirmLabel="Delete"
                confirmingLabel="Deleting..."
            />
        </div>
    );
};

export default CompanyHolidays;
