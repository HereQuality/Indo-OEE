import React, { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Alert, Button, FormGroup, Input, Label, Modal, ModalBody, ModalFooter, ModalHeader, Spinner } from "reactstrap";
import { getDayStatusReasons, saveDayStatus } from "../../api/machineDayStatus.api";
import RecordHistoryModal from "../AuditTrail/RecordHistoryModal";

/**
 * Components/Production/NotRunningModal.jsx
 * ──────────────────────────────────────────
 * The "Not running" shortcut on a sheet's "Not filled yet" row: pick one or
 * more reasons the machine didn't run that day (each one picked is written
 * into the remarks, which can then be added to), and optionally pick other
 * machines still unfilled that day to mark the same way.
 *
 * target = { sheet, date, machine, machineLabel, others: [{ id, label }], existing? }
 *
 * Editing an existing mark also offers "History" (footer, left): who marked
 * or changed it and when, from the audit trail (RecordHistoryModal).
 */
const FALLBACK_REASONS = [
  { value: "holiday", label: "Holiday / plant off", kind: "planned" },
  { value: "noOrder", label: "No order / no plan", kind: "planned" },
  { value: "maintenance", label: "Planned maintenance", kind: "planned" },
  { value: "breakdown", label: "Breakdown", kind: "unplanned" },
  { value: "noOperator", label: "No operator", kind: "unplanned" },
  { value: "noMaterial", label: "No material", kind: "unplanned" },
  { value: "power", label: "Power cut", kind: "unplanned" },
  { value: "other", label: "Other", kind: "unplanned" },
];
let cachedReasons = null;
const dmy = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

export default function NotRunningModal({ target, onClose, onSaved }) {
  const [reasons, setReasons] = useState(cachedReasons || FALLBACK_REASONS);
  const [picked, setPicked] = useState([]);
  const [remarks, setRemarks] = useState("");
  const [alsoMachines, setAlsoMachines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (cachedReasons) return;
    getDayStatusReasons()
      .then((res) => {
        if (Array.isArray(res?.data?.data) && res.data.data.length) setReasons((cachedReasons = res.data.data));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    setPicked(target?.existing?.reasons || (target?.existing?.reason ? [target.existing.reason] : []));
    setRemarks(target?.existing?.remarks || "");
    setAlsoMachines([]);
    setError("");
    setHistoryOpen(false);
  }, [target]);

  const others = target?.existing ? [] : target?.others || [];
  const labelOf = (v) => reasons.find((r) => r.value === v)?.label || v;
  const autoText = (list) => list.map(labelOf).join(", ");
  // Picking a reason writes it into the remarks: the remarks start with the
  // picked reasons, and anything typed after them is kept.
  const toggleReason = (v) => {
    const next = picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v];
    const was = autoText(picked);
    const now = autoText(next);
    setRemarks((cur) => {
      if (was && cur.startsWith(was)) {
        const rest = cur.slice(was.length);
        return now ? now + rest : rest.replace(/^\s*—\s*/, "");
      }
      return now + (cur.trim() ? `${now ? " — " : ""}${cur}` : "");
    });
    setPicked(next);
  };
  const toggleMachine = (id) => setAlsoMachines((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const needsRemark = picked.includes("other") && remarks.trim() === autoText(picked);
  const kind = picked.some((v) => reasons.find((r) => r.value === v)?.kind !== "planned") ? "unplanned" : "planned";
  const save = async () => {
    if (!picked.length && !remarks.trim()) return setError("Pick a reason or write a description.");
    if (needsRemark) return setError("Write a remark for 'Other'.");
    setSaving(true);
    setError("");
    try {
      const machines = [target.machine, ...alsoMachines];
      await saveDayStatus({ sheet: target.sheet, date: target.date, machines, reasons: picked.length ? picked : ["other"], remarks: remarks.trim() });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={!!target} toggle={() => !saving && onClose()} centered scrollable>
      <ModalHeader toggle={() => !saving && onClose()}>{target?.existing ? "Edit not running" : "Mark as not running"}</ModalHeader>
      <ModalBody>
        <div className="text-muted small mb-3">
          {target?.machineLabel ? <><b className="text-body">{target.machineLabel}</b> on </> : null}
          <b className="text-body">{dmy(target?.date)}</b> — no entry will be expected for {target?.machineLabel ? "this machine" : "this day"}.
        </div>
        <Label className="mb-2">Reason <span className="text-muted small fw-normal">(pick one or more, or just write a description)</span></Label>
        <div className="d-flex flex-wrap gap-2 mb-3" role="group" aria-label="Reasons">
          {reasons.map((r) => (
            <Button
              key={r.value}
              type="button"
              size="sm"
              aria-pressed={picked.includes(r.value)}
              color={picked.includes(r.value) ? "primary" : "light"}
              className="rounded-pill"
              onClick={() => toggleReason(r.value)}
            >
              {r.label}
            </Button>
          ))}
        </div>
        {picked.length > 0 && (
          <div className="small text-muted mb-3">
            {kind === "planned" ? "Planned stop — not counted as a loss." : "Unplanned stop — a loss on the day."}
          </div>
        )}
        <FormGroup className="mb-2">
          <Label htmlFor="nr-remarks" className="mb-1">Remarks / description{picked.includes("other") ? " *" : ""}</Label>
          <Input id="nr-remarks" type="textarea" rows={3} maxLength={300} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Spindle bearing replaced, back tomorrow" invalid={!!error && needsRemark} />
          <div className="form-text text-end">{remarks.length}/300</div>
        </FormGroup>
        {others.length > 0 && (
          <div className="mb-2">
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
              <Label className="mb-0">Also mark these unfilled machines <span className="text-muted small fw-normal">(optional)</span></Label>
              <Button type="button" size="sm" color="link" className="p-0" onClick={() => setAlsoMachines(alsoMachines.length === others.length ? [] : others.map((o) => o.id))}>
                {alsoMachines.length === others.length ? "Clear" : "Select all"}
              </Button>
            </div>
            <div className="d-flex flex-wrap gap-2" role="group" aria-label="Other machines">
              {others.map((o) => (
                <Button key={o.id} type="button" size="sm" outline={!alsoMachines.includes(o.id)} color="primary" className="rounded-pill" aria-pressed={alsoMachines.includes(o.id)} onClick={() => toggleMachine(o.id)}>
                  {o.label}
                </Button>
              ))}
            </div>
          </div>
        )}
        {error && <Alert color="danger" className="mb-0 mt-2 py-2">{error}</Alert>}
      </ModalBody>
      <ModalFooter className="flex-wrap gap-2">
        {target?.existing && (
          <Button type="button" color="link" className="me-auto px-0 d-inline-flex align-items-center gap-1 text-decoration-none" onClick={() => setHistoryOpen(true)} disabled={saving} title="Who marked or changed this and when">
            <History size={14} /> History
          </Button>
        )}
        <Button color="light" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button color="primary" onClick={save} disabled={saving || (!picked.length && !remarks.trim())}>
          {saving ? <Spinner size="sm" /> : alsoMachines.length ? `Save ${alsoMachines.length + 1} machines` : "Save"}
        </Button>
      </ModalFooter>
      {target?.existing && (
        <RecordHistoryModal
          isOpen={historyOpen}
          onClose={() => setHistoryOpen(false)}
          title={`Not running · ${[target.machineLabel, dmy(target.date)].filter(Boolean).join(" · ")}`}
          query={{ sheet: target.sheet, date: target.date, machine: target.machine || "" }}
        />
      )}
    </Modal>
  );
}
