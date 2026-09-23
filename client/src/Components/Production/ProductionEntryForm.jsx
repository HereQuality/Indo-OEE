import React, { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Col, Input, Label, Row } from "reactstrap";
import DatePicker from "../Common/DatePicker";
import TimePicker from "../Common/TimePicker";
import NumberInput from "./NumberInput";
import { useAlert } from "../../context/AlertContext";
import { CYCLE_OP_FIELDS, REJECT_REASONS, fmtNum, fmtPct, rowCalc } from "../../utils/productionSheet";

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
 * utils/productionSheet.js. There's no typed Actual Quantity box — Ideal
 * Quantity (Shift Time ÷ Cycle Time, rounded down) does that job, so Rejected
 * Quantity (always Ideal − OK) and the dashboard's Total/Rejected/% OK all
 * read from Ideal Quantity rather than a separately typed count.
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
    <div className="mb-2" title={title}>
      <Label className={labelClass}>{label}</Label>
      <Input type="text" bsSize="sm" value={value ?? ""} readOnly disabled className="bg-light" />
    </div>
  </Col>
);

// A typed field.
const Field = ({ label, required, error, children, md = 3 }) => (
  <Col md={md}>
    <div className="mb-2">
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
  { id: 5, title: "Ideal Qty, OK Qty, Rejected, % OK Qty", fields: ["okQty"] },
  { id: 13, title: "Reject Master", fields: ["rejectBreakdown"] },
  { id: 6, title: "Planned Operator Shift Time", fields: ["plannedOperatorShiftHours"] },
  { id: 7, title: "Setup Time, No Man Power, Material Shifting", fields: ["setupMin", "noManPowerMin", "materialShiftingMin"] },
  { id: 8, title: "No Material, Breakdown Mechanical, BD Electricity, No Power", fields: ["noMaterialMin", "bdMechMin", "bdEleMin", "noPowerMin"] },
  { id: 9, title: "Lunch / Rest, Other (min)", fields: ["lunchMin", "otherMin"] },
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
    <div className={`border rounded mb-2 ${hasError ? "border-danger" : ""}`}>
      <div className="d-flex align-items-center gap-2 px-2 py-1 bg-light border-bottom rounded-top">
        <span className="fw-semibold small">{def.title}</span>
        {hasError && <span className="badge bg-danger-subtle text-danger ms-auto">Check this line</span>}
      </div>
      <div className="px-2 pt-2">{children}</div>
    </div>
  );
};

// Everything a block can hold beyond the machine itself — used to tell a
// collapsed block that still has typing in it from an untouched one.
const DATA_KEYS = [
  "operator", "itemName", "drawingNo", "machineOnTime", "machineOffTime",
  "okQty", "plannedOperatorShiftHours", "remarks",
  ...LINES.flatMap((l) => l.fields),
].filter((k) => !["date", "machine", "slot", "rejectBreakdown"].includes(k));

const hasData = (v) =>
  DATA_KEYS.some((k) => v[k] !== "" && v[k] !== undefined && v[k] !== null) ||
  Object.values(v.rejectBreakdown || {}).some((n) => n !== "" && n !== undefined && n !== null);

const EntryBlock = ({
  values,
  errors,
  isSubmit,
  machines,
  processes,
  items,
  operators,
  isEdit,
  index,
  canRemove,
  expanded,
  onExpand,
  onChange,
  onItemSelect,
  onRejectChange,
  onRemove,
}) => {
  const { warning } = useAlert();
  const calc = useMemo(() => rowCalc(values), [values]);
  // The picked part's own record — its Total Cycle Time and operation times
  // are what an unticked box gets restored from when it's ticked back.
  const selectedItem = useMemo(() => items.find((it) => it._id === values.item) || null, [items, values.item]);

  // Which process's machines the machine picker is narrowed to — a filter
  // only, never saved on the entry itself (the machine already carries its
  // own process link). Starts on the process the entry's machine already
  // belongs to, so editing (or reopening a filled-in block) doesn't reset it.
  const [processFilter, setProcessFilter] = useState(
    () => String(machines.find((m) => m._id === values.machine)?.process || ""),
  );

  const filteredMachines = useMemo(
    () => (processFilter ? machines.filter((m) => String(m.process || "") === processFilter) : machines),
    [machines, processFilter],
  );

  const handleProcessFilter = (e) => {
    const nextProcess = e.target.value;
    setProcessFilter(nextProcess);
    // Dropping a machine that belongs to a different process than the one
    // just picked, so the two selects can't disagree with each other.
    const stillValid = machines.some(
      (m) => m._id === values.machine && (!nextProcess || String(m.process || "") === nextProcess),
    );
    if (!stillValid) onChange(index, "machine", "");
  };

  const processSelect = (
    <Input type="select" bsSize="sm" value={processFilter} onChange={handleProcessFilter} disabled={isEdit}>
      <option value="">All processes</option>
      {processes.map((p) => (
        <option key={p._id} value={p._id}>
          {p.processName}
        </option>
      ))}
    </Input>
  );

  // The reject split's running total, against the Rejected figure it has to
  // match. Shown live so the operator sees the gap while typing rather than
  // only after pressing Save.
  const splitTotal = useMemo(
    () =>
      Object.values(values.rejectBreakdown || {}).reduce(
        (sum, v) => sum + (v === "" || v === null || v === undefined ? 0 : Number(v) || 0),
        0,
      ),
    [values.rejectBreakdown],
  );
  const splitMismatch = splitTotal !== (calc.rejectedQty || 0);

  const err = (key) => (isSubmit ? errors[key] : undefined);
  const handle = (e) => onChange(index, e.target.name, e.target.value);

  // A collapsed block hides its fields, so a failed save would hide the reason
  // with them. Reopen the block whenever validation flags something inside it.
  const errorKeys = Object.keys(errors).join("|");
  useEffect(() => {
    if (isSubmit && errorKeys) onExpand(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubmit, errorKeys]);

  const machineSelect = (
    <Input type="select" bsSize="sm" name="machine" value={values.machine} onChange={handle} disabled={isEdit}>
      <option value="">Select machine</option>
      {filteredMachines.map((m) => (
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

  // Collapsed: process, then this process's machines, then this machine's "+".
  if (!expanded) {
    return (
      <div className="border rounded mb-2 px-2 pt-2">
        <Row className="align-items-start g-2">
          <Field label="Process" md={5}>
            {processSelect}
          </Field>
          <Field label="Machine No." required error={err("machine")} md={5}>
            {machineSelect}
          </Field>
          <Col md={2}>
            <div className="mb-2">
              <Label className={`${labelClass} d-block`}>&nbsp;</Label>
              <div className="d-flex align-items-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary d-inline-flex align-items-center justify-content-center p-0 flex-shrink-0"
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
              {!values.machine
                ? processFilter
                  ? "Select a machine, then press +"
                  : "Select a process, then a machine, then press +"
                : hasData(values)
                  ? "Entry filled in — press + to reopen it"
                  : "Press + to fill this machine's entry"}
            </div>
          </Col>
        </Row>
      </div>
    );
  }

  const machineLabel = machines.find((m) => m._id === values.machine)?.machineName;

  return (
    <div className="border border-primary rounded mb-3">
      <div className="d-flex align-items-center gap-2 px-2 py-1 bg-light border-bottom rounded-top">
        <button
          type="button"
          className="btn btn-sm btn-light border d-inline-flex align-items-center justify-content-center p-0 flex-shrink-0"
          style={{ width: 24, height: 24 }}
          onClick={() => onExpand(isEdit ? index : null)}
          title="Collapse this machine"
          aria-label="Collapse this machine"
        >
          <Minus size={15} />
        </button>
        <span className="fw-semibold small">Machine {machineLabel || index + 1}</span>
        <span className="ms-auto">{removeButton}</span>
      </div>

      <div className="p-2">
        <Line id={1} errors={errors} isSubmit={isSubmit}>
          <Row className="g-2">
            <Field label="Date" required error={err("date")} md={3}>
              <DatePicker name="date" value={values.date} onChange={handle} hasError={!!err("date")} />
            </Field>
            <Field label="Machine No." required error={err("machine")} md={3}>
              {machineSelect}
            </Field>
            <Field label="Operator" error={err("operator")} md={6}>
              <Input type="select" bsSize="sm" name="operator" value={values.operator} onChange={handle}>
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
          <Row className="g-2">
            <Field label="Part Name" error={err("itemName")} md={8}>
              <Input
                type="select"
                bsSize="sm"
                name="item"
                value={values.item || ""}
                onChange={(e) => onItemSelect(index, e.target.value)}
              >
                {/* A record typed into the old grid has a part name but no link to
                    the Item master. Show that name rather than an empty box, so
                    editing the record doesn't look like the part was lost. */}
                <option value="">{values.itemName && !values.item ? values.itemName : "Select part"}</option>
                {items.map((it) => (
                  <option key={it._id} value={it._id}>
                    {it.itemName}
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
          <Row className="g-2">
            {CYCLE_OP_FIELDS.map((f) => {
              // Both "Other Operation" boxes carry the sheet's own label; the
              // index tells the two apart without renaming either.
              const label = f.key === "otherOp2Sec" ? `${f.label.replace(" (sec)", "")} 2 (sec)` : f.label;
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
          <Row className="g-2">
            <Field label="Machine ON Time" error={err("machineOnTime")} md={4}>
              <TimePicker
                name="machineOnTime"
                value={values.machineOnTime}
                onChange={handle}
                hasError={!!err("machineOnTime")}
              />
            </Field>
            <Field label="Machine OFF Time" error={err("machineOffTime")} md={4}>
              <TimePicker
                name="machineOffTime"
                value={values.machineOffTime}
                onChange={handle}
                hasError={!!err("machineOffTime")}
              />
            </Field>
            <Calc
              label="Machine Shift (hr)"
              value={fmtNum(calc.shiftHours)}
              md={4}
              title="MOD(Machine OFF Time − Machine ON Time, 1) × 24"
            />
          </Row>
        </Line>

        <Line id={5} errors={errors} isSubmit={isSubmit}>
          <Row className="g-2">
            <Calc
              label="Ideal Quantity"
              value={fmtNum(calc.idealQty)}
              md={4}
              title="Machine Shift Time × 3600 ÷ Total Cycle Time, rounded down — stands in for Actual Quantity, so Rejected is measured against it"
            />
            <Field label="OK Quantity" error={err("okQty")} md={4}>
              <NumberInput
                name="okQty"
                value={values.okQty}
                onChange={handle}
                decimals={false}
                max={calc.idealQty}
                onExceedMax={(max) => warning(`OK Quantity can't be more than Ideal Quantity (${fmtNum(max)})`)}
              />
            </Field>
            <Calc label="Rejected" value={fmtNum(calc.rejectedQty)} md={4} title="Ideal Quantity − OK Quantity" />
          </Row>
          <Row className="g-2">
            <Calc label="% OK Quantity" value={fmtPct(calc.pctOk)} md={4} title="OK Quantity ÷ (OK Quantity + Rejected Quantity)" />
          </Row>
        </Line>

        <Line id={13} errors={errors} isSubmit={isSubmit}>
          <Row className="g-2">
            {REJECT_REASONS.map((reason) => (
              <Col md={4} key={reason}>
                <div className="mb-2">
                  <Label className={labelClass}>{reason}</Label>
                  <NumberInput
                    name={reason}
                    value={values.rejectBreakdown?.[reason] ?? ""}
                    onChange={(e) => onRejectChange(index, reason, e.target.value)}
                    decimals={false}
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
            {err("rejectBreakdown") && <p className="text-danger mb-0 mt-1">{err("rejectBreakdown")}</p>}
          </div>
        </Line>

        <Line id={6} errors={errors} isSubmit={isSubmit}>
          <Row className="g-2">
            <Field label="Planned Operator Shift Time (hr)" error={err("plannedOperatorShiftHours")} md={6}>
              <NumberInput
                name="plannedOperatorShiftHours"
                value={values.plannedOperatorShiftHours}
                onChange={handle}
              />
            </Field>
          </Row>
        </Line>

        <Line id={7} errors={errors} isSubmit={isSubmit}>
          <Row className="g-2">
            <Field label="Setup Time (min)" error={err("setupMin")} md={4}>
              <NumberInput name="setupMin" value={values.setupMin} onChange={handle} decimals={false} />
            </Field>
            <Field label="No Man Power (min)" error={err("noManPowerMin")} md={4}>
              <NumberInput name="noManPowerMin" value={values.noManPowerMin} onChange={handle} decimals={false} />
            </Field>
            <Field label="Material Shifting (min)" error={err("materialShiftingMin")} md={4}>
              <NumberInput
                name="materialShiftingMin"
                value={values.materialShiftingMin}
                onChange={handle}
                decimals={false}
              />
            </Field>
          </Row>
        </Line>

        <Line id={8} errors={errors} isSubmit={isSubmit}>
          <Row className="g-2">
            <Field label="No Material (min)" error={err("noMaterialMin")} md={3}>
              <NumberInput name="noMaterialMin" value={values.noMaterialMin} onChange={handle} decimals={false} />
            </Field>
            <Field label="Breakdown Mechanical (min)" error={err("bdMechMin")} md={3}>
              <NumberInput name="bdMechMin" value={values.bdMechMin} onChange={handle} decimals={false} />
            </Field>
            <Field label="BD Electricity (min)" error={err("bdEleMin")} md={3}>
              <NumberInput name="bdEleMin" value={values.bdEleMin} onChange={handle} decimals={false} />
            </Field>
            <Field label="No Power (min)" error={err("noPowerMin")} md={3}>
              <NumberInput name="noPowerMin" value={values.noPowerMin} onChange={handle} decimals={false} />
            </Field>
          </Row>
        </Line>

        <Line id={9} errors={errors} isSubmit={isSubmit}>
          <Row className="g-2">
            <Field label="Lunch / Rest (min)" error={err("lunchMin")} md={6}>
              <NumberInput name="lunchMin" value={values.lunchMin} onChange={handle} decimals={false} />
            </Field>
            <Field label="Other (min)" error={err("otherMin")} md={6}>
              <NumberInput name="otherMin" value={values.otherMin} onChange={handle} decimals={false} />
            </Field>
          </Row>
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
  machines = [],
  processes = [],
  items = [],
  operators = [],
  isEdit = false,
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
  const [expandedIndex, setExpandedIndex] = useState(isEdit ? 0 : null);

  return (
    <>
      {entries.map((values, i) => (
        <EntryBlock
          key={i}
          index={i}
          values={values}
          errors={errors[i] || {}}
          isSubmit={isSubmit}
          machines={machines}
          processes={processes}
          items={items}
          operators={operators}
          isEdit={isEdit}
          canRemove={!isEdit && entries.length > 1}
          expanded={isEdit || expandedIndex === i}
          onExpand={setExpandedIndex}
          onChange={onChange}
          onItemSelect={onItemSelect}
          onRejectChange={onRejectChange}
          onRemove={onRemove}
        />
      ))}

      {!isEdit && (
        <button
          type="button"
          className="btn btn-outline-primary d-inline-flex align-items-center gap-2"
          onClick={() => {
            setExpandedIndex(entries.length);
            onAdd();
          }}
        >
          <Plus size={16} /> Add another machine
        </button>
      )}
    </>
  );
};

export default ProductionEntryForm;
