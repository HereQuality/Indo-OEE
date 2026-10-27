import React, { useState, useEffect, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Pencil, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader, Col, Container, Modal, ModalBody, ModalFooter, ModalHeader, Label, Input, Row } from "reactstrap";
import DataTable from "react-data-table-component";
import DeleteModal from "../Components/Common/DeleteModal";
import FormsHeader from "../Components/Common/FormsModalHeader";
import FormsFooter from "../Components/Common/FormAddFooter";
import FormUpdateFooter from "../Components/Common/FormUpdateFooter";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useInvalidateItems } from "../hooks/useItems";
import { PROCESSES_QUERY_KEY, useProcesses } from "../hooks/useProcesses";
import { createItem, deleteItem, getItemById, updateItem, searchItems } from "../api/items.api";
import { searchProcesses } from "../api/processes.api";
import { CYCLE_OP_FIELDS, cycleOpLabel } from "../utils/productionSheet";
import { isCncProcess, isVmcProcess } from "../utils/vmcSheet";
import { SPM_OP_FIELDS, SPM_REFERENCE_FIELDS, isSpmProcess } from "../utils/spmSheet";
import { RIVET_OP_FIELDS, RIVET_PROCESS_TYPES, isRivetProcess } from "../utils/rivetSheet";
import { PRESS_OPERATIONS, isPressProcess } from "../utils/pressSheet";
import { isContactProcess } from "../utils/contactSheet";
import { isTrobeProcess } from "../utils/trobeSheet";
import { isSpringProcess } from "../utils/springSheet";
import { isPowderCoatingProcess } from "../utils/powderCoatingSheet";
import { isRubberProcess } from "../utils/rubberSheet";
import { isInjectionProcess } from "../utils/injectionSheet";
import { isEmbossingProcess } from "../utils/embossingSheet";
import { isBpcProcess } from "../utils/bpcSheet";
import { isFinalAssemblyProcess } from "../utils/finalAssemblySheet";
import { isPrintingProcess } from "../utils/printingSheet";
import { isRawCastingProcess } from "../utils/rawCastingSheet";
import { MFA_LABELS, isMfaProcess } from "../utils/mfaSheet";
import { MFD_OPERATIONS, isMfdProcess } from "../utils/mfdSheet";
import NumberInput from "../Components/Production/NumberInput";
import ItemHistoryModal from "../Components/Production/ItemHistoryModal";

const emptyOps = () => Object.fromEntries(CYCLE_OP_FIELDS.map((f) => [f.key, ""]));
const emptySpmOps = () => Object.fromEntries(SPM_OP_FIELDS.map((f) => [f.key, ""]));
const emptySpmReference = () => Object.fromEntries(SPM_REFERENCE_FIELDS.map((f) => [f.key, ""]));
const emptyRivetOps = () => Object.fromEntries(RIVET_OP_FIELDS.map((f) => [f.key, ""]));

// Total Cycle Time is the operation times' own sum — never typed separately.
// Blank when every operation box is blank, rather than showing a false "0".
const sumOps = (v) => {
  const nums = CYCLE_OP_FIELDS.map((f) => v[f.key]).filter((n) => n !== "" && n !== null && n !== undefined);
  if (!nums.length) return "";
  return nums.reduce((s, n) => s + Number(n), 0);
};

// Same idea, for SPM's own four operations.
const sumSpmOps = (v) => {
  const nums = SPM_OP_FIELDS.map((f) => v[f.key]).filter((n) => n !== "" && n !== null && n !== undefined);
  if (!nums.length) return "";
  return nums.reduce((s, n) => s + Number(n), 0);
};

// Same idea, for RIVET's own four operations.
const sumRivetOps = (v) => {
  const nums = RIVET_OP_FIELDS.map((f) => v[f.key]).filter((n) => n !== "" && n !== null && n !== undefined);
  if (!nums.length) return "";
  return nums.reduce((s, n) => s + Number(n), 0);
};

// A worked-out time (VMC's or PRESS's program ÷ pieces) shown to 2 decimals
// rather than 62.142857142857146. Display only — the full figure is what's saved.
const showSec = (n) => (n === "" || n === null || n === undefined || !Number.isFinite(Number(n)) ? n ?? "" : Number(Number(n).toFixed(2)));

// SPRING FOR PINS and AFTER POWDER COATING call their one typed-in time what
// their own data entry sheet calls it; every other process says Total Cycle Time.
// (BEFORE POWDER COATING says Standard Time per Piece too.)
// (INJECTION MOULDING says Standard Time per Piece too.)
const cycleTimeName = (process) =>
  isSpringProcess(process) || isBpcProcess(process) || isFinalAssemblyProcess(process) || isInjectionProcess(process) || isEmbossingProcess(process) || isPrintingProcess(process)
    ? "Standard Time per Piece"
    : isPowderCoatingProcess(process) || isRawCastingProcess(process)
      ? "Standard Inspection Time per Piece"
      : isMfaProcess(process)
        ? MFA_LABELS.cycle
        : "Total Cycle Time";
// (RAW CASTING is an inspection sheet too: Standard Inspection Time per Piece;
// MODULAR FRAME ASSEMBLY words its own, MFA_LABELS in utils/mfaSheet.js.)
const cycleTimeLabel = (process) =>
  isSpringProcess(process) || isPowderCoatingProcess(process) || isBpcProcess(process) || isFinalAssemblyProcess(process) || isInjectionProcess(process) || isEmbossingProcess(process) || isPrintingProcess(process) || isRawCastingProcess(process) || isMfaProcess(process) ? `${cycleTimeName(process)} (Sec)` : "Total Cycle Time (sec)";

const initialState = {
  itemName: "",
  // Which process runs this part — decides which data entry page offers it, and
  // whether it carries operation times (CNC), a program (VMC — Program Time and
  // No. of Piece In One Program) or its own four operations (SPM — Loading,
  // Process, Unloading and Cleaning, Other Operations), all set once here.
  process: "",
  drawingNo: "",
  totalCycleSec: "",
  programTimeMin: "",
  pcsPerProgram: "",
  standardTimeMin: "",
  pcsPerStandardTime: "",
  rivetProcessType: "",
  pressOperation: "",
  // MODULAR FRAME DRILLING parts: their Process (DRILLING, TAPPING, …).
  mfdOperation: "",
  ...emptyOps(),
  ...emptySpmOps(),
  ...emptySpmReference(),
  ...emptyRivetOps(),
  isActive: true,
};

const ItemMaster = () => {
  const toast = useAlert();
  const {
    currentPagePermissions = { read: true, write: true, edit: true, delete: true },
    isAdmin,
    getPermissionsForMenu,
    findMenuIdByUrl,
  } = useContext(MenuContext) || {};

  const [values, setValues] = useState(initialState);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmit, setIsSubmit] = useState(false);
  const [filter, setFilter] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);

  const [items, setItems] = useState([]);
  const invalidateItems = useInvalidateItems();
  const [query, setQuery] = useState("");
  // Parts are told apart by process: the list can be narrowed to one ("" = all,
  // "none" = parts not in any process yet), and the form picks it.
  const { data: activeProcesses = [] } = useProcesses();
  // Inactive processes too: a part can still belong to a process that has since
  // been deactivated, and it needs that process to show its name and the right
  // cycle time boxes (missing, the form showed none and Save cleared them). The
  // route behind this list is Process Master's, so it's only asked for by
  // someone who may open that page; anyone else gets the active ones.
  const canListAllProcesses = !!(isAdmin || getPermissionsForMenu?.(findMenuIdByUrl?.("/x/production/processes"))?.view);
  const { data: allProcesses } = useQuery({
    queryKey: [...PROCESSES_QUERY_KEY, "withInactive"],
    queryFn: async () => (await searchProcesses({ skip: 0, per_page: 1000 }))?.data?.data?.[0]?.data || [],
    enabled: canListAllProcesses,
    retry: false,
  });
  const processes = (canListAllProcesses && allProcesses) || activeProcesses;
  const processName = Object.fromEntries(
    processes.map((p) => [p._id, p.isActive === false ? `${p.processName} (inactive)` : p.processName]),
  );
  const [processFilter, setProcessFilter] = useState("");
  // A VMC part has a program; a CNC or SPM part has operation times (CNC's
  // eight, SPM's own four); anything else (not in a process yet, or another
  // process type) carries neither.
  const selectedProcess = useMemo(() => processes.find((p) => p._id === values.process), [processes, values.process]);
  const isVmc = useMemo(() => isVmcProcess(selectedProcess), [selectedProcess]);
  const isCnc = useMemo(() => isCncProcess(selectedProcess), [selectedProcess]);
  const isSpm = useMemo(() => isSpmProcess(selectedProcess), [selectedProcess]);
  const isRivet = useMemo(() => isRivetProcess(selectedProcess), [selectedProcess]);
  const isPress = useMemo(() => isPressProcess(selectedProcess), [selectedProcess]);
  // MODULAR FRAME DRILLING: Process, No. of Holes, Stroke Required and a typed Total Cycle Time.
  const isMfd = useMemo(() => isMfdProcess(selectedProcess), [selectedProcess]);
  // TROBE, SPRING FOR PINS, AFTER POWDER COATING and RUBBER parts work the same way as
  // Contact ones: one Total Cycle Time (for After Powder Coating, its Standard
  // Inspection Time per Piece), typed straight in.
  const isContact = useMemo(
    () =>
      isContactProcess(selectedProcess) ||
      isTrobeProcess(selectedProcess) ||
      isSpringProcess(selectedProcess) ||
      isInjectionProcess(selectedProcess) ||
      isEmbossingProcess(selectedProcess) ||
      isPowderCoatingProcess(selectedProcess) ||
      isBpcProcess(selectedProcess) ||
      isFinalAssemblyProcess(selectedProcess) ||
      isPrintingProcess(selectedProcess) ||
      isRawCastingProcess(selectedProcess) ||
      isMfaProcess(selectedProcess) ||
      isRubberProcess(selectedProcess),
    [selectedProcess],
  );
  // The form's Process picker: active processes, plus the one this part
  // already has if that one is inactive, so editing it never drops it.
  const processOptions = processes.filter((p) => p.isActive !== false || p._id === values.process);
  // A process this page can't look up at all (inactive, for someone without
  // Process Master) says nothing about which boxes the part has.
  const unknownProcess = !!values.process && !selectedProcess;

  const [_id, set_Id] = useState("");
  const [remove_id, setRemove_id] = useState("");

  // null = closed, "add" or "edit"
  const [modalMode, setModalMode] = useState(null);
  const [modal_delete, setmodal_delete] = useState(false);
  // The edit history: one part's, or (historyItem null) every part's.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState(null);

  const [loading, setLoading] = useState(false);
  const [totalRows, setTotalRows] = useState(0);
  const [pageNo, setPageNo] = useState(1);
  const [column, setcolumn] = useState();
  const [sortDirection, setsortDirection] = useState();
  const perPage = 100;

  const closeModal = () => {
    setModalMode(null);
    setValues(initialState);
    setIsSubmit(false);
    setFormErrors({});
  };

  const openAdd = () => {
    setValues(initialState);
    setIsSubmit(false);
    setFormErrors({});
    setModalMode("add");
  };

  const openEdit = (id) => {
    set_Id(id);
    setIsSubmit(false);
    setFormErrors({});
    setModalMode("edit");
    setIsLoading(true);
    getItemById(id)
      .then((res) => {
        const it = res.data.data;
        setValues({
          itemName: it.itemName,
          process: it.process || "",
          drawingNo: it.drawingNo || "",
          totalCycleSec: it.totalCycleSec ?? "",
          programTimeMin: it.programTimeMin ?? "",
          pcsPerProgram: it.pcsPerProgram ?? "",
          standardTimeMin: it.standardTimeMin ?? "",
          pcsPerStandardTime: it.pcsPerStandardTime ?? "",
          rivetProcessType: it.rivetProcessType || "",
          pressOperation: it.pressOperation || "",
          mfdOperation: it.mfdOperation || "",
          ...Object.fromEntries(CYCLE_OP_FIELDS.map((f) => [f.key, it[f.key] ?? ""])),
          ...Object.fromEntries(SPM_OP_FIELDS.map((f) => [f.key, it[f.key] ?? ""])),
          ...Object.fromEntries(SPM_REFERENCE_FIELDS.map((f) => [f.key, it[f.key] ?? ""])),
          ...Object.fromEntries(RIVET_OP_FIELDS.map((f) => [f.key, it[f.key] ?? ""])),
          isActive: it.isActive,
        });
      })
      .catch(() => toast.error("Failed to fetch part details"))
      .finally(() => setIsLoading(false));
  };

  const tog_delete = (id) => {
    setmodal_delete(!modal_delete);
    setRemove_id(id);
  };

  const openHistory = (row = null) => {
    setHistoryItem(row);
    setHistoryOpen(true);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues((v) => {
      const next = { ...v, [name]: value };
      // Total Cycle Time is derived from the operation boxes, so any of
      // their changes recompute it — it's never typed on its own.
      if (CYCLE_OP_FIELDS.some((f) => f.key === name)) next.totalCycleSec = sumOps(next);
      if (SPM_OP_FIELDS.some((f) => f.key === name)) next.totalCycleSec = sumSpmOps(next);
      if (RIVET_OP_FIELDS.some((f) => f.key === name)) next.totalCycleSec = sumRivetOps(next);
      return next;
    });
  };

  const validate = (v) => {
    const errors = {};
    if (!v.itemName.trim()) errors.itemName = "Part Name is required!";
    if (!v.drawingNo.trim()) errors.drawingNo = "Drawing No. is required!";
    // Only a CNC part's form shows the Operation Times boxes — nothing else
    // to validate for a VMC part or one in no process / another process type.
    if (isCnc && CYCLE_OP_FIELDS.some((f) => v[f.key] !== "" && (!Number.isFinite(Number(v[f.key])) || Number(v[f.key]) < 0))) {
      errors.cycleOps = "Cycle times must be 0 or more";
    }
    // A VMC part's program drives its Product Cycle Time everywhere this part
    // is used (every VMC Data Entry row), so it has to be set here, not left
    // to be typed — or guessed — on the entry form.
    if (isVmc) {
      const program = v.programTimeMin === "" ? NaN : Number(v.programTimeMin);
      if (v.programTimeMin === "") errors.programTimeMin = "Program Time is required";
      else if (!Number.isFinite(program) || program <= 0) errors.programTimeMin = "Must be more than 0";
      const pieces = v.pcsPerProgram === "" ? NaN : Number(v.pcsPerProgram);
      if (v.pcsPerProgram === "") errors.pcsPerProgram = "No. of Piece In One Program is required";
      else if (!Number.isInteger(pieces) || pieces < 1) errors.pcsPerProgram = "Must be a whole number, 1 or more";
    }
    // An SPM part's four operations drive its Total Cycle Time everywhere
    // this part is used, so all four have to be set here, same reasoning as
    // VMC's program above.
    if (isSpm) {
      for (const f of SPM_OP_FIELDS) {
        if (v[f.key] === "") errors[f.key] = `${f.label.replace(" (sec)", "")} is required`;
        else if (!Number.isFinite(Number(v[f.key])) || Number(v[f.key]) < 0) errors[f.key] = "Must be 0 or more";
      }
      for (const f of SPM_REFERENCE_FIELDS) {
        if (v[f.key] === "") errors[f.key] = `${f.label} is required`;
        else if (!Number.isFinite(Number(v[f.key])) || Number(v[f.key]) < 0) errors[f.key] = "Must be 0 or more";
      }
      // The sheet divides by it, so a cycle has to make at least one piece.
      if (!errors.piecesPerCycle && Number(v.piecesPerCycle) < 1) errors.piecesPerCycle = "Must be 1 or more";
    }
    // A RIVET part's four operations drive its Total Cycle Time everywhere
    // this part is used, same reasoning as SPM's above.
    if (isRivet) {
      for (const f of RIVET_OP_FIELDS) {
        if (v[f.key] === "") errors[f.key] = `${f.label.replace(" (sec)", "")} is required`;
        else if (!Number.isFinite(Number(v[f.key])) || Number(v[f.key]) < 0) errors[f.key] = "Must be 0 or more";
      }
      if (!v.rivetProcessType) errors.rivetProcessType = "Process is required";
    }
    // A PRESS part's standard time drives its Product Cycle Time everywhere
    // this part is used, same reasoning as VMC's program above.
    if (isPress) {
      const standard = v.standardTimeMin === "" ? NaN : Number(v.standardTimeMin);
      if (v.standardTimeMin === "") errors.standardTimeMin = "Standard Time Taken is required";
      else if (!Number.isFinite(standard) || standard <= 0) errors.standardTimeMin = "Must be more than 0";
      const pieces = v.pcsPerStandardTime === "" ? NaN : Number(v.pcsPerStandardTime);
      if (v.pcsPerStandardTime === "") errors.pcsPerStandardTime = "No. Piece in Standard Time is required";
      else if (!Number.isInteger(pieces) || pieces < 1) errors.pcsPerStandardTime = "Must be a whole number, 1 or more";
      if (!v.pressOperation) errors.pressOperation = "Operation is required";
    }
    // A MODULAR FRAME DRILLING part's Process, No. of Holes and Stroke Required
    // are shown on every entry it's picked on, and its Total Cycle Time fills
    // in each entry's own (still changeable there for the day).
    if (isMfd) {
      if (!v.mfdOperation) errors.mfdOperation = "Process is required";
      for (const [key, label] of [
        ["noOfHoles", "No. of Holes in One Piece"],
        ["strokeRequired", "Stroke Required for One Piece"],
      ]) {
        if (v[key] === "" || v[key] === null || v[key] === undefined) errors[key] = `${label} is required`;
        else if (!Number.isInteger(Number(v[key])) || Number(v[key]) < 0) errors[key] = "Must be a whole number, 0 or more";
      }
      const cycle = v.totalCycleSec === "" ? NaN : Number(v.totalCycleSec);
      if (v.totalCycleSec === "") errors.totalCycleSec = "Total Cycle Time is required";
      else if (!Number.isFinite(cycle) || cycle <= 0) errors.totalCycleSec = "Must be more than 0";
    }
    // A Contact part has no operation breakdown — its Total Cycle Time is
    // typed straight in here and drives every Contact Data Entry row.
    if (isContact) {
      const cycle = v.totalCycleSec === "" ? NaN : Number(v.totalCycleSec);
      // FINAL ASSEMBLY: optional — PACKING has none.
      if (v.totalCycleSec === "") {
        if (!isFinalAssemblyProcess(selectedProcess)) errors.totalCycleSec = `${cycleTimeName(selectedProcess)} is required`;
      }
      else if (!Number.isFinite(cycle) || cycle <= 0) errors.totalCycleSec = "Must be more than 0";
    }
    return errors;
  };

  // Once Save has been pressed, the messages follow the form as it is fixed.
  useEffect(() => {
    if (isSubmit) setFormErrors(validate(values));
  }, [values, isSubmit]);

  const handleSave = (e) => {
    e.preventDefault();
    const errors = validate(values);
    setFormErrors(errors);
    setIsSubmit(true);
    if (Object.keys(errors).length) return;

    const num = (x) => (x === "" ? null : Number(x));
    // Only the fields the form showed are kept: a part moved off CNC drops its
    // operation times, one moved off VMC drops its program, and one moved off
    // SPM drops its own four operations — so a part never carries another
    // kind's leftovers.
    const noProgram = { programTimeMin: null, pcsPerProgram: null };
    const noPress = { standardTimeMin: null, pcsPerStandardTime: null };
    const noCycleOps = Object.fromEntries(CYCLE_OP_FIELDS.map((f) => [f.key, null]));
    const noSpmOps = Object.fromEntries(SPM_OP_FIELDS.map((f) => [f.key, null]));
    const noSpmReference = Object.fromEntries(SPM_REFERENCE_FIELDS.map((f) => [f.key, null]));
    const noRivetOps = Object.fromEntries(RIVET_OP_FIELDS.map((f) => [f.key, null]));
    const noRivetProcessType = { rivetProcessType: null };
    const noPressOperation = { pressOperation: null };
    const noneOfThem = {
      ...noProgram,
      ...noPress,
      totalCycleSec: null,
      ...noCycleOps,
      ...noSpmOps,
      ...noSpmReference,
      ...noRivetOps,
      ...noRivetProcessType,
      ...noPressOperation,
    };
    // A process this page couldn't look up showed none of the boxes, so none
    // are sent at all (undefined is left out of the request) and the server
    // keeps whatever the part already has, instead of clearing it.
    const leaveAsTheyAre = Object.fromEntries(Object.keys(noneOfThem).map((k) => [k, undefined]));
    const cycleFields = isCnc
      ? {
          ...noProgram,
          ...noPress,
          totalCycleSec: num(values.totalCycleSec),
          ...Object.fromEntries(CYCLE_OP_FIELDS.map((f) => [f.key, num(values[f.key])])),
          ...noSpmOps,
          ...noSpmReference,
          ...noRivetOps,
          ...noRivetProcessType,
          ...noPressOperation,
        }
      : isVmc
        ? {
            programTimeMin: num(values.programTimeMin),
            pcsPerProgram: num(values.pcsPerProgram),
            // Kept in step so the Parts list's own Total Cycle (sec) column
            // (and anything else reading it directly) shows the same figure
            // the VMC Data Entry sheet computes from this program.
            totalCycleSec: (Number(values.programTimeMin) * 60) / Number(values.pcsPerProgram),
            ...noPress,
            ...noCycleOps,
            ...noSpmOps,
            ...noSpmReference,
            ...noRivetOps,
            ...noRivetProcessType,
            ...noPressOperation,
          }
        : isSpm
          ? {
              ...noProgram,
              ...noPress,
              totalCycleSec: num(values.totalCycleSec),
              ...noCycleOps,
              ...Object.fromEntries(SPM_OP_FIELDS.map((f) => [f.key, num(values[f.key])])),
              ...Object.fromEntries(SPM_REFERENCE_FIELDS.map((f) => [f.key, num(values[f.key])])),
              ...noRivetOps,
              ...noRivetProcessType,
              ...noPressOperation,
            }
          : isRivet
            ? {
                ...noProgram,
                ...noPress,
                totalCycleSec: num(values.totalCycleSec),
                ...noCycleOps,
                ...noSpmOps,
                ...noSpmReference,
                ...Object.fromEntries(RIVET_OP_FIELDS.map((f) => [f.key, num(values[f.key])])),
                rivetProcessType: values.rivetProcessType,
                ...noPressOperation,
              }
            : isPress
              ? {
                  ...noProgram,
                  standardTimeMin: num(values.standardTimeMin),
                  pcsPerStandardTime: num(values.pcsPerStandardTime),
                  // Kept in step so the Parts list's own Total Cycle (sec)
                  // column shows the same figure the PRESS Data Entry sheet
                  // computes from this standard time.
                  totalCycleSec: (Number(values.standardTimeMin) * 60) / Number(values.pcsPerStandardTime),
                  ...noCycleOps,
                  ...noSpmOps,
                  ...noSpmReference,
                  ...noRivetOps,
                  ...noRivetProcessType,
                  pressOperation: values.pressOperation,
                }
              : isMfd
                ? {
                    ...noProgram,
                    ...noPress,
                    totalCycleSec: num(values.totalCycleSec),
                    ...noCycleOps,
                    ...noSpmOps,
                    // No. of Holes / Stroke Required are SPM's own reference fields, reused.
                    ...noSpmReference,
                    noOfHoles: num(values.noOfHoles),
                    strokeRequired: num(values.strokeRequired),
                    ...noRivetOps,
                    ...noRivetProcessType,
                    ...noPressOperation,
                  }
              : isContact
                ? {
                    ...noProgram,
                    ...noPress,
                    totalCycleSec: num(values.totalCycleSec),
                    ...noCycleOps,
                    ...noSpmOps,
                    ...noSpmReference,
                    ...noRivetOps,
                    ...noRivetProcessType,
                    ...noPressOperation,
                  }
              : unknownProcess
                ? leaveAsTheyAre
                : noneOfThem;
    const data = {
      ...values,
      itemName: values.itemName.trim(),
      drawingNo: values.drawingNo.trim(),
      ...cycleFields,
      // MODULAR FRAME DRILLING's Process belongs to its parts only (kept as is
      // for a process this page couldn't look up, like the boxes above).
      mfdOperation: isMfd ? values.mfdOperation : unknownProcess ? undefined : null,
    };

    setIsLoading(true);
    const request = modalMode === "add" ? createItem(data) : updateItem(_id, data);
    request
      .then(() => {
        toast.success(modalMode === "add" ? "Part Added Successfully!" : "Part Updated Successfully!");
        closeModal();
        fetchItems();
        invalidateItems();
      })
      .catch((err) => toast.error(err?.response?.data?.message || "Failed to save part. Please try again."))
      .finally(() => setIsLoading(false));
  };

  const handleDelete = (e) => {
    e.preventDefault();
    setIsDeleteLoading(true);
    deleteItem(remove_id)
      .then((res) => {
        setmodal_delete(false);
        toast.success(res?.data?.message || "Part Removed Successfully!");
        fetchItems();
        invalidateItems();
      })
      .catch(() => {
        setmodal_delete(false);
        toast.error("Failed to delete part. Please try again.");
      })
      .finally(() => setIsDeleteLoading(false));
  };

  useEffect(() => {
    const timeout = setTimeout(() => fetchItems(), 500);
    return () => clearTimeout(timeout);
  }, [pageNo, column, sortDirection, query, filter, processFilter]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const response = await searchItems({
        skip: Math.max(0, (pageNo - 1) * perPage),
        per_page: perPage,
        sorton: column,
        sortdir: sortDirection,
        match: query,
        // "Active only" off lists every part, active or not.
        ...(filter ? { isActive: true } : {}),
        ...(processFilter ? { process: processFilter } : {}),
      });
      const res = response.data.data[0];
      setTotalRows(res?.count || 0);
      setItems(res?.data || []);
    } catch (error) {
      console.error("Error fetching parts:", error);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  // Narrowed to SPRING FOR PINS or AFTER POWDER COATING, the cycle column takes
  // that process's own name for the time; across processes it stays generic.
  const filteredProcess = processes.find((p) => p._id === processFilter);
  const cycleColumn =
    isSpringProcess(filteredProcess) || isPowderCoatingProcess(filteredProcess) || isBpcProcess(filteredProcess) || isFinalAssemblyProcess(filteredProcess) || isInjectionProcess(filteredProcess) || isEmbossingProcess(filteredProcess) || isPrintingProcess(filteredProcess) || isRawCastingProcess(filteredProcess) || isMfaProcess(filteredProcess)
      ? cycleTimeLabel(filteredProcess)
      : "Total Cycle (sec)";

  const col = [
    // Numbered on from the previous page rather than starting at 1 again.
    { name: "Sr No", selector: (row, index) => (pageNo - 1) * perPage + index + 1, maxWidth: "20px" },
    { name: "Part Name", selector: (row) => row.itemName, sortable: true, sortField: "itemName", minWidth: "220px", wrap: true },
    // A part's process stays named even after that process is deactivated.
    { name: "Process", selector: (row) => processName[row.process] || (row.process && processes.length ? "Inactive process" : "—"), minWidth: "110px", wrap: true },
    { name: "Drawing No.", selector: (row) => row.drawingNo || "", sortable: true, sortField: "drawingNo", minWidth: "120px", wrap: true },
    { name: cycleColumn, selector: (row) => showSec(row.totalCycleSec), sortable: true, sortField: "totalCycleSec", minWidth: "130px" },
    { name: "Status", selector: (row) => (row.isActive ? "Active" : "Inactive"), minWidth: "100px" },
    {
      name: "Action",
      cell: (row) => (
        <div className="d-flex gap-2">
          <button className="btn btn-sm btn-soft-info btn-icon fs-14" title="History" onClick={() => openHistory(row)}>
            <History size={16} className="text-info" />
          </button>
          {currentPagePermissions.edit && (
            <button className="btn btn-sm btn-soft-success btn-icon fs-14" title="Edit" onClick={() => openEdit(row._id)}>
              <Pencil size={16} className="text-success" />
            </button>
          )}
          {currentPagePermissions.delete && (
            <button className="btn btn-sm btn-soft-danger btn-icon fs-14" title="Remove" onClick={() => tog_delete(row._id)}>
              <Trash2 size={16} className="text-danger" />
            </button>
          )}
        </div>
      ),
      minWidth: "180px",
    },
  ];

  document.title = `Part Master | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;

  return (
    <React.Fragment>
      <div className="page-content">
        <Container fluid>
          <Row>
            <Col lg={12}>
              <Card>
                <CardHeader>
                  <FormsHeader
                    formName="Part"
                    filter={filter}
                    handleFilter={(e) => {
                      setPageNo(1);
                      setFilter(e.target.checked);
                    }}
                    tog_list={openAdd}
                    setQuery={setQuery}
                    showAddButton={currentPagePermissions.create}
                    extraControls={
                      <>
                        <select
                          value={processFilter}
                          onChange={(e) => {
                            setPageNo(1);
                            setProcessFilter(e.target.value);
                          }}
                          title="Show the parts of one process"
                          className="w-full sm:w-44 bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 transition-all text-slate-700"
                        >
                          <option value="">All processes</option>
                          {processes.map((p) => (
                            <option key={p._id} value={p._id}>
                              {processName[p._id]}
                            </option>
                          ))}
                          <option value="none">Not in any process</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => openHistory()}
                          title="Every change made to any part, including parts since deleted"
                          className="inline-flex items-center justify-center gap-1.5 shrink-0 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-700 transition-colors"
                        >
                          <History size={16} />
                          History
                        </button>
                      </>
                    }
                  />
                </CardHeader>
                <CardBody>
                  <div className="table-responsive table-card mt-1 mb-1 text-right">
                    <DataTable
                      columns={col}
                      data={items}
                      progressPending={loading}
                      sortServer
                      onSort={(c, dir) => {
                        setcolumn(c.sortField);
                        setsortDirection(dir);
                      }}
                      pagination
                      paginationServer
                      paginationComponentOptions={{ noRowsPerPage: true }}
                      paginationTotalRows={totalRows}
                      paginationPerPage={perPage}
                      onChangePage={setPageNo}
                    />
                  </div>
                </CardBody>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>

      <Modal isOpen={modalMode !== null} toggle={closeModal} centered backdrop="static" size="lg" scrollable>
        <ModalHeader className="p-3 border-bottom" toggle={closeModal}>
          {modalMode === "edit" ? "Update Part" : "Add Part"}
        </ModalHeader>
        <form noValidate onSubmit={handleSave}>
          <ModalBody>
            <div className="form-floating mb-3">
              <Input type="text" name="itemName" value={values.itemName} onChange={handleChange} placeholder=" " maxLength={120} />
              <Label>
                Part Name <span className="text-danger">*</span>
              </Label>
              {isSubmit && <p className="text-danger">{formErrors.itemName}</p>}
            </div>
            <div className="form-floating mb-3">
              <Input type="select" name="process" value={values.process} onChange={handleChange}>
                <option value="">Not in any process</option>
                {processOptions.map((p) => (
                  <option key={p._id} value={p._id}>
                    {processName[p._id]}
                  </option>
                ))}
                {unknownProcess && <option value={values.process}>Current process (inactive)</option>}
              </Input>
              <Label>Process (the data entry page that offers this part)</Label>
            </div>
            <div className="form-floating mb-3">
              <Input type="text" name="drawingNo" value={values.drawingNo} onChange={handleChange} placeholder=" " maxLength={40} />
              <Label>
                Drawing No. <span className="text-danger">*</span>
              </Label>
              {isSubmit && formErrors.drawingNo && <p className="text-danger">{formErrors.drawingNo}</p>}
            </div>
            {isVmc ? (
              // A VMC part's program drives its Product Cycle Time everywhere
              // it's used — set once here, copied onto every VMC Data Entry
              // row the part is picked on (still editable there as just the
              // read-only, ticked-off-able figures, never retyped).
              <Row className="g-2 align-items-end mb-1">
                <Col xs={6} md={6}>
                  <div className="form-floating">
                    <NumberInput name="programTimeMin" value={values.programTimeMin} onChange={handleChange} placeholder=" " />
                    <Label>
                      Program Time (min) <span className="text-danger">*</span>
                    </Label>
                  </div>
                  {isSubmit && formErrors.programTimeMin && <p className="text-danger mb-0 small mt-1">{formErrors.programTimeMin}</p>}
                </Col>
                <Col xs={6} md={6}>
                  <div className="form-floating">
                    <NumberInput name="pcsPerProgram" value={values.pcsPerProgram} onChange={handleChange} decimals={false} placeholder=" " />
                    <Label>
                      No. of Piece In One Program <span className="text-danger">*</span>
                    </Label>
                  </div>
                  {isSubmit && formErrors.pcsPerProgram && <p className="text-danger mb-0 small mt-1">{formErrors.pcsPerProgram}</p>}
                </Col>
                {/* Never typed on its own — Program Time × 60 ÷ No. of Piece
                    In One Program, worked out live so this matches what Save
                    will store without waiting for a round trip. */}
                <Col xs={12} className="mt-3">
                  <div className="form-floating">
                    <NumberInput
                      name="vmcTotalCycleSec"
                      value={
                        values.programTimeMin !== "" && values.pcsPerProgram !== "" && Number(values.pcsPerProgram) > 0
                          ? showSec((Number(values.programTimeMin) * 60) / Number(values.pcsPerProgram))
                          : ""
                      }
                      onChange={() => {}}
                      placeholder=" "
                      disabled
                    />
                    <Label>Total Cycle Time (sec) — calculated</Label>
                  </div>
                </Col>
              </Row>
            ) : isCnc ? (
              <>
                <Label className="mb-2 d-block">Operation Times (sec)</Label>
                <Row className="g-2 align-items-end">
                  {CYCLE_OP_FIELDS.map((f) => (
                    <Col key={f.key} xs={6} md={3}>
                      <div className="form-floating">
                        <NumberInput
                          name={f.key}
                          value={values[f.key]}
                          onChange={handleChange}
                          decimals={false}
                          placeholder=" "
                        />
                        <Label>{cycleOpLabel(f).replace(" (sec)", "")}</Label>
                      </div>
                    </Col>
                  ))}
                </Row>
                {isSubmit && formErrors.cycleOps && <p className="text-danger mt-1">{formErrors.cycleOps}</p>}
                {/* Never typed on its own — it's this part's operation times'
                    own sum, kept in step by handleChange as soon as any of them
                    changes, so it can't drift out of sync with its own inputs. */}
                <div className="form-floating mt-3">
                  <NumberInput
                    name="totalCycleSec"
                    value={values.totalCycleSec}
                    onChange={() => {}}
                    decimals={false}
                    placeholder=" "
                    disabled
                  />
                  <Label>Total Cycle Time (sec) — calculated</Label>
                </div>
              </>
            ) : isSpm ? (
              <>
                <Row className="g-2 align-items-end mb-1">
                  {SPM_REFERENCE_FIELDS.map((f) => (
                    <Col key={f.key} xs={12} md={6}>
                      <div className="form-floating">
                        <NumberInput name={f.key} value={values[f.key]} onChange={handleChange} decimals={false} placeholder=" " />
                        <Label>
                          {f.label} <span className="text-danger">*</span>
                        </Label>
                      </div>
                      {isSubmit && formErrors[f.key] && <p className="text-danger mb-0 small mt-1">{formErrors[f.key]}</p>}
                    </Col>
                  ))}
                </Row>
                <Label className="mb-2 d-block">
                  Operation Times (sec) <span className="text-danger">*</span>
                </Label>
                <Row className="g-2 align-items-end">
                  {SPM_OP_FIELDS.map((f) => (
                    <Col key={f.key} xs={6} md={3}>
                      <div className="form-floating">
                        <NumberInput name={f.key} value={values[f.key]} onChange={handleChange} decimals={false} placeholder=" " />
                        <Label>{f.label.replace(" (sec)", "")}</Label>
                      </div>
                      {isSubmit && formErrors[f.key] && <p className="text-danger mb-0 small mt-1">{formErrors[f.key]}</p>}
                    </Col>
                  ))}
                </Row>
                {/* Never typed on its own — it's this part's operation times'
                    own sum, kept in step by handleChange as soon as any of them
                    changes, so it can't drift out of sync with its own inputs. */}
                <div className="form-floating mt-3">
                  <NumberInput
                    name="totalCycleSec"
                    value={values.totalCycleSec}
                    onChange={() => {}}
                    decimals={false}
                    placeholder=" "
                    disabled
                  />
                  <Label>Total Cycle Time (sec) — calculated</Label>
                </div>
              </>
            ) : isRivet ? (
              <>
                <div className="form-floating mb-3">
                  <Input type="select" name="rivetProcessType" value={values.rivetProcessType} onChange={handleChange}>
                    <option value="">Select process</option>
                    {RIVET_PROCESS_TYPES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Input>
                  <Label>
                    Process <span className="text-danger">*</span>
                  </Label>
                  {isSubmit && formErrors.rivetProcessType && <p className="text-danger">{formErrors.rivetProcessType}</p>}
                </div>
                <Label className="mb-2 d-block">
                  Operation Times (sec) <span className="text-danger">*</span>
                </Label>
                <Row className="g-2 align-items-end">
                  {RIVET_OP_FIELDS.map((f) => (
                    <Col key={f.key} xs={6} md={3}>
                      <div className="form-floating">
                        <NumberInput name={f.key} value={values[f.key]} onChange={handleChange} decimals={false} placeholder=" " />
                        <Label>{f.label.replace(" (sec)", "")}</Label>
                      </div>
                      {isSubmit && formErrors[f.key] && <p className="text-danger mb-0 small mt-1">{formErrors[f.key]}</p>}
                    </Col>
                  ))}
                </Row>
                {/* Never typed on its own — it's this part's operation times'
                    own sum, kept in step by handleChange as soon as any of them
                    changes, so it can't drift out of sync with its own inputs. */}
                <div className="form-floating mt-3">
                  <NumberInput
                    name="totalCycleSec"
                    value={values.totalCycleSec}
                    onChange={() => {}}
                    decimals={false}
                    placeholder=" "
                    disabled
                  />
                  <Label>Total Cycle Time (sec) — calculated</Label>
                </div>
              </>
            ) : isPress ? (
              // A PRESS part's standard time drives its Product Cycle Time
              // everywhere it's used — set once here, copied onto every PRESS
              // Data Entry row the part is picked on (shown there as a
              // read-only tick box, same as VMC's). Operation is a plain
              // required dropdown, independent of the entry's own Operation box.
              <>
                <div className="form-floating mb-3">
                  <Input type="select" name="pressOperation" value={values.pressOperation} onChange={handleChange}>
                    <option value="">Select operation</option>
                    {PRESS_OPERATIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Input>
                  <Label>
                    Operation <span className="text-danger">*</span>
                  </Label>
                  {isSubmit && formErrors.pressOperation && <p className="text-danger">{formErrors.pressOperation}</p>}
                </div>
                <Row className="g-2 align-items-end mb-1">
                <Col xs={6} md={6}>
                  <div className="form-floating">
                    <NumberInput name="standardTimeMin" value={values.standardTimeMin} onChange={handleChange} placeholder=" " />
                    <Label>
                      Standard Time Taken (min) <span className="text-danger">*</span>
                    </Label>
                  </div>
                  {isSubmit && formErrors.standardTimeMin && <p className="text-danger mb-0 small mt-1">{formErrors.standardTimeMin}</p>}
                </Col>
                <Col xs={6} md={6}>
                  <div className="form-floating">
                    <NumberInput name="pcsPerStandardTime" value={values.pcsPerStandardTime} onChange={handleChange} decimals={false} placeholder=" " />
                    <Label>
                      No. Piece in Standard Time <span className="text-danger">*</span>
                    </Label>
                  </div>
                  {isSubmit && formErrors.pcsPerStandardTime && <p className="text-danger mb-0 small mt-1">{formErrors.pcsPerStandardTime}</p>}
                </Col>
                {/* Never typed on its own — Standard Time Taken × 60 ÷ No.
                    Piece in Standard Time, worked out live so this matches
                    what Save will store without waiting for a round trip. */}
                <Col xs={12} className="mt-3">
                  <div className="form-floating">
                    <NumberInput
                      name="pressTotalCycleSec"
                      value={
                        values.standardTimeMin !== "" && values.pcsPerStandardTime !== "" && Number(values.pcsPerStandardTime) > 0
                          ? showSec((Number(values.standardTimeMin) * 60) / Number(values.pcsPerStandardTime))
                          : ""
                      }
                      onChange={() => {}}
                      placeholder=" "
                      disabled
                    />
                    <Label>Total Cycle Time (sec) — calculated</Label>
                  </div>
                </Col>
                </Row>
              </>
            ) : isMfd ? (
              // A MODULAR FRAME DRILLING part: its Process (a required dropdown,
              // like PRESS's Operation), No. of Holes and Stroke Required (SPM's
              // reference fields) — shown on every entry it's picked on — and a
              // Total Cycle Time typed straight in, which fills in each entry's own.
              <>
                <div className="form-floating mb-3">
                  <Input type="select" name="mfdOperation" value={values.mfdOperation} onChange={handleChange}>
                    <option value="">Select process</option>
                    {MFD_OPERATIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Input>
                  <Label>
                    Process <span className="text-danger">*</span>
                  </Label>
                  {isSubmit && formErrors.mfdOperation && <p className="text-danger">{formErrors.mfdOperation}</p>}
                </div>
                <Row className="g-2 align-items-end mb-1">
                  {[
                    ["noOfHoles", "No. of Holes in One Piece"],
                    ["strokeRequired", "Stroke Required for One Piece"],
                  ].map(([key, label]) => (
                    <Col key={key} xs={12} md={6}>
                      <div className="form-floating">
                        <NumberInput name={key} value={values[key]} onChange={handleChange} decimals={false} placeholder=" " />
                        <Label>
                          {label} <span className="text-danger">*</span>
                        </Label>
                      </div>
                      {isSubmit && formErrors[key] && <p className="text-danger mb-0 small mt-1">{formErrors[key]}</p>}
                    </Col>
                  ))}
                  <Col xs={12} className="mt-3">
                    <div className="form-floating">
                      <NumberInput name="totalCycleSec" value={values.totalCycleSec} onChange={handleChange} placeholder=" " />
                      <Label>
                        Total Cycle Time (Sec) <span className="text-danger">*</span>
                      </Label>
                    </div>
                    {isSubmit && formErrors.totalCycleSec ? (
                      <p className="text-danger mb-0 small mt-1">{formErrors.totalCycleSec}</p>
                    ) : (
                      <p className="text-muted mb-0 small mt-1">Filled in on each entry — can be changed there for the day.</p>
                    )}
                  </Col>
                </Row>
              </>
            ) : isContact ? (
              // A Contact part has no operation breakdown — Total Cycle Time is
              // typed straight in, and fills in every Contact Data Entry row the
              // part is picked on (still changeable there for the day).
              <div className="form-floating mb-1">
                <NumberInput name="totalCycleSec" value={values.totalCycleSec} onChange={handleChange} placeholder=" " />
                <Label>
                  {cycleTimeLabel(selectedProcess)} {!isFinalAssemblyProcess(selectedProcess) && <span className="text-danger">*</span>}
                </Label>
                {isSubmit && formErrors.totalCycleSec ? (
                  <p className="text-danger mb-0 small mt-1">{formErrors.totalCycleSec}</p>
                ) : (
                  <p className="text-muted mb-0 small mt-1">Filled in on each entry — can be changed there for the day.</p>
                )}
              </div>
            ) : null}
            <div className="mt-3">
              <Input
                type="checkbox"
                className="form-check-input"
                name="isActive"
                checked={values.isActive}
                onChange={(e) => setValues({ ...values, isActive: e.target.checked })}
              />
              <Label className="form-check-label ms-1">Is Active</Label>
            </div>
          </ModalBody>
          <ModalFooter>
            {modalMode === "edit" ? (
              <FormUpdateFooter handleUpdate={handleSave} handleUpdateCancel={closeModal} isLoading={isLoading} />
            ) : (
              <FormsFooter handleSubmit={handleSave} handleSubmitCancel={closeModal} isLoading={isLoading} />
            )}
          </ModalFooter>
        </form>
      </Modal>

      <ItemHistoryModal isOpen={historyOpen} toggle={() => setHistoryOpen(false)} item={historyItem} />

      <DeleteModal
        show={modal_delete}
        handleDelete={handleDelete}
        toggle={(e) => {
          e?.preventDefault?.();
          setmodal_delete(false);
        }}
        setmodal_delete={setmodal_delete}
        disabled={isDeleteLoading}
        deactivates={!!items.find((r) => r._id === remove_id)?.isActive}
      />
    </React.Fragment>
  );
};

export default ItemMaster;
