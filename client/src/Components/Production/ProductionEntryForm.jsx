import React, { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Col, Input, Label, Row } from "reactstrap";
import DatePicker from "../Common/DatePicker";
import TimePicker from "../Common/TimePicker";
import NumberInput from "./NumberInput";
import { useAlert } from "../../context/AlertContext";
import { CYCLE_OP_FIELDS, REJECT_REASONS, cycleOpLabel, fmtNum, fmtPct, normalizeTime, rowCalc } from "../../utils/productionSheet";
import { DOWNTIME_KEYS, cleanSplit, isTimeRuleMessage, lunchRequired, stoppageLimitMin } from "../../utils/entryValidation";

/**
 * components/Production/ProductionEntryForm.jsx
 * ──────────────────────────────────────────────
 * The Production Data Entry form: one block per machine, each behind its own
 * "+". A block starts as just a machine picker and that "+"; pressing it opens
 * that machine's whole sheet at once — all twelve lines, nothing else to click.
 * "Add another machine" appends a further block, so several machines can be
 * filled in and saved together; an open block collapses again with "−", which
 * keeps everything typed into it and just gets it out of the way while another
 * machine is filled in. Editing an existing record shows a single block,
 * already open.
 *
 * Typed fields are white; every grey box is calculated live by
 * utils/productionSheet.js. Actual Quantity is typed (never more than Ideal
 * Quantity — Shift Time ÷ Cycle Time, rounded down) and OK Quantity is typed
 * against it, so Rejected is always Actual − OK and the Rejection Master split
 * has to account for every one of those pieces; the dashboard's Total/
 * Rejected/% OK read the same Actual figure.
 *
 * Everything on the form is required except the downtime boxes and the general
 * remarks — and downtime is only checked if something is typed. Lunch / Rest is
 * required only while Planned Operator Shift − Machine Shift leaves time over. The rules live
 * in utils/entryValidation.js, which the page runs live over every block: Save
 * looks inactive until they all pass, and pressing it anyway sends `focusTarget`
 * here, which opens the first incomplete block and scrolls to its first missing
 * field. Using "Other" as a reject reason or as downtime opens a remark box that
 * is itself required.
 *
 * The form deliberately shows less than the sheet does. Entry No. is assigned
 * by the page rather than picked; Drawing No. and Cycle Time come from the
 * chosen part and are saved without being shown; and Effective Machine
 * Runtime, Unreported Time, Setup Efficiency and the three OEE figures are
 * all derived, so they are left to the entries table and the dashboard
 * instead of being repeated here as boxes nobody fills in.
 */

const labelClass = "form-label small text-muted mb-1";

// A calculated box — greyed so nobody tries to type in it.
const Calc = ({ label, value, md = 3, title }) => (
  <Col md={md}>
    <div className="mb-1" title={title}>
      <Label className={labelClass}>{label}</Label>
      <Input type="text" bsSize="sm" value={value ?? ""} readOnly disabled className="bg-light" />
    </div>
  </Col>
);

// A typed field. `fieldKey` is what Save's scroll-to-first-error looks for.
const Field = ({ label, required, error, children, md = 3, fieldKey }) => (
  <Col md={md}>
    <div className="mb-1" data-field={fieldKey}>
      <Label className={labelClass}>
        {label} {required && <span className="text-danger">*</span>}
      </Label>
      {children}
      {error && <p className="text-danger mb-0 small mt-1">{error}</p>}
    </div>
  </Col>
);

// The lines, in sheet order. `fields` lists the typed keys in each line, so a
// line containing a validation error can flag itself in its heading.
const LINES = [
  { id: 1, title: "Date, Machine No., Operator", fields: ["date", "machine", "operator"] },
  {
    id: 2,
    title: "Part Name, Total Cycle Time",
    fields: ["itemName", ...CYCLE_OP_FIELDS.map((f) => f.key)],
  },
  { id: 3, title: "Machine ON–OFF Time, Machine Shift", fields: ["machineOnTime", "machineOffTime"] },
  { id: 5, title: "Ideal Qty, Actual Qty, OK Qty, Rejected, % OK Qty", fields: ["actualQty", "okQty"] },
  { id: 13, title: "Rejection Master (Qty)", fields: ["rejectBreakdown", "rejectOtherRemark"] },
  // Lunch / Rest is a property of the shift, not of a stoppage, so it sits with
  // Planned Operator Shift — though it still counts toward total stoppage.
  { id: 7, title: "Planned Operator Shift, Lunch / Rest", fields: ["plannedOperatorShiftHours", "lunchMin"] },
  // Every other downtime/stoppage reason in one box, so the whole stoppage
  // picture is visible at a glance and none is easy to miss.
  { id: 8, title: "Downtime / Stoppage (min)", fields: [...DOWNTIME_KEYS, "stoppageTotal", "otherMinRemark"] },
  { id: 12, title: "Remarks", fields: ["remarks"] },
];

const findLine = (id) => LINES.find((l) => l.id === id);

// A titled box around one line's fields. Kept at module scope — defining it
// inside EntryBlock would make React see a brand-new component type on every
// keystroke (since the function itself is recreated each render) and remount
// the whole subtree, dropping focus out of whatever input was being typed in.
const Line = ({ id, errors, isSubmit, children }) => {
  const def = findLine(id);
  const hasError = isSubmit && def.fields.some((f) => errors[f]);
  return (
    <div className={`border rounded mb-1 ${hasError ? "border-danger" : ""}`}>
      <div className="d-flex align-items-center gap-2 px-2 py-1 bg-light border-bottom rounded-top">
        <span className="fw-semibold small">{def.title}</span>
        {hasError && <span className="badge bg-danger-subtle text-danger ms-auto">Check this line</span>}
      </div>
      <div className="px-2 pt-1">{children}</div>
    </div>
  );
};

// Everything a block can hold beyond the machine itself — used to tell a
// collapsed block that still has typing in it from an untouched one.
const DATA_KEYS = [
  "operator", "itemName", "drawingNo", "machineOnTime", "machineOffTime",
  "actualQty", "okQty", "plannedOperatorShiftHours", "remarks",
  ...LINES.flatMap((l) => l.fields),
].filter((k) => !["date", "machine", "slot", "rejectBreakdown", "stoppageTotal"].includes(k));

const hasData = (v) =>
  DATA_KEYS.some((k) => v[k] !== "" && v[k] !== undefined && v[k] !== null) ||
  Object.values(v.rejectBreakdown || {}).some((n) => n !== "" && n !== undefined && n !== null);

const EntryBlock = ({
  values,
  errors,
  isSubmit,
  machines,
  items,
  operators,
  isEdit,
  index,
  canRemove,
  expanded,
  booked = [],
  onExpand,
  onChange,
  onItemSelect,
  onRejectChange,
  onRemove,
  registerRef,
}) => {
  const { warning } = useAlert();
  const calc = useMemo(() => rowCalc(values), [values]);
  // The picked part's own record — its Total Cycle Time and operation times
  // are what an unticked box gets restored from when it's ticked back.
  const selectedItem = useMemo(() => items.find((it) => it._id === values.item) || null, [items, values.item]);

  // The reject split's running total, against the Rejected figure it has to
  // match. Shown live so the operator sees the gap while typing rather than
  // only after pressing Save.
  const splitTotal = useMemo(() => Object.values(cleanSplit(values.rejectBreakdown)).reduce((sum, v) => sum + v, 0), [values.rejectBreakdown]);
  const rejected = calc.rejectedQty || 0;
  const splitMismatch = splitTotal !== rejected;
  const rejectOtherUsed = Number(values.rejectBreakdown?.Other) > 0;

  // The most stoppage this entry can account for, against what's typed.
  const stoppageLimit = useMemo(() => stoppageLimitMin(values), [values]);
  const overStoppage = stoppageLimit !== null && calc.totalStoppageMin > stoppageLimit;
  const lunchNeeded = lunchRequired(values);
  const otherDowntimeUsed = Number(values.otherMin) > 0;

  // What each capped box may still take. A Rejection Master box can hold whatever
  // of Rejected the other boxes haven't used; a downtime box (Lunch / Rest
  // included) whatever of the allowed stoppage the others haven't — the same
  // "can't type past it" rule as Actual and OK Quantity, instead of leaving it
  // to an error on Save. Downtime has no ceiling until Planned Operator Shift
  // and the machine times are in, since the allowance can't be worked out yet.
  const rejectRoom = (reason) =>
    Math.max(0, rejected - (splitTotal - (Number(values.rejectBreakdown?.[reason]) || 0)));
  const minutesBox = (key) => {
    const room =
      stoppageLimit === null
        ? 1440
        : Math.min(1440, Math.max(0, stoppageLimit - ((calc.totalStoppageMin || 0) - (Number(values[key]) || 0))));
    return {
      max: room,
      onExceedMax: () =>
        warning(
          stoppageLimit === null
            ? "Downtime can't be more than 1440 minutes (a day)."
            : `Total stoppage can't be more than ${stoppageLimit} min (Planned Operator Shift − Machine Shift) — only ${room} min left for this box.`,
        ),
    };
  };

  // The time rules (OFF after ON, no overlap) show as soon as the times are
  // picked; everything else waits until Save has been pressed.
  const err = (key) => (isSubmit || isTimeRuleMessage(errors[key]) ? errors[key] : undefined);

  // The OFF picker offers nothing at or before the ON time.
  const offEarliest = useMemo(() => {
    const on = normalizeTime(values.machineOnTime);
    if (!on) return null;
    const next = Number(on.slice(0, 2)) * 60 + Number(on.slice(3)) + 1;
    return next >= 1440 ? null : `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
  }, [values.machineOnTime]);
  const errorCount = Object.keys(errors).length;
  const handle = (e) => onChange(index, e.target.name, e.target.value);

  // Picking a machine in a closed block opens its entry fields straight away —
  // no separate "+" press needed (the "+" stays for reopening a collapsed one).
  const handleMachine = (e) => {
    handle(e);
    if (!isEdit && !expanded && e.target.value) onExpand(index);
  };

  const machineSelect = (
    <Input
      type="select"
      bsSize="sm"
      name="machine"
      value={values.machine}
      onChange={handleMachine}
      disabled={isEdit}
      invalid={!!err("machine")}
    >
      <option value="">Select machine</option>
      {machines.map((m) => (
        <option key={m._id} value={m._id}>
          {m.machineName}
        </option>
      ))}
    </Input>
  );

  const removeButton = canRemove && (
    <button
      type="button"
      className="btn btn-sm btn-soft-danger btn-icon flex-shrink-0"
      title="Remove this machine"
      onClick={() => onRemove(index)}
    >
      <Trash2 size={16} className="text-danger" />
    </button>
  );

  // What a block that still needs something says about itself — the only
  // place a collapsed block can, since its fields are hidden.
  const incompleteBadge = isSubmit && errorCount > 0 && (
    <span className="badge bg-danger-subtle text-danger">
      Incomplete — {errorCount} field{errorCount === 1 ? "" : "s"} need{errorCount === 1 ? "s" : ""} attention
    </span>
  );

  // Collapsed: process, then this process's machines, then this machine's "+".
  // A filled-in block gets a subtle tint so "press + to reopen it" reads as
  // "there's saved work here", not indistinguishable from a blank block.
  if (!expanded) {
    return (
      <div
        ref={registerRef}
        data-entry-index={index}
        className={`entry-block-in border rounded mb-1 px-2 pt-1 transition-colors ${
          isSubmit && errorCount > 0 ? "border-danger" : ""
        } ${hasData(values) ? "bg-primary bg-opacity-10" : ""}`}
      >
        <Row className="align-items-start g-1">
          <Field label="Machine No." required error={err("machine")} md={4} fieldKey="machine">
            {machineSelect}
          </Field>
          <Col md={2}>
            <div className="mb-2">
              <Label className={`${labelClass} d-block`}>&nbsp;</Label>
              <div className="d-flex align-items-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary d-inline-flex align-items-center justify-content-center p-0 flex-shrink-0 rounded-circle"
                  style={{ width: 32, height: 32 }}
                  onClick={() => onExpand(index)}
                  disabled={!values.machine}
                  title={values.machine ? "Open the entry fields" : "Select a machine first"}
                  aria-label="Open the entry fields"
                >
                  <Plus size={18} />
                </button>
                {removeButton}
              </div>
            </div>
          </Col>
          <Col md={12}>
            <div className="text-muted small mt-n2 mb-2">
              {incompleteBadge ||
                (!values.machine
                  ? "Select a machine — its entry fields open automatically"
                  : hasData(values)
                    ? "Entry filled in — press + to reopen it"
                    : "Press + to fill this machine's entry")}
            </div>
          </Col>
        </Row>
      </div>
    );
  }

  const machineLabel = machines.find((m) => m._id === values.machine)?.machineName;

  return (
    <div
      ref={registerRef}
      data-entry-index={index}
      className={`entry-block-in border rounded mb-2 transition-colors ${
        isSubmit && errorCount > 0 ? "border-danger" : "border-primary"
      }`}
    >
      <div className="d-flex align-items-center gap-2 px-2 py-1 bg-light border-bottom rounded-top">
        <button
          type="button"
          className="btn btn-sm btn-primary d-inline-flex align-items-center justify-content-center p-0 flex-shrink-0 rounded-circle"
          style={{ width: 24, height: 24 }}
          onClick={() => onExpand(isEdit ? index : null)}
          title="Collapse this machine"
          aria-label="Collapse this machine"
        >
          <Minus size={15} />
        </button>
        <span className="fw-semibold small">Machine {machineLabel || index + 1}</span>
        {incompleteBadge}
        <span className="ms-auto">{removeButton}</span>
      </div>

      <div className="p-2">
        <Line id={1} errors={errors} isSubmit={isSubmit}>
          <Row className="g-1">
            <Field label="Date" required error={err("date")} md={3} fieldKey="date">
              <DatePicker name="date" value={values.date} onChange={handle} hasError={!!err("date")} />
            </Field>
            <Field label="Machine No." required error={err("machine")} md={3} fieldKey="machine">
              {machineSelect}
            </Field>
            <Field label="Operator" required error={err("operator")} md={6} fieldKey="operator">
              <Input
                type="select"
                bsSize="sm"
                name="operator"
                value={values.operator}
                onChange={handle}
                invalid={!!err("operator")}
              >
                {/* A record saved before this box read from Operator Master, or
                    one whose operator has since been deactivated, still has a
                    name typed here that this list won't contain — keep showing
                    that name rather than an empty box. */}
                <option value="">
                  {values.operator && !operators.some((o) => o.name === values.operator)
                    ? values.operator
                    : "Select operator"}
                </option>
                {operators.map((o) => (
                  <option key={o._id} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </Input>
            </Field>
          </Row>
        </Line>

        <Line id={2} errors={errors} isSubmit={isSubmit}>
          <Row className="g-1">
            <Field label="Part Name" required error={err("itemName")} md={8} fieldKey="itemName">
              <Input
                type="select"
                bsSize="sm"
                name="item"
                value={values.item || ""}
                onChange={(e) => onItemSelect(index, e.target.value)}
                invalid={!!err("itemName")}
              >
                {/* A record typed into the old grid has a part name but no link to
                    the Item master. Show that name rather than an empty box, so
                    editing the record doesn't look like the part was lost. */}
                <option value="">{values.itemName && !values.item ? values.itemName : "Select part"}</option>
                {items.map((it) => (
                  <option key={it._id} value={it._id}>
                    {/* The cycle time rides along so two parts sharing a name (or a
                        near-duplicate one) can still be told apart before picking. */}
                    {it.itemName}
                    {Number.isFinite(Number(it.totalCycleSec)) && it.totalCycleSec !== "" ? ` — ${it.totalCycleSec} sec` : ""}
                  </option>
                ))}
              </Input>
            </Field>
            <Calc
              label="Total Cycle Time (sec)"
              value={fmtNum(calc.totalCycleSec)}
              md={4}
              title="The Part's own Total Cycle Time, minus any unticked operation below"
            />
          </Row>
          <Row className="g-1">
            {CYCLE_OP_FIELDS.map((f) => {
              const label = cycleOpLabel(f);
              const checkId = `cycle-op-${index}-${f.key}`;
              // Which operations this Part *has* decides whether the box can
              // be ticked at all — one Item Master doesn't have stays
              // permanently unticked. The value itself always comes from the
              // Part and is never cleared; unticking only excludes it from
              // this entry's Total Cycle Time (excludedOps), so ticking it
              // back needs nothing restored — the seconds were there the
              // whole time.
              const itemValue = selectedItem?.[f.key];
              const canTick = itemValue !== undefined && itemValue !== null && itemValue !== "";
              const excludedOps = values.excludedOps || [];
              const excluded = excludedOps.includes(f.key);
              const toggle = () => {
                if (!canTick) return;
                onChange(
                  index,
                  "excludedOps",
                  excluded ? excludedOps.filter((k) => k !== f.key) : [...excludedOps, f.key],
                );
              };
              return (
                <Col key={f.key} md={3}>
                  <div className="form-check mb-2 d-flex align-items-center gap-1">
                    <input
                      type="checkbox"
                      className="form-check-input flex-shrink-0"
                      id={checkId}
                      checked={canTick && !excluded}
                      disabled={!canTick}
                      onChange={toggle}
                    />
                    <Label className={`form-check-label ${labelClass} mb-0`} htmlFor={checkId}>
                      {label}
                      {canTick && (
                        <span className={`ms-1 ${excluded ? "text-decoration-line-through text-muted" : "fw-semibold text-body"}`}>
                          — {fmtNum(Number(itemValue))}
                        </span>
                      )}
                    </Label>
                  </div>
                </Col>
              );
            })}
          </Row>
        </Line>

        <Line id={3} errors={errors} isSubmit={isSubmit}>
          <Row className="g-1">
            <Field label="Machine ON Time" required error={err("machineOnTime")} md={4} fieldKey="machineOnTime">
              <TimePicker
                name="machineOnTime"
                value={values.machineOnTime}
                onChange={handle}
                hasError={!!err("machineOnTime")}
              />
            </Field>
            <Field label="Machine OFF Time" required error={err("machineOffTime")} md={4} fieldKey="machineOffTime">
              <TimePicker
                name="machineOffTime"
                value={values.machineOffTime}
                onChange={handle}
                hasError={!!err("machineOffTime")}
                minTime={offEarliest}
              />
            </Field>
            <Calc
              label="Machine Shift (hr)"
              value={fmtNum(calc.shiftHours)}
              md={4}
              title="MOD(Machine OFF Time − Machine ON Time, 1) × 24"
            />
          </Row>
          {booked.length > 0 && (
            <p className="text-muted small mb-1">
              Already booked for this machine on this date: <b>{booked.join(", ")}</b> — pick a time outside it.
            </p>
          )}
        </Line>

        <Line id={5} errors={errors} isSubmit={isSubmit}>
          <Row className="g-1">
            <Calc
              label="Ideal Quantity"
              value={fmtNum(calc.idealQty)}
              md={3}
              title="Machine Shift Time × 3600 ÷ Total Cycle Time, rounded down — the most the shift could make, so Actual Quantity can't go above it"
            />
            <Field label="Actual Quantity" required error={err("actualQty")} md={3} fieldKey="actualQty">
              <NumberInput
                name="actualQty"
                value={values.actualQty}
                onChange={handle}
                decimals={false}
                invalid={!!err("actualQty")}
                max={calc.idealQty}
                onExceedMax={(max) => warning(`Actual Quantity can't be more than Ideal Quantity (${fmtNum(max)})`)}
              />
            </Field>
            <Field label="OK Quantity" required error={err("okQty")} md={3} fieldKey="okQty">
              <NumberInput
                name="okQty"
                value={values.okQty}
                onChange={handle}
                decimals={false}
                invalid={!!err("okQty")}
                max={Number.isFinite(Number(values.actualQty)) && values.actualQty !== "" ? Number(values.actualQty) : calc.idealQty}
                onExceedMax={(max) => warning(`OK Quantity can't be more than Actual Quantity (${fmtNum(max)})`)}
              />
            </Field>
            <Calc label="Rejected" value={fmtNum(calc.rejectedQty)} md={3} title="Actual Quantity − OK Quantity, so OK + Rejected = Actual" />
          </Row>
          <Row className="g-1">
            <Calc label="% OK Quantity" value={fmtPct(calc.pctOk)} md={3} title="OK Quantity ÷ (OK Quantity + Rejected Quantity)" />
          </Row>
        </Line>

        <Line id={13} errors={errors} isSubmit={isSubmit}>
          <div data-field="rejectBreakdown">
            <Row className="g-1">
              {REJECT_REASONS.map((reason) => (
                <Col md={4} key={reason}>
                  <div className="mb-2">
                    <Label className={labelClass}>{reason}</Label>
                    <NumberInput
                      name={reason}
                      value={values.rejectBreakdown?.[reason] ?? ""}
                      onChange={(e) => onRejectChange(index, reason, e.target.value)}
                      decimals={false}
                      invalid={!!err("rejectBreakdown") && splitMismatch}
                      max={rejectRoom(reason)}
                      onExceedMax={(max) =>
                        warning(
                          rejected === 0
                            ? "Rejected Quantity is 0 (Actual − OK), so there is nothing to split."
                            : `Only ${max} of the ${rejected} rejected pieces are left for “${reason}” — the boxes can't add up to more than Rejected.`,
                        )
                      }
                    />
                  </div>
                </Col>
              ))}
            </Row>
            {/* The split has to account for every rejected piece, so the running
                total is shown next to the figure it must match. */}
            <div className="mb-2 small">
              <span className="text-muted">Split so far: </span>
              <span className={splitMismatch ? "text-danger fw-semibold" : "fw-semibold"}>{splitTotal}</span>
              <span className="text-muted"> of {fmtNum(calc.rejectedQty) || 0} rejected</span>
              {splitTotal < rejected && <span className="text-danger"> — {rejected - splitTotal} left to assign</span>}
              {err("rejectBreakdown") && <p className="text-danger mb-0 mt-1">{err("rejectBreakdown")}</p>}
            </div>
          </div>
          {rejectOtherUsed && (
            <Row className="g-1">
              <Field label="Remark for “Other” rejection" required error={err("rejectOtherRemark")} md={12} fieldKey="rejectOtherRemark">
                <Input
                  type="textarea"
                  bsSize="sm"
                  name="rejectOtherRemark"
                  value={values.rejectOtherRemark || ""}
                  onChange={handle}
                  maxLength={300}
                  placeholder="Why were these pieces rejected as “Other”?"
                  invalid={!!err("rejectOtherRemark")}
                  style={{ height: "52px" }}
                />
              </Field>
            </Row>
          )}
        </Line>

        <Line id={7} errors={errors} isSubmit={isSubmit}>
          <Row className="g-1">
            <Field label="Planned Operator Shift (hr)" required error={err("plannedOperatorShiftHours")} md={4} fieldKey="plannedOperatorShiftHours">
              <NumberInput
                name="plannedOperatorShiftHours"
                value={values.plannedOperatorShiftHours}
                onChange={handle}
                invalid={!!err("plannedOperatorShiftHours")}
                max={24}
                onExceedMax={() => warning("Planned Operator Shift can't be more than 24 hours.")}
              />
            </Field>
            <Field label="Lunch / Rest (min)" required={lunchNeeded} error={err("lunchMin")} md={4} fieldKey="lunchMin">
              <NumberInput
                name="lunchMin"
                value={values.lunchMin}
                onChange={handle}
                decimals={false}
                invalid={!!err("lunchMin")}
                {...minutesBox("lunchMin")}
              />
              {stoppageLimit === 0 && (
                <p className="text-muted mb-0 small mt-1">Not needed — the machine ran the whole planned shift.</p>
              )}
            </Field>
            <Calc
              label="Stoppage Allowed (min)"
              value={stoppageLimit === null ? "" : String(stoppageLimit)}
              md={4}
              title="Planned Operator Shift (min) − Machine Shift (min): the most Lunch / Rest plus every downtime below can add up to"
            />
          </Row>
        </Line>

        <Line id={8} errors={errors} isSubmit={isSubmit}>
          <Row className="g-1">
            <Field label="Setup Time (min)" error={err("setupMin")} md={3} fieldKey="setupMin">
              <NumberInput name="setupMin" value={values.setupMin} onChange={handle} decimals={false} invalid={!!err("setupMin")} {...minutesBox("setupMin")} />
            </Field>
            <Field label="No Man Power (min)" error={err("noManPowerMin")} md={3} fieldKey="noManPowerMin">
              <NumberInput name="noManPowerMin" value={values.noManPowerMin} onChange={handle} decimals={false} invalid={!!err("noManPowerMin")} {...minutesBox("noManPowerMin")} />
            </Field>
            <Field label="Material Shifting (min)" error={err("materialShiftingMin")} md={3} fieldKey="materialShiftingMin">
              <NumberInput
                name="materialShiftingMin"
                value={values.materialShiftingMin}
                onChange={handle}
                decimals={false}
                invalid={!!err("materialShiftingMin")}
                {...minutesBox("materialShiftingMin")}
              />
            </Field>
            <Field label="No Material (min)" error={err("noMaterialMin")} md={3} fieldKey="noMaterialMin">
              <NumberInput name="noMaterialMin" value={values.noMaterialMin} onChange={handle} decimals={false} invalid={!!err("noMaterialMin")} {...minutesBox("noMaterialMin")} />
            </Field>
            <Field label="Breakdown Mechanical (min)" error={err("bdMechMin")} md={3} fieldKey="bdMechMin">
              <NumberInput name="bdMechMin" value={values.bdMechMin} onChange={handle} decimals={false} invalid={!!err("bdMechMin")} {...minutesBox("bdMechMin")} />
            </Field>
            <Field label="BD Electricity (min)" error={err("bdEleMin")} md={3} fieldKey="bdEleMin">
              <NumberInput name="bdEleMin" value={values.bdEleMin} onChange={handle} decimals={false} invalid={!!err("bdEleMin")} {...minutesBox("bdEleMin")} />
            </Field>
            <Field label="No Power (min)" error={err("noPowerMin")} md={3} fieldKey="noPowerMin">
              <NumberInput name="noPowerMin" value={values.noPowerMin} onChange={handle} decimals={false} invalid={!!err("noPowerMin")} {...minutesBox("noPowerMin")} />
            </Field>
            <Field label="Other (min)" error={err("otherMin")} md={3} fieldKey="otherMin">
              <NumberInput name="otherMin" value={values.otherMin} onChange={handle} decimals={false} invalid={!!err("otherMin")} {...minutesBox("otherMin")} />
            </Field>
          </Row>
          {/* Lunch / Rest and every box above have to fit inside what Planned
              Operator Shift leaves after the machine's own run, so the running
              total sits next to that allowance. */}
          <div className="mb-2 small" data-field="stoppageTotal">
            <span className="text-muted">Total stoppage (with Lunch / Rest): </span>
            <span className={overStoppage ? "text-danger fw-semibold" : "fw-semibold"}>{fmtNum(calc.totalStoppageMin) || 0} min</span>
            <span className="text-muted">
              {stoppageLimit === null
                ? " — enter Planned Operator Shift and Machine ON/OFF Time to see the allowance"
                : ` of ${stoppageLimit} min allowed`}
            </span>
            {err("stoppageTotal") && <p className="text-danger mb-0 mt-1">{err("stoppageTotal")}</p>}
          </div>
          {otherDowntimeUsed && (
            <Row className="g-1">
              <Field label="Remark for Other downtime" required error={err("otherMinRemark")} md={12} fieldKey="otherMinRemark">
                <Input
                  type="textarea"
                  bsSize="sm"
                  name="otherMinRemark"
                  value={values.otherMinRemark || ""}
                  onChange={handle}
                  maxLength={300}
                  placeholder="What was the “Other” downtime?"
                  invalid={!!err("otherMinRemark")}
                  style={{ height: "52px" }}
                />
              </Field>
            </Row>
          )}
        </Line>

        <Line id={12} errors={errors} isSubmit={isSubmit}>
          <div className="mb-2">
            <Label className={labelClass}>Remarks</Label>
            <Input
              type="textarea"
              bsSize="sm"
              name="remarks"
              value={values.remarks}
              onChange={handle}
              maxLength={500}
              style={{ height: "60px" }}
            />
          </div>
        </Line>
      </div>
    </div>
  );
};

const ProductionEntryForm = ({
  entries = [],
  errors = [],
  isSubmit = false,
  focusTarget = null,
  machines = [],
  items = [],
  operators = [],
  isEdit = false,
  booked = [],
  onChange,
  onItemSelect,
  onRejectChange,
  onAdd,
  onRemove,
}) => {
  // Only one block is ever open at a time: opening one collapses whichever
  // else was open, so several "Add another machine" blocks behave like an
  // accordion instead of piling up expanded together. Editing shows a single
  // block, always open.
  // "Add Entry" with a machine already chosen (the sheet's Machine filter, or a
  // restored draft) opens that block at once instead of waiting for a "+".
  const [expandedIndex, setExpandedIndex] = useState(() => {
    if (isEdit) return 0;
    const first = entries.findIndex((v) => v.machine);
    return first === -1 ? null : first;
  });

  // One scroll owned by the parent, not one independent effect per block —
  // expanding block B while collapsing block A changes both of their
  // `expanded` props in the same render, and two competing scrollIntoView
  // calls raced each other (whichever ran last silently won, so a plain
  // collapse-to-none often ended up wherever some *other* block's effect
  // last pointed rather than back at the block just closed). This fires
  // exactly once per expandedIndex change: to the newly opened block, or —
  // when collapsing back to none — to whichever block was just closed.
  const blockRefs = useRef({});
  const lastExpandedRef = useRef(expandedIndex);
  // Set while a failed Save is steering the scroll itself, so this block-level
  // scroll doesn't fight it.
  const focusScrollRef = useRef(false);
  useEffect(() => {
    if (focusScrollRef.current) {
      focusScrollRef.current = false;
    } else {
      const target = expandedIndex ?? lastExpandedRef.current;
      if (target !== null && target !== undefined) {
        blockRefs.current[target]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
    lastExpandedRef.current = expandedIndex;
  }, [expandedIndex]);

  // A failed Save hands over the first incomplete entry and field ({ index,
  // field, nonce }). Open that block, then scroll to the field once it has
  // rendered (a collapsed block only mounts its fields after opening) and put
  // the cursor in it.
  const rootRef = useRef(null);
  useEffect(() => {
    if (!focusTarget) return undefined;
    const { index, field } = focusTarget;
    if (!isEdit && expandedIndex !== index) {
      focusScrollRef.current = true;
      setExpandedIndex(index);
    }
    let tries = 0;
    let frame;
    const go = () => {
      const el = rootRef.current?.querySelector(`[data-entry-index="${index}"] [data-field="${field}"]`);
      if (!el) {
        tries += 1;
        if (tries < 20) frame = requestAnimationFrame(go);
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.querySelector("input, select, textarea")?.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(go);
    return () => cancelAnimationFrame(frame);
    // Only a new request (its nonce) should steer the scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget?.nonce]);

  // "Add another machine": once the new block is on screen, scroll to it and
  // put the cursor in its machine box.
  const askMachineFor = useRef(null);
  useEffect(() => {
    const index = askMachineFor.current;
    if (index === null || index !== entries.length - 1) return;
    askMachineFor.current = null;
    const frame = requestAnimationFrame(() => {
      const el = rootRef.current?.querySelector(`[data-entry-index="${index}"] [data-field="machine"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.querySelector("select")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [entries.length]);

  return (
    <div ref={rootRef}>
      {entries.map((values, i) => (
        <EntryBlock
          key={i}
          index={i}
          values={values}
          errors={errors[i] || {}}
          isSubmit={isSubmit}
          machines={machines}
          items={items}
          operators={operators}
          isEdit={isEdit}
          canRemove={!isEdit && entries.length > 1}
          expanded={isEdit || expandedIndex === i}
          booked={booked[i] || []}
          onExpand={setExpandedIndex}
          onChange={onChange}
          onItemSelect={onItemSelect}
          onRejectChange={onRejectChange}
          onRemove={onRemove}
          registerRef={(el) => {
            blockRefs.current[i] = el;
          }}
        />
      ))}

      {!isEdit && (
        <button
          type="button"
          className="btn btn-outline-primary d-inline-flex align-items-center gap-2"
          onClick={() => {
            // The new block stays closed and asks for its machine first (focus
            // goes to the machine box); it opens once one is picked.
            askMachineFor.current = entries.length;
            onAdd();
          }}
        >
          <Plus size={16} /> Add another machine
        </button>
      )}
    </div>
  );
};

export default ProductionEntryForm;
