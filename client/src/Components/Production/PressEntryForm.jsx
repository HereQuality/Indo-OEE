import React, { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Col, Input, Label, Row } from "reactstrap";
import DatePicker from "../Common/DatePicker";
import TimePicker from "../Common/TimePicker";
import NumberInput from "./NumberInput";
import PartOptions from "./PartOptions";
import { useAlert } from "../../context/AlertContext";
import { fmtNum, fmtPct, normalizeTime } from "../../utils/productionSheet";
import { isTimeRuleMessage, stoppageLimitMin, withDecimalPlanned } from "../../utils/entryValidation";
import { pressRowCalc } from "../../utils/pressSheet";
import { PRESS_DOWNTIME_KEYS } from "../../utils/pressValidation";
import { hoursToHm, parseHm } from "../../utils/shiftHours";

/**
 * components/Production/PressEntryForm.jsx
 * ────────────────────────────────────────
 * The PRESS Data Entry form — VmcEntryForm's twin, with the same behaviour: one
 * block per machine behind its own "+", "Add another machine" for several
 * machines in one Save, one block open at a time, Save scrolling to the first
 * incomplete field, grey boxes calculated live, typed boxes capped so they
 * can't be typed past what is allowed (OK + Rejected within Ideal Quantity;
 * every downtime box within what Planned Operator Shift leaves after the
 * machine's own run).
 *
 * What differs is the PRESS sheet's own fields: Operation and Setup No., both
 * dropdowns (neither tied to any formula); Standard Time Taken and the number
 * of pieces made in it, which give the Product Cycle Time (same shape as
 * VMC's Program Time); Actual OK and Rejected Quantity both typed (so no
 * reject reason split); and all ten downtime boxes.
 *
 * The rules live in utils/pressValidation.js; the figures in utils/pressSheet.js.
 */

const labelClass = "form-label small text-muted mb-1";

// The sheet's own Operation choices. Keep in step with OPERATIONS in
// server/models/PressEntry.js.
const OPERATIONS = ["Bending", "Tapping", "Blank", "Blank/Bending"];
// The sheet's own Setup No. choices. Keep in step with SETUP_NUMBERS in
// server/models/PressEntry.js.
const SETUP_NUMBERS = ["1", "2", "3", "4", "5"];

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
  { id: 2, title: "Part, Operation, Setup No.", fields: ["itemName", "operation", "setupNo"] },
  {
    id: 3,
    title: "Standard Time, Product Cycle Time",
    fields: ["standardTimeMin", "pcsPerStandardTime"],
  },
  { id: 4, title: "Machine ON–OFF Time, Machine Shift", fields: ["machineOnTime", "machineOffTime"] },
  { id: 5, title: "Production (Qty)", fields: ["okQty", "rejectedQty"] },
  // Lunch / Rest sits beside Planned Operator Shift on the form, though it is
  // still just one more stoppage box toward the total (see rowCalc).
  { id: 7, title: "Planned Operator Shift, Lunch / Rest", fields: ["plannedOperatorShiftHours", "lunchMin"] },
  { id: 8, title: "Downtime / Stoppage (min)", fields: [...PRESS_DOWNTIME_KEYS, "stoppageTotal", "otherMinRemark"] },
  { id: 12, title: "Remarks", fields: ["remarks"] },
];

const findLine = (id) => LINES.find((l) => l.id === id);

// A titled box around one line's fields. Kept at module scope — defining it
// inside EntryBlock would make React see a brand-new component type on every
// keystroke and remount the whole subtree, dropping focus out of whatever input
// was being typed in.
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
const DATA_KEYS = LINES.flatMap((l) => l.fields).filter((k) => !["date", "machine", "stoppageTotal"].includes(k));

const hasData = (v) => DATA_KEYS.some((k) => v[k] !== "" && v[k] !== undefined && v[k] !== null);

// One downtime box: a capped minutes input labelled like the sheet.
const DOWNTIME_BOXES = [
  ["plannedDownMin", "Planned Downtime (min)"],
  ["setupMin", "Set-up Time (min)"],
  ["noManPowerMin", "No Manpower (min)"],
  ["materialShiftingMin", "Material Shifting (min)"],
  ["noMaterialMin", "No Material (min)"],
  ["bdMechMin", "B.D. Mech. (min)"],
  ["bdEleMin", "B.D. Ele. (min)"],
  ["noPowerMin", "No Power (min)"],
  ["otherMin", "Others (min)"],
];

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
  onRemove,
  registerRef,
}) => {
  const { warning } = useAlert();
  const calc = useMemo(() => pressRowCalc(values), [values]);

  // The most stoppage this entry can account for, against what's typed.
  const planned = useMemo(() => parseHm(values.plannedOperatorShiftHours).hours, [values.plannedOperatorShiftHours]);
  const stoppageLimit = useMemo(() => stoppageLimitMin(withDecimalPlanned(values)), [values]);
  const machineShiftMin = calc.shiftHours === null || calc.shiftHours === undefined ? null : Math.round(calc.shiftHours * 60);
  const plannedBelowMachine = planned !== null && machineShiftMin !== null && Math.round(planned * 60) < machineShiftMin;
  const overStoppage = stoppageLimit !== null && calc.totalStoppageMin > stoppageLimit;
  const otherDowntimeUsed = Number(values.otherMin) > 0;

  // What each downtime box may still take: whatever of the allowed stoppage the
  // others haven't used. No ceiling until Planned Operator Shift and the machine
  // times are in, since the allowance can't be worked out yet.
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
            : `Total stoppage can't be more than the Machine Shift (${stoppageLimit} min) — only ${room} min left for this box.`,
        ),
    };
  };

  // OK + Rejected can't go past Ideal Quantity: each box may take what the other leaves.
  const qtyRoom = (otherKey) =>
    Number.isFinite(calc.idealQty) ? Math.max(0, calc.idealQty - (Number(values[otherKey]) || 0)) : undefined;
  const exceedIdeal = () => warning(`OK + Rejected can't be more than Ideal Quantity (${fmtNum(calc.idealQty)})`);

  // The time rules (OFF after ON, no overlap) show as soon as the times are
  // picked; everything else waits until Save has been pressed.
  const err = (key) => (isSubmit || isTimeRuleMessage(errors[key]) ? errors[key] : undefined);

  // An OFF picker offers nothing at or before its ON time.
  const after = (on) => {
    const t = normalizeTime(on);
    if (!t) return null;
    const next = Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + 1;
    return next >= 1440 ? null : `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
  };
  const offEarliest = useMemo(() => after(values.machineOnTime), [values.machineOnTime]);
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

  // Collapsed: just the machine and its "+". A filled-in block gets a subtle
  // tint so "press + to reopen it" reads as "there's saved work here".
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
            <Field label="Operator" required error={err("operator")} md={3} fieldKey="operator">
              <Input type="select" bsSize="sm" name="operator" value={values.operator} onChange={handle} invalid={!!err("operator")}>
                {/* A record saved before this box read from Operator Master, or one
                    whose operator has since been deactivated, still has a name
                    typed here that this list won't contain — keep showing that
                    name rather than an empty box. */}
                <option value="">
                  {values.operator && !operators.some((o) => o.name === values.operator) ? values.operator : "Select operator"}
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
            <Field label="Part Name" required error={err("itemName")} md={4} fieldKey="itemName">
              <Input
                type="select"
                bsSize="sm"
                name="item"
                value={values.item || ""}
                onChange={(e) => onItemSelect(index, e.target.value)}
                invalid={!!err("itemName")}
              >
                <PartOptions items={items} selectedId={values.item} selectedName={values.itemName} label={(it) => it.itemName} />
              </Input>
            </Field>
            <Field label="Operation" error={err("operation")} md={4} fieldKey="operation">
              <Input type="select" bsSize="sm" name="operation" value={values.operation} onChange={handle} invalid={!!err("operation")}>
                {/* A record saved before this box existed, or with a value since
                    retired from the list, still shows what it has rather than an
                    empty box. */}
                <option value="">{values.operation && !OPERATIONS.includes(values.operation) ? values.operation : "Select operation"}</option>
                {OPERATIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Input>
            </Field>
            <Field label="Setup No." error={err("setupNo")} md={4} fieldKey="setupNo">
              <Input type="select" bsSize="sm" name="setupNo" value={values.setupNo} onChange={handle} invalid={!!err("setupNo")}>
                {/* A record saved before this box existed, or with a value since
                    retired from the list, still shows what it has rather than an
                    empty box. */}
                <option value="">{values.setupNo && !SETUP_NUMBERS.includes(values.setupNo) ? values.setupNo : "Select setup no."}</option>
                {SETUP_NUMBERS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Input>
            </Field>
          </Row>
        </Line>

        <Line id={3} errors={errors} isSubmit={isSubmit}>
          <Row className="g-1">
            <Field label="Standard Time Taken (min)" required error={err("standardTimeMin")} md={4} fieldKey="standardTimeMin">
              <NumberInput name="standardTimeMin" value={values.standardTimeMin} onChange={handle} invalid={!!err("standardTimeMin")} />
            </Field>
            <Field label="No. Piece in Standard Time" required error={err("pcsPerStandardTime")} md={4} fieldKey="pcsPerStandardTime">
              <NumberInput
                name="pcsPerStandardTime"
                value={values.pcsPerStandardTime}
                onChange={handle}
                decimals={false}
                invalid={!!err("pcsPerStandardTime")}
              />
            </Field>
            <Calc
              label="Product Cycle Time (sec)"
              value={fmtNum(calc.totalCycleSec)}
              md={4}
              title="Standard Time Taken (min) × 60 ÷ No. Piece in Standard Time"
            />
          </Row>
        </Line>

        <Line id={4} errors={errors} isSubmit={isSubmit}>
          <Row className="g-1">
            <Field label="Machine Time ON" required error={err("machineOnTime")} md={3} fieldKey="machineOnTime">
              <TimePicker name="machineOnTime" value={values.machineOnTime} onChange={handle} hasError={!!err("machineOnTime")} />
            </Field>
            <Field label="Machine Time OFF" required error={err("machineOffTime")} md={3} fieldKey="machineOffTime">
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
              value={hoursToHm(calc.shiftHours)}
              md={3}
              title="Machine Time OFF − Machine Time ON, as hours:minutes"
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
              title="Machine Shift (min) × No. Piece in Standard Time ÷ Standard Time Taken (min), rounded down — the most the shift could make, so OK + Rejected can't go above it"
            />
            <Field label="Actual OK Quantity" required error={err("okQty")} md={3} fieldKey="okQty">
              <NumberInput
                name="okQty"
                value={values.okQty}
                onChange={handle}
                decimals={false}
                invalid={!!err("okQty")}
                max={qtyRoom("rejectedQty")}
                onExceedMax={exceedIdeal}
              />
            </Field>
            <Field label="Rejected Quantity" required error={err("rejectedQty")} md={3} fieldKey="rejectedQty">
              <NumberInput
                name="rejectedQty"
                value={values.rejectedQty}
                onChange={handle}
                decimals={false}
                invalid={!!err("rejectedQty")}
                max={qtyRoom("okQty")}
                onExceedMax={exceedIdeal}
              />
            </Field>
          </Row>
          <Row className="g-1">
            <Calc label="% OK Quantity" value={fmtPct(calc.pctOk)} md={3} title="OK Quantity ÷ (OK Quantity + Rejected Quantity)" />
          </Row>
        </Line>

        <Line id={7} errors={errors} isSubmit={isSubmit}>
          <Row className="g-1">
            <Field label="Planned Operator Shift (hr.min)" required error={err("plannedOperatorShiftHours")} md={4} fieldKey="plannedOperatorShiftHours">
              <NumberInput
                name="plannedOperatorShiftHours"
                value={values.plannedOperatorShiftHours}
                onChange={handle}
                invalid={!!err("plannedOperatorShiftHours")}
                maxLength={5}
                max={24}
                onExceedMax={() => warning("Planned Operator Shift can't be more than 24 hours.")}
              />
              {!err("plannedOperatorShiftHours") && (
                <p className={`mb-0 small mt-1 ${plannedBelowMachine ? "text-danger" : "text-muted"}`}>
                  {plannedBelowMachine
                    ? `Can't be less than Machine Shift (${hoursToHm(machineShiftMin / 60)}).`
                    : planned !== null
                      ? `= ${hoursToHm(planned)} hr`
                      : "Type hours.minutes — 3.30 is 3 h 30 min."}
                </p>
              )}
            </Field>
            <Field label="Lunch / Rest (min)" error={err("lunchMin")} md={4} fieldKey="lunchMin">
              <NumberInput name="lunchMin" value={values.lunchMin} onChange={handle} decimals={false} invalid={!!err("lunchMin")} {...minutesBox("lunchMin")} />
            </Field>
            <Calc
              label="Stoppage Allowed (min)"
              value={stoppageLimit === null ? "" : String(stoppageLimit)}
              md={4}
              title="Planned Operator Shift (min) − Machine Shift (min): the most Lunch / Rest plus every downtime can add up to"
            />
          </Row>
        </Line>

        <Line id={8} errors={errors} isSubmit={isSubmit}>
          <Row className="g-1">
            {DOWNTIME_BOXES.map(([key, label]) => (
              <Field key={key} label={label} error={err(key)} md={3} fieldKey={key}>
                <NumberInput name={key} value={values[key]} onChange={handle} decimals={false} invalid={!!err(key)} {...minutesBox(key)} />
              </Field>
            ))}
          </Row>
          {/* Every stoppage box, Lunch / Rest included, has to fit inside what Planned
              Operator Shift leaves after the machine's own run, so the running
              total sits next to that allowance. */}
          <div className="mb-2 small" data-field="stoppageTotal">
            <span className="text-muted">Total stoppage (with Lunch / Rest): </span>
            <span className={overStoppage ? "text-danger fw-semibold" : "fw-semibold"}>{fmtNum(calc.totalStoppageMin) || 0} min</span>
            <span className="text-muted">
              {stoppageLimit === null
                ? " — enter Machine ON/OFF Time to see the allowance"
                : ` of ${stoppageLimit} min allowed`}
            </span>
            {err("stoppageTotal") && <p className="text-danger mb-0 mt-1">{err("stoppageTotal")}</p>}
          </div>
          {otherDowntimeUsed && (
            <Row className="g-1">
              <Field label="Remark for Others downtime" required error={err("otherMinRemark")} md={12} fieldKey="otherMinRemark">
                <Input
                  type="textarea"
                  bsSize="sm"
                  name="otherMinRemark"
                  value={values.otherMinRemark || ""}
                  onChange={handle}
                  maxLength={300}
                  placeholder="What was the “Others” downtime?"
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
            <Input type="textarea" bsSize="sm" name="remarks" value={values.remarks} onChange={handle} maxLength={500} style={{ height: "60px" }} />
          </div>
        </Line>
      </div>
    </div>
  );
};

const PressEntryForm = ({
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

export default PressEntryForm;
