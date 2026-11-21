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
  // Optional free note about the part.
  description: "",
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

// The boxes every part has, whatever its process — the rest are one process's
// own details (operation times, a program, a Process/Operation choice…).
const COMMON_KEYS = ["itemName", "process", "drawingNo", "description", "isActive"];
const DETAIL_KEYS = Object.keys(initialState).filter((k) => !COMMON_KEYS.includes(k));
const emptyDetails = () => Object.fromEntries(DETAIL_KEYS.map((k) => [k, initialState[k]]));
const detailsOf = (v) => Object.fromEntries(DETAIL_KEYS.map((k) => [k, v[k] ?? initialState[k]]));

// Which kind of detail boxes a process's parts carry. A VMC part has a program;
// a CNC or SPM part has operation times (CNC's eight, SPM's own four); TROBE,
// SPRING FOR PINS, AFTER POWDER COATING, RUBBER… work like Contact: one typed
// cycle time; anything else (not in a process yet) carries none.
const kindOf = (process) => ({
  isVmc: isVmcProcess(process),
  isCnc: isCncProcess(process),
  isSpm: isSpmProcess(process),
  isRivet: isRivetProcess(process),
  isPress: isPressProcess(process),
  // MODULAR FRAME DRILLING: Process, No. of Holes, Stroke Required and a typed Total Cycle Time.
  isMfd: isMfdProcess(process),
  isContact:
    isContactProcess(process) ||
    isTrobeProcess(process) ||
    isSpringProcess(process) ||
    isInjectionProcess(process) ||
    isEmbossingProcess(process) ||
    isPowderCoatingProcess(process) ||
    isBpcProcess(process) ||
    isFinalAssemblyProcess(process) ||
    isPrintingProcess(process) ||
    isRawCastingProcess(process) ||
    isMfaProcess(process) ||
    isRubberProcess(process),
});

// The process-specific errors of one part's form (the common boxes are checked
// in validateCommon). `k` is kindOf(process).
const validateDetails = (v, k, process) => {
  const errors = {};
  // Only a CNC part's form shows the Operation Times boxes — nothing else
  // to validate for a VMC part or one in no process / another process type.
  if (k.isCnc && CYCLE_OP_FIELDS.some((f) => v[f.key] !== "" && (!Number.isFinite(Number(v[f.key])) || Number(v[f.key]) < 0))) {
    errors.cycleOps = "Cycle times must be 0 or more";
  }
  // A VMC part's program drives its Product Cycle Time everywhere this part
  // is used (every VMC Data Entry row), so it has to be set here, not left
  // to be typed — or guessed — on the entry form.
  if (k.isVmc) {
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
  if (k.isSpm) {
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
  if (k.isRivet) {
    for (const f of RIVET_OP_FIELDS) {
      if (v[f.key] === "") errors[f.key] = `${f.label.replace(" (sec)", "")} is required`;
      else if (!Number.isFinite(Number(v[f.key])) || Number(v[f.key]) < 0) errors[f.key] = "Must be 0 or more";
    }
    if (!v.rivetProcessType) errors.rivetProcessType = "Process is required";
  }
  // A PRESS part's standard time drives its Product Cycle Time everywhere
  // this part is used, same reasoning as VMC's program above.
  if (k.isPress) {
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
  if (k.isMfd) {
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
  if (k.isContact) {
    const cycle = v.totalCycleSec === "" ? NaN : Number(v.totalCycleSec);
    // FINAL ASSEMBLY: optional — PACKING has none.
    if (v.totalCycleSec === "") {
      if (!isFinalAssemblyProcess(process)) errors.totalCycleSec = `${cycleTimeName(process)} is required`;
    } else if (!Number.isFinite(cycle) || cycle <= 0) errors.totalCycleSec = "Must be more than 0";
  }
  return errors;
};

const validateCommon = (v) => {
  const errors = {};
  if (!v.itemName.trim()) errors.itemName = "Part Name is required!";
  if (!v.drawingNo.trim()) errors.drawingNo = "Drawing No. is required!";
  return errors;
};

// The process-specific fields as they're sent to the server. Only the fields
// the form showed are kept: a part moved off CNC drops its operation times,
// one moved off VMC drops its program, and one moved off SPM drops its own
// four operations — so a part never carries another kind's leftovers.
// `unknownProcess`: a process this page couldn't look up showed none of the
// boxes, so none are sent at all (undefined is left out of the request) and
// the server keeps whatever the part already has, instead of clearing it.
const detailFieldsFor = (k, values, unknownProcess) => {
  const num = (x) => (x === "" ? null : Number(x));
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
  const leaveAsTheyAre = Object.fromEntries(Object.keys(noneOfThem).map((key) => [key, undefined]));
  const cycleFields = k.isCnc
    ? {
        ...noneOfThem,
        totalCycleSec: num(values.totalCycleSec),
        ...Object.fromEntries(CYCLE_OP_FIELDS.map((f) => [f.key, num(values[f.key])])),
      }
    : k.isVmc
      ? {
          ...noneOfThem,
          programTimeMin: num(values.programTimeMin),
          pcsPerProgram: num(values.pcsPerProgram),
          // Kept in step so the Parts list's own Total Cycle (sec) column
          // (and anything else reading it directly) shows the same figure
          // the VMC Data Entry sheet computes from this program.
          totalCycleSec: (Number(values.programTimeMin) * 60) / Number(values.pcsPerProgram),
        }
      : k.isSpm
        ? {
            ...noneOfThem,
            totalCycleSec: num(values.totalCycleSec),
            ...Object.fromEntries(SPM_OP_FIELDS.map((f) => [f.key, num(values[f.key])])),
            ...Object.fromEntries(SPM_REFERENCE_FIELDS.map((f) => [f.key, num(values[f.key])])),
          }
        : k.isRivet
          ? {
              ...noneOfThem,
              totalCycleSec: num(values.totalCycleSec),
              ...Object.fromEntries(RIVET_OP_FIELDS.map((f) => [f.key, num(values[f.key])])),
              rivetProcessType: values.rivetProcessType,
            }
          : k.isPress
            ? {
                ...noneOfThem,
                standardTimeMin: num(values.standardTimeMin),
                pcsPerStandardTime: num(values.pcsPerStandardTime),
                // Kept in step so the Parts list's own Total Cycle (sec)
                // column shows the same figure the PRESS Data Entry sheet
                // computes from this standard time.
                totalCycleSec: (Number(values.standardTimeMin) * 60) / Number(values.pcsPerStandardTime),
                pressOperation: values.pressOperation,
              }
            : k.isMfd
              ? {
                  ...noneOfThem,
                  totalCycleSec: num(values.totalCycleSec),
                  // No. of Holes / Stroke Required are SPM's own reference fields, reused.
                  noOfHoles: num(values.noOfHoles),
                  strokeRequired: num(values.strokeRequired),
                }
              : k.isContact
                ? { ...noneOfThem, totalCycleSec: num(values.totalCycleSec) }
                : unknownProcess
                  ? leaveAsTheyAre
                  : noneOfThem;
  return {
    ...cycleFields,
    // MODULAR FRAME DRILLING's Process belongs to its parts only (kept as is
    // for a process this page couldn't look up, like the boxes above).
    mfdOperation: k.isMfd ? values.mfdOperation : unknownProcess ? undefined : null,
  };
};

// One part as the server takes it: the common boxes plus its process's details.
const payloadFor = (values, k, unknownProcess) => ({
  ...values,
  itemName: values.itemName.trim(),
  drawingNo: values.drawingNo.trim(),
  description: values.description.trim(),
  ...detailFieldsFor(k, values, unknownProcess),
});

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
  const kind = useMemo(() => kindOf(selectedProcess), [selectedProcess]);
  const { isVmc, isCnc, isSpm, isRivet, isPress, isMfd, isContact } = kind;
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
  // Adding goes step by step: the common boxes first, then one step per
  // process ticked, each asking that process's own details — Save only comes
  // at the last step. One part record is made per process (a part belongs to
  // exactly one process, so the same name and drawing in two processes are two
  // parts, as they are when added one at a time). Editing stays one part.
  const [selectedProcesses, setSelectedProcesses] = useState([]);
  const [step, setStep] = useState(0); // 0 = common boxes; k = selectedProcesses[k-1]'s details
  const [perProcess, setPerProcess] = useState({}); // process id → its details, as typed so far
  const wizard = modalMode === "add";
  const lastStep = selectedProcesses.length;
  const stepProcessId = step > 0 ? selectedProcesses[step - 1] : "";
  const [modal_delete, setmodal_delete] = useState(false);
  // The edit history: one part's, or (historyItem null) every part's.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState(null);

  const [loading, setLoading] = useState(false);
  const [totalRows, setTotalRows] = useState(0);
  const [pageNo, setPageNo] = useState(1);
  const [column, setcolumn] = useState();
  const [sortDirection, setsortDirection] = useState();
  // Paged the same way as the data entry sheets: Page x of y, Prev / Next,
  // Go to, plus how many parts a page holds (25 to start).
  const [perPage, setPerPage] = useState(25);
  const [goTo, setGoTo] = useState("");
  const totalPages = Math.max(1, Math.ceil(totalRows / perPage));

  // A page that isn't there (0, or past the last) goes to the nearest one
  // that is, and says so, instead of quietly doing nothing.
  const goToPage = () => {
    if (goTo === "") return;
    const n = Number(goTo);
    if (!Number.isInteger(n)) {
      toast.warning(`Enter a page number from 1 to ${totalPages}.`);
    } else if (n < 1 || n > totalPages) {
      const nearest = Math.min(Math.max(n, 1), totalPages);
      toast.warning(`There's no page ${n} — showing page ${nearest} of ${totalPages}.`);
      setPageNo(nearest);
    } else {
      setPageNo(n);
    }
    setGoTo("");
  };

  const closeModal = () => {
    setModalMode(null);
    setValues(initialState);
    setIsSubmit(false);
    setFormErrors({});
    setSelectedProcesses([]);
    setStep(0);
    setPerProcess({});
  };

  const openAdd = () => {
    setValues(initialState);
    setIsSubmit(false);
    setFormErrors({});
    setSelectedProcesses([]);
    setStep(0);
    setPerProcess({});
    setModalMode("add");
  };

  const toggleProcess = (id) =>
    setSelectedProcesses((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...processes.filter((p) => ids.includes(p._id) || p._id === id).map((p) => p._id)]));

  // Moves to another step of the Add wizard: what's typed for the current
  // process is kept, and the next process's boxes are loaded (empty if new).
  const goToStep = (next) => {
    const stash = step > 0 ? { ...perProcess, [stepProcessId]: detailsOf(values) } : perProcess;
    setPerProcess(stash);
    const nextId = next > 0 ? selectedProcesses[next - 1] : "";
    setValues((v) => ({ ...v, process: nextId, ...(stash[nextId] || emptyDetails()) }));
    setIsSubmit(false);
    setFormErrors({});
    setStep(next);
  };

  const goNext = () => {
    const errors = validate(values);
    setFormErrors(errors);
    setIsSubmit(true);
    if (Object.keys(errors).length) return;
    goToStep(step + 1);
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
          description: it.description || "",
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

  // The current form's errors: in the Add wizard, step 0 checks the common
  // boxes and each later step its own process's details; editing checks both.
  const validate = (v) => {
    if (wizard && step === 0) return validateCommon(v);
    if (wizard) return validateDetails(v, kind, selectedProcess);
    return { ...validateCommon(v), ...validateDetails(v, kind, selectedProcess) };
  };

  // Once Save has been pressed, the messages follow the form as it is fixed.
  useEffect(() => {
    if (isSubmit) setFormErrors(validate(values));
  }, [values, isSubmit]);

  const handleSave = async (e) => {
    e.preventDefault();
    const errors = validate(values);
    setFormErrors(errors);
    setIsSubmit(true);
    if (Object.keys(errors).length) return;

    setIsLoading(true);
    try {
      if (!wizard) {
        await updateItem(_id, payloadFor(values, kind, unknownProcess));
        toast.success("Part Updated Successfully!");
      } else if (!selectedProcesses.length) {
        // No process ticked: one part, not in any process yet.
        await createItem(payloadFor({ ...values, process: "" }, kindOf(undefined), false));
        toast.success("Part Added Successfully!");
      } else {
        // One part per process ticked, each with the details typed at its step
        // (the current step's are still in `values`). Saved one after another so
        // a failure says which process stopped it and what was already added.
        const details = { ...perProcess, [stepProcessId]: detailsOf(values) };
        let saved = 0;
        for (const id of selectedProcesses) {
          const proc = processes.find((p) => p._id === id);
          const v = { ...values, process: id, ...(details[id] || emptyDetails()) };
          try {
            await createItem(payloadFor(v, kindOf(proc), false));
            saved += 1;
          } catch (err) {
            const name = processName[id] || "a process";
            toast.error(`${err?.response?.data?.message || "Failed to save part"} (${name}). ${saved ? `${saved} of ${selectedProcesses.length} parts were added.` : "Nothing was added."}`);
            if (saved) {
              fetchItems();
              invalidateItems();
            }
            return;
          }
        }
        toast.success(saved === 1 ? "Part Added Successfully!" : `${saved} parts added, one per process.`);
      }
      closeModal();
      fetchItems();
      invalidateItems();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save part. Please try again.");
    } finally {
      setIsLoading(false);
    }
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
  }, [pageNo, perPage, column, sortDirection, query, filter, processFilter]);

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
    { name: "Process", selector: (row) => processName[row.process] || (row.process && processes.length ? "Inactive process" : "—"), minWidth: "200px", grow: 1.2, wrap: true },
    { name: "Drawing No.", selector: (row) => row.drawingNo || "", sortable: true, sortField: "drawingNo", minWidth: "120px", wrap: true },
    {
      name: "Description",
      selector: (row) => row.description || "",
      cell: (row) => (
        <span className="text-truncate d-inline-block" style={{ maxWidth: "240px" }} title={row.description || ""}>
          {row.description || "—"}
        </span>
      ),
      minWidth: "150px",
      grow: 1.5,
    },
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
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 px-3 py-2 border-bottom">
                  <span className="small text-muted">
                    Page {pageNo} of {totalPages}
                    {totalRows > 0 && (
                      <span className="ms-2">
                        · {(pageNo - 1) * perPage + 1}–{Math.min(pageNo * perPage, totalRows)} of {totalRows} parts
                      </span>
                    )}
                  </span>
                  <div className="d-flex flex-wrap align-items-center gap-2">
                    <select
                      value={perPage}
                      onChange={(e) => {
                        setPerPage(Number(e.target.value));
                        setPageNo(1);
                      }}
                      title="Parts per page"
                      className="form-select form-select-sm"
                      style={{ width: "auto" }}
                    >
                      {[10, 25, 50, 100].map((n) => (
                        <option key={n} value={n}>
                          {n} per page
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      style={{ minWidth: "84px" }}
                      disabled={pageNo <= 1}
                      onClick={() => setPageNo((p) => Math.max(1, p - 1))}
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      style={{ minWidth: "84px" }}
                      disabled={pageNo >= totalPages}
                      onClick={() => setPageNo((p) => Math.min(totalPages, p + 1))}
                    >
                      Next
                    </button>
                    <span className="small text-muted ms-2">Go to</span>
                    <NumberInput
                      name="goTo"
                      decimals={false}
                      maxLength={4}
                      max={totalPages}
                      placeholder={String(pageNo)}
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
          {modalMode === "edit" ? "Update Part" : lastStep ? `Add Part · step ${step + 1} of ${lastStep + 1}` : "Add Part"}
        </ModalHeader>
        <form
          noValidate
          onSubmit={(e) => {
            // Enter on a wizard step moves on; Save is only the last step's button.
            if (wizard && step < lastStep) {
              e.preventDefault();
              goNext();
            } else handleSave(e);
          }}
        >
          <ModalBody>
            {(!wizard || step === 0) && (
              <>
                <div className="form-floating mb-3">
                  <Input type="text" name="itemName" value={values.itemName} onChange={handleChange} placeholder=" " maxLength={120} />
                  <Label>
                    Part Name <span className="text-danger">*</span>
                  </Label>
                  {isSubmit && <p className="text-danger">{formErrors.itemName}</p>}
                </div>
                {wizard ? (
                  // Tick every process this part is run in — a step per process
                  // follows, asking that process's own details.
                  <div className="mb-3">
                    <Label className="mb-1 d-block">Processes (the data entry pages that offer this part)</Label>
                    <div className="border rounded-3 p-2" style={{ maxHeight: "220px", overflowY: "auto" }}>
                      <Row className="g-1">
                        {processOptions.map((p) => (
                          <Col key={p._id} xs={12} sm={6}>
                            <div className="form-check">
                              <Input
                                type="checkbox"
                                className="form-check-input"
                                id={`part-process-${p._id}`}
                                checked={selectedProcesses.includes(p._id)}
                                onChange={() => toggleProcess(p._id)}
                              />
                              <Label className="form-check-label" htmlFor={`part-process-${p._id}`}>
                                {processName[p._id]}
                              </Label>
                            </div>
                          </Col>
                        ))}
                      </Row>
                    </div>
                    <p className="text-muted mb-0 small mt-1">
                      {selectedProcesses.length === 0
                        ? "None ticked: the part is saved as not in any process."
                        : selectedProcesses.length === 1
                          ? `Next asks for its ${processName[selectedProcesses[0]]} details.`
                          : `${selectedProcesses.length} ticked: one part is made per process, each with its own details — Next asks for them one by one.`}
                    </p>
                  </div>
                ) : (
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
                )}
                <div className="form-floating mb-3">
                  <Input type="text" name="drawingNo" value={values.drawingNo} onChange={handleChange} placeholder=" " maxLength={40} />
                  <Label>
                    Drawing No. <span className="text-danger">*</span>
                  </Label>
                  {isSubmit && formErrors.drawingNo && <p className="text-danger">{formErrors.drawingNo}</p>}
                </div>
                <div className="form-floating mb-3">
                  <Input
                    type="textarea"
                    name="description"
                    value={values.description}
                    onChange={handleChange}
                    placeholder=" "
                    maxLength={500}
                    style={{ minHeight: "88px" }}
                  />
                  <Label>Description (optional)</Label>
                  <p className="text-muted mb-0 small mt-1">Material, finish, where it's used — anything worth noting about this part.</p>
                </div>
              </>
            )}
            {wizard && step > 0 && (
              <div className="mb-3">
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <span className="badge bg-primary-subtle text-primary fs-12">
                    {step} / {lastStep}
                  </span>
                  <span className="fw-semibold">{processName[stepProcessId] || "Process"} details</span>
                  <span className="text-muted small">for {values.itemName.trim()} · {values.drawingNo.trim()}</span>
                </div>
                <div className="d-flex flex-wrap gap-1 mt-2">
                  {selectedProcesses.map((id, i) => (
                    <span key={id} className={`badge ${i + 1 === step ? "bg-primary" : i + 1 < step ? "bg-success-subtle text-success" : "bg-light text-muted"}`}>
                      {processName[id]}
                    </span>
                  ))}
                </div>
              </div>
            )}
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
            {(!wizard || step === 0) && (
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
            )}
          </ModalBody>
          <ModalFooter>
            {modalMode === "edit" ? (
              <FormUpdateFooter handleUpdate={handleSave} handleUpdateCancel={closeModal} isLoading={isLoading} />
            ) : (
              // Back / Next through the steps; Save appears only on the last one.
              <div className="d-flex flex-wrap align-items-center justify-content-end gap-2 w-100">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isLoading}
                  className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2.5 transition-colors disabled:opacity-60"
                >
                  Cancel
                </button>
                {step > 0 && (
                  <button
                    type="button"
                    onClick={() => goToStep(step - 1)}
                    disabled={isLoading}
                    className="rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2.5 transition-colors disabled:opacity-60"
                  >
                    Back
                  </button>
                )}
                {step < lastStep ? (
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={isLoading}
                    className="rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors disabled:opacity-70"
                  >
                    Next: {processName[selectedProcesses[step]]}
                  </button>
                ) : (
                  <FormsFooter handleSubmit={handleSave} handleSubmitCancel={closeModal} isLoading={isLoading} hideCancel />
                )}
              </div>
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
