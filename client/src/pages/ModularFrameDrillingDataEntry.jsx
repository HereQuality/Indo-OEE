import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useReviewAccess } from "../hooks/useReviewAccess";
import { entryLinkRange, useOpenEntryFromLink } from "../hooks/useOpenEntryFromLink";
import { Plus, Search } from "lucide-react";
import { Card, CardBody, CardHeader, Container, Input, Modal, ModalBody, ModalFooter, ModalHeader } from "reactstrap";
import DeleteModal from "../Components/Common/DeleteModal";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import ProductionEntriesTable, { emptyEntriesText } from "../Components/Production/ProductionEntriesTable";
import { MFD_COLUMNS } from "../Components/Production/mfdColumns";
import MfdEntryForm from "../Components/Production/MfdEntryForm";
import NumberInput from "../Components/Production/NumberInput";
import FilterPanel from "../Components/ProcessDashboard/FilterPanel";
import "../Components/ProcessDashboard/processDashboard.css";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useMachines } from "../hooks/useMachines";
import { useProcesses } from "../hooks/useProcesses";
import { useItems } from "../hooks/useItems";
import { useMachineOperators } from "../hooks/useMachineOperators";
import { useVendors } from "../hooks/useVendors";
import { anyVendorFor } from "../utils/vendorsFor";
import {
  deleteMfdRow,
  getMfdExtent,
  getMfdFilterOptions,
  getMfdOccupiedTimes,
  getMfdOperatorOccupied,
  getMfdSheet,
  saveMfdRow,
  unlockMfdRow,
} from "../api/mfdSheet.api";
import { STOPPAGE_FIELDS, isoDay, sortByMachineOn } from "../utils/productionSheet";
import { MFD_FORMULAS, MFD_MAX_SLOTS, mfdDayCalc, mfdRowCalc } from "../utils/mfdSheet";
import { firstMfdError, validateMfdEntry } from "../utils/mfdValidation";
import { firstOverLimit } from "../utils/limitNotice";
import { quantityFormValues } from "../utils/quantityRules";
import { bookedRanges, isTimeRuleMessage, operatorOverlapErrors, slotsFullErrors } from "../utils/entryValidation";
import { guardEscape } from "../utils/modalEscape";
import { DIMENSIONS, EMPTY_FILTERS, applyFilters, defaultEntryRange, hasFilters } from "../utils/processDashboard";
import { getCompanyHolidays, getWeeklyOff } from "../api/companyHolidays.api";
import { LOCK_WORKING_DAYS, getLockDeadline } from "../utils/workingDays";
import { hmToWireHours, hoursToShiftInput, parseShiftHours } from "../utils/shiftHours";
import { shiftSettingForMachine } from "../utils/plannedShift";

/**
 * MODULAR FRAME DRILLING Data Entry — the MODULAR FRAME DRILLING sheet's
 * records, and one form per record.
 *
 * InjectionDataEntry's twin: the same list with its filters and paging, the
 * same Add/Edit form behaviour, the same two-working-day lock and Super Admin
 * unlock — over this sheet's own data (/mfd-sheet) and columns. A record is
 * keyed by (date, machine, entry no.); the entry no. is assigned by the server
 * (slot "auto") and machine stays locked while editing, because changing it
 * would move the record to a different key.
 *
 * Its own: up to MFD_MAX_SLOTS entries per machine per date, which MAY overlap
 * in time (two jobs on one drilling machine at once — the paper does), so
 * there's no machine overlap check, only an operator on two machines at once.
 *
 * The figures live in utils/mfdSheet.js (the CNC formulas with this sheet's
 * own IDEAL Quantity, every entry worked out on its own — entryDayCalc) and the
 * rules in utils/mfdValidation.js, so the form's grey boxes, the table and the
 * Save button can't disagree. No Rejection Master: the paper has no reject
 * reasons.
 */

const STOPPAGE_KEYS = STOPPAGE_FIELDS.map((f) => f.key);
const TEXT_FIELDS = ["operator", "itemName", "drawingNo", "operation", "remarks", "otherMinRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime", "settingOnTime", "settingOffTime"];
const NUMBER_FIELDS = ["noOfHoles", "strokeRequired", "totalCycleSec", "actualQty", "okQty", "plannedOperatorShiftHours", ...STOPPAGE_KEYS];

// Add-entry drafts: typing gets saved to localStorage the moment the form is
// closed (Cancel, the X, Escape) so an accidental close doesn't lose it.
// Reopening "Add Entry" within a minute brings it back; after that (or on a
// successful Save) it's gone, so the form doesn't come back stale hours later.
const DRAFT_KEY = "mfdEntryDraft";
const DRAFT_TTL_MS = 60 * 1000;

const hasAnyEntryData = (list) =>
  list.some((v) => {
    if (v.machine) return true;
    return [...TEXT_FIELDS, ...TIME_FIELDS, ...NUMBER_FIELDS].some((k) => v[k] !== "" && v[k] !== undefined && v[k] !== null);
  });

const loadDraft = () => {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.entries?.length || Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      window.localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return parsed.entries;
  } catch {
    return null;
  }
};

const saveDraft = (entries) => {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ entries, savedAt: Date.now() }));
  } catch {
    // localStorage unavailable (private mode, quota) — the draft is just skipped.
  }
};

const clearDraft = () => {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
};

const emptyEntry = () => ({
  date: isoDay(new Date()),
  machine: "",
  // Reasons For Not Working — any of Machine Breakdown / No Manpower / No Planning.
  machineStatus: [],
  // Working (default) or Non Working — see utils/productionSheet.js.
  workingMode: "Working",
  // Assigned on save from the machine's free slots for that date; kept in the
  // values only because an edited record has to save back to its own slot.
  slot: 1,
  item: "",
  // Vendor Name — offered only when the machine's process has vendors (Vendor Master).
  vendor: "",
  vendorName: "",
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, ""])),
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, ""])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, ""])),
});

// A saved record -> form values ("" for anything unset, so inputs stay controlled).
const toFormValues = (row) => ({
  ...emptyEntry(),
  ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)),
  item: row.item || "",
  slot: row.slot,
  // Actual Quantity — no Rejection Master split on this sheet.
  actualQty: quantityFormValues(row).actualQty,
  // A stored shift is decimal hours; the box shows it as the sheet writes it (5 h 20 min → "5.33").
  plannedOperatorShiftHours: hoursToShiftInput(row.plannedOperatorShiftHours),
});

// A Non Working day keeps just its status, Operator and Remarks — anything
// typed in the hidden production boxes before it was picked is sent blank, so
// it's never saved.
const STATUS_ONLY_KEPT = ["operator", "workingMode", "machineStatus", "remarks"];
const toPayload = (v, isEdit) => {
  const body = toFullPayload(v, isEdit);
  if (v.workingMode !== "Non Working") return body;
  return Object.fromEntries(
    Object.entries(body).map(([k, val]) =>
      ["_id", "date", "machine", "slot", ...STATUS_ONLY_KEPT].includes(k) ? [k, val] : [k, k === "item" ? null : ""],
    ),
  );
};

// Form values -> request body. "" tells the server to unset that field.
const toFullPayload = (v, isEdit) => ({
  // Tells the server which exact document this edit belongs to, so changing
  // Date moves that document instead of leaving it behind and quietly creating
  // a second one — absent on a new entry, which has no document yet.
  ...(isEdit && v._id ? { _id: v._id } : {}),
  date: v.date,
  machine: v.machine,
  // Status belongs to a Non Working day only; a Working entry carries none.
  machineStatus: v.workingMode === "Non Working" ? v.machineStatus || [] : [],
  workingMode: v.workingMode || "Working",
  // An edited record saves back to its own slot; a new one asks the server for
  // the machine's next free slot on that date, since only the server can see
  // every entry — the page may be filtered to one machine.
  slot: isEdit ? Number(v.slot) : "auto",
  item: v.item || null,
  vendor: v.vendor || null,
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, String(v[k] ?? "").trim()])),
  // A remark only belongs to an "Others" that is still in use — once that figure
  // goes back to zero the remark is cleared with it.
  otherMinRemark: Number(v.otherMin) > 0 ? String(v.otherMinRemark ?? "").trim() : "",
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, v[k] ?? ""])),
  // rejectedQty is never sent — the server works it out (Actual − OK).
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, v[k] === "" || v[k] === undefined ? "" : Number(v[k])])),
  // Typed as decimal hours like the sheet, taken to the whole minute (5.33 → 5 h 20 min).
  plannedOperatorShiftHours: (() => {
    const { hours } = parseShiftHours(v.plannedOperatorShiftHours);
    return hours === null ? "" : hmToWireHours(hours);
  })(),
  // Lunch is optional on the form; the server wants a 0 rather than nothing.
  lunchMin: v.lunchMin === "" || v.lunchMin === undefined ? 0 : Number(v.lunchMin),
});

// The part's Drawing No., Process, No. of Holes, Stroke Required and Total
// Cycle Time, as an entry carries them — the cycle time only as a starting
// value, editable for the day — so a later change to the master never rewrites
// saved records.
const withPart = (v, it) => ({
  ...v,
  item: it._id,
  itemName: it.itemName,
  drawingNo: it.drawingNo || "",
  operation: it.mfdOperation || "",
  noOfHoles: it.noOfHoles ?? "",
  strokeRequired: it.strokeRequired ?? "",
  totalCycleSec: it.totalCycleSec ?? "",
});
const NO_PART = { item: "", itemName: "", drawingNo: "", operation: "", noOfHoles: "", strokeRequired: "", totalCycleSec: "" };

const ModularFrameDrillingDataEntry = () => {
  const toast = useAlert();
  const { currentPagePermissions, isAdmin: isSuperAdmin } = useContext(MenuContext) || {};
  // Super Admin or a Full access role — the people who can unlock a locked entry.
  const { canReview } = useReviewAccess();
  const isAdmin = !!isSuperAdmin || canReview;
  const canCreate = currentPagePermissions ? !!currentPagePermissions.create : true;
  const canEdit = currentPagePermissions ? !!currentPagePermissions.edit : true;
  const canDelete = currentPagePermissions ? !!currentPagePermissions.delete : true;

  // ── Entry lock (2 working days) ───────────────────────────────────────
  // Preview only — see utils/workingDays.js's file comment. The server
  // (mfdSheet.controller.js) re-checks this on every Save/Delete/Unlock. A row
  // carrying an active `unlockedUntil` is never locked here, for anyone.
  const [holidays, setHolidays] = useState([]);
  const [weeklyOffDays, setWeeklyOffDays] = useState([0]);
  useEffect(() => {
    getCompanyHolidays().then((res) => setHolidays(res?.data?.data || [])).catch(() => setHolidays([]));
    getWeeklyOff().then((res) => setWeeklyOffDays(res?.data?.data?.weeklyOffDays || [0])).catch(() => {});
  }, []);
  // The window counts from when the row was actually saved (createdAt), not
  // its own Date — a catch-up entry for an old date gets its own fresh 2
  // working days starting from the moment it's created.
  const lockInfo = useCallback(
    (row) => {
      if (row.unlockedUntil && new Date(row.unlockedUntil) > new Date()) return "";
      const created = row.createdAt ? new Date(row.createdAt) : null;
      if (!created || Number.isNaN(created.getTime())) return "";
      // Both days in UTC, as the server's own check counts them.
      const asOf = new Date().toISOString().slice(0, 10);
      const deadline = getLockDeadline(created.toISOString().slice(0, 10), weeklyOffDays, holidays, LOCK_WORKING_DAYS);
      if (asOf <= deadline) return "";
      const [y, m, d] = deadline.split("-");
      return `Locked — saved more than ${LOCK_WORKING_DAYS} working days ago (editable through ${d}/${m}/${y})`;
    },
    [weeklyOffDays, holidays],
  );

  // The process's fixed Operator Planned Shift for a row (null when its hours are typed on each entry),
  // and the Full access button that moves one earlier entry onto it.
  const currentShiftOf = (row) => ((row.machine ? shiftSettingForMachine(row.machine, machines, processes) : null)?.hours ?? null);
  // Done with a batch of ticked rows (utils in the table): say how it went and reload.
  const handleBulkDone = useCallback(({ type, message }) => {
    toast[type](message);
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [unlockingId, setUnlockingId] = useState(null);
  const handleUnlock = useCallback(
    (row) => {
      setUnlockingId(row._id);
      unlockMfdRow(row._id)
        .then((res) => {
          toast.success(res?.data?.message || "Unlocked for 24 hours");
          fetchRows();
        })
        .catch((err) => toast.error(err?.response?.data?.message || "Could not unlock this entry"))
        .finally(() => setUnlockingId(null));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // One Filters button holds everything that slices the sheet — period,
  // Machine, Operator, Part — the same panel the process dashboards use.
  // Search stays its own field beside it.
  const [range, setRange] = useState(() => entryLinkRange(defaultEntryRange));
  const [baseRange, setBaseRange] = useState(range);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, toDate] = range;

  // Paginated by date on the server (getSheet in mfdSheet.controller.js).
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalDays, setTotalDays] = useState(0);
  // Blank by default — the field shows the current page only as a placeholder.
  const [goTo, setGoTo] = useState("");

  const { data: machines = [] } = useMachines();
  const { data: processes = [] } = useProcesses();
  const { data: items = [] } = useItems();
  const { data: operators = [] } = useMachineOperators();
  const { data: vendors = [] } = useVendors();

  // Whichever process (Production › Processes) names *this* page as its own
  // Data Entry Page — matched on the route path with any role-slug prefix
  // stripped. Exactly one match narrows the Machine picker to that process's
  // own machines; none or more than one falls back to every machine.
  const location = useLocation();
  const lockedProcess = useMemo(() => {
    const stripSlug = (p) => p.replace(/^\/[^/]+/, "");
    const here = stripSlug(location.pathname);
    const owners = processes.filter((p) => p.dataEntryMenu && stripSlug(p.dataEntryMenu) === here);
    return owners.length === 1 ? owners[0] : null;
  }, [processes, location.pathname]);

  const scopedMachines = useMemo(
    () => (lockedProcess ? machines.filter((m) => String(m.process || "") === String(lockedProcess._id)) : machines),
    [machines, lockedProcess],
  );

  // Parts follow the same scoping: this process's parts, plus any part not
  // given a process yet. Not linked: every part.
  const scopedItems = useMemo(
    () => (lockedProcess ? items.filter((it) => !it.process || String(it.process) === String(lockedProcess._id)) : items),
    [items, lockedProcess],
  );

  // null = closed, "add" | "edit"
  const [modalMode, setModalMode] = useState(null);
  // One entry per block in the form; adding starts with a single block.
  const [entries, setEntries] = useState(() => [emptyEntry()]);
  const [isSubmit, setIsSubmit] = useState(false);
  // Set by a failed Save: the first incomplete entry and field, for the form to
  // scroll to. The nonce makes pressing Save again scroll again.
  const [focusTarget, setFocusTarget] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // What each machine in the form already has on its date, keyed
  // "machine|date" — asked of the server once per pair while the form is open,
  // for the "already has" hint and the MFD_MAX_SLOTS limit (overlapping times
  // are allowed on this sheet). `editing` is the row being edited.
  const [occupied, setOccupied] = useState({});
  const occupiedAsked = useRef(new Set());
  const [editing, setEditing] = useState(null);
  // Likewise what each OPERATOR already has on a date, on any machine
  // ("operator|date"), so the same operator can't be put on two machines at once.
  const [operatorOccupied, setOperatorOccupied] = useState({});
  const operatorAsked = useRef(new Set());
  const resetOccupied = useCallback(() => {
    occupiedAsked.current.clear();
    operatorAsked.current.clear();
    setOccupied({});
    setOperatorOccupied({});
  }, []);

  const [removeId, setRemoveId] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // The machine list is active machines only; the server sends the names of
  // every machine the loaded rows (and the Filters panel) mention.
  const [serverMachineNames, setServerMachineNames] = useState({});
  const machineName = useMemo(
    () => ({ ...serverMachineNames, ...Object.fromEntries(machines.map((m) => [m._id, m.machineName])) }),
    [machines, serverMachineNames],
  );
  // Editing a row whose machine is no longer in the (active) list still shows
  // that machine's name in the locked Machine box.
  const formMachines = useMemo(
    () =>
      modalMode === "edit" && editing?.machine && !scopedMachines.some((m) => m._id === editing.machine)
        ? [...scopedMachines, { _id: editing.machine, machineName: machineName[editing.machine] || "—" }]
        : scopedMachines,
    [modalMode, editing, scopedMachines, machineName],
  );
  // Where each machine sits in the sheet order Super Admin sets in Machine Master.
  const machineRank = useMemo(() => Object.fromEntries(machines.map((m, i) => [m._id, i])), [machines]);
  const rankOf = useCallback((id) => machineRank[id] ?? Number.MAX_SAFE_INTEGER, [machineRank]);

  // ── Load ───────────────────────────────────────────────────────────────
  const validRange = !!fromDate && !!toDate && fromDate <= toDate;

  const fetchRows = useCallback(() => {
    if (!validRange) return;
    setLoading(true);
    getMfdSheet({ from: fromDate, to: toDate, page, machine: filters.machine, operator: filters.operator, item: filters.item })
      .then((res) => {
        setRows(res.data.data || []);
        setServerMachineNames((n) => ({ ...n, ...(res.data.machineNames || {}) }));
        const meta = res.data.meta || {};
        setTotalPages(Math.max(1, meta.totalPages || 1));
        setTotalDays(meta.totalDays || 0);
        // The server clamps an out-of-range page to its own last page.
        if (meta.page && meta.page !== page) setPage(meta.page);
      })
      .catch((err) => {
        toast.error(err?.response?.data?.message || "Failed to load entries");
        setRows([]);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, page, filters.machine, filters.operator, filters.item, validRange]);

  useEffect(() => {
    if (!validRange) {
      toast.error("From Date must be on or before To Date");
      return;
    }
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, page, filters.machine, filters.operator, filters.item]);

  // The date range this sheet actually has data in, for the Filters panel's Year tab.
  const [extent, setExtent] = useState(null);
  useEffect(() => {
    getMfdExtent()
      .then((res) => setExtent(res?.data?.data || null))
      .catch(() => setExtent(null));
  }, []);

  // What the Filters panel's Machine/Operator/Part pickers offer: the values
  // present anywhere in the selected date range, plus anything already picked.
  const ctx = useMemo(() => ({ machineName }), [machineName]);
  const [rangeFilterValues, setRangeFilterValues] = useState({ machine: [], operator: [], item: [] });
  useEffect(() => {
    if (!validRange) return;
    getMfdFilterOptions({ from: fromDate, to: toDate })
      .then((res) => {
        setRangeFilterValues(res?.data?.data || { machine: [], operator: [], item: [] });
        setServerMachineNames((n) => ({ ...n, ...(res?.data?.machineNames || {}) }));
      })
      .catch(() => {});
  }, [fromDate, toDate, validRange]);

  const filterOptions = useMemo(() => {
    const options = (dim) =>
      [...new Set([...(rangeFilterValues[dim] || []), ...filters[dim]])]
        .map((value) => ({ value, label: DIMENSIONS[dim].text(value, ctx) }))
        .sort((a, b) => (dim === "machine" ? rankOf(a.value) - rankOf(b.value) : 0) || a.label.localeCompare(b.label, undefined, { numeric: true }));
    return { machine: options("machine"), operator: options("operator"), item: options("item") };
  }, [rangeFilterValues, ctx, filters, rankOf]);

  // Page resets to 1 alongside the filter/range change itself, so the sheet
  // fetches page 1 of the new selection exactly once.
  const onFilterSet = useCallback((dim, values) => {
    setFilters((f) => ({ ...f, [dim]: values }));
    setPage(1);
    setGoTo("");
  }, []);
  const onRangeChange = useCallback((next) => {
    setRange(next);
    setPage(1);
    setGoTo("");
  }, []);
  const isDefaultRange = range.join() === baseRange.join();
  const filtersActive = !isDefaultRange || hasFilters(filters);
  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    const fresh = defaultEntryRange();
    setBaseRange(fresh);
    setRange(fresh);
    setPage(1);
    setGoTo("");
  };

  // This page's own rows only — Operator/Part still narrow the view here.
  const filteredRows = useMemo(() => applyFilters(rows, filters), [rows, filters]);

  // Newest date first, machines in Machine Master's order, and a machine's
  // entries by Machine Time ON (overlapping entries read in the order they started).
  const sortedRows = useMemo(() => {
    const onOf = (r) => (/^\d{2}:\d{2}$/.test(r.machineOnTime || "") ? r.machineOnTime : "99:99");
    return [...filteredRows].sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        rankOf(a.machine) - rankOf(b.machine) ||
        (machineName[a.machine] || "").localeCompare(machineName[b.machine] || "", undefined, { numeric: true }) ||
        onOf(a).localeCompare(onOf(b)) ||
        a.slot - b.slot,
    );
  }, [filteredRows, machineName, rankOf]);

  // A page that isn't there (0, or past the last) goes to the nearest one that is, and says so.
  const goToPage = () => {
    if (goTo === "") return;
    const n = Number(goTo);
    if (!Number.isInteger(n)) {
      toast.warning(`Enter a page number from 1 to ${totalPages}.`);
    } else if (n < 1 || n > totalPages) {
      const nearest = Math.min(Math.max(n, 1), totalPages);
      toast.warning(`There's no page ${n} — showing page ${nearest} of ${totalPages}.`);
      setPage(nearest);
    } else {
      setPage(n);
    }
    setGoTo("");
  };

  // Each entry's own OEE / Unreported figures (mfdDayCalc → entryDayCalc: per
  // entry, or combined across the machine's date on a locked 12 h shift), one
  // result per row — keyed by that record's own id, not by machine+date.
  const dayResultByKey = useMemo(() => {
    const groups = {};
    for (const r of rows) (groups[`${r.machine}|${r.date}`] ||= []).push(r);
    const out = {};
    for (const group of Object.values(groups)) {
      // entryDayCalc sorts by Machine ON Time internally; sorted the same way
      // here (via the same helper) so result i still lines up with sorted[i].
      const sorted = sortByMachineOn(group);
      const results = mfdDayCalc(sorted);
      sorted.forEach((r, i) => {
        out[r._id] = results[i];
      });
    }
    return out;
  }, [rows]);

  // ── Form ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!modalMode) return;
    for (const v of entries) {
      if (!v.machine || !/^\d{4}-\d{2}-\d{2}$/.test(v.date || "")) continue;
      const key = `${v.machine}|${v.date}`;
      if (occupiedAsked.current.has(key)) continue;
      occupiedAsked.current.add(key);
      getMfdOccupiedTimes({ date: v.date, machine: v.machine })
        .then((res) => setOccupied((o) => ({ ...o, [key]: res.data.data || [] })))
        // Save is still checked by the server. Look again in a while.
        .catch(() => setTimeout(() => occupiedAsked.current.delete(key), 15000));
    }
    // `occupied` is a dependency so that clearing it (after a failed save) asks again
    // at once; pairs already asked are skipped, so this cannot loop.
  }, [modalMode, entries, occupied]);

  useEffect(() => {
    if (!modalMode) return;
    for (const v of entries) {
      const op = String(v.operator ?? "").trim();
      if (!op || !/^\d{4}-\d{2}-\d{2}$/.test(v.date || "")) continue;
      const key = `${op}|${v.date}`;
      if (operatorAsked.current.has(key)) continue;
      operatorAsked.current.add(key);
      getMfdOperatorOccupied({ date: v.date, operator: op })
        .then((res) => setOperatorOccupied((o) => ({ ...o, [key]: res.data.data || [] })))
        // The server still checks on Save; look again in a while.
        .catch(() => setTimeout(() => operatorAsked.current.delete(key), 15000));
    }
  }, [modalMode, entries, operatorOccupied]);

  const errorsList = useMemo(() => {
    const saved = editing?.saved || null;
    // A machine that already has MFD_MAX_SLOTS entries that date — the server's own refusal, said on the box.
    const full = slotsFullErrors(entries, occupied, { editSlot: editing?.slot ?? null, saved, max: MFD_MAX_SLOTS });
    // No machine overlap check (two jobs may share a machine's time), but one
    // operator can't be on two machines at once.
    const operatorClash = operatorOverlapErrors(entries, operatorOccupied, {
      editing: editing ? { machine: editing.machine, slot: editing.slot } : null,
      saved,
      machineName: (id) => machineName[id] || "",
    });
    return entries.map((v, i) => ({ ...full[i], ...operatorClash[i], ...validateMfdEntry(v, { saved }) }));
  }, [entries, occupied, operatorOccupied, editing, machineName]);
  // Warn the moment a pick creates (or changes) a time-rule problem — not only
  // when Save is pressed. Nothing repeats while the problem stays as it was.
  const timeWarned = useRef({});
  useEffect(() => {
    if (!modalMode) {
      timeWarned.current = {};
      return;
    }
    errorsList.forEach((errs, i) => {
      const message = [errs.machineOnTime, errs.machineOffTime, errs.plannedOperatorShiftHours].find(isTimeRuleMessage);
      if (message && timeWarned.current[i] !== message) toast.warning(message);
      if (message) timeWarned.current[i] = message;
      else delete timeWarned.current[i];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorsList, modalMode]);

  // Operator Planned Shift from each block's machine's process (Process
  // Master): a new entry takes that process's hours, filled in here; an edited
  // one keeps the shift it was saved with. Either way the box is read-only —
  // and the server enforces the same on Save (server/utils/plannedShift.js).
  const plannedLocks = useMemo(
    () =>
      entries.map((v) => {
        const setting = shiftSettingForMachine(v.machine, machines, processes);
        if (!setting) return null;
        const kept = modalMode === "edit" && editing?.savedPlanned !== null && editing?.savedPlanned !== undefined;
        return { ...setting, fromEntry: kept };
      }),
    [entries, machines, processes, modalMode, editing],
  );
  useEffect(() => {
    if (!modalMode) return;
    setEntries((list) => {
      let changed = false;
      const next = list.map((v, i) => {
        const lock = plannedLocks[i];
        if (!lock || lock.fromEntry) return v;
        const want = hoursToShiftInput(lock.hours);
        if (v.plannedOperatorShiftHours === want) return v;
        changed = true;
        return { ...v, plannedOperatorShiftHours: want };
      });
      return changed ? next : list;
    });
  }, [modalMode, plannedLocks]);

  // What the machine already has on the block's date — informational here,
  // since overlapping times are allowed.
  const bookedList = useMemo(() => entries.map((v) => bookedRanges(v, occupied, editing?.slot ?? null, editing?.saved || null)), [entries, occupied, editing]);
  const incompleteCount = errorsList.filter((e) => Object.keys(e).length).length;
  const canSave = incompleteCount === 0;

  // discardDraft: true after a successful Save — that data's in the database now.
  const closeModal = (discardDraft = false) => {
    if (modalMode === "add") {
      if (!discardDraft && hasAnyEntryData(entries)) saveDraft(entries);
      else clearDraft();
    }
    setModalMode(null);
    setEntries([emptyEntry()]);
    setEditing(null);
    resetOccupied();
    setFocusTarget(null);
    setIsSubmit(false);
  };

  const openAdd = () => {
    // A draft saved before a field existed lacks it — fill those in as blank.
    const draft = loadDraft()?.map((d) => ({ ...emptyEntry(), ...d }));
    // Only pre-fills the machine when the Filters panel narrows to exactly one.
    setEntries(draft || [{ ...emptyEntry(), machine: filters.machine.length === 1 ? filters.machine[0] : "" }]);
    setEditing(null);
    resetOccupied();
    setFocusTarget(null);
    setIsSubmit(false);
    setModalMode("add");
  };

  // The "Clear form" button in the Add Entry modal — wipes every block back
  // to blank and drops the saved draft.
  const clearForm = () => {
    if (!window.confirm("Clear everything typed in this form? This can't be undone.")) return;
    clearDraft();
    setEntries([emptyEntry()]);
    setFocusTarget(null);
    setIsSubmit(false);
  };

  const openEdit = (row) => {
    setEntries([toFormValues(row)]);
    setEditing({
      slot: row.slot,
      machine: row.machine,
      savedPlanned: row.plannedOperatorShiftHours ?? null,
      saved: { date: row.date, machine: row.machine, machineOnTime: row.machineOnTime, machineOffTime: row.machineOffTime, operator: row.operator },
    });
    resetOccupied();
    setFocusTarget(null);
    setIsSubmit(false);
    setModalMode("edit");
  };

  // "?entry=<id>&date=…" (OEE Review, an OEE notification) opens that entry's edit form.
  useOpenEntryFromLink({
    rows,
    loading,
    range,
    onRangeChange,
    openEdit,
    blockedReason: (row) => (!canEdit ? "You don't have permission to edit entries on this page." : lockInfo(row)),
  });

  const handleChange = useCallback((index, name, value) => {
    setEntries((list) => list.map((v, i) => (i === index ? { ...v, [name]: value } : v)));
  }, []);

  // A new block copies the date from the block above it — the whole form is
  // normally one day's shift — but nothing else.
  const handleAddBlock = useCallback(() => {
    setEntries((list) => [...list, { ...emptyEntry(), date: list[list.length - 1]?.date || isoDay(new Date()) }]);
  }, []);

  const handleRemoveBlock = useCallback((index) => {
    setEntries((list) => (list.length > 1 ? list.filter((_, i) => i !== index) : list));
  }, []);

  // Picking a part copies its Drawing No., Process, No. of Holes, Stroke
  // Required and Total Cycle Time onto the form — the cycle time still editable.
  const handleItemSelect = useCallback(
    (index, itemId) => {
      setEntries((list) =>
        list.map((v, i) => {
          if (i !== index) return v;
          if (!itemId) return { ...v, ...NO_PART };
          const it = items.find((item) => item._id === itemId);
          if (!it) return { ...v, item: "" };
          return withPart(v, it);
        }),
      );
    },
    [items],
  );

  const handleSave = async (e) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSubmit(true);

    // Nothing is saved while any block is incomplete — pressing Save opens the
    // first incomplete block and scrolls to its first missing field.
    const first = firstMfdError(errorsList);
    if (first) {
      // A quantity or stoppage past what the shift allows pops up why, with
      // the figures, before Save takes the operator to it.
      const over = firstOverLimit(entries, errorsList, mfdRowCalc, { qtyKey: "actualQty", machineName });
      if (over) await toast.notice(...over.notice);
      setFocusTarget({ ...(over ? { index: over.index, field: over.field } : first), nonce: Date.now() });
      return;
    }

    setIsSaving(true);
    // Saved one after another rather than in parallel, so a mid-way failure
    // leaves a clear "saved the first N". Those are dropped from the form as
    // they go, so pressing Save again can't add them a second time.
    const savedIndexes = new Set();
    try {
      for (const [i, v] of entries.entries()) {
        await saveMfdRow(toPayload(v, modalMode === "edit"));
        savedIndexes.add(i);
      }
      const saved = savedIndexes.size;
      if (modalMode === "edit") toast.success("Entry updated successfully!");
      else toast.success(saved === 1 ? "Entry added successfully!" : `${saved} entries added successfully!`);
      closeModal(true);
      fetchRows();
    } catch (err) {
      const reason = err?.response?.data?.message || "Failed to save. Please try again.";
      resetOccupied(); // something may have changed under us — re-read what is booked
      if (savedIndexes.size) {
        setEntries((list) => list.filter((_, i) => !savedIndexes.has(i)));
        setFocusTarget(null);
        toast.error(`${savedIndexes.size} saved, then: ${reason} The rest are still in the form.`);
        fetchRows();
      } else {
        toast.error(reason);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (e) => {
    e.preventDefault();
    setIsDeleting(true);
    deleteMfdRow(removeId)
      .then((res) => {
        setDeleteOpen(false);
        toast.success(res?.data?.message || "Entry deleted successfully!");
        fetchRows();
      })
      .catch((err) => {
        setDeleteOpen(false);
        toast.error(err?.response?.data?.message || "Failed to delete the entry. Please try again.");
      })
      .finally(() => setIsDeleting(false));
  };

  const fmtShort = (iso) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  const periodLabel = useMemo(() => `${fmtShort(fromDate)} – ${fmtShort(toDate)}`, [fromDate, toDate]);

  // The Vendor Name column shows on a process that uses vendors (Vendor
  // Master), or while any loaded entry names one.
  const showVendorColumn = useMemo(
    () => anyVendorFor(vendors, lockedProcess ? [lockedProcess._id] : machines.map((m) => m.process)) || sortedRows.some((r) => r.vendorName),
    [vendors, lockedProcess, machines, sortedRows],
  );

  // Search matches Part Name, Operator, Drawing No. or Process — only within
  // this page's own loaded rows.
  const searchedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedRows;
    return sortedRows.filter((r) => [r.itemName, r.operator, r.drawingNo, r.operation].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [sortedRows, search]);

  document.title = `MODULAR FRAME DRILLING Data Entry | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>
      {/* This page fills the exact height the layout hands it and scrolls only
          inside the table (the `min-h-0`/`h-100` chain and `fillHeight` on
          ProductionEntriesTable). */}
      <div className="page-content pd-root h-100 d-flex flex-column" style={{ minHeight: 0 }}>
        <Container fluid className="d-flex flex-column flex-grow-1" style={{ minHeight: 0 }}>
          <Card className="mb-0 d-flex flex-column flex-grow-1" style={{ minHeight: 0 }}>
            <CardHeader>
              <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
                <h5 className="mb-0 fs-6 fw-semibold">MODULAR FRAME DRILLING Data Entry</h5>

                <div className="d-flex flex-wrap align-items-center gap-2">
                  <div style={{ position: "relative" }}>
                    <Search size={14} style={{ position: "absolute", left: 10, top: 9, color: "#9ca3af", pointerEvents: "none" }} />
                    <Input
                      type="search"
                      placeholder="Search part, operator, drawing no…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      style={{ width: "220px", maxWidth: "100%", paddingLeft: 32 }}
                      bsSize="sm"
                    />
                  </div>
                  <FilterPanel
                    range={range}
                    onRangeChange={onRangeChange}
                    extent={extent}
                    filters={filters}
                    onFilterSet={onFilterSet}
                    options={filterOptions}
                    active={filtersActive}
                    onClearAll={clearAll}
                  />
                  {canCreate && (
                    <button type="button" className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onClick={openAdd}>
                      <Plus size={15} /> Add Entry
                    </button>
                  )}
                </div>
              </div>
            </CardHeader>
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 px-3 py-2 border-bottom">
              <span className="small text-muted">
                Page {page} of {totalPages}
              </span>
              <div className="d-flex flex-wrap align-items-center gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  style={{ minWidth: "84px" }}
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  style={{ minWidth: "84px" }}
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
                <span className="small text-muted ms-2">Go to</span>
                <NumberInput
                  name="goTo"
                  decimals={false}
                  maxLength={4}
                  max={totalPages}
                  placeholder={String(page)}
                  value={goTo}
                  onChange={(e) => setGoTo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && goToPage()}
                  style={{ width: "64px" }}
                />
                <button type="button" className="btn btn-sm btn-primary" onClick={goToPage}>
                  Go
                </button>
              </div>
            </div>
            <CardBody className="d-flex flex-column flex-grow-1 overflow-hidden" style={{ minHeight: 0 }}>
              <ProductionEntriesTable
                rows={searchedRows}
                showVendor={showVendorColumn}
                machineName={machineName}
                dayResultByKey={dayResultByKey}
                columns={MFD_COLUMNS}
                formulas={MFD_FORMULAS}
                calcRow={mfdRowCalc}
                loading={loading}
                emptyText={emptyEntriesText({
                  sheet: "MODULAR FRAME DRILLING",
                  period: periodLabel,
                  search,
                  searchedOut: !!search.trim() && sortedRows.length > 0,
                  filtered: hasFilters(filters),
                })}
                canEdit={canEdit}
                canDelete={canDelete}
                onEdit={openEdit}
                onDelete={(r) => {
                  setRemoveId(r._id);
                  setDeleteOpen(true);
                }}
                lockInfo={lockInfo}
                isAdmin={isAdmin}
                onUnlock={handleUnlock}
                currentShiftOf={currentShiftOf}
                bulk={{ sheet: "mfd", unlock: unlockMfdRow, remove: deleteMfdRow, onDone: handleBulkDone }}
                unlockingId={unlockingId}
                fillHeight
              />
            </CardBody>
          </Card>
        </Container>
      </div>

      <Modal isOpen={modalMode !== null} toggle={guardEscape(() => closeModal())} centered backdrop="static" size="xl" scrollable>
        <ModalHeader className="p-3 border-bottom" toggle={() => closeModal()}>
          <div className="d-flex flex-wrap align-items-center gap-2">
            <span>{modalMode === "edit" ? "Update MODULAR FRAME DRILLING Entry" : "Add MODULAR FRAME DRILLING Entry"}</span>
            {modalMode === "add" && hasAnyEntryData(entries) && (
              <button type="button" className="btn btn-sm btn-outline-danger" onClick={clearForm}>
                Clear form
              </button>
            )}
          </div>
        </ModalHeader>
        <form noValidate onSubmit={handleSave}>
          {/* The form is far taller than the viewport: the body scrolls and the
              Save/Cancel footer stays reachable. */}
          <ModalBody>
            <MfdEntryForm
              entries={entries}
              errors={errorsList}
              isSubmit={isSubmit}
              focusTarget={focusTarget}
              machines={formMachines}
              items={scopedItems}
              operators={operators}
              vendors={vendors}
              isEdit={modalMode === "edit"}
              booked={bookedList}
              plannedLocks={plannedLocks}
              savedRows={rows}
              onChange={handleChange}
              onItemSelect={handleItemSelect}
              onAdd={handleAddBlock}
              onRemove={handleRemoveBlock}
            />
          </ModalBody>
          <ModalFooter>
            {isSubmit && !canSave && (
              <span className="text-danger small me-auto" role="status">
                {entries.length === 1
                  ? "This entry is incomplete — fix the highlighted fields to save."
                  : `${incompleteCount} of ${entries.length} entries are incomplete — fix the highlighted fields to save.`}
              </span>
            )}
            {modalMode === "edit" ? (
              <FormUpdateFooter handleUpdate={handleSave} handleUpdateCancel={() => closeModal()} isLoading={isSaving} isSaveBlocked={!canSave} />
            ) : (
              <FormsFooter handleSubmit={handleSave} handleSubmitCancel={() => closeModal()} isLoading={isSaving} isSaveBlocked={!canSave} />
            )}
          </ModalFooter>
        </form>
      </Modal>

      <DeleteModal
        show={deleteOpen}
        handleDelete={handleDelete}
        toggle={(e) => {
          e?.preventDefault?.();
          setDeleteOpen(false);
        }}
        setmodal_delete={setDeleteOpen}
        disabled={isDeleting}
      />
    </React.Fragment>
  );
};

export default ModularFrameDrillingDataEntry;
