import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
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
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useMachines } from "../hooks/useMachines";
import { useProcesses } from "../hooks/useProcesses";
import { useItems } from "../hooks/useItems";
import {
  deleteProductionRow,
  getOperatorNames,
  getProductionSheet,
  saveProductionRow,
} from "../api/productionSheet.api";
import {
  REJECT_REASONS,
  STOPPAGE_FIELDS,
  dayCalc,
  daysOfMonth,
  isoDay,
  totalCycleSec,
} from "../utils/productionSheet";

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
const TEXT_FIELDS = ["operator", "itemName", "drawingNo", "remarks"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime"];
const NUMBER_FIELDS = ["actualQty", "okQty", "plannedOperatorShiftHours", ...STOPPAGE_KEYS];

const emptyEntry = () => ({
  date: isoDay(new Date()),
  machine: "",
  // Assigned on save from the machine's free slots for that date; kept in the
  // values only because an edited record has to save back to its own slot.
  slot: 1,
  item: "",
  cycleTimeSec: "",
  rejectBreakdown: {},
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, ""])),
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, ""])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, ""])),
});

// A saved record -> form values ("" for anything unset, so inputs stay controlled).
//
// Records saved by the old grid have OK and Rejected but no Actual. Actual is
// back-filled from them here, because the server now derives Rejected from
// Actual − OK: without this, re-saving such a record with Actual left blank
// would quietly wipe its Rejected quantity.
const toFormValues = (row) => {
  const ok = Number(row.okQty);
  const rejected = Number(row.rejectedQty);
  const legacyActual =
    row.actualQty === null || row.actualQty === undefined
      ? [ok, rejected].filter(Number.isFinite).length
        ? (Number.isFinite(ok) ? ok : 0) + (Number.isFinite(rejected) ? rejected : 0)
        : ""
      : row.actualQty;

  return {
    ...emptyEntry(),
    ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)),
    actualQty: legacyActual,
    item: row.item || "",
    slot: row.slot,
    // Records saved by the old grid hold up to five op-wise cycle times; the
    // form has one Cycle Time box, so it shows their total. Every formula uses
    // that total, so the numbers are unchanged — only the op-wise split is
    // dropped, and only once such a record is saved from here.
    cycleTimeSec: totalCycleSec(row.cycleOpsSec) ?? "",
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
  return {
  date: v.date,
  machine: v.machine,
  // An edited record saves back to its own slot; a new one asks the server for
  // the machine's next free slot on that date, since only the server can see
  // every entry — the page may be filtered to one machine.
  slot: isEdit ? Number(v.slot) : "auto",
  item: v.item || null,
  cycleOpsSec: v.cycleTimeSec === "" ? [] : [Number(v.cycleTimeSec)],
  rejectBreakdown: split,
  rejectReason: topReason,
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, String(v[k] ?? "").trim()])),
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, v[k] ?? ""])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, v[k] === "" ? "" : Number(v[k])])),
  };
};

const ProductionSheet = () => {
  const toast = useAlert();
  const { currentPagePermissions } = useContext(MenuContext) || {};
  const canCreate = currentPagePermissions ? !!currentPagePermissions.create : true;
  const canEdit = currentPagePermissions ? !!currentPagePermissions.edit : true;
  const canDelete = currentPagePermissions ? !!currentPagePermissions.delete : true;

  const [month, setMonth] = useState(() => isoDay(new Date()).slice(0, 7));
  const [machineFilter, setMachineFilter] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [operatorNames, setOperatorNames] = useState([]);

  const { data: machines = [] } = useMachines();
  const { data: processes = [] } = useProcesses();
  const { data: items = [] } = useItems();

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

  const days = useMemo(() => daysOfMonth(month), [month]);
  const machineName = useMemo(
    () => Object.fromEntries(machines.map((m) => [m._id, m.machineName])),
    [machines],
  );

  // ── Load ───────────────────────────────────────────────────────────────
  const fetchRows = useCallback(() => {
    setLoading(true);
    getProductionSheet({ from: days[0], to: days[days.length - 1], machine: machineFilter || undefined })
      .then((res) => setRows(res.data.data || []))
      .catch((err) => {
        toast.error(err?.response?.data?.message || "Failed to load entries");
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [days, machineFilter]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    getOperatorNames()
      .then((res) => setOperatorNames(res.data.data || []))
      .catch(() => {});
  }, []);

  const sortedRows = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          (machineName[a.machine] || "").localeCompare(machineName[b.machine] || "", undefined, { numeric: true }) ||
          a.slot - b.slot,
      ),
    [rows, machineName],
  );

  // Same figures per saved record, for the list's OEE column.
  const dayResultByKey = useMemo(() => {
    const groups = {};
    for (const r of rows) (groups[`${r.machine}|${r.date}`] ||= []).push(r);
    return Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, dayCalc(g)]));
  }, [rows]);

  // ── Form ───────────────────────────────────────────────────────────────
  const closeModal = () => {
    setModalMode(null);
    setEntries([emptyEntry()]);
    setFormErrors([]);
    setIsSubmit(false);
  };

  const openAdd = () => {
    setEntries([{ ...emptyEntry(), machine: machineFilter || "" }]);
    setFormErrors([]);
    setIsSubmit(false);
    setModalMode("add");
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
          if (!itemId) return { ...v, item: "", itemName: "" };
          const it = items.find((item) => item._id === itemId);
          if (!it) return { ...v, item: "" };
          return {
            ...v,
            item: it._id,
            itemName: it.itemName,
            drawingNo: it.drawingNo || "",
            cycleTimeSec: totalCycleSec(it.cycleOpsSec) ?? "",
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

    const actual = v.actualQty === "" ? null : Number(v.actualQty);
    const ok = v.okQty === "" ? null : Number(v.okQty);
    if (actual !== null && (!Number.isFinite(actual) || actual < 0)) errors.actualQty = "Must be 0 or more";
    if (ok !== null && (!Number.isFinite(ok) || ok < 0)) errors.okQty = "Must be 0 or more";
    if (actual !== null && ok !== null && ok > actual) errors.okQty = "OK cannot be more than Actual";
    if (ok !== null && actual === null) errors.actualQty = "Enter Actual Quantity too";

    // The per-reason split is what makes rejections readable on the dashboard,
    // so it has to account for every rejected piece — no more, no less.
    const rejected = actual !== null && ok !== null ? actual - ok : 0;
    const split = cleanSplit(v.rejectBreakdown);
    const splitTotal = Object.values(split).reduce((s, n) => s + n, 0);
    if (Object.entries(v.rejectBreakdown || {}).some(([, n]) => n !== "" && (!Number.isFinite(Number(n)) || Number(n) < 0))) {
      errors.rejectBreakdown = "Rejected quantities must be 0 or more";
    } else if (rejected > 0 && splitTotal !== rejected) {
      errors.rejectBreakdown = `Split ${splitTotal} of ${rejected} rejected — the boxes must add up to the rejected quantity`;
    } else if (rejected <= 0 && splitTotal > 0) {
      errors.rejectBreakdown = "Nothing was rejected, so these boxes should be empty";
    }

    const cycle = v.cycleTimeSec === "" ? null : Number(v.cycleTimeSec);
    if (cycle !== null && (!Number.isFinite(cycle) || cycle < 0)) errors.cycleTimeSec = "Must be 0 or more";
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

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSubmit(true);

    // A block whose machine was never picked is one the user added and left
    // alone — skipped rather than reported, so a stray block can't block a save.
    const isUntouched = (v) => !v.machine;
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
      closeModal();
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

  const periodLabel = useMemo(() => {
    const [y, m] = month.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  }, [month]);

  document.title = `Production Data Entry | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>
          <Card>
            <CardHeader>
              <div className="d-flex flex-wrap align-items-center gap-2">
                <h5 className="mb-0 fs-6 fw-semibold">Production Data Entry</h5>

                <div className="ms-auto d-flex flex-wrap align-items-center gap-2">
                  <Input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    style={{ width: "165px" }}
                    bsSize="sm"
                  />
                  <Input
                    type="select"
                    value={machineFilter}
                    onChange={(e) => setMachineFilter(e.target.value)}
                    style={{ width: "170px" }}
                    bsSize="sm"
                  >
                    <option value="">All machines</option>
                    {machines.map((m) => (
                      <option key={m._id} value={m._id}>
                        {m.machineName}
                      </option>
                    ))}
                  </Input>
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
            <CardBody>
              <ProductionEntriesTable
                rows={sortedRows}
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
              />
            </CardBody>
          </Card>
        </Container>
      </div>

      <Modal isOpen={modalMode !== null} toggle={closeModal} centered backdrop="static" keyboard={false} size="xl" scrollable>
        <ModalHeader className="p-3 border-bottom" toggle={closeModal}>
          {modalMode === "edit" ? "Update Production Entry" : "Add Production Entry"}
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
              machines={machines}
              processes={processes}
              items={items}
              operatorNames={operatorNames}
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
              <FormUpdateFooter handleUpdate={handleSave} handleUpdateCancel={closeModal} isLoading={isSaving} />
            ) : (
              <FormsFooter handleSubmit={handleSave} handleSubmitCancel={closeModal} isLoading={isSaving} />
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
