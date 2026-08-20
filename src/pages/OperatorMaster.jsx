import React, { useState, useEffect, useContext } from "react";
import { Pencil, Trash2, Users, Plus, X } from "lucide-react";
import { toast as toastify } from "react-toastify";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import DeleteModal from "../Components/Common/DeleteModal";
import StatusCheckbox from "../Components/Common/StatusCheckbox";
import { useInvalidateOperators } from "../hooks/useOperators";
import {
  createOperator,
  updateOperator,
  deleteOperator,
  getOperatorById,
  searchOperators,
} from "../api/operators.api";

// ── Validation ────────────────────────────────────────────────────────────
const NAME_MAX = 100;
const CODE_MAX = 20;

const validate = (values) => {
  const errors = {};
  const name = (values.name || "").trim();
  if (!name) {
    errors.name = "Operator name is required";
  } else if (name.length > NAME_MAX) {
    errors.name = `Name must be ${NAME_MAX} characters or fewer`;
  }
  return errors;
};

// ── Add / Edit Modal ──────────────────────────────────────────────────────
const OperatorFormModal = ({ mode, initialValues, onClose, onSaved }) => {
  const toast = useAlert() || toastify;
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
      const payload = {
        name: values.name.trim(),
        isActive: values.isActive,
      };

      if (mode === "add") {
        const res = await createOperator(payload);
        if (res.data.isOk) {
          toast.success?.("Operator added successfully!");
          onSaved();
        }
      } else {
        await updateOperator(initialValues._id, payload);
        toast.success?.("Operator updated successfully!");
        onSaved();
      }
    } catch (err) {
      console.error(err);
      toast.error?.(err.response?.data?.message || "Failed to save operator.");
    } finally {
      setIsSaving(false);
    }
  };

  const inputCls = (name) =>
    `w-full border rounded-xl px-3.5 py-2.5 text-sm outline-none transition-shadow ${
      isSubmit && formErrors[name]
        ? "border-red-400 focus:border-red-500 focus:ring-4 focus:ring-red-500/15"
        : "border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
    }`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-slate-200">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">
            {mode === "add" ? "Add Operator" : "Edit Operator"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Operator Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="name"
              value={values.name}
              onChange={handleChange}
              maxLength={NAME_MAX}
              placeholder="e.g. Ramesh Kumar"
              className={inputCls("name")}
              autoFocus
            />
            {isSubmit && formErrors.name && (
              <p className="text-xs text-red-500 mt-1">{formErrors.name}</p>
            )}
          </div>


          {/* Active toggle */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="operator_isActive"
              name="isActive"
              checked={values.isActive}
              onChange={handleChange}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <label htmlFor="operator_isActive" className="text-sm text-slate-700 select-none cursor-pointer">
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
              {isSaving ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving…
                </>
              ) : mode === "add" ? "Add Operator" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const initialState = { name: "", isActive: true };

// ── Main Page ─────────────────────────────────────────────────────────────
const OperatorMaster = () => {
  const toast = useAlert() || toastify;
  const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } =
    useContext(MenuContext) || {};

  const invalidateOperators = useInvalidateOperators();

  const [operators, setOperators] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editItem, setEditItem] = useState(null);       // { _id, name, code, isActive }
  const [deleteId, setDeleteId] = useState(null);

  const fetchOperators = () => {
    setIsLoading(true);
    searchOperators({
      skip: 0,
      per_page: 200,
      match: query || undefined,
      isActive: activeOnly,
    })
      .then((res) => setOperators(res.data?.data?.[0]?.data || []))
      .catch(() => toast.error?.("Failed to load operators"))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    fetchOperators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, activeOnly]);

  const openEdit = (id) => {
    getOperatorById(id)
      .then((res) => {
        const o = res.data.data;
        setEditItem({ _id: id, name: o.name || "", isActive: o.isActive });
      })
      .catch(() => toast.error?.("Failed to fetch operator details"));
  };

  const handleDelete = (e) => {
    e.preventDefault();
    setIsDeleteLoading(true);
    deleteOperator(deleteId)
      .then(() => {
        setDeleteId(null);
        toast.success?.("Operator removed successfully!");
        fetchOperators();
        invalidateOperators();
      })
      .catch(() => { setDeleteId(null); toast.error?.("Failed to delete operator."); })
      .finally(() => setIsDeleteLoading(false));
  };

  return (
    <div className="p-4 sm:p-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-brand-600" />
          <h1 className="text-lg font-semibold text-slate-900">Operator Master</h1>
        </div>
        {currentPagePermissions.create && (
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Operator
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <input
          type="text"
          placeholder="Search operators…"
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
              <th className="px-4 py-3 font-medium">Operator Name</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {operators.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-slate-400">
                  {isLoading ? "Loading…" : "No operators found. Click 'Add Operator' to create one."}
                </td>
              </tr>
            )}
            {operators.map((o) => (
              <tr key={o._id} className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors">
                <td className="px-4 py-3 text-slate-800 font-medium">{o.name}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      o.isActive ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {o.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {currentPagePermissions.edit && (
                      <button
                        onClick={() => openEdit(o._id)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    {currentPagePermissions.delete && (
                      <button
                        onClick={() => setDeleteId(o._id)}
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
        <OperatorFormModal
          mode="add"
          initialValues={initialState}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false);
            fetchOperators();
            invalidateOperators();
          }}
        />
      )}

      {/* Edit Modal */}
      {editItem && (
        <OperatorFormModal
          mode="edit"
          initialValues={editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => {
            setEditItem(null);
            fetchOperators();
            invalidateOperators();
          }}
        />
      )}

      {/* Delete Modal */}
      <DeleteModal
        show={!!deleteId}
        toggle={() => setDeleteId(null)}
        handleDelete={handleDelete}
        disabled={isDeleteLoading}
      />
    </div>
  );
};

export default OperatorMaster;
