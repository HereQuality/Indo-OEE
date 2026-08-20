import React, { useState, useEffect, useContext } from "react";
import { Pencil, Trash2, Layers, Plus, X } from "lucide-react";
import { toast as toastify } from "react-toastify";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import DeleteModal from "../Components/Common/DeleteModal";
import Tooltip from "../Components/Common/Tooltip";
import StatusCheckbox from "../Components/Common/StatusCheckbox";
import { useInvalidateProcesses } from "../hooks/useProcesses";
import { useShifts } from "../hooks/useShifts";
import {
  createProcess,
  updateProcess,
  deleteProcess,
  getProcessById,
  searchProcesses,
} from "../api/process.api";

// ── Constants ──────────────────────────────────────────────────────────────
const NAME_MAX = 100;
const DESC_MAX = 300;

const initialState = {
  processName: "",
  description: "",
  shift: "",
  isActive: true,
};

const validate = (values) => {
  const errors = {};

  const name = (values.processName || "").trim();
  if (!name) {
    errors.processName = "Process name is required";
  } else if (name.length > NAME_MAX) {
    errors.processName = `Process name must be ${NAME_MAX} characters or fewer`;
  }

  const desc = (values.description || "").trim();
  if (desc.length > DESC_MAX) {
    errors.description = `Description must be ${DESC_MAX} characters or fewer`;
  }

  return errors;
};

// ── Sub-component: Add / Edit Modal ───────────────────────────────────────
const ProcessFormModal = ({ mode, initialValues, onClose, onSaved }) => {
  const toast = useAlert() || toastify;
  const { data: shiftOptions = [] } = useShifts();
  const [values, setValues] = useState(initialValues);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmit, setIsSubmit] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setValues((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
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
        const res = await createProcess({
          processName: values.processName.trim(),
          description: values.description.trim(),
          shift: values.shift || "",
          isActive: values.isActive,
        });
        if (res.data.isOk) {
          toast.success?.("Process added successfully!");
          onSaved();
        }
      } else {
        await updateProcess(initialValues._id, {
          processName: values.processName.trim(),
          description: values.description.trim(),
          shift: values.shift || "",
          isActive: values.isActive,
        });
        toast.success?.("Process updated successfully!");
        onSaved();
      }
    } catch (err) {
      console.error(err);
      toast.error?.(err.response?.data?.message || "Failed to save process.");
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
            {mode === "add" ? "Add Process" : "Edit Process"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Process Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Process Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="processName"
              value={values.processName}
              onChange={handleChange}
              maxLength={NAME_MAX}
              placeholder="e.g. Grinding"
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
            />
            {isSubmit && formErrors.processName && (
              <p className="text-xs text-red-500 mt-1">{formErrors.processName}</p>
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
              placeholder="Optional description or notes about this process"
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 resize-none"
            />
            {isSubmit && formErrors.description && (
              <p className="text-xs text-red-500 mt-1">{formErrors.description}</p>
            )}
          </div>

          {/* Default Shift — Grinding Data Entry auto-fills the entry's
              Shift (and its On/Off Time) from this the moment this Process
              is selected, so the operator doesn't pick a Shift by hand. */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Default Shift
              <span className="ml-1 text-xs text-slate-400 font-normal">(auto-applied in Grinding Data Entry)</span>
            </label>
            <select
              name="shift"
              value={values.shift || ""}
              onChange={handleChange}
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
            >
              <option value="">No default shift</option>
              {shiftOptions.map((s) => (
                <option key={s._id} value={s._id}>{s.shiftName} ({s.shiftOnTime}–{s.shiftOffTime})</option>
              ))}
            </select>
          </div>

          {/* Active toggle */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="isActive_process_modal"
              name="isActive"
              checked={values.isActive}
              onChange={handleChange}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <label htmlFor="isActive_process_modal" className="text-sm text-slate-700 select-none cursor-pointer">
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
              {isSaving ? "Saving…" : mode === "add" ? "Add Process" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────
const ProcessMaster = () => {
  const toast = useAlert() || toastify;
  const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } =
    useContext(MenuContext) || {};

  const invalidateProcesses = useInvalidateProcesses();

  const [processes, setProcesses] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editProcessId, setEditProcessId] = useState(null);
  const [editInitialValues, setEditInitialValues] = useState(null);
  const [deleteProcessId, setDeleteProcessId] = useState(null);

  const fetchProcesses = () => {
    setIsLoading(true);
    searchProcesses({
      skip: 0,
      per_page: 200,
      match: query || undefined,
      isActive: activeOnly,
    })
      .then((res) => setProcesses(res.data?.data?.[0]?.data || []))
      .catch(() => toast.error?.("Failed to load processes"))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { fetchProcesses(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [query, activeOnly]);

  const openEdit = (id) => {
    getProcessById(id)
      .then((res) => {
        const p = res.data.data;
        setEditInitialValues({
          _id: id,
          processName: p.processName || "",
          description: p.description || "",
          shift: typeof p.shift === "object" ? p.shift?._id || "" : p.shift || "",
          isActive: p.isActive,
        });
        setEditProcessId(id);
      })
      .catch(() => toast.error?.("Failed to fetch process details"));
  };

  const handleDelete = (e) => {
    e.preventDefault();
    setIsDeleteLoading(true);
    deleteProcess(deleteProcessId)
      .then(() => {
        setDeleteProcessId(null);
        toast.success?.("Process removed successfully!");
        fetchProcesses();
        invalidateProcesses();
      })
      .catch(() => { setDeleteProcessId(null); toast.error?.("Failed to delete process."); })
      .finally(() => setIsDeleteLoading(false));
  };

  return (
    <div className="p-4 sm:p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-brand-600" />
          <h1 className="text-lg font-semibold text-slate-900">Process Master</h1>
        </div>
        {currentPagePermissions.create && (
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Process
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <input
          type="text"
          placeholder="Search processes…"
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
              <th className="px-4 py-3 font-medium">Process Name</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Default Shift</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {processes.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  {isLoading ? "Loading…" : "No processes found. Click 'Add Process' to create one."}
                </td>
              </tr>
            )}
            {processes.map((p) => (
              <tr key={p._id} className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors">
                <td className="px-4 py-3 text-slate-800 font-medium">{p.processName}</td>
                <td className="px-4 py-3 text-slate-500 max-w-xs">
                  <Tooltip text={p.description}>
                    <span className="block truncate">{p.description || "—"}</span>
                  </Tooltip>
                </td>
                <td className="px-4 py-3 text-slate-600 font-mono text-xs whitespace-nowrap">
                  {p.shift ? `${p.shift.shiftName} (${p.shift.shiftOnTime}–${p.shift.shiftOffTime})` : <span className="text-slate-400 font-sans">—</span>}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      p.isActive ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {p.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {currentPagePermissions.edit && (
                      <button
                        onClick={() => openEdit(p._id)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    {currentPagePermissions.delete && (
                      <button
                        onClick={() => setDeleteProcessId(p._id)}
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
        <ProcessFormModal
          mode="add"
          initialValues={initialState}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false);
            fetchProcesses();
            invalidateProcesses();
          }}
        />
      )}

      {/* Edit Modal */}
      {editProcessId && editInitialValues && (
        <ProcessFormModal
          mode="edit"
          initialValues={editInitialValues}
          onClose={() => { setEditProcessId(null); setEditInitialValues(null); }}
          onSaved={() => {
            setEditProcessId(null);
            setEditInitialValues(null);
            fetchProcesses();
            invalidateProcesses();
          }}
        />
      )}

      {/* Delete Modal */}
      <DeleteModal
        show={!!deleteProcessId}
        toggle={() => setDeleteProcessId(null)}
        handleDelete={handleDelete}
        disabled={isDeleteLoading}
      />
    </div>
  );
};

export default ProcessMaster;
