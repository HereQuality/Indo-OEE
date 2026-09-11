import React, { useState, useEffect, useContext, useMemo } from "react";
import { Pencil, Trash2, Clock, Plus, X } from "lucide-react";
import { toast as toastify } from "react-toastify";
import { useAlert } from "../context/AlertContext";
import { MenuContext } from "../context/MenuContext";
import { useMachines } from "../hooks/useMachines";
import { useProcesses } from "../hooks/useProcesses";
import DeleteModal from "../Components/Common/DeleteModal";
import StatusCheckbox from "../Components/Common/StatusCheckbox";
import {
  createStandardTime,
  updateStandardTime,
  deleteStandardTime,
  getStandardTimeById,
  searchStandardTimes,
} from "../api/standardTime.api";

const PAGE_SIZE = 20;

// React attaches wheel listeners as passive by default, so preventDefault()
// from a plain onWheel prop is silently ignored — the browser still lets
// mouse-wheel/trackpad scroll bump a focused number input's value. Attaching
// a real (non-passive) DOM listener via ref is the only way to block it.
const noWheelChange = (el) => {
  if (el) el.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
};

// ── Validation ────────────────────────────────────────────────────────────
const validate = (v) => {
  const e = {};
  if (!v.machine) e.machine = "Machine is required";
  const w = Number(v.sizeWidthMm);
  if (!v.sizeWidthMm) e.sizeWidthMm = "Width is required";
  else if (isNaN(w) || w <= 0) e.sizeWidthMm = "Must be > 0";
  const h = Number(v.sizeHeightMm);
  if (!v.sizeHeightMm) e.sizeHeightMm = "Height is required";
  else if (isNaN(h) || h <= 0) e.sizeHeightMm = "Must be > 0";
  if (!String(v.thicknessMm || "").trim()) e.thicknessMm = "Thickness is required";
  const st = Number(v.standardTimeMin);
  if (!v.standardTimeMin) e.standardTimeMin = "Standard Time is required";
  else if (isNaN(st) || st <= 0) e.standardTimeMin = "Must be > 0";
  return e;
};

const INIT = { machine: "", sizeWidthMm: "", sizeHeightMm: "", thicknessMm: "", standardTimeMin: "", isActive: true };

// ── Add / Edit Modal ──────────────────────────────────────────────────────
const STModal = ({ mode, initialValues, machines, processes, onClose, onSaved }) => {
  const toast = useAlert() || toastify;
  const [v, setV] = useState(initialValues);
  const [errs, setErrs] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  // Process filter for the Machine dropdown — purely a UI narrowing aid
  // (StandardTime only stores `machine`; the process is implied by the
  // machine's own `processes` list on the Machine master), same pattern
  // as the Process→Machine cascade on the Grinding Data Entry form.
  const [process, setProcess] = useState(() => {
    const initMachine = machines.find((m) => m._id === initialValues.machine);
    const firstProcess = initMachine?.processes?.[0];
    return firstProcess ? (typeof firstProcess === "object" ? firstProcess._id : firstProcess) : "";
  });
  const filteredMachines = useMemo(() => {
    if (!process) return machines;
    return machines.filter((m) =>
      (m.processes || []).some((p) => (typeof p === "object" ? p._id : p) === process)
    );
  }, [machines, process]);

  const set = (name, value) => setV((prev) => ({ ...prev, [name]: value }));

  const handleProcessChange = (e) => {
    setProcess(e.target.value);
    set("machine", "");
  };

  // Live duplicate check — once Machine + Size + Thickness are all filled,
  // look for another record already using that exact combination and, if
  // found, lock the Standard Time field so a duplicate can't be typed at
  // all (this mirrors the machine+size+thickness uniqueness enforced on
  // the backend, just surfaced earlier in the flow).
  const [dupCheck, setDupCheck] = useState({ checking: false, duplicate: false });
  useEffect(() => {
    const { machine, sizeWidthMm, sizeHeightMm, thicknessMm } = v;
    if (!machine || !sizeWidthMm || !sizeHeightMm || !String(thicknessMm || "").trim()) {
      setDupCheck({ checking: false, duplicate: false });
      return;
    }
    let cancelled = false;
    setDupCheck((prev) => ({ ...prev, checking: true }));
    const timer = setTimeout(() => {
      searchStandardTimes({ skip: 0, per_page: 500, machine })
        .then((res) => {
          if (cancelled) return;
          const rows = res.data?.data?.[0]?.data || [];
          const match = rows.find(
            (r) =>
              r._id !== initialValues._id &&
              String(r.sizeWidthMm) === String(sizeWidthMm) &&
              String(r.sizeHeightMm) === String(sizeHeightMm) &&
              String(r.thicknessMm).trim().toLowerCase() === String(thicknessMm).trim().toLowerCase(),
          );
          setDupCheck({ checking: false, duplicate: !!match });
        })
        .catch(() => { if (!cancelled) setDupCheck({ checking: false, duplicate: false }); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [v.machine, v.sizeWidthMm, v.sizeHeightMm, v.thicknessMm, initialValues._id]);

  useEffect(() => {
    if (dupCheck.duplicate) {
      set("standardTimeMin", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupCheck.duplicate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errors = validate(v);
    if (dupCheck.duplicate) {
      errors.thicknessMm = "An entry already exists for this machine, size and thickness combination";
    }
    setErrs(errors);
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      if (mode === "add") {
        const res = await createStandardTime(v);
        if (res.data.isOk) { toast.success?.("Standard time added!"); onSaved(); }
      } else {
        await updateStandardTime(initialValues._id, v);
        toast.success?.("Standard time updated!");
        onSaved();
      }
    } catch (err) {
      const msg = err.response?.data?.message || "Failed to save";
      const apiErrs = err.response?.data?.errors;
      if (apiErrs) setErrs((prev) => ({ ...prev, ...apiErrs }));
      toast.error?.(msg);
    } finally {
      setSaving(false);
    }
  };

  const inp = (name) => ({
    value: v[name],
    onChange: (e) => set(name, e.target.value),
    className: `w-full border rounded-xl px-3.5 py-2.5 text-sm outline-none transition-shadow ${
      submitted && errs[name]
        ? "border-red-400 focus:border-red-500 focus:ring-4 focus:ring-red-500/15"
        : "border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
    }`,
  });

  const err = (name) => submitted && errs[name] ? <p className="text-xs text-red-500 mt-1">{errs[name]}</p> : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-slate-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">
            {mode === "add" ? "Add Standard Time" : "Edit Standard Time"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Process — narrows the Machine dropdown below */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Process</label>
            <select
              value={process}
              onChange={handleProcessChange}
              className="w-full border rounded-xl px-3.5 py-2.5 text-sm outline-none transition-shadow border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
            >
              <option value="">All Processes</option>
              {processes.map((p) => (
                <option key={p._id} value={p._id}>{p.processName}</option>
              ))}
            </select>
          </div>

          {/* Machine */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Machine <span className="text-red-500">*</span>
            </label>
            <select {...inp("machine")}>
              <option value="">{filteredMachines.length === 0 ? "— No machines for this process —" : "Select Machine"}</option>
              {filteredMachines.map((m) => (
                <option key={m._id} value={m._id}>{m.machineName}</option>
              ))}
            </select>
            {err("machine")}
          </div>

          {/* Size Width × Height */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Size in mm <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0.1}
                step={0.1}
                placeholder="Width"
                value={v.sizeWidthMm}
                onChange={(e) => set("sizeWidthMm", e.target.value)}
                onWheel={(e) => e.target.blur()}
                ref={noWheelChange}
                className={`w-full border rounded-xl px-3.5 py-2.5 text-sm outline-none transition-shadow ${
                  submitted && errs.sizeWidthMm ? "border-red-400 focus:border-red-500 focus:ring-4 focus:ring-red-500/15" : "border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
                }`}
              />
              <span className="text-slate-400 font-semibold text-lg shrink-0">×</span>
              <input
                type="number"
                min={0.1}
                step={0.1}
                placeholder="Height"
                value={v.sizeHeightMm}
                onChange={(e) => set("sizeHeightMm", e.target.value)}
                onWheel={(e) => e.target.blur()}
                ref={noWheelChange}
                className={`w-full border rounded-xl px-3.5 py-2.5 text-sm outline-none transition-shadow ${
                  submitted && errs.sizeHeightMm ? "border-red-400 focus:border-red-500 focus:ring-4 focus:ring-red-500/15" : "border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
                }`}
              />
            </div>
            {(submitted && (errs.sizeWidthMm || errs.sizeHeightMm)) && (
              <p className="text-xs text-red-500 mt-1">{errs.sizeWidthMm || errs.sizeHeightMm}</p>
            )}
          </div>

          {/* Thickness */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Thickness (mm) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. 6 or 6L"
              value={v.thicknessMm}
              onChange={(e) => set("thicknessMm", e.target.value)}
              className={`w-full border rounded-xl px-3.5 py-2.5 text-sm outline-none transition-shadow ${
                (submitted && errs.thicknessMm) || dupCheck.duplicate ? "border-red-400 focus:border-red-500 focus:ring-4 focus:ring-red-500/15" : "border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
              }`}
            />
            {dupCheck.checking && (
              <p className="text-xs text-slate-400 mt-1">Checking for an existing entry…</p>
            )}
            {!dupCheck.checking && dupCheck.duplicate && (
              <p className="text-xs text-red-500 mt-1">
                An entry already exists for this Machine + Size + Thickness combination.
              </p>
            )}
            {!dupCheck.duplicate && err("thicknessMm")}
          </div>

          {/* Standard Time */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Standard Time of Grinding One Glass (Minutes) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min={0.01}
              step={0.01}
              placeholder={dupCheck.duplicate ? "Already exists for this combination" : "e.g. 2.5"}
              value={v.standardTimeMin}
              onChange={(e) => set("standardTimeMin", e.target.value)}
              onWheel={(e) => e.target.blur()}
              ref={noWheelChange}
              disabled={dupCheck.duplicate}
              className={`w-full border rounded-xl px-3.5 py-2.5 text-sm outline-none transition-shadow disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed ${
                submitted && errs.standardTimeMin ? "border-red-400 focus:border-red-500 focus:ring-4 focus:ring-red-500/15" : "border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
              }`}
            />
            {err("standardTimeMin")}
          </div>

          {/* Active */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="st_isActive"
              checked={v.isActive}
              onChange={(e) => set("isActive", e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <label htmlFor="st_isActive" className="text-sm text-slate-700 select-none cursor-pointer">Active</label>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button type="button" onClick={onClose} disabled={saving}
              className="rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2.5 disabled:opacity-60">
              Cancel
            </button>
            <button type="submit" disabled={saving || dupCheck.duplicate}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2.5 shadow-sm disabled:opacity-70">
              {saving ? "Saving…" : mode === "add" ? "Add" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────
const StandardTimeMaster = () => {
  const toast = useAlert() || toastify;
  const { currentPagePermissions = { read: true, write: true, edit: true, delete: true } } =
    useContext(MenuContext) || {};
  const { data: machines = [] } = useMachines();
  const { data: processes = [] } = useProcesses();

  const [records, setRecords] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);
  const [filterProcess, setFilterProcess] = useState("");
  const [filterMachine, setFilterMachine] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  const fetchRecords = () => {
    setIsLoading(true);
    searchStandardTimes({
      skip: (page - 1) * PAGE_SIZE,
      per_page: PAGE_SIZE,
      machine: filterMachine || undefined,
      isActive: activeOnly,
    })
      .then((res) => {
        setRecords(res.data?.data?.[0]?.data || []);
        setTotalCount(res.data?.data?.[0]?.count || 0);
      })
      .catch(() => toast.error?.("Failed to load standard times"))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { fetchRecords(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filterMachine, activeOnly, page]);

  // A filter change should reset back to page 1 — otherwise a narrower
  // filter could land on a now out-of-range page.
  useEffect(() => { setPage(1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filterMachine, activeOnly]);

  const openEdit = (id) => {
    getStandardTimeById(id).then((res) => {
      const d = res.data.data;
      setEditItem({
        _id: id,
        machine: d.machine?._id || d.machine || "",
        sizeWidthMm: d.sizeWidthMm,
        sizeHeightMm: d.sizeHeightMm,
        thicknessMm: d.thicknessMm,
        standardTimeMin: d.standardTimeMin,
        isActive: d.isActive,
      });
    }).catch(() => toast.error?.("Failed to fetch record"));
  };

  const handleDelete = (e) => {
    e.preventDefault();
    setIsDeleteLoading(true);
    deleteStandardTime(deleteId)
      .then(() => { setDeleteId(null); toast.success?.("Removed!"); fetchRecords(); })
      .catch(() => { setDeleteId(null); toast.error?.("Failed to delete"); })
      .finally(() => setIsDeleteLoading(false));
  };

  const allMachinesForFilter = useMemo(() => {
    if (!filterProcess) return machines;
    return machines.filter((m) =>
      (m.processes || []).some((p) => (typeof p === "object" ? p._id : p) === filterProcess)
    );
  }, [machines, filterProcess]);

  const handleFilterProcessChange = (e) => {
    setFilterProcess(e.target.value);
    setFilterMachine("");
  };

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-brand-600" />
          <h1 className="text-lg font-semibold text-slate-900">Standard Time Master</h1>
        </div>
        {currentPagePermissions.create && (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-4 py-2.5 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Standard Time
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3">
        <select
          value={filterProcess}
          onChange={handleFilterProcessChange}
          className="w-full sm:w-56 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
        >
          <option value="">All Processes</option>
          {processes.map((p) => (
            <option key={p._id} value={p._id}>{p.processName}</option>
          ))}
        </select>
        <select
          value={filterMachine}
          onChange={(e) => setFilterMachine(e.target.value)}
          className="w-full sm:w-56 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
        >
          <option value="">All Machines</option>
          {allMachinesForFilter.map((m) => (
            <option key={m._id} value={m._id}>{m.machineName}</option>
          ))}
        </select>
        <StatusCheckbox checked={activeOnly} onChange={setActiveOnly} className="sm:ml-auto" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600 text-left">
              <th className="px-4 py-3 font-medium whitespace-nowrap">Machine</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Process</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Size (mm)</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Thickness (mm)</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Std. Time (min)</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Status</th>
              <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  {isLoading ? "Loading…" : "No records found. Click 'Add Standard Time' to create one."}
                </td>
              </tr>
            )}
            {records.map((r) => (
              <tr key={r._id} className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors">
                <td className="px-4 py-3 font-medium text-slate-800">{r.machine?.machineName || "—"}</td>
                <td className="px-4 py-3 text-slate-600">
                  {(r.machine?.processes || []).map((p) => p.processName).join(", ") || "—"}
                </td>
                <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                  {r.sizeWidthMm} × {r.sizeHeightMm}
                </td>
                <td className="px-4 py-3 text-slate-600">{r.thicknessMm} mm</td>
                <td className="px-4 py-3 text-slate-800 font-semibold">{r.standardTimeMin} min</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    r.isActive ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
                  }`}>
                    {r.isActive ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {currentPagePermissions.edit && (
                      <button onClick={() => openEdit(r._id)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors" title="Edit">
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    {currentPagePermissions.delete && (
                      <button onClick={() => setDeleteId(r._id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors" title="Delete">
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

      {totalCount > 0 && (
        <div className="flex items-center justify-between mt-3 px-1 text-sm text-slate-600">
          <span>
            Showing {Math.min((page - 1) * PAGE_SIZE + 1, totalCount)}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500">
              Page {page} of {Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => (p * PAGE_SIZE < totalCount ? p + 1 : p))}
              disabled={page * PAGE_SIZE >= totalCount || isLoading}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {showAdd && (
        <STModal mode="add" initialValues={INIT} machines={machines} processes={processes}
          onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); fetchRecords(); }} />
      )}
      {editItem && (
        <STModal mode="edit" initialValues={editItem} machines={machines} processes={processes}
          onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); fetchRecords(); }} />
      )}
      <DeleteModal show={!!deleteId} toggle={() => setDeleteId(null)}
        handleDelete={handleDelete} disabled={isDeleteLoading} />
    </div>
  );
};

export default StandardTimeMaster;
