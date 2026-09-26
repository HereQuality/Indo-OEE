import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import {
  Card,
  CardBody,
  CardHeader,
  Container,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "reactstrap";
import DeleteModal from "../Components/Common/DeleteModal";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import ProductionEntriesTable from "../Components/Production/ProductionEntriesTable";
import ProductionEntryForm from "../Components/Production/ProductionEntryForm";
import NumberInput from "../Components/Production/NumberInput";
import FilterPanel from "../Components/ProcessDashboard/FilterPanel";
import "../Components/ProcessDashboard/processDashboard.css";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useMachines } from "../hooks/useMachines";
import { useProcesses } from "../hooks/useProcesses";
import { useItems } from "../hooks/useItems";
import { useMachineOperators } from "../hooks/useMachineOperators";
import {
  deleteProductionRow,
  getProductionExtent,
  getProductionFilterOptions,
  getOccupiedTimes,
  getProductionSheet,
  saveProductionRow,
  unlockProductionRow,
} from "../api/productionSheet.api";
import {
  CYCLE_OP_FIELDS,
  REJECT_REASONS,
  STOPPAGE_FIELDS,
  dayCalc,
  isoDay,
  sortByMachineOn,
} from "../utils/productionSheet";
import { bookedRanges, cleanSplit, firstError, isTimeRuleMessage, overlapErrors, validateEntry } from "../utils/entryValidation";
import { DIMENSIONS, EMPTY_FILTERS, applyFilters, defaultEntryRange, hasFilters } from "../utils/processDashboard";
import { getCompanyHolidays, getWeeklyOff } from "../api/companyHolidays.api";
import { LOCK_WORKING_DAYS, getLockDeadline } from "../utils/workingDays";

/**
 * Production Data Entry — the month's records, and one form per record.
 *
 * The roll-up charts live on their own page (pages/ProductionDashboardPage),
 * so this page loads only what the list and the form need.
 *
 * A record is still keyed by (date, machine, entry no.) the way the Indo
 * "Section Wise Eff. (CNC)" sheet is, but the entry no. is no longer typed:
 * a new entry is sent with slot "auto" and the server gives it the machine's
 * next free slot for that date (1–3), reporting a machine that already has
 * three entries that day rather than overwriting one. Machine stays locked
 * while editing,
 * because changing it would move the record to a different key rather than
 * edit it — delete and re-add instead.
 *
 * Every formula lives in utils/productionSheet.js and is shared with the
 * dashboard page, so the form's read-only boxes and the charts can't disagree.
 * Every rule the form enforces lives in utils/entryValidation.js; the errors
 * are worked out live from the entries, so the Save button, the messages and
 * the scroll to the first incomplete field all read from one answer.
 */

const STOPPAGE_KEYS = STOPPAGE_FIELDS.map((f) => f.key);
const CYCLE_OP_KEYS = CYCLE_OP_FIELDS.map((f) => f.key);
const TEXT_FIELDS = ["operator", "itemName", "drawingNo", "remarks", "rejectOtherRemark", "otherMinRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime"];
const NUMBER_FIELDS = [
  "actualQty",
  "okQty",
  "plannedOperatorShiftHours",
  "totalCycleSec",
  ...STOPPAGE_KEYS,
  ...CYCLE_OP_KEYS,
];

// Add-entry drafts: typing gets saved to localStorage the moment the form is
// closed (Cancel, the X, Escape, clicking away isn't possible — backdrop is
// static) so an accidental close doesn't lose it. Reopening "Add Entry"
// within a minute brings it back; after that (or on a successful Save) it's
// gone, so the form doesn't come back stale hours later.
const DRAFT_KEY = "productionEntryDraft";
const DRAFT_TTL_MS = 60 * 1000;

const hasAnyEntryData = (list) =>
  list.some((v) => {
    if (v.machine || v.operator || v.itemName || v.drawingNo || v.remarks) return true;
    if (v.machineOnTime || v.machineOffTime || v.plannedOperatorShiftHours !== "") return true;
    if ([v.actualQty, v.okQty].some((q) => q !== "" && q !== undefined && q !== null)) return true;
    if (Object.values(v.rejectBreakdown || {}).some((n) => n !== "" && n !== undefined && n !== null && Number(n) !== 0)) return true;
    return [...STOPPAGE_KEYS, ...CYCLE_OP_KEYS].some((k) => v[k] !== "" && v[k] !== undefined && v[k] !== null);
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
  // Assigned on save from the machine's free slots for that date; kept in the
  // values only because an edited record has to save back to its own slot.
  slot: 1,
  item: "",
  rejectBreakdown: {},
  // Operations this entry has unticked out of what its Part carries — subtracted
  // from its Total Cycle Time; the Part's own record is never touched.
  excludedOps: [],
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, ""])),
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, ""])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, ""])),
});

// A saved record -> form values ("" for anything unset, so inputs stay controlled).
//
// actualQty is never shown or typed here — Ideal Quantity does that job — but
// it's still sent back on save (see toPayload), recomputed from this record's
// own Ideal Quantity rather than kept from what was last stored.
const toFormValues = (row) => {
  return {
    ...emptyEntry(),
    ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)),
    item: row.item || "",
    slot: row.slot,
    // A record saved before the split existed has only a single rejectReason;
    // its rejected pieces are put against that reason so editing it doesn't
    // look like the reason was lost.
    rejectBreakdown: (() => {
      const stored = row.rejectBreakdown;
      if (stored && Object.keys(stored).length) {
        return Object.fromEntries(Object.entries(stored).filter(([r]) => REJECT_REASONS.includes(r)));
      }
      const rejected = Number(row.rejectedQty);
      return row.rejectReason && REJECT_REASONS.includes(row.rejectReason) && Number.isFinite(rejected) && rejected > 0
        ? { [row.rejectReason]: rejected }
        : {};
    })(),
  };
};

// Form values -> request body. "" tells the server to unset that field.
// rejectedQty is deliberately absent: the server derives it from Actual − OK.
const toPayload = (v, isEdit) => {
  const split = cleanSplit(v.rejectBreakdown);
  // The entries table and older records still carry one reason per entry, so
  // the biggest contributor in the split is saved there too — the table column
  // keeps working without needing a second shape.
  const topReason = Object.entries(split).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return {
    date: v.date,
    machine: v.machine,
    // An edited record saves back to its own slot; a new one asks the server for
    // the machine's next free slot on that date, since only the server can see
    // every entry — the page may be filtered to one machine.
    slot: isEdit ? Number(v.slot) : "auto",
    item: v.item || null,
    excludedOps: v.excludedOps || [],
    rejectBreakdown: split,
    rejectReason: topReason,
    ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, String(v[k] ?? "").trim()])),
    // A remark only belongs to an "Other" that is still in use — once that
    // figure goes back to zero the remark is cleared with it.
    rejectOtherRemark: split.Other > 0 ? String(v.rejectOtherRemark ?? "").trim() : "",
    otherMinRemark: Number(v.otherMin) > 0 ? String(v.otherMinRemark ?? "").trim() : "",
    ...Object.fromEntries(TIME_FIELDS.map((k) => [k, v[k] ?? ""])),
    ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, v[k] === "" || v[k] === undefined ? "" : Number(v[k])])),
  };
};

const ProductionSheet = () => {
  const toast = useAlert();
  const { currentPagePermissions, isAdmin } = useContext(MenuContext) || {};
  const canCreate = currentPagePermissions ? !!currentPagePermissions.create : true;
  const canEdit = currentPagePermissions ? !!currentPagePermissions.edit : true;
  const canDelete = currentPagePermissions ? !!currentPagePermissions.delete : true;

  // ── Entry lock (2 working days) ───────────────────────────────────────
  // Preview only — see utils/workingDays.js's file comment. The server
  // (productionSheet.controller.js) re-checks this against the real date
  // on every Save/Delete/Unlock. A row already carrying an active
  // `unlockedUntil` (Super Admin granted it, see handleUnlock below) is
  // never locked here, for anyone — that's the whole point of unlocking it.
  const [holidays, setHolidays] = useState([]);
  const [weeklyOffDays, setWeeklyOffDays] = useState([0]);
  useEffect(() => {
    getCompanyHolidays().then((res) => setHolidays(res?.data?.data || [])).catch(() => setHolidays([]));
    getWeeklyOff().then((res) => setWeeklyOffDays(res?.data?.data?.weeklyOffDays || [0])).catch(() => {});
  }, []);
  const lockInfo = useCallback(
    (row) => {
      if (row.unlockedUntil && new Date(row.unlockedUntil) > new Date()) return "";
      const asOf = isoDay(new Date());
      const deadline = getLockDeadline(row.date, weeklyOffDays, holidays, LOCK_WORKING_DAYS);
      if (asOf <= deadline) return "";
      const [y, m, d] = deadline.split("-");
      return `Locked — more than ${LOCK_WORKING_DAYS} working days old (editable through ${d}/${m}/${y})`;
    },
    [weeklyOffDays, holidays],
  );

  const [unlockingId, setUnlockingId] = useState(null);
  const handleUnlock = useCallback(
    (row) => {
      setUnlockingId(row._id);
      unlockProductionRow(row._id)
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

  // One Filters button holds everything that slices the sheet — period
  // (date range / month / year), Machine, Operator, Item — the same panel
  // the process dashboards use, so both pages behave alike. Search stays its
  // own field beside it, since it searches text the panel can't multi-select.
  const [range, setRange] = useState(defaultEntryRange);
  const [baseRange, setBaseRange] = useState(range);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, toDate] = range;

  // Paginated by date on the server, not in the browser — each page's own
  // request only ever returns that page's rows (PAGE_SIZE_DAYS distinct
  // dates), never the whole selected range at once. See getSheet in
  // productionSheet.controller.js for the matching server-side paging.
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalDays, setTotalDays] = useState(0);
  // Blank by default — the field shows the current page only as a
  // placeholder hint, not a real value sitting there to be typed over.
  const [goTo, setGoTo] = useState("");

  const { data: machines = [] } = useMachines();
  const { data: processes = [] } = useProcesses();
  const { data: items = [] } = useItems();
  const { data: operators = [] } = useMachineOperators();

  // Whichever process (Production › Processes) names *this* page as its own
  // Data Entry Page — matched on the route path with any role-slug prefix
  // stripped, the same way Layout.jsx matches the sidebar's current-page
  // title, so it doesn't matter which role's slug the URL happens to carry.
  // Exactly one match narrows the Machine picker to that process's own
  // machines; none (not linked yet) or more than one (misconfigured — two
  // processes pointing at the same page) falls back to every machine.
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

  // null = closed, "add" | "edit"
  const [modalMode, setModalMode] = useState(null);
  // One entry per machine block in the form; adding starts with a single block.
  const [entries, setEntries] = useState(() => [emptyEntry()]);
  const [isSubmit, setIsSubmit] = useState(false);
  // Set by a failed Save: the first incomplete entry and field, for the form to
  // scroll to. The nonce makes pressing Save again scroll again.
  const [focusTarget, setFocusTarget] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // What each machine in the form already has booked on its date, keyed
  // "machine|date" — asked of the server once per pair while the form is open,
  // so an overlapping ON/OFF time is flagged as it is picked (the server
  // refuses one on Save regardless). `editing` is the row being edited (its slot
  // is not "another" entry; its loaded times decide whether the time rules
  // apply — an old row that already breaks them stays editable).
  const [occupied, setOccupied] = useState({});
  const occupiedAsked = useRef(new Set());
  const [editing, setEditing] = useState(null);
  const resetOccupied = useCallback(() => {
    occupiedAsked.current.clear();
    setOccupied({});
  }, []);

  const [removeId, setRemoveId] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const machineName = useMemo(
    () => Object.fromEntries(machines.map((m) => [m._id, m.machineName])),
    [machines],
  );
  // Where each machine sits in the sheet order Super Admin sets in Machine
  // Master — `machines` already arrives in that order. A machine that's since
  // been deactivated isn't in the list, so it ranks after the rest, by name.
  const machineRank = useMemo(() => Object.fromEntries(machines.map((m, i) => [m._id, i])), [machines]);
  const rankOf = useCallback((id) => machineRank[id] ?? Number.MAX_SAFE_INTEGER, [machineRank]);

  // ── Load ───────────────────────────────────────────────────────────────
  // Only Machine narrows what's actually fetched — Operator/Item still
  // narrow the browser's *view* of a page's rows (applyFilters below), same
  // as before — but both narrow which *dates* the server pages through, so
  // paging a filtered view never lands on a date with nothing matching.
  // Whatever page is asked for, only that page's rows come over the wire —
  // the full date range is never fetched in one request.
  const validRange = !!fromDate && !!toDate && fromDate <= toDate;

  const fetchRows = useCallback(() => {
    if (!validRange) return;
    setLoading(true);
    getProductionSheet({ from: fromDate, to: toDate, page, machine: filters.machine, operator: filters.operator, item: filters.item })
      .then((res) => {
        setRows(res.data.data || []);
        const meta = res.data.meta || {};
        setTotalPages(Math.max(1, meta.totalPages || 1));
        setTotalDays(meta.totalDays || 0);
        // The server clamps an out-of-range page to its own last page —
        // mirror that back into local state so "Page X of Y" reads right.
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

  // The date range this app actually has data in, for the Filters panel's
  // Year tab — independent of the sheet's own current page.
  const [extent, setExtent] = useState(null);
  useEffect(() => {
    getProductionExtent()
      .then((res) => setExtent(res?.data?.data || null))
      .catch(() => setExtent(null));
  }, []);

  // What the Filters panel's Machine/Operator/Item pickers offer: the values
  // present anywhere in the selected date range (not just this page), plus
  // anything already picked (so a pick never vanishes from its own list once
  // the period moves past it). Refetched only when the date range changes —
  // picking a filter doesn't shrink what the other pickers can offer.
  const ctx = useMemo(() => ({ machineName }), [machineName]);
  const [rangeFilterValues, setRangeFilterValues] = useState({ machine: [], operator: [], item: [] });
  useEffect(() => {
    if (!validRange) return;
    getProductionFilterOptions({ from: fromDate, to: toDate })
      .then((res) => setRangeFilterValues(res?.data?.data || { machine: [], operator: [], item: [] }))
      .catch(() => {});
  }, [fromDate, toDate, validRange]);

  const filterOptions = useMemo(() => {
    const options = (dim) =>
      [...new Set([...(rangeFilterValues[dim] || []), ...filters[dim]])]
        .map((value) => ({ value, label: DIMENSIONS[dim].text(value, ctx) }))
        .sort(
          (a, b) =>
            (dim === "machine" ? rankOf(a.value) - rankOf(b.value) : 0) ||
            a.label.localeCompare(b.label, undefined, { numeric: true }),
        );
    return { machine: options("machine"), operator: options("operator"), item: options("item") };
  }, [rangeFilterValues, ctx, filters, rankOf]);

  // Page resets to 1 alongside the filter/range change itself (not in a
  // separate effect reacting to it) so the two state updates land in the
  // same render and the sheet fetches page 1 of the new selection exactly
  // once, instead of once for the old page and again once it's corrected.
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

  // This page's own rows only — Operator/Item still narrow the view here
  // (Machine was already narrowed server-side), same applyFilters the
  // process dashboards use.
  const filteredRows = useMemo(() => applyFilters(rows, filters), [rows, filters]);

  const sortedRows = useMemo(
    () =>
      [...filteredRows].sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          rankOf(a.machine) - rankOf(b.machine) ||
          (machineName[a.machine] || "").localeCompare(machineName[b.machine] || "", undefined, { numeric: true }) ||
          a.slot - b.slot,
      ),
    [filteredRows, machineName, rankOf],
  );

  const goToPage = () => {
    if (goTo === "") return;
    const n = Number(goTo);
    if (Number.isInteger(n) && n >= 1 && n <= totalPages) setPage(n);
    setGoTo("");
  };

  // dayCalc looks at a machine's whole date (this row + the following rows
  // of that same date) but hands back one result per row, not one shared
  // value — so each saved record's OEE/Unreported/Unutilized figures are
  // keyed by that record's own id, not by machine+date.
  const dayResultByKey = useMemo(() => {
    const groups = {};
    for (const r of rows) (groups[`${r.machine}|${r.date}`] ||= []).push(r);
    const out = {};
    for (const group of Object.values(groups)) {
      // dayCalc sorts by Machine ON Time internally to build its window;
      // sorted the same way here (via the same helper, not a second copy of
      // the logic) so result i still lines up with sorted[i].
      const sorted = sortByMachineOn(group);
      const results = dayCalc(sorted);
      sorted.forEach((r, i) => {
        out[r._id] = results[i];
      });
    }
    return out;
  }, [rows]);

  // ── Form ───────────────────────────────────────────────────────────────
  // Every block's problems, worked out live from what's typed — the form shows
  // them once Save has been pressed, and Save itself stays inactive until there
  // are none (see canSave).
  useEffect(() => {
    if (!modalMode) return;
    for (const v of entries) {
      if (!v.machine || !/^\d{4}-\d{2}-\d{2}$/.test(v.date || "")) continue;
      const key = `${v.machine}|${v.date}`;
      if (occupiedAsked.current.has(key)) continue;
      occupiedAsked.current.add(key);
      getOccupiedTimes({ date: v.date, machine: v.machine })
        .then((res) => setOccupied((o) => ({ ...o, [key]: res.data.data || [] })))
        // Save is still checked by the server. Look again in a while — not on
        // every keystroke while the lookup keeps failing.
        .catch(() => setTimeout(() => occupiedAsked.current.delete(key), 15000));
    }
    // `occupied` is a dependency so that clearing it (after a failed save) asks again
    // at once; pairs already asked are skipped, so this cannot loop.
  }, [modalMode, entries, occupied]);

  const errorsList = useMemo(() => {
    const saved = editing?.saved || null;
    const overlap = overlapErrors(entries, occupied, { editSlot: editing?.slot ?? null, saved });
    // A block's own problems (blank / invalid / OFF before ON) come first.
    return entries.map((v, i) => ({ ...overlap[i], ...validateEntry(v, { saved }) }));
  }, [entries, occupied, editing]);
  // Warn the moment a pick creates (or changes) a time-rule problem — not only
  // when Save is pressed. Nothing repeats while the problem stays as it was.
  const timeWarned = useRef({});
  useEffect(() => {
    if (!modalMode) {
      timeWarned.current = {};
      return;
    }
    errorsList.forEach((errs, i) => {
      const message = [errs.machineOnTime, errs.machineOffTime].find(isTimeRuleMessage);
      if (message && timeWarned.current[i] !== message) toast.warning(message);
      if (message) timeWarned.current[i] = message;
      else delete timeWarned.current[i];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorsList, modalMode]);

  const bookedList = useMemo(
    () => entries.map((v) => bookedRanges(v, occupied, editing?.slot ?? null)),
    [entries, occupied, editing],
  );
  const incompleteCount = errorsList.filter((e) => Object.keys(e).length).length;
  const canSave = incompleteCount === 0;

  // discardDraft: true after a successful Save — that data's in the database
  // now, so there's nothing left worth keeping a temporary copy of.
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
    // Only pre-fills the machine when the Filters panel narrows to exactly
    // one — with several ticked there's no single machine to default to.
    setEntries(draft || [{ ...emptyEntry(), machine: filters.machine.length === 1 ? filters.machine[0] : "" }]);
    setEditing(null);
    resetOccupied();
    setFocusTarget(null);
    setIsSubmit(false);
    setModalMode("add");
  };

  // The "Clear form" button in the Add Entry modal — wipes every block back
  // to blank and drops the saved draft, so a bad start doesn't linger.
  const clearForm = () => {
    if (!window.confirm("Clear everything typed in this form? This can't be undone.")) return;
    clearDraft();
    setEntries([emptyEntry()]);
    setFocusTarget(null);
    setIsSubmit(false);
  };

  const openEdit = (row) => {
    setEntries([toFormValues(row)]);
    setEditing({ slot: row.slot, saved: { machineOnTime: row.machineOnTime, machineOffTime: row.machineOffTime } });
    resetOccupied();
    setFocusTarget(null);
    setIsSubmit(false);
    setModalMode("edit");
  };

  const handleChange = useCallback((index, name, value) => {
    setEntries((list) => list.map((v, i) => (i === index ? { ...v, [name]: value } : v)));
  }, []);

  const handleRejectChange = useCallback((index, reason, value) => {
    setEntries((list) =>
      list.map((v, i) => (i === index ? { ...v, rejectBreakdown: { ...(v.rejectBreakdown || {}), [reason]: value } } : v)),
    );
  }, []);

  // A new machine block copies the date from the block above it — the whole
  // form is normally one day's shift — but nothing else.
  const handleAddBlock = useCallback(() => {
    setEntries((list) => [...list, { ...emptyEntry(), date: list[list.length - 1]?.date || isoDay(new Date()) }]);
  }, []);

  const handleRemoveBlock = useCallback((index) => {
    setEntries((list) => (list.length > 1 ? list.filter((_, i) => i !== index) : list));
  }, []);

  // Picking an item copies its master values onto the form — still editable,
  // so a later change to the master never rewrites saved records.
  const handleItemSelect = useCallback(
    (index, itemId) => {
      setEntries((list) =>
        list.map((v, i) => {
          if (i !== index) return v;
          if (!itemId) return { ...v, item: "", itemName: "", excludedOps: [] };
          const it = items.find((item) => item._id === itemId);
          if (!it) return { ...v, item: "" };
          return {
            ...v,
            item: it._id,
            itemName: it.itemName,
            drawingNo: it.drawingNo || "",
            // Copies the item's own Total Cycle Time and operation times onto
            // the entry. These are locked to the item, not typed here — a
            // later change to the master is picked up again next time this
            // part is (re)selected. A freshly (re)picked part starts with
            // every operation ticked; whichever were unticked belonged to
            // the part picked before.
            totalCycleSec: it.totalCycleSec ?? "",
            excludedOps: [],
            ...Object.fromEntries(CYCLE_OP_KEYS.map((k) => [k, it[k] ?? ""])),
          };
        }),
      );
    },
    [items],
  );

  const handleSave = async (e) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSubmit(true);

    // Nothing is saved while any block is incomplete — the button only looks
    // inactive so it can still be pressed, and pressing it opens the first
    // incomplete block and scrolls to its first missing field.
    const first = firstError(errorsList);
    if (first) {
      setFocusTarget({ ...first, nonce: Date.now() });
      return;
    }

    setIsSaving(true);
    // Saved one after another rather than in parallel, so a mid-way failure
    // leaves a clear "saved the first N". Those are dropped from the form as
    // they go, so pressing Save again after fixing the failed one can't add
    // them a second time.
    const savedIndexes = new Set();
    try {
      for (const [i, v] of entries.entries()) {
        await saveProductionRow(toPayload(v, modalMode === "edit"));
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
    deleteProductionRow(removeId)
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

  // Search matches Part Name, Operator, or Drawing No. — only within this
  // page's own loaded rows, not the whole selection (see the `extent` state
  // above and getProductionExtent for what covers the full range).
  const searchedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedRows;
    return sortedRows.filter((r) =>
      [r.itemName, r.operator, r.drawingNo].some((v) => String(v || "").toLowerCase().includes(q)),
    );
  }, [sortedRows, search]);

  document.title = `Production Data Entry | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>
      {/* This page fills the exact height the layout hands it and scrolls
          only inside the table (see the `min-h-0`/`h-100` chain below and
          `fillHeight` on ProductionEntriesTable) — without that chain, a
          flex child's default min-height:auto keeps it from shrinking below
          its content size, so the table would grow past the viewport and
          the whole page would scroll underneath its own internal scrollbar. */}
      <div className="page-content pd-root h-100 d-flex flex-column" style={{ minHeight: 0 }}>
        <Container fluid className="d-flex flex-column flex-grow-1" style={{ minHeight: 0 }}>
          <Card className="mb-0 d-flex flex-column flex-grow-1" style={{ minHeight: 0 }}>
            <CardHeader>
              <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
                <h5 className="mb-0 fs-6 fw-semibold">Production Data Entry</h5>

                <div className="d-flex flex-wrap align-items-center gap-2">
                  <div style={{ position: "relative" }}>
                    <Search size={14} style={{ position: "absolute", left: 10, top: 9, color: "#9ca3af", pointerEvents: "none" }} />
                    <Input
                      type="search"
                      placeholder="Search part, operator, drawing no…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      style={{ width: "220px", paddingLeft: 32 }}
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
                    <button
                      type="button"
                      className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1"
                      onClick={openAdd}
                    >
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
              <div className="d-flex align-items-center gap-2">
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
                machineName={machineName}
                dayResultByKey={dayResultByKey}
                loading={loading}
                emptyText={`No entries for ${periodLabel}. Click “Add Entry” to start.`}
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
                unlockingId={unlockingId}
                fillHeight
              />
            </CardBody>
          </Card>
        </Container>
      </div>

      <Modal isOpen={modalMode !== null} toggle={() => closeModal()} centered backdrop="static" size="xl" scrollable>
        <ModalHeader className="p-3 border-bottom" toggle={() => closeModal()}>
          <div className="d-flex align-items-center gap-2">
            <span>{modalMode === "edit" ? "Update Production Entry" : "Add Production Entry"}</span>
            {modalMode === "add" && hasAnyEntryData(entries) && (
              <button
                type="button"
                className="btn btn-sm btn-outline-danger ms-2"
                onClick={clearForm}
              >
                Clear form
              </button>
            )}
          </div>
        </ModalHeader>
        <form noValidate onSubmit={handleSave}>
          {/* The form is far taller than the viewport. An explicit height here
              rather than relying on Bootstrap's .modal-dialog-scrollable, so the
              body scrolls and the Save/Cancel footer stays reachable. */}
          <ModalBody style={{ maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}>
            <ProductionEntryForm
              entries={entries}
              errors={errorsList}
              isSubmit={isSubmit}
              focusTarget={focusTarget}
              machines={scopedMachines}
              items={items}
              operators={operators}
              isEdit={modalMode === "edit"}
              booked={bookedList}
              onChange={handleChange}
              onItemSelect={handleItemSelect}
              onRejectChange={handleRejectChange}
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

export default ProductionSheet;
