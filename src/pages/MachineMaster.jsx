import React, { useState, useEffect, useContext } from "react";
import { Pencil, Trash2, Cog, Plus, X } from "lucide-react";
import { toast as toastify } from "react-toastify";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import DeleteModal from "../Components/Common/DeleteModal";
import Tooltip from "../Components/Common/Tooltip";
import StatusCheckbox from "../Components/Common/StatusCheckbox";
import TimePicker from "../Components/Common/TimePicker";
import { useInvalidateMachines } from "../hooks/useMachines";
import { useProcesses } from "../hooks/useProcesses";
import {
  createMachine,
  updateMachine,
  deleteMachine,
  getMachineById,
  searchMachines,
} from "../api/machines.api";

// ── Constants ──────────────────────────────────────────────────────────────
const NAME_MAX = 100;
const CODE_MAX = 20;
const DESC_MAX = 300;
const TIME_RX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const initialState = {
  machineName: "",
  machineCode: "",
  description: "",
  processes: [],
  machineOnTime: "",
  machineOffTime: "",
  isActive: true,
};

const validate = (values) => {
  const errors = {};

  const name = (values.machineName || "").trim();
  if (!name) {
    errors.machineName = "Machine name is required";
  } else if (name.length > NAME_MAX) {
    errors.machineName = `Machine name must be ${NAME_MAX} characters or fewer`;
  }

  const code = (values.machineCode || "").trim();
  if (code.length > CODE_MAX) {
    errors.machineCode = `Machine code must be ${CODE_MAX} characters or fewer`;
  }

  const desc = (values.description || "").trim();
  if (desc.length > DESC_MAX) {
    errors.description = `Description must be ${DESC_MAX} characters or fewer`;
  }

  if (!values.machineOnTime) {
    errors.machineOnTime = "Shift Time Start is required";
  } else if (!TIME_RX.test(values.machineOnTime)) {
    errors.machineOnTime = "Use HH:mm format";
  }
  if (!values.machineOffTime) {
    errors.machineOffTime = "Shift Time End is required";
  } else if (!TIME_RX.test(values.machineOffTime)) {
    errors.machineOffTime = "Use HH:mm format";
  }

  return errors;
};

// ── Sub-component: Add / Edit Modal ───────────────────────────────────────
const MachineFormModal = ({ mode, initialValues, onClose, onSaved }) => {
  const toast = useAlert() || toastify;
  const { data: processOptions = [] } = useProcesses();
  const [values, setValues] = useState(initialValues);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmit, setIsSubmit] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setValues((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const toggleProcess = (processId) => {
    setValues((prev) => {
      const current = prev.processes || [];
      const next = current.includes(processId)
        ? current.filter((id) => id !== processId)
        : [...current, processId];
      return { ...prev, processes: next };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = validate(values);
    setFormErrors(errors);
    setIsSubmit(true);
    if (Object.keys(errors).length > 0) return;

    setIsSaving(true);
    try {
      if (mode === "add") {
        const res = await createMachine({
          machineName: values.machineName.trim(),
          machineCode: values.machineCode.trim(),
          description: values.description.trim(),
          processes: values.processes || [],
          machineOnTime: values.machineOnTime || "",
          machineOffTime: values.machineOffTime || "",
          isActive: values.isActive,
        });
        if (res.data.isOk) {
          toast.success?.("Machine added successfully!");
          onSaved();
        }
      } else {
        await updateMachine(initialValues._id, {
          machineName: values.machineName.trim(),
          machineCode: values.machineCode.trim(),
          description: values.description.trim(),
          processes: values.processes || [],
          machineOnTime: values.machineOnTime || "",
          machineOffTime: values.machineOffTime || "",
          isActive: values.isActive,
        });
        toast.success?.("Machine updated successfully!");
        onSaved();
      }
    } catch (err) {
      console.error(err);
      const apiErrors = err.response?.data?.errors;
      if (apiErrors) setFormErrors((prev) => ({ ...prev, ...apiErrors }));
      toast.error?.(err.response?.data?.message || "Failed to save machine.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">
            {mode === "add" ? "Add Machine" : "Edit Machine"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Machine Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Machine Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="machineName"
              value={values.machineName}
              onChange={handleChange}
              maxLength={NAME_MAX}
              placeholder="e.g. APG M/C No. 1"
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
            />
            {isSubmit && formErrors.machineName && (
              <p className="text-xs text-red-500 mt-1">{formErrors.machineName}</p>
            )}
          </div>

          {/* Machine Code */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Machine Code
            </label>
            <input
              type="text"
              name="machineCode"
              value={values.machineCode}
              onChange={handleChange}
              maxLength={CODE_MAX}
              placeholder="e.g. MC-01"
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
            />
            {isSubmit && formErrors.machineCode && (
              <p className="text-xs text-red-500 mt-1">{formErrors.machineCode}</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              name="description"
              value={values.description}
              onChange={handleChange}
              maxLength={DESC_MAX}
              rows={3}
              placeholder="Optional description or notes about this machine"
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 resize-none"
            />
            {isSubmit && formErrors.description && (
              <p className="text-xs text-red-500 mt-1">{formErrors.description}</p>
            )}
          </div>

          {/* Processes (multi-select) */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Processes
            </label>
            <div className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 max-h-40 overflow-y-auto space-y-1.5">
              {processOptions.length === 0 && (
                <p className="text-xs text-slate-400">No active processes yet — add one in Process Master.</p>
              )}
              {processOptions.map((p) => (
                <label key={p._id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={(values.processes || []).includes(p._id)}
                    onChange={() => toggleProcess(p._id)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  {p.processName}
                </label>
              ))}
            </div>
          </div>

          {/* Shift Time Start/End */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Shift Time Start <span className="text-red-500">*</span></label>
              <TimePicker
                name="machineOnTime"
                value={values.machineOnTime}
                onChange={handleChange}
                hasError={isSubmit && !!formErrors.machineOnTime}
              />
              {isSubmit && formErrors.machineOnTime && (
                <p className="text-xs text-red-500 mt-1">{formErrors.machineOnTime}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Shift Time End <span className="text-red-500">*</span></label>
              <TimePicker
                name="machineOffTime"
                value={values.machineOffTime}
                onChange={handleChange}
                hasError={isSubmit && !!formErrors.machineOffTime}
              />
              {isSubmit && formErrors.machineOffTime && (
                <p className="text-xs text-red-500 mt-1">{formErrors.machineOffTime}</p>
              )}
            </div>
          </div>

          {/* Active toggle */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="isActive_modal"
              name="isActive"
              checked={values.isActive}
              onChange={handleChange}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <label htmlFor="isActive_modal" className="text-sm text-slate-700 select-none cursor-pointer">
              Active
            </label>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2.5 transition-colors disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors disabled:opacity-70"
            >
              {isSaving ? "Saving…" : mode === "add" ? "Add Machine" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────
const MachineMaster = () => {
  const toast = useAlert() || toastify;
  const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } =
    useContext(MenuContext) || {};

  const invalidateMachines = useInvalidateMachines();

  const [machines, setMachines] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editMachineId, setEditMachineId] = useState(null);
  const [editInitialValues, setEditInitialValues] = useState(null);
  const [deleteMachineId, setDeleteMachineId] = useState(null);

  const fetchMachines = () => {
    setIsLoading(true);
    searchMachines({
      skip: 0,
      per_page: 200,
      match: query || undefined,
      isActive: activeOnly,
    })
      .then((res) => setMachines(res.data?.data?.[0]?.data || []))
      .catch(() => toast.error?.("Failed to load machines"))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { fetchMachines(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [query, activeOnly]);

  const openEdit = (id) => {
    getMachineById(id)
      .then((res) => {
        const m = res.data.data;
        setEditInitialValues({
          _id: id,
          machineName: m.machineName || "",
          machineCode: m.machineCode || "",
          description: m.description || "",
          processes: (m.processes || []).map((p) => (typeof p === "object" ? p._id : p)),
          machineOnTime: m.machineOnTime || "",
          machineOffTime: m.machineOffTime || "",
          isActive: m.isActive,
        });
        setEditMachineId(id);
      })
      .catch(() => toast.error?.("Failed to fetch machine details"));
  };

  const handleDelete = (e) => {
    e.preventDefault();
    setIsDeleteLoading(true);
    deleteMachine(deleteMachineId)
      .then(() => {
        setDeleteMachineId(null);
        toast.success?.("Machine removed successfully!");
        fetchMachines();
        invalidateMachines();
      })
      .catch(() => { setDeleteMachineId(null); toast.error?.("Failed to delete machine."); })
      .finally(() => setIsDeleteLoading(false));
  };

  return (
    <div className="p-4 sm:p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Cog className="w-5 h-5 text-brand-600" />
          <h1 className="text-lg font-semibold text-slate-900">Machine (M/C) Master</h1>
        </div>
        {currentPagePermissions.create && (
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Machine
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <input
          type="text"
          placeholder="Search machines…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full sm:w-64 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
        />
        <StatusCheckbox checked={activeOnly} onChange={setActiveOnly} className="sm:ml-auto" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600 text-left">
              <th className="px-4 py-3 font-medium">Machine Name</th>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Processes</th>
              <th className="px-4 py-3 font-medium">Shift Time</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {machines.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  {isLoading ? "Loading…" : "No machines found. Click 'Add Machine' to create one."}
                </td>
              </tr>
            )}
            {machines.map((m) => (
              <tr key={m._id} className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors">
                <td className="px-4 py-3 text-slate-800 font-medium">{m.machineName}</td>
                <td className="px-4 py-3 text-slate-600 font-mono text-xs">{m.machineCode || "—"}</td>
                <td className="px-4 py-3 text-slate-500 max-w-xs">
                  <Tooltip text={m.description}>
                    <span className="block truncate">{m.description || "—"}</span>
                  </Tooltip>
                </td>
                <td className="px-4 py-3">
                  {(m.processes || []).length === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {m.processes.map((p) => (
                        <span
                          key={typeof p === "object" ? p._id : p}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-50 text-brand-700"
                        >
                          {typeof p === "object" ? p.processName : p}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600 font-mono text-xs whitespace-nowrap">
                  {m.shiftTime ? `${m.shiftTime.onTime} – ${m.shiftTime.offTime}` : <span className="text-slate-400 font-sans">—</span>}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      m.isActive ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {m.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {currentPagePermissions.edit && (
                      <button
                        onClick={() => openEdit(m._id)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    {currentPagePermissions.delete && (
                      <button
                        onClick={() => setDeleteMachineId(m._id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <MachineFormModal
          mode="add"
          initialValues={initialState}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false);
            fetchMachines();
            invalidateMachines();
          }}
        />
      )}

      {/* Edit Modal */}
      {editMachineId && editInitialValues && (
        <MachineFormModal
          mode="edit"
          initialValues={editInitialValues}
          onClose={() => { setEditMachineId(null); setEditInitialValues(null); }}
          onSaved={() => {
            setEditMachineId(null);
            setEditInitialValues(null);
            fetchMachines();
            invalidateMachines();
          }}
        />
      )}

      {/* Delete Modal */}
      <DeleteModal
        show={!!deleteMachineId}
        toggle={() => setDeleteMachineId(null)}
        handleDelete={handleDelete}
        disabled={isDeleteLoading}
      />
    </div>
  );
};

export default MachineMaster;
