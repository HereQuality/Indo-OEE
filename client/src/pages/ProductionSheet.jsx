import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
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
  getProductionSheet,
  saveProductionRow,
} from "../api/productionSheet.api";
import {
  CYCLE_OP_FIELDS,
  REJECT_REASONS,
  STOPPAGE_FIELDS,
  dayCalc,
  isoDay,
  rowCalc,
  sortByMachineOn,
} from "../utils/productionSheet";
import { DIMENSIONS, EMPTY_FILTERS, applyFilters, defaultEntryRange, hasFilters } from "../utils/processDashboard";

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
 */

const STOPPAGE_KEYS = STOPPAGE_FIELDS.map((f) => f.key);
const CYCLE_OP_KEYS = CYCLE_OP_FIELDS.map((f) => f.key);
const TEXT_FIELDS = ["operator", "itemName", "drawingNo", "remarks"];
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
    if (v.machineOnTime || v.machineOffTime || v.okQty !== "" || v.plannedOperatorShiftHours !== "") return true;
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

// Blank boxes dropped, everything else as a number — what the server stores.
const cleanSplit = (split) =>
  Object.fromEntries(
    Object.entries(split || {})
      .map(([reason, v]) => [reason, v === "" || v === null || v === undefined ? 0 : Number(v)])
      .filter(([, n]) => Number.isFinite(n) && n > 0),
  );

// Form values -> request body. "" tells the server to unset that field.
// rejectedQty is deliberately absent: the server derives it from Actual − OK.
const toPayload = (v, isEdit) => {
  const split = cleanSplit(v.rejectBreakdown);
  // The entries table and older records still carry one reason per entry, so
  // the biggest contributor in the split is saved there too — the table column
  // keeps working without needing a second shape.
  const topReason = Object.entries(split).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  // There's no typed Actual Quantity any more — Ideal Quantity stands in for
  // it, so what's sent as actualQty (the server still derives Rejected from
  // actualQty − okQty) is this entry's own calculated Ideal Quantity.
  const idealQty = rowCalc(v).idealQty;
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
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, v[k] ?? ""])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, v[k] === "" ? "" : Number(v[k])])),
  actualQty: idealQty === null ? "" : idealQty,
  };
};

const ProductionSheet = () => {
  const toast = useAlert();
  const { currentPagePermissions } = useContext(MenuContext) || {};
  const canCreate = currentPagePermissions ? !!currentPagePermissions.create : true;
  const canEdit = currentPagePermissions ? !!currentPagePermissions.edit : true;
  const canDelete = currentPagePermissions ? !!currentPagePermissions.delete : true;

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

  // Paginated by date rather than by raw row — a date's entries are merged
  // into one block (shared Date/Machine cells), so slicing mid-date would
  // split a merged block across two pages. 10 days per page.
  const PAGE_SIZE_DAYS = 10;
  const [page, setPage] = useState(1);
  const [goTo, setGoTo] = useState("1");

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
  const [formErrors, setFormErrors] = useState([]);
  const [isSubmit, setIsSubmit] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [removeId, setRemoveId] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const machineName = useMemo(
    () => Object.fromEntries(machines.map((m) => [m._id, m.machineName])),
    [machines],
  );

  // ── Load ───────────────────────────────────────────────────────────────
  // The server is only asked to narrow by date — Machine/Operator/Item are
  // applied in the browser (like the process dashboards), so ticking more
  // than one of each in the Filters panel doesn't need a second round trip.
  const validRange = !!fromDate && !!toDate && fromDate <= toDate;

  const fetchRows = useCallback(() => {
    if (!validRange) return;
    setLoading(true);
    getProductionSheet({ from: fromDate, to: toDate })
      .then((res) => setRows(res.data.data || []))
      .catch((err) => {
        toast.error(err?.response?.data?.message || "Failed to load entries");
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [fromDate, toDate, validRange]);

  useEffect(() => {
    if (!validRange) {
      toast.error("From Date must be on or before To Date");
      return;
    }
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  useEffect(() => {
    setPage(1);
    setGoTo("1");
  }, [fromDate, toDate, filters]);

  const ctx = useMemo(() => ({ machineName }), [machineName]);

  const filteredRows = useMemo(() => applyFilters(rows, filters), [rows, filters]);

  // What the Filters panel's Machine/Operator/Item pickers offer: the values
  // present in the loaded period, plus anything already picked (so a pick
  // never vanishes from its own list once the period moves past it).
  const filterOptions = useMemo(() => {
    const options = (dim) =>
      [...new Set([...rows.map(DIMENSIONS[dim].value), ...filters[dim]])]
        .map((value) => ({ value, label: DIMENSIONS[dim].text(value, ctx) }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    return { machine: options("machine"), operator: options("operator"), item: options("item") };
  }, [rows, ctx, filters]);

  const onFilterSet = useCallback((dim, values) => setFilters((f) => ({ ...f, [dim]: values })), []);
  const onRangeChange = useCallback((next) => setRange(next), []);
  const isDefaultRange = range.join() === baseRange.join();
  const filtersActive = !isDefaultRange || hasFilters(filters);
  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    const fresh = defaultEntryRange();
    setBaseRange(fresh);
    setRange(fresh);
  };

  const sortedRows = useMemo(
    () =>
      [...filteredRows].sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          (machineName[a.machine] || "").localeCompare(machineName[b.machine] || "", undefined, { numeric: true }) ||
          a.slot - b.slot,
      ),
    [filteredRows, machineName],
  );

  // The distinct dates actually present, in the same newest-first order as
  // sortedRows — what gets paged is this list, not the raw rows.
  const activeDays = useMemo(() => [...new Set(sortedRows.map((r) => r.date))], [sortedRows]);
  const totalPages = Math.max(1, Math.ceil(activeDays.length / PAGE_SIZE_DAYS));

  // A new month/machine filter (or a load that shrinks the day count) can
  // leave `page` pointing past the end — pull it back in range rather than
  // showing an empty page.
  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  const pagedRows = useMemo(() => {
    const pageDays = new Set(activeDays.slice((page - 1) * PAGE_SIZE_DAYS, page * PAGE_SIZE_DAYS));
    return sortedRows.filter((r) => pageDays.has(r.date));
  }, [sortedRows, activeDays, page]);

  const goToPage = () => {
    const n = Number(goTo);
    if (Number.isInteger(n) && n >= 1 && n <= totalPages) setPage(n);
    setGoTo(String(Math.min(Math.max(1, Number.isInteger(n) ? n : page), totalPages)));
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
  // discardDraft: true after a successful Save — that data's in the database
  // now, so there's nothing left worth keeping a temporary copy of.
  const closeModal = (discardDraft = false) => {
    if (modalMode === "add") {
      if (!discardDraft && hasAnyEntryData(entries)) saveDraft(entries);
      else clearDraft();
    }
    setModalMode(null);
    setEntries([emptyEntry()]);
    setFormErrors([]);
    setIsSubmit(false);
  };

  const openAdd = () => {
    const draft = loadDraft();
    // Only pre-fills the machine when the Filters panel narrows to exactly
    // one — with several ticked there's no single machine to default to.
    setEntries(draft || [{ ...emptyEntry(), machine: filters.machine.length === 1 ? filters.machine[0] : "" }]);
    setFormErrors([]);
    setIsSubmit(false);
    setModalMode("add");
  };

  // The "Clear form" button in the Add Entry modal — wipes every block back
  // to blank and drops the saved draft, so a bad start doesn't linger.
  const clearForm = () => {
    if (!window.confirm("Clear everything typed in this form? This can't be undone.")) return;
    clearDraft();
    setEntries([emptyEntry()]);
    setFormErrors([]);
  };

  const openEdit = (row) => {
    setEntries([toFormValues(row)]);
    setFormErrors([]);
    setIsSubmit(false);
    setModalMode("edit");
  };

  const handleChange = useCallback((index, name, value) => {
    setEntries((list) => list.map((v, i) => (i === index ? { ...v, [name]: value } : v)));
  }, []);

  const handleRejectChange = useCallback((index, reason, value) => {
    setEntries((list) =>
      list.map((v, i) =>
        i === index ? { ...v, rejectBreakdown: { ...(v.rejectBreakdown || {}), [reason]: value } } : v,
      ),
    );
  }, []);

  // A new machine block copies the date from the block above it — the whole
  // form is normally one day's shift — but nothing else.
  const handleAddBlock = useCallback(() => {
    setEntries((list) => [...list, { ...emptyEntry(), date: list[list.length - 1]?.date || isoDay(new Date()) }]);
  }, []);

  const handleRemoveBlock = useCallback((index) => {
    setEntries((list) => (list.length > 1 ? list.filter((_, i) => i !== index) : list));
    setFormErrors((list) => list.filter((_, i) => i !== index));
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

  const validate = (v) => {
    const errors = {};
    if (!v.date) errors.date = "Date is required";
    if (!v.machine) errors.machine = "Machine is required";

    // There's no typed Actual Quantity any more — Ideal Quantity (Shift Time ÷
    // Cycle Time, rounded down) stands in for it, so OK/Rejected are checked
    // against Ideal Quantity instead.
    const idealQty = rowCalc(v).idealQty;
    const ok = v.okQty === "" ? null : Number(v.okQty);
    if (ok !== null && (!Number.isFinite(ok) || ok < 0)) errors.okQty = "Must be 0 or more";
    if (ok !== null && idealQty !== null && ok > idealQty) errors.okQty = "OK cannot be more than Ideal Quantity";

    // The per-reason split is what makes rejections readable on the dashboard,
    // so it has to account for every rejected piece — no more, no less.
    const rejected = idealQty !== null && ok !== null ? idealQty - ok : 0;
    const split = cleanSplit(v.rejectBreakdown);
    const splitTotal = Object.values(split).reduce((s, n) => s + n, 0);
    if (Object.entries(v.rejectBreakdown || {}).some(([, n]) => n !== "" && (!Number.isFinite(Number(n)) || Number(n) < 0))) {
      errors.rejectBreakdown = "Rejected quantities must be 0 or more";
    } else if (rejected > 0 && splitTotal !== rejected) {
      errors.rejectBreakdown = `Split ${splitTotal} of ${rejected} rejected — the boxes must add up to the rejected quantity`;
    } else if (rejected <= 0 && splitTotal > 0) {
      errors.rejectBreakdown = "Nothing was rejected, so these boxes should be empty";
    }

    for (const key of CYCLE_OP_KEYS) {
      const n = v[key] === "" ? null : Number(v[key]);
      if (n !== null && (!Number.isFinite(n) || n < 0)) errors[key] = "Must be 0 or more";
    }
    for (const key of STOPPAGE_KEYS) {
      const n = v[key] === "" ? null : Number(v[key]);
      if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1440)) errors[key] = "0–1440";
    }
    const planned = v.plannedOperatorShiftHours === "" ? null : Number(v.plannedOperatorShiftHours);
    if (planned !== null && (!Number.isFinite(planned) || planned < 0 || planned > 24)) {
      errors.plannedOperatorShiftHours = "0–24 hours";
    }
    return errors;
  };

  // A block whose machine was never picked is one the user added and left
  // alone — skipped rather than reported, so a stray block can't block a save.
  const isUntouched = (v) => !v.machine;

  // The Save/Update button stays disabled until every required field (Date,
  // Machine — the only two boxes marked * on the form) is filled in for at
  // least one machine block. This only gates the required boxes, not the
  // full validation (mismatched reject splits, out-of-range minutes, …) —
  // those still surface as the usual field errors once Save is pressed.
  const canSave = useMemo(
    () => entries.some((v) => !isUntouched(v)) && entries.every((v) => isUntouched(v) || v.date),
    [entries],
  );

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSubmit(true);
    const errorsPerBlock = entries.map((v) => (isUntouched(v) ? {} : validate(v)));
    const toSave = entries.filter((v) => !isUntouched(v));

    if (!toSave.length) {
      setFormErrors(entries.map((_, i) => (i === 0 ? { machine: "Select a machine to save an entry" } : {})));
      return;
    }

    setFormErrors(errorsPerBlock);
    if (errorsPerBlock.some((errs) => Object.keys(errs).length)) return;

    setIsSaving(true);
    try {
      // Saved one after another rather than in parallel, so a mid-way failure
      // leaves a clear "saved the first N" rather than a scattered result.
      let saved = 0;
      let cleared = 0;
      for (const v of toSave) {
        const res = await saveProductionRow(toPayload(v, modalMode === "edit"));
        if (res?.data?.data) saved += 1;
        else cleared += 1;
      }
      if (modalMode === "edit") toast.success("Entry updated successfully!");
      else toast.success(saved === 1 ? "Entry added successfully!" : `${saved} entries added successfully!`);
      if (cleared) toast.info(`${cleared} block(s) had every field blank, so nothing was saved for them.`);
      closeModal(true);
      fetchRows();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save. Please try again.");
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
  const extent = useMemo(() => {
    if (!rows.length) return null;
    const dates = rows.map((r) => r.date);
    return { from: dates.reduce((a, b) => (b < a ? b : a)), to: dates.reduce((a, b) => (b > a ? b : a)) };
  }, [rows]);

  // Search matches Part Name, Operator, or Drawing No. — the sheet's own
  // rows, not the day-level aggregate figures next to them.
  const searchedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pagedRows;
    return pagedRows.filter((r) =>
      [r.itemName, r.operator, r.drawingNo].some((v) => String(v || "").toLowerCase().includes(q)),
    );
  }, [pagedRows, search]);

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
                  Previous
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
                <Input
                  type="number"
                  bsSize="sm"
                  min={1}
                  max={totalPages}
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
              errors={formErrors}
              isSubmit={isSubmit}
              machines={scopedMachines}
              items={items}
              operators={operators}
              isEdit={modalMode === "edit"}
              onChange={handleChange}
              onItemSelect={handleItemSelect}
              onRejectChange={handleRejectChange}
              onAdd={handleAddBlock}
              onRemove={handleRemoveBlock}
            />
          </ModalBody>
          <ModalFooter>
            {modalMode === "edit" ? (
              <FormUpdateFooter handleUpdate={handleSave} handleUpdateCancel={() => closeModal()} isLoading={isSaving} isSaveDisabled={!canSave} />
            ) : (
              <FormsFooter handleSubmit={handleSave} handleSubmitCancel={() => closeModal()} isLoading={isSaving} isSaveDisabled={!canSave} />
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
