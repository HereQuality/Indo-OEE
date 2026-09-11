import React, { useState, useEffect, useContext, useMemo } from "react";
import { Pencil, Trash2, Plus, X, ChevronUp, ChevronDown, Lock, Eye, EyeOff, LayoutList } from "lucide-react";
import { toast as toastify } from "react-toastify";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import DeleteModal from "../Components/Common/DeleteModal";
import {
  getFormSchema,
  createFormField,
  updateFormField,
  deleteFormField,
  reorderFormFields,
} from "../api/formBuilder.api";
import { useInvalidateFormSchema } from "../hooks/useFormSchema";

const FIELD_TYPES = ["number", "text", "date", "time", "textarea"];
const LABEL_MAX = 120;

// Mirrors STRUCTURAL_KEYS in server/controllers/formBuilder.controller.js —
// used only to explain WHY a control is disabled. The server enforces it.
const STRUCTURAL_KEYS = new Set([
  "machine", "date", "mcStartTime", "mcOffTime",
  "sizeWidthMm", "sizeHeightMm", "thicknessMm",
  "processQty", "okQty", "standardTimePerPieceMin",
]);

const keyFromLabel = (label) => {
  const cleaned = String(label).replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/);
  if (!cleaned.length || !cleaned[0]) return "";
  return cleaned
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("")
    .replace(/^[^a-zA-Z]+/, "");
};

// ── Add / Edit field modal ────────────────────────────────────────────────
const FieldModal = ({ field, onClose, onSave, isSaving }) => {
  const isNew = !field?._id;
  const isCore = !!field?.isCore;
  const isStructural = isCore && STRUCTURAL_KEYS.has(field?.key);

  const [label, setLabel] = useState(field?.label || "");
  const [key, setKey] = useState(field?.key || "");
  const [keyTouched, setKeyTouched] = useState(!isNew);
  const [type, setType] = useState(field?.type || "number");
  const [section, setSection] = useState(field?.section || "Additional Fields");
  const [isRequired, setIsRequired] = useState(!!field?.isRequired);
  const [isStoppageReason, setIsStoppageReason] = useState(!!field?.isStoppageReason);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isNew && !keyTouched) setKey(keyFromLabel(label));
  }, [label, isNew, keyTouched]);

  // A stoppage reason is summed as minutes, so it has to stay numeric.
  useEffect(() => {
    if (isStoppageReason && type !== "number") setType("number");
  }, [isStoppageReason, type]);

  const submit = () => {
    if (!label.trim()) return setError("Label is required");
    if (isNew && !key.trim()) return setError("Key is required");
    if (isNew && !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
      return setError("Key must start with a letter and contain only letters, numbers or underscores");
    }
    setError("");
    onSave({
      label: label.trim(),
      section,
      isRequired,
      ...(isCore ? {} : { key: key.trim(), type, isStoppageReason }),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b px-5 py-3 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {isNew ? "Add Field" : `Edit "${field.label}"`}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {isCore && (
            <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
              <Lock size={14} className="mt-0.5 shrink-0" />
              <span>
                This is a core field used by the OEE calculation. You can rename and reorder it
                {isStructural ? ", but it can't be hidden or made optional." : ", and hide it if unused."}
              </span>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Label *</label>
            <input
              value={label}
              maxLength={LABEL_MAX}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              placeholder="e.g. Tool Change (Minutes)"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Key</label>
            <input
              value={key}
              disabled={!isNew}
              onChange={(e) => { setKeyTouched(true); setKey(e.target.value); }}
              className="w-full rounded border px-3 py-2 font-mono text-sm disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-900"
            />
            <p className="mt-1 text-xs text-gray-500">
              {isNew ? "Auto-filled from the label. Used to store the value — it can't be changed later." : "A field's key is fixed once created."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Type</label>
              <select
                value={type}
                disabled={isCore || isStoppageReason}
                onChange={(e) => setType(e.target.value)}
                className="w-full rounded border px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-900"
              >
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Section</label>
              <input
                value={section}
                onChange={(e) => setSection(e.target.value)}
                className="w-full rounded border px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={isRequired}
                disabled={isStructural}
                onChange={(e) => setIsRequired(e.target.checked)}
                className="h-4 w-4"
              />
              Required
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={isStoppageReason}
                disabled={isCore}
                onChange={(e) => setIsStoppageReason(e.target.checked)}
                className="h-4 w-4"
              />
              Counts towards Total Stoppage
            </label>
            {isStoppageReason && (
              <p className="pl-6 text-xs text-gray-500">
                Its minutes are added to Total Stoppage, reducing Available Working Time and OEE.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3 dark:border-gray-700">
          <button onClick={onClose} className="rounded border px-4 py-2 text-sm dark:border-gray-600 dark:text-gray-200">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={isSaving}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? "Saving..." : isNew ? "Add Field" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────
const FormBuilder = () => {
  const toast = useAlert() || toastify;
  const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } =
    useContext(MenuContext) || {};
  const canWrite = currentPagePermissions.write || currentPagePermissions.edit;
  const invalidateSchema = useInvalidateFormSchema();

  const [form, setForm] = useState(null);
  const [fields, setFields] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [modalField, setModalField] = useState(null);
  const [deleteField, setDeleteField] = useState(null);

  const load = () => {
    setIsLoading(true);
    getFormSchema()
      .then((res) => {
        const data = res.data?.data;
        setForm(data || null);
        setFields(data?.fields || []);
      })
      .catch(() => toast.error?.("Failed to load form. Has `npm run seed:forms` been run?"))
      .finally(() => setIsLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sections = useMemo(() => {
    const grouped = {};
    for (const f of fields) (grouped[f.section] ||= []).push(f);
    for (const list of Object.values(grouped)) list.sort((a, b) => a.order - b.order);
    return grouped;
  }, [fields]);

  const afterChange = (msg) => {
    toast.success?.(msg);
    invalidateSchema();
    load();
  };

  const handleSave = (payload) => {
    setIsSaving(true);
    const req = modalField?._id
      ? updateFormField(modalField._id, payload)
      : createFormField(form._id, { ...payload, order: (fields.filter((f) => f.section === payload.section).length || 0) + 1 });

    req
      .then(() => { setModalField(null); afterChange(modalField?._id ? "Field updated" : "Field added"); })
      .catch((e) => toast.error?.(e?.response?.data?.message || "Could not save field"))
      .finally(() => setIsSaving(false));
  };

  const toggleVisible = (field) => {
    updateFormField(field._id, { isVisible: !field.isVisible })
      .then(() => afterChange(field.isVisible ? "Field hidden" : "Field shown"))
      .catch((e) => toast.error?.(e?.response?.data?.message || "Could not update field"));
  };

  const move = (field, dir) => {
    const list = sections[field.section] || [];
    const i = list.findIndex((f) => f._id === field._id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const reordered = [...list];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    const payload = reordered.map((f, idx) => ({ _id: f._id, order: idx + 1 }));
    setFields((prev) =>
      prev.map((f) => {
        const hit = payload.find((p) => p._id === f._id);
        return hit ? { ...f, order: hit.order } : f;
      }),
    );
    reorderFormFields(payload)
      .then(() => invalidateSchema())
      .catch(() => { toast.error?.("Could not save order"); load(); });
  };

  const confirmDelete = () => {
    deleteFormField(deleteField._id)
      .then(() => { setDeleteField(null); afterChange("Field deleted"); })
      .catch((e) => { setDeleteField(null); toast.error?.(e?.response?.data?.message || "Could not delete field"); });
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
            <LayoutList size={20} /> Form Builder
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {form ? `${form.name} — version ${form.version}` : "Configure the Grinding Data Entry form"}
          </p>
        </div>
        {canWrite && form && (
          <button
            onClick={() => setModalField({ section: "Additional Fields", type: "number" })}
            className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus size={16} /> Add Field
          </button>
        )}
      </div>

      <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
        Fields marked with a lock are used by the OEE calculation — they can be renamed, reordered and
        (where optional) hidden, but not deleted. Fields you add yourself are saved alongside each entry,
        and if you mark one as counting towards Total Stoppage its minutes feed the OEE figures.
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {!isLoading && !form && (
        <p className="text-sm text-gray-500">
          No form found. Run <code className="rounded bg-gray-100 px-1 dark:bg-gray-700">npm run seed:forms</code> in the server directory.
        </p>
      )}

      {Object.entries(sections).map(([section, list]) => (
        <div key={section} className="mb-5 overflow-hidden rounded-lg border dark:border-gray-700">
          <div className="border-b bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
            {section} <span className="font-normal text-gray-400">({list.length})</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              <tr>
                <th className="px-4 py-2 text-left">Label</th>
                <th className="px-4 py-2 text-left">Key</th>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-left">Flags</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((f, idx) => (
                <tr
                  key={f._id}
                  className={`border-t dark:border-gray-700 ${f.isVisible ? "" : "bg-gray-50 opacity-60 dark:bg-gray-900"}`}
                >
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2 text-gray-900 dark:text-gray-100">
                      {f.isCore && <Lock size={12} className="shrink-0 text-amber-500" />}
                      {f.label}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{f.key}</td>
                  <td className="px-4 py-2 text-gray-500">{f.type}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {f.isRequired && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">required</span>}
                      {f.isStoppageReason && <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">stoppage</span>}
                      {!f.isVisible && <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">hidden</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {canWrite && (
                        <>
                          <button onClick={() => move(f, -1)} disabled={idx === 0} className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700" title="Move up">
                            <ChevronUp size={16} />
                          </button>
                          <button onClick={() => move(f, 1)} disabled={idx === list.length - 1} className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700" title="Move down">
                            <ChevronDown size={16} />
                          </button>
                          <button onClick={() => toggleVisible(f)} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" title={f.isVisible ? "Hide" : "Show"}>
                            {f.isVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                          </button>
                          <button onClick={() => setModalField(f)} className="rounded p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-700" title="Edit">
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => setDeleteField(f)}
                            disabled={f.isCore}
                            className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-gray-700"
                            title={f.isCore ? "Core fields can't be deleted" : "Delete"}
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {modalField && (
        <FieldModal
          field={modalField}
          isSaving={isSaving}
          onClose={() => setModalField(null)}
          onSave={handleSave}
        />
      )}

      {deleteField && (
        <DeleteModal
          isOpen
          onClose={() => setDeleteField(null)}
          onConfirm={confirmDelete}
          title="Delete field"
          message={`Delete "${deleteField.label}"? Values already saved on past entries are kept.`}
        />
      )}
    </div>
  );
};

export default FormBuilder;
