import React, { useEffect, useMemo, useRef, useState } from "react";
import { operatorsForMachine } from "../../utils/operatorsForMachine";
import { vendorsForMachine } from "../../utils/vendorsFor";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Col, Input, Label, Row } from "reactstrap";
import DatePicker from "../Common/DatePicker";
import TimePicker from "../Common/TimePicker";
import NumberInput from "./NumberInput";
import MachineStatusSelect from "./MachineStatusSelect";
import OeeCheck from "./OeeCheck";
import FormLine from "./FormLine";
import SearchablePartSelect from "./SearchablePartSelect";
import VendorSelect from "./VendorSelect";
import { useAlert } from "../../context/AlertContext";
import { stoppageNotice } from "../../utils/limitNotice";
import { ProductionMasterFields } from "./QuantityMaster";
import { fmtNum, fmtPct, isNonWorking, metricsOver100, normalizeTime, partCycleLabel } from "../../utils/productionSheet";
import { isEndBeforeStartMessage, isLiveMessage, stoppageLimitMin, withDecimalPlanned } from "../../utils/entryValidation";
import { INJECTION_STOPPAGE_FIELDS, injectionRowCalc, isStatusOnly } from "../../utils/injectionSheet";
import { INJECTION_DOWNTIME_KEYS } from "../../utils/injectionValidation";
import { hoursToHm, parseShiftHours } from "../../utils/shiftHours";

// The quantity boxes in the paper sheet's own words.
const QTY_LABELS = { actual: "TOTAL QTY", ok: "OK QTY", rejected: "Rejected QTY" };

/**
 * components/Production/InjectionEntryForm.jsx
 * ──────────────────────────────────────────────
 * The INJECTION MOULDING form — SpringEntryForm's twin, with the same
 * behaviour: one block per machine behind its own "+", "Add another machine"
 * for several machines in one Save, one block open at a time, Save scrolling
 * to the first incomplete field, grey boxes calculated live, typed boxes
 * capped so they can't be typed past what is allowed (Actual Quantity — the
 * sheet's TOTAL QTY. — within Ideal Quantity rounded down; all downtime
 * together within the Machine Shift — a popup explains either limit with its
 * figures).
 *
 * Its own fields, in the paper sheet's words: Working Status / Reasons For Not
 * Working (a Non Working day records only its reason), Item Name, Standard
 * Time per Piece (filled in from the Part, can be changed for the day), the
 * Production Master (TOTAL and OK typed, Rejected = TOTAL − OK) with the
 * sheet's grey figures under it, the ten downtime boxes and "Reason/Remarks
 * for Rejection/Rework". No Rejection Master: the sheet has no reject reasons.
 *
 * The rules live in utils/injectionValidation.js; the figures in utils/injectionSheet.js.
 */

const labelClass = "form-label small text-muted mb-1";

// Column widths keyed to the modal's own width, not just the viewport's:
// Bootstrap's modal is only 500px wide until 992px, so `md` (768px) columns
// would squeeze four fields into ~110px each on an iPad in portrait. One per
// row on phones, two from `sm`, the full 4-/3-up layout only from `lg`.
const QUARTER = { xs: 12, sm: 6, lg: 3 };
const THIRD = { xs: 12, sm: 6, lg: 4 };
const FULL = { xs: 12 };

// A calculated box — greyed so nobody tries to type in it.
const Calc = ({ label, value, cols = QUARTER, title }) => (
  <Col {...cols}>
    <div className="mb-1" title={title}>
      <Label className={labelClass}>{label}</Label>
      <Input type="text" bsSize="sm" value={value ?? ""} readOnly disabled className="bg-light" />
    </div>
  </Col>
);

// A typed field. `fieldKey` is what Save's scroll-to-first-error looks for.
const Field = ({ label, required, error, children, cols = QUARTER, fieldKey }) => (
  <Col {...cols}>
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
  { id: 1, title: "Date, MC No., Operator, Working Status", fields: ["date", "machine", "operator", "workingMode", "machineStatus"] },
  { id: 2, title: "Item Name, Standard Time per Piece", fields: ["itemName", "vendor", "totalCycleSec"] },
  { id: 3, title: "Machine ON–OFF Time, Machine Shift Time", fields: ["machineOnTime", "machineOffTime"] },
  { id: 5, title: "Production Master — TOTAL QTY., OK QTY., Rejected QTY", fields: ["actualQty", "okQty"] },
  // Lunch / Tea sits beside Planned Operator Shift on the form, though it is
  // still just one of the downtime columns toward Total Idle Time (see rowCalc).
  { id: 7, title: "Planned Operator Shift, Lunch / Tea / Washroom", fields: ["plannedOperatorShiftHours", "lunchMin"] },
  { id: 8, title: "Idle Time (min)", fields: [...INJECTION_DOWNTIME_KEYS, "stoppageTotal", "otherMinRemark"] },
  { id: 12, title: "Reason / Remarks for Rejection / Rework", fields: ["remarks"] },
];

const findLine = (id) => LINES.find((l) => l.id === id);

// A titled box around one line's fields. Kept at module scope — defining it
// inside EntryBlock would make React see a brand-new component type on every
// keystroke and remount the whole subtree, dropping focus out of whatever input
// was being typed in.
const Line = ({ id, ...rest }) => <FormLine title={findLine(id).title} fields={findLine(id).fields} {...rest} />;

// Everything a block can hold beyond the machine itself — used to tell a
// collapsed block that still has typing in it from an untouched one.
const DATA_KEYS = LINES.flatMap((l) => l.fields).filter((k) => !["date", "machine", "workingMode", "stoppageTotal"].includes(k));

const hasData = (v) =>
  v.workingMode === "Non Working" || DATA_KEYS.some((k) => (Array.isArray(v[k]) ? v[k].length > 0 : v[k] !== "" && v[k] !== undefined && v[k] !== null));

// The downtime boxes, labelled like the sheet — every one but Lunch / Tea,
// which sits beside Planned Operator Shift.
const DOWNTIME_BOXES = INJECTION_STOPPAGE_FIELDS.filter((f) => f.key !== "lunchMin");
const LUNCH_LABEL = INJECTION_STOPPAGE_FIELDS.find((f) => f.key === "lunchMin").label;

const EntryBlock = ({
  values,
  errors,
  isSubmit,
  machines,
  items,
  operators,
  vendors,
  isEdit,
  index,
  canRemove,
  expanded,
  booked = [],
  takenMachines = [],
  plannedLock = null,
  onExpand,
  onChange,
  onItemSelect,
  onRemove,
  registerRef,
}) => {
  const { warning, notice } = useAlert();
  const opList = operatorsForMachine(operators, machines, values.machine);
  // Vendor Name shows only when this machine's process has vendors (Vendor
  // Master) — or the entry already names one, so editing never hides it.
  const blockVendors = vendorsForMachine(vendors, machines, values.machine);
  const showVendor = blockVendors.length > 0 || !!values.vendor;
  const nonWorking = isNonWorking(values);
  const calc = useMemo(() => injectionRowCalc(values), [values]);
  // Availability / Performance / Quality as Save will work them out (planned
  // shift converted from its typed decimal hours first) — any above 100% sends the
  // entry to Admin review, so it's flagged here before Save.
  const oeeCalc = useMemo(() => injectionRowCalc(withDecimalPlanned(values)), [values]);
  const overMetrics = metricsOver100(oeeCalc);
  const statusOnly = isStatusOnly(values) || nonWorking;
  // The picked Part's own cycle time — what this entry's box was filled in
  // with, shown as a hint once the box has been changed for the day.
  const partCycle = useMemo(() => {
    const n = items.find((it) => it._id === values.item)?.totalCycleSec;
    return n === null || n === undefined || n === "" || !Number.isFinite(Number(n)) ? null : Number(n);
  }, [items, values.item]);

  // The most stoppage this entry can account for, against what's typed.
  const planned = useMemo(() => parseShiftHours(values.plannedOperatorShiftHours).hours, [values.plannedOperatorShiftHours]);
  const stoppageLimit = useMemo(() => stoppageLimitMin(withDecimalPlanned(values)), [values]);
  const machineShiftMin = calc.shiftHours === null || calc.shiftHours === undefined ? null : Math.round(calc.shiftHours * 60);
  // Not while End isn't after Start — that "shift" wraps past midnight, and
  // the End box already says what's wrong.
  const plannedBelowMachine = !isEndBeforeStartMessage(errors.machineOffTime) && planned !== null && machineShiftMin !== null && Math.round(planned * 60) < machineShiftMin;
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
      // Past the Machine Shift is a popup with the figures; the one-day cap
      // before the times are in stays a plain warning.
      onExceedMax: (max, typed) =>
        stoppageLimit === null
          ? warning("Downtime can't be more than 1440 minutes (a day).")
          : notice(
              ...stoppageNotice({
                limitMin: stoppageLimit,
                totalMin: (calc.totalStoppageMin || 0) - (Number(values[key]) || 0) + typed,
              }),
            ),
    };
  };

  // The time rules (OFF after ON, no overlap) show as soon as the times are
  // picked (and a typed time that isn't one, or a machine already full
  // for the date, as soon as it's there); everything else waits until Save
  // has been pressed.
  const err = (key) => (isSubmit || isLiveMessage(errors[key]) ? errors[key] : undefined);

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
        <option key={m._id} value={m._id} disabled={takenMachines.includes(String(m._id))}>
          {m.machineName}
          {takenMachines.includes(String(m._id)) ? " — already added" : ""}
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
          <Field label="MC No." required error={err("machine")} cols={{ xs: 8, sm: 6, lg: 4 }} fieldKey="machine">
            {machineSelect}
          </Field>
          <Col xs={4} sm={6} lg={2}>
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
          <Col xs={12}>
            <div className="text-muted small mt-n2 mb-2">
              {incompleteBadge ||
                (!machines.length
                  ? "No machines yet — add them to INJECTION MOULDING in Production › Machines."
                  : !values.machine
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
      data-expanded="true"
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
        <Line id={1} errors={errors} isSubmit={isSubmit} values={values}>
          <Row className="g-1">
            <Field label="Date" required error={err("date")} fieldKey="date">
              <DatePicker name="date" value={values.date} onChange={handle} hasError={!!err("date")} />
            </Field>
            <Field label="MC No." required error={err("machine")} fieldKey="machine">
              {machineSelect}
            </Field>
            <Field label="Operator" required={!statusOnly} error={err("operator")} fieldKey="operator">
              <Input type="select" bsSize="sm" name="operator" value={values.operator} onChange={handle} invalid={!!err("operator")}>
                {/* A record saved before this box read from Operator Master, or one
                    whose operator has since been deactivated, still has a name
                    typed here that this list won't contain — keep showing that
                    name rather than an empty box. */}
                <option value="">
                  {values.operator && !opList.some((o) => o.name === values.operator) ? values.operator : "Select operator"}
                </option>
                {opList.map((o) => (
                  <option key={o._id} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </Input>
            </Field>
            <Field label="Working Status" error={err("workingMode")} fieldKey="workingMode">
              <Input
                type="select"
                bsSize="sm"
                name="workingMode"
                value={values.workingMode || "Working"}
                onChange={(e) => {
                  handle(e);
                  // Working has no reason — drop any picked while it was Non Working.
                  if (e.target.value === "Working") onChange(index, "machineStatus", []);
                }}
              >
                <option value="Working">Working</option>
                <option value="Non Working">Non Working</option>
              </Input>
            </Field>
            {nonWorking && (
              <Field label="Reasons For Not Working" error={err("machineStatus")} fieldKey="machineStatus">
                <MachineStatusSelect
                  value={values.machineStatus}
                  onChange={(list) => onChange(index, "machineStatus", list)}
                  remark={values.remarks}
                />
              </Field>
            )}
          </Row>
          {statusOnly && (
            <p className="text-muted small mb-2">
              {nonWorking ? (
                <>
                  <b>Non Working</b> — the machine did not run, so nothing else is needed. Pick a reason if you like (W.OFF and the
                  like go in Remarks) and press Save.
                </>
              ) : (
                <>
                  <b>{values.workingStatus}</b> — no production that day, so only Date, MC No. and Working Status are saved
                  (Operator and Remarks too, if filled in).
                </>
              )}
            </p>
          )}
        </Line>

        {!statusOnly && (
          <>
        <Line id={2} errors={errors} isSubmit={isSubmit} values={values}>
          <Row className="g-1">
            <Field label="Item Name" required error={err("itemName")} cols={{ xs: 12, lg: 9 }} fieldKey="itemName">
              <SearchablePartSelect
                items={items}
                value={values.item || ""}
                itemName={values.itemName}
                onSelect={(itemId) => onItemSelect(index, itemId)}
                invalid={!!err("itemName")}
                label={partCycleLabel}
              />
            </Field>
            <Field label="Standard Time per Piece (in Sec)" required error={err("totalCycleSec")} fieldKey="totalCycleSec">
              <NumberInput name="totalCycleSec" value={values.totalCycleSec} onChange={handle} invalid={!!err("totalCycleSec")} />
              {/* Filled in from the Part when picked; today's run may differ. */}
              {!err("totalCycleSec") && partCycle !== null && Number(values.totalCycleSec) !== partCycle && (
                <p className="text-muted small mb-0 mt-1">Part's usual: {fmtNum(partCycle)} sec</p>
              )}
            </Field>
          </Row>
          {showVendor && (
            <Row className="g-1">
              <Field label="Vendor Name" error={err("vendor")} cols={{ xs: 12, md: 6 }} fieldKey="vendor">
                <VendorSelect
                  vendors={blockVendors}
                  value={values.vendor || ""}
                  vendorName={values.vendorName}
                  onSelect={(vendorId) => onChange(index, "vendor", vendorId)}
                  invalid={!!err("vendor")}
                />
              </Field>
            </Row>
          )}
        </Line>

        <Line id={3} errors={errors} isSubmit={isSubmit} values={values}>
          <Row className="g-1">
            <Field label="Machine ON Time" required error={err("machineOnTime")} cols={THIRD} fieldKey="machineOnTime">
              <TimePicker name="machineOnTime" value={values.machineOnTime} onChange={handle} hasError={!!err("machineOnTime")} />
            </Field>
            <Field label="Machine OFF Time" required error={err("machineOffTime")} cols={THIRD} fieldKey="machineOffTime">
              <TimePicker
                name="machineOffTime"
                value={values.machineOffTime}
                onChange={handle}
                hasError={!!err("machineOffTime")}
                minTime={offEarliest}
              />
            </Field>
            <Calc
              label="Machine Shift Time (Hours)"
              value={calc.shiftHours === null || calc.shiftHours === undefined ? "" : `${fmtNum(calc.shiftHours)} (${hoursToHm(calc.shiftHours)} hr)`}
              cols={THIRD}
              title="Machine OFF Time − Machine ON Time"
            />
          </Row>
          {booked.length > 0 && (
            <p className="text-muted small mb-1">
              Already booked for this machine on this date: <b>{booked.join(", ")}</b> — pick a time outside it.
            </p>
          )}
        </Line>

        <Line id={5} errors={errors} isSubmit={isSubmit} values={values}>
          {/* Actual Quantity is the sheet's TOTAL QTY. — capped at Ideal Quantity rounded down. */}
          <ProductionMasterFields values={values} calc={calc} err={err} onChange={handle} md={4} labels={QTY_LABELS} />
          <Row className="g-1">
            <Calc label="Ok Quantity (%)" value={calc.pctOk === null || calc.pctOk === undefined ? "" : fmtPct(calc.pctOk)} title="OK QTY. ÷ TOTAL QTY." />
            <Calc
              label="Ideal Quantity"
              value={fmtNum(calc.idealQtyExact)}
              title="Machine Shift Time × 3600 ÷ Standard Time per Piece — TOTAL QTY. can't be more than the whole number under it"
            />
            <Calc label="Ideal Quantity/Hours" value={fmtNum(calc.idealQtyPerHour)} title="3600 ÷ Standard Time per Piece" />
            <Calc
              label="Effective Machine Run Time (hours)"
              value={calc.effectiveHours === null || calc.effectiveHours === undefined ? "" : `${fmtNum(calc.effectiveHours)} (${hoursToHm(calc.effectiveHours)} hr)`}
              title="TOTAL QTY. × Standard Time per Piece ÷ 3600"
            />
          </Row>
          <OeeCheck calc={oeeCalc} over={overMetrics} />
        </Line>

        <Line id={7} errors={errors} isSubmit={isSubmit} values={values} optional openByDefault={!plannedLock} countFields={["lunchMin"]} summary={plannedLock ? "Shift fixed — Lunch / Tea optional" : ""}>
          <Row className="g-1">
            <Field label="Planned Operator Shift (hours)" required error={err("plannedOperatorShiftHours")} cols={THIRD} fieldKey="plannedOperatorShiftHours">
              <NumberInput
                name="plannedOperatorShiftHours"
                disabled={!!plannedLock}
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
                      : "Type hours as on the sheet — 3.5 is 3 h 30 min."}
                </p>
              )}
              {plannedLock && (
                <p className="text-muted small mb-0 mt-1">
                  {plannedLock.fromEntry
                    ? "Kept as this entry was saved — set by Process Master"
                    : plannedLock.locked
                      ? `Fixed at ${hoursToHm(plannedLock.hours)} hr — locked in Process Master`
                      : `Set to ${hoursToHm(plannedLock.hours)} hr in Process Master`}
                </p>
              )}
            </Field>
            <Field label={LUNCH_LABEL} error={err("lunchMin")} cols={THIRD} fieldKey="lunchMin">
              <NumberInput name="lunchMin" value={values.lunchMin} onChange={handle} decimals={false} invalid={!!err("lunchMin")} {...minutesBox("lunchMin")} />
            </Field>
            <Calc
              label="Idle Time Allowed (min)"
              value={stoppageLimit === null ? "" : String(stoppageLimit)}
              cols={THIRD}
              title="The Machine Shift in minutes: the most Lunch / Tea plus every downtime can add up to"
            />
          </Row>
        </Line>

        <Line id={8} errors={errors} isSubmit={isSubmit} values={values} optional>
          <Row className="g-1">
            {DOWNTIME_BOXES.map(({ key, label }) => (
              <Field key={key} label={label} error={err(key)} fieldKey={key}>
                <NumberInput name={key} value={values[key]} onChange={handle} decimals={false} invalid={!!err(key)} {...minutesBox(key)} />
              </Field>
            ))}
          </Row>
          {/* Every downtime box, Lunch / Tea included, has to fit inside the
              machine's own run, so the running total sits next to that allowance. */}
          <div className="mb-2 small" data-field="stoppageTotal">
            <span className="text-muted">Total Idle Time (with Lunch / Tea): </span>
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
              <Field label="Remark for Other downtime" required error={err("otherMinRemark")} cols={FULL} fieldKey="otherMinRemark">
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
          </>
        )}

        <Line id={12} errors={errors} isSubmit={isSubmit} values={values} optional>
          <div className="mb-2">
            <Label className={labelClass}>Reason/Remarks for Rejection/ Rework</Label>
            <Input type="textarea" bsSize="sm" name="remarks" value={values.remarks} onChange={handle} maxLength={500} style={{ height: "60px" }} />
          </div>
        </Line>
      </div>
    </div>
  );
};

const InjectionEntryForm = ({
  entries = [],
  errors = [],
  isSubmit = false,
  focusTarget = null,
  machines = [],
  items = [],
  operators = [],
  vendors = [],
  isEdit = false,
  booked = [],
  plannedLocks = [],
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
      const el = rootRef.current?.querySelector(`[data-entry-index="${index}"][data-expanded] [data-field="${field}"]`);
      if (!el) {
        tries += 1;
        if (tries < 20) frame = requestAnimationFrame(go);
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.querySelector("input, select, textarea, button")?.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(go);
    return () => cancelAnimationFrame(frame);
    // Only a new request (its nonce) should steer the scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget?.nonce]);

  // Removing a block moves every block after it up one; the open one moves
  // with them rather than closing (and removing the open one closes it).
  const removeBlock = (i) => {
    setExpandedIndex((open) => (open === null || open < i ? open : open === i ? null : open - 1));
    onRemove(i);
  };

  // A new block takes the last block's date; once every machine is already on
  // that date in this form, it would have none left to pick (TROBE has one).
  const lastDate = entries[entries.length - 1]?.date;
  const allTaken = machines.length > 0 && machines.every((m) => entries.some((v) => v.date === lastDate && String(v.machine) === String(m._id)));

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
          vendors={vendors}
          isEdit={isEdit}
          canRemove={!isEdit && entries.length > 1}
          expanded={isEdit || expandedIndex === i}
          booked={booked[i] || []}
          // Machines another block of this form already has on the same date can't be picked again.
          takenMachines={entries.filter((o, j) => j !== i && o.machine && o.date === values.date).map((o) => String(o.machine))}
          plannedLock={plannedLocks[i] || null}
          onExpand={setExpandedIndex}
          onChange={onChange}
          onItemSelect={onItemSelect}
          onRemove={removeBlock}
          registerRef={(el) => {
            blockRefs.current[i] = el;
          }}
        />
      ))}

      {!isEdit && (
        <div className="d-flex flex-wrap align-items-center gap-2">
          <button
            type="button"
            className="btn btn-outline-primary d-inline-flex align-items-center gap-2"
            disabled={allTaken}
            onClick={() => {
              // The new block stays closed and asks for its machine first (focus
              // goes to the machine box); it opens once one is picked.
              askMachineFor.current = entries.length;
              onAdd();
            }}
          >
            <Plus size={16} /> Add another machine
          </button>
          {allTaken && <span className="text-muted small">Every machine is already in this form for this date.</span>}
        </div>
      )}
    </div>
  );
};

export default InjectionEntryForm;
