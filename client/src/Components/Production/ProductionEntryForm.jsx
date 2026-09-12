import React, { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Col, Input, Label, Row } from "reactstrap";
import DatePicker from "../Common/DatePicker";
import TimePicker from "../Common/TimePicker";
import NumberInput from "./NumberInput";
import { REJECT_REASONS, SLOTS_PER_DAY, fmtNum, fmtPct, rowCalc } from "../../utils/productionSheet";

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
 * utils/productionSheet.js, Rejected Quantity included (always Actual − OK,
 * which is why it can't be typed). The last four boxes cover that machine's
 * whole day rather than the one record, and arrive via `dayResult`.
 */

const labelClass = "form-label small text-muted mb-1";

// A calculated box — greyed so nobody tries to type in it.
const Calc = ({ label, value, md = 3, title }) => (
  <Col md={md}>
    <div className="mb-3" title={title}>
      <Label className={labelClass}>{label}</Label>
      <Input type="text" value={value ?? ""} readOnly disabled className="bg-light" />
    </div>
  </Col>
);

// A typed field.
const Field = ({ label, required, error, children, md = 3 }) => (
  <Col md={md}>
    <div className="mb-3">
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
  { id: 1, title: "Date, Machine No., Operator", fields: ["date", "machine", "slot", "operator"] },
  { id: 2, title: "Part Name, Drawing No., Cycle Time", fields: ["itemName", "drawingNo", "cycleTimeSec"] },
  { id: 3, title: "Machine ON–OFF Time, Machine Shift", fields: ["machineOnTime", "machineOffTime"] },
  { id: 4, title: "Ideal Quantity, Ideal Quantity per Hour", fields: [] },
  { id: 5, title: "Actual Qty, OK Qty, Rejected, % OK Qty, Reject Master", fields: ["actualQty", "okQty", "rejectReason"] },
  { id: 6, title: "Planned Operator Shift Time, Utilized Machine Time", fields: ["plannedOperatorShiftHours"] },
  { id: 7, title: "Downtime, Setup Time, No Man Power, Material Shifting", fields: ["plannedDownMin", "setupMin", "noManPowerMin", "materialShiftingMin"] },
  { id: 8, title: "No Material, Breakdown Mechanical, BD Electricity, No Power", fields: ["noMaterialMin", "bdMechMin", "bdEleMin", "noPowerMin"] },
  { id: 9, title: "Lunch / Rest, Other (min)", fields: ["lunchMin", "otherMin"] },
  { id: 10, title: "Effective Machine Runtime, Unreported Time", fields: [] },
  { id: 11, title: "Setup Efficiency", fields: [] },
  { id: 12, title: "OEE (3 measures), Remarks", fields: ["remarks"] },
];

const findLine = (id) => LINES.find((l) => l.id === id);

// Everything a block can hold beyond the machine itself — used to tell a
// collapsed block that still has typing in it from an untouched one.
const DATA_KEYS = [
  "operator", "itemName", "drawingNo", "cycleTimeSec", "machineOnTime", "machineOffTime",
  "actualQty", "okQty", "rejectReason", "plannedOperatorShiftHours", "remarks",
  ...LINES.flatMap((l) => l.fields),
].filter((k) => !["date", "machine", "slot"].includes(k));

const hasData = (v) => DATA_KEYS.some((k) => v[k] !== "" && v[k] !== undefined && v[k] !== null);

const EntryBlock = ({
  values,
  errors,
  isSubmit,
  machines,
  items,
  dayResult,
  isEdit,
  index,
  canRemove,
  onChange,
  onItemSelect,
  onRemove,
}) => {
  const calc = useMemo(() => rowCalc(values), [values]);
  // A new block starts collapsed to its machine picker; editing opens straight up.
  const [expanded, setExpanded] = useState(isEdit);

  const err = (key) => (isSubmit ? errors[key] : undefined);
  const handle = (e) => onChange(index, e.target.name, e.target.value);

  // A collapsed block hides its fields, so a failed save would hide the reason
  // with them. Reopen the block whenever validation flags something inside it.
  const errorKeys = Object.keys(errors).join("|");
  useEffect(() => {
    if (isSubmit && errorKeys) setExpanded(true);
  }, [isSubmit, errorKeys]);

  const machineSelect = (
    <Input type="select" name="machine" value={values.machine} onChange={handle} disabled={isEdit}>
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

  // Collapsed: just the machine picker and this machine's "+".
  if (!expanded) {
    return (
      <div className="border rounded mb-3 px-3 pt-3">
        <Row className="align-items-start">
          <Field label="Machine No." required error={err("machine")} md={5}>
            {machineSelect}
          </Field>
          <Col md={7}>
            <div className="mb-3">
              <Label className={`${labelClass} d-block`}>&nbsp;</Label>
              <div className="d-flex align-items-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary d-inline-flex align-items-center justify-content-center p-0 flex-shrink-0"
                  style={{ width: 38, height: 38 }}
                  onClick={() => setExpanded(true)}
                  disabled={!values.machine}
                  title={values.machine ? "Open the entry fields" : "Select a machine first"}
                  aria-label="Open the entry fields"
                >
                  <Plus size={18} />
                </button>
                <span className="text-muted small">
                  {!values.machine
                    ? "Select a machine, then press +"
                    : hasData(values)
                      ? "Entry filled in — press + to reopen it"
                      : "Press + to fill this machine's entry"}
                </span>
                <span className="ms-auto">{removeButton}</span>
              </div>
            </div>
          </Col>
        </Row>
      </div>
    );
  }

  const Line = ({ id, children }) => {
    const def = findLine(id);
    const hasError = isSubmit && def.fields.some((f) => errors[f]);
    return (
      <div className={`border rounded mb-3 ${hasError ? "border-danger" : ""}`}>
        <div className="d-flex align-items-center gap-2 px-3 py-2 bg-light border-bottom rounded-top">
          <span className="fw-semibold small">{def.title}</span>
          {hasError && <span className="badge bg-danger-subtle text-danger ms-auto">Check this line</span>}
        </div>
        <div className="px-3 pt-3">{children}</div>
      </div>
    );
  };

  const machineLabel = machines.find((m) => m._id === values.machine)?.machineName;

  return (
    <div className="border border-primary rounded mb-4">
      <div className="d-flex align-items-center gap-2 px-3 py-2 bg-light border-bottom rounded-top">
        <button
          type="button"
          className="btn btn-sm btn-light border d-inline-flex align-items-center justify-content-center p-0 flex-shrink-0"
          style={{ width: 28, height: 28 }}
          onClick={() => setExpanded(false)}
          title="Collapse this machine"
          aria-label="Collapse this machine"
        >
          <Minus size={15} />
        </button>
        <span className="fw-semibold">Machine {machineLabel || index + 1}</span>
        <span className="ms-auto">{removeButton}</span>
      </div>

      <div className="p-3">
        <Line id={1}>
          <Row>
            <Field label="Date" required error={err("date")} md={3}>
              <DatePicker name="date" value={values.date} onChange={handle} hasError={!!err("date")} />
            </Field>
            <Field label="Machine No." required error={err("machine")} md={3}>
              {machineSelect}
            </Field>
            <Field label="Entry No." required error={err("slot")} md={2}>
              <Input type="select" name="slot" value={values.slot} onChange={handle} disabled={isEdit}>
                {Array.from({ length: SLOTS_PER_DAY }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </Input>
            </Field>
            <Field label="Operator" error={err("operator")} md={4}>
              <Input
                type="text"
                name="operator"
                value={values.operator}
                onChange={handle}
                list="operator-names"
                maxLength={60}
                autoComplete="off"
              />
            </Field>
          </Row>
        </Line>

        <Line id={2}>
          <Row>
            <Field label="Part Name" error={err("itemName")} md={5}>
              <Input
                type="select"
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
            <Field label="Drawing No." md={4}>
              <Input type="text" name="drawingNo" value={values.drawingNo} onChange={handle} maxLength={40} />
            </Field>
            <Field label="Cycle Time (sec)" error={err("cycleTimeSec")} md={3}>
              <NumberInput name="cycleTimeSec" value={values.cycleTimeSec} onChange={handle} />
            </Field>
          </Row>
        </Line>

        <Line id={3}>
          <Row>
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
              title="Machine OFF Time − Machine ON Time"
            />
          </Row>
        </Line>

        <Line id={4}>
          <Row>
            <Calc
              label="Ideal Quantity"
              value={fmtNum(calc.idealQty)}
              md={6}
              title="Machine Shift (hr) × 3600 ÷ Cycle Time (sec)"
            />
            <Calc
              label="Ideal Quantity per Hour"
              value={fmtNum(calc.idealQtyPerHour)}
              md={6}
              title="3600 ÷ Cycle Time (sec)"
            />
          </Row>
        </Line>

        <Line id={5}>
          <Row>
            <Field label="Actual Quantity" error={err("actualQty")} md={3}>
              <NumberInput name="actualQty" value={values.actualQty} onChange={handle} decimals={false} />
            </Field>
            <Field label="OK Quantity" error={err("okQty")} md={3}>
              <NumberInput name="okQty" value={values.okQty} onChange={handle} decimals={false} />
            </Field>
            <Calc label="Rejected" value={fmtNum(calc.rejectedQty)} md={3} title="Actual Quantity − OK Quantity" />
            <Calc label="% OK Quantity" value={fmtPct(calc.pctOk)} md={3} title="OK Quantity ÷ Actual Quantity" />
          </Row>
          <Row>
            <Field label="Reject Master" error={err("rejectReason")} md={6}>
              <Input type="select" name="rejectReason" value={values.rejectReason} onChange={handle}>
                <option value="">— None —</option>
                {REJECT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Input>
            </Field>
          </Row>
        </Line>

        <Line id={6}>
          <Row>
            <Field label="Planned Operator Shift Time (hr)" error={err("plannedOperatorShiftHours")} md={6}>
              <NumberInput
                name="plannedOperatorShiftHours"
                value={values.plannedOperatorShiftHours}
                onChange={handle}
              />
            </Field>
            <Calc
              label="Utilized Machine Time (hr)"
              value=""
              md={6}
              title="Formula still to be confirmed — not calculated yet"
            />
          </Row>
        </Line>

        <Line id={7}>
          <Row>
            <Field label="Downtime (min)" error={err("plannedDownMin")} md={3}>
              <NumberInput name="plannedDownMin" value={values.plannedDownMin} onChange={handle} decimals={false} />
            </Field>
            <Field label="Setup Time (min)" error={err("setupMin")} md={3}>
              <NumberInput name="setupMin" value={values.setupMin} onChange={handle} decimals={false} />
            </Field>
            <Field label="No Man Power (min)" error={err("noManPowerMin")} md={3}>
              <NumberInput name="noManPowerMin" value={values.noManPowerMin} onChange={handle} decimals={false} />
            </Field>
            <Field label="Material Shifting (min)" error={err("materialShiftingMin")} md={3}>
              <NumberInput
                name="materialShiftingMin"
                value={values.materialShiftingMin}
                onChange={handle}
                decimals={false}
              />
            </Field>
          </Row>
        </Line>

        <Line id={8}>
          <Row>
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

        <Line id={9}>
          <Row>
            <Field label="Lunch / Rest (min)" error={err("lunchMin")} md={6}>
              <NumberInput name="lunchMin" value={values.lunchMin} onChange={handle} decimals={false} />
            </Field>
            <Field label="Other (min)" error={err("otherMin")} md={6}>
              <NumberInput name="otherMin" value={values.otherMin} onChange={handle} decimals={false} />
            </Field>
          </Row>
        </Line>

        <Line id={10}>
          <Row>
            <Calc
              label="Effective Machine Runtime (hr)"
              value={fmtNum(calc.effectiveHours)}
              md={6}
              title="OK Quantity × Cycle Time (sec) ÷ 3600"
            />
            <Calc
              label="Unreported Time (min)"
              value={fmtNum(dayResult.unreportedMin)}
              md={6}
              title="Per machine per day: Shift − Total Downtime − Effective Runtime"
            />
          </Row>
        </Line>

        <Line id={11}>
          <Row>
            <Calc
              label="Setup Efficiency (%)"
              value={fmtPct(calc.setupEfficiency)}
              md={6}
              title="Effective Machine Runtime ÷ Machine Shift"
            />
          </Row>
        </Line>

        <Line id={12}>
          <Row>
            <Calc
              label="OEE considering losses (%)"
              value={fmtPct(dayResult.oeeLosses)}
              md={4}
              title="Per machine per day: Effective ÷ (Shift − Total Downtime)"
            />
            <Calc
              label="OEE not considering losses but lunch (%)"
              value={fmtPct(dayResult.oeeLunch)}
              md={4}
              title="Per machine per day: Effective ÷ (Shift − Lunch/Rest)"
            />
            <Calc
              label="OEE not considering losses but lunch and COT (%)"
              value={fmtPct(dayResult.oeeLunchCot)}
              md={4}
              title="Per machine per day: Effective ÷ (Shift − Lunch − Setup Time). COT = Setup Time."
            />
          </Row>
          <div className="mb-3">
            <Label className={labelClass}>Remarks</Label>
            <Input
              type="textarea"
              name="remarks"
              value={values.remarks}
              onChange={handle}
              maxLength={500}
              style={{ height: "90px" }}
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
  items = [],
  operatorNames = [],
  dayResults = [],
  isEdit = false,
  onChange,
  onItemSelect,
  onAdd,
  onRemove,
}) => (
  <>
    {/* One shared suggestion list for every block's Operator box. */}
    <datalist id="operator-names">
      {operatorNames.map((n) => (
        <option key={n} value={n} />
      ))}
    </datalist>

    {entries.map((values, i) => (
      <EntryBlock
        key={i}
        index={i}
        values={values}
        errors={errors[i] || {}}
        isSubmit={isSubmit}
        machines={machines}
        items={items}
        dayResult={dayResults[i] || {}}
        isEdit={isEdit}
        canRemove={!isEdit && entries.length > 1}
        onChange={onChange}
        onItemSelect={onItemSelect}
        onRemove={onRemove}
      />
    ))}

    {!isEdit && (
      <button type="button" className="btn btn-outline-primary d-inline-flex align-items-center gap-2" onClick={onAdd}>
        <Plus size={16} /> Add another machine
      </button>
    )}
  </>
);

export default ProductionEntryForm;
