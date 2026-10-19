import React, { useEffect, useMemo, useRef, useState } from "react";
import { operatorsForMachine } from "../../utils/operatorsForMachine";
import { vendorsForMachine } from "../../utils/vendorsFor";
import { isNonWorking } from "../../utils/productionSheet";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Col, Input, Label, Row } from "reactstrap";
import DatePicker from "../Common/DatePicker";
import TimePicker from "../Common/TimePicker";
import NumberInput from "./NumberInput";
import MachineStatusSelect from "./MachineStatusSelect";
import OeeCheck from "./OeeCheck";
import FormLine from "./FormLine";
import { metricsOver100 } from "../../utils/productionSheet";
import SearchablePartSelect from "./SearchablePartSelect";
import VendorSelect from "./VendorSelect";
import { useAlert } from "../../context/AlertContext";
import { qtyNotice, stoppageNotice } from "../../utils/limitNotice";
import { fmtNum, fmtPct, normalizeTime, partCycleLabel } from "../../utils/productionSheet";
import { isTimeRuleMessage, stoppageLimitMin, withDecimalPlanned } from "../../utils/entryValidation";
import { RIVET_OP_FIELDS, RIVET_PROCESS_TYPES, rivetRowCalc } from "../../utils/rivetSheet";
import { RIVET_DOWNTIME_KEYS } from "../../utils/rivetValidation";
import { hoursToHm, parseHm } from "../../utils/shiftHours";

/**
 * components/Production/RivetEntryForm.jsx
 * ────────────────────────────────────────
 * The RIVET Data Entry form — SpmEntryForm's twin, with the same behaviour: one
 * block per machine behind its own "+", "Add another machine" for several
 * machines in one Save, one block open at a time, Save scrolling to the first
 * incomplete field, grey boxes calculated live, typed boxes capped so they
 * can't be typed past what is allowed (OK + Rejected within Ideal Quantity;
 * all downtime together within the Machine Shift — a popup explains either limit with its figures).
 *
 * What differs is the RIVET sheet's own fields: Loading, Process, Unloading and
 * Cleaning and Other Operations (sec), set once on the Part (required there,
 * not typed here) and shown as CNC/SPM-style tick boxes — unticking one
 * subtracts its own seconds from this entry's Total Cycle Time, the Part's
 * own record untouched; No. of Holes in One Piece, typed and shown but not
 * yet part of any formula; Actual OK and Rejected Quantity both typed (so no
 * reject reason split); and all ten downtime boxes.
 *
 * The rules live in utils/rivetValidation.js; the figures in utils/rivetSheet.js.
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
const Field = ({ label, required, error, children, md = 3, lg, fieldKey }) => (
  <Col md={md} lg={lg}>
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
  { id: 1, title: "Date, Machine No., Operator", fields: ["date", "machine", "operator", "machineStatus"] },
  {
    id: 2,
    title: "Process, Part, Total Cycle Time",
    fields: ["processType", "itemName", "noOfHoles"],
  },
  { id: 3, title: "Machine ON–OFF Time, Machine Shift", fields: ["machineOnTime", "machineOffTime"] },
  { id: 5, title: "Production (Qty)", fields: ["okQty", "rejectedQty"] },
  // Lunch / Rest sits beside Planned Operator Shift on the form, though it is
  // still just one more stoppage box toward the total (see rowCalc).
  { id: 7, title: "Planned Operator Shift, Lunch / Rest", fields: ["plannedOperatorShiftHours", "lunchMin"] },
  { id: 8, title: "Downtime / Stoppage (min)", fields: [...RIVET_DOWNTIME_KEYS, "stoppageTotal", "otherMinRemark"] },
  { id: 12, title: "Remarks", fields: ["remarks"] },
];

const findLine = (id) => LINES.find((l) => l.id === id);

// A titled box around one line's fields. Kept at module scope — defining it
// inside EntryBlock would make React see a brand-new component type on every
// keystroke and remount the whole subtree, dropping focus out of whatever input
// was being typed in.
const Line = ({ id, ...rest }) => <FormLine title={findLine(id).title} fields={findLine(id).fields} {...rest} />;

// Everything a block can hold beyond the machine itself — used to tell a
// collapsed block that still has typing in it from an untouched one.
const DATA_KEYS = LINES.flatMap((l) => l.fields).filter((k) => !["date", "machine", "stoppageTotal"].includes(k));

const hasData = (v) => v.workingMode === "Non Working" || DATA_KEYS.some((k) => (Array.isArray(v[k]) ? v[k].length > 0 : v[k] !== "" && v[k] !== undefined && v[k] !== null));

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
  const calc = useMemo(() => rivetRowCalc(values), [values]);
  // Availability / Performance / Quality as Save will work them out (planned
  // shift converted from its typed H.MM first) — any above 100% sends the
  // entry to Admin review, so it's flagged here before Save.
  const oeeCalc = useMemo(() => rivetRowCalc(withDecimalPlanned(values)), [values]);
  const overMetrics = metricsOver100(oeeCalc);
  const selectedItem = useMemo(() => items.find((it) => it._id === values.item) || null, [items, values.item]);

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

  // OK + Rejected can't go past Ideal Quantity: each box may take what the other leaves.
  const qtyRoom = (otherKey) =>
    Number.isFinite(calc.idealQty) ? Math.max(0, calc.idealQty - (Number(values[otherKey]) || 0)) : undefined;
  // A blocked keystroke pops up why, with the figures: what was typed plus what
  // the other box already holds, against Ideal Quantity.
  const exceedIdeal = (otherKey) => (max, typed) =>
    notice(...qtyNotice({ calc, entered: typed + (Number(values[otherKey]) || 0) }));

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
        <Line id={1} errors={errors} isSubmit={isSubmit} values={values}>
          <Row className="g-1">
            <Field label="Date" required error={err("date")} md={6} lg={3} fieldKey="date">
              <DatePicker name="date" value={values.date} onChange={handle} hasError={!!err("date")} />
            </Field>
            <Field label="Machine No." required error={err("machine")} md={6} lg={3} fieldKey="machine">
              {machineSelect}
            </Field>
            <Field label="Operator" required={!nonWorking} error={err("operator")} md={6} lg={3} fieldKey="operator">
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
            <Field label="Machine Working Status" error={err("workingMode")} md={6} lg={3} fieldKey="workingMode">
              <Input
                type="select"
                bsSize="sm"
                name="workingMode"
                value={values.workingMode || "Working"}
                onChange={(e) => {
                  handle(e);
                  // Working has no Status — drop any picked while it was Non Working.
                  if (e.target.value === "Working") onChange(index, "machineStatus", []);
                }}
              >
                <option value="Working">Working</option>
                <option value="Non Working">Non Working</option>
              </Input>
            </Field>
            {nonWorking && (
              <Field label="Status" error={err("machineStatus")} md={6} lg={3} fieldKey="machineStatus">
                <MachineStatusSelect
                  value={values.machineStatus}
                  onChange={(list) => onChange(index, "machineStatus", list)}
                  remark={values.remarks}
                />
              </Field>
            )}
          </Row>
        </Line>

        {nonWorking ? (
          <p className="text-muted small mb-1 px-1">
            <b>Non Working</b> — the machine did not run, so nothing else is needed. Pick a Status if you like and press Save.
          </p>
        ) : (
          <>

        <Line id={2} errors={errors} isSubmit={isSubmit} values={values}>
          <Row className="g-1">
            <Field label="Part Name" required error={err("itemName")} md={12} fieldKey="itemName">
              <SearchablePartSelect
                items={items}
                value={values.item || ""}
                itemName={values.itemName}
                onSelect={(itemId) => onItemSelect(index, itemId)}
                invalid={!!err("itemName")}
                label={partCycleLabel}
              />
            </Field>
          </Row>
          {showVendor && (
            <Row className="g-1">
              <Field label="Vendor Name" error={err("vendor")} md={6} fieldKey="vendor">
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
          <Row className="g-1">
            <Field label="Process" required error={err("processType")} md={6} fieldKey="processType">
              <Input type="select" bsSize="sm" name="processType" value={values.processType} onChange={handle} invalid={!!err("processType")}>
                {/* A record saved before this box existed, or with a value since
                    retired from the list, still shows what it has rather than an
                    empty box. */}
                <option value="">
                  {values.processType && !RIVET_PROCESS_TYPES.includes(values.processType) ? values.processType : "Select process"}
                </option>
                {RIVET_PROCESS_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Input>
            </Field>
            <Field label="No. of Holes in One Piece" error={err("noOfHoles")} md={6} fieldKey="noOfHoles">
              <NumberInput name="noOfHoles" value={values.noOfHoles} onChange={handle} decimals={false} invalid={!!err("noOfHoles")} />
            </Field>
          </Row>
          <Row className="g-1">
            {RIVET_OP_FIELDS.map((f) => {
              const checkId = `rivet-op-${index}-${f.key}`;
              // Same look as CNC's/SPM's own operation checkboxes: value always
              // comes from the Part (never typed here), unticking subtracts
              // just this operation's own seconds from this entry's Total
              // Cycle Time — the Part's own record is never touched.
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
                      {f.label.replace(" (sec)", "")}
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
          <Row className="g-1">
            <Calc
              label="Total Cycle Time (Sec)"
              value={fmtNum(calc.totalCycleSec)}
              md={3}
              title="The Part's own Total Cycle Time, minus any unticked operation above"
            />
          </Row>
        </Line>

        <Line id={3} errors={errors} isSubmit={isSubmit} values={values}>
          <Row className="g-1">
            <Field label="Machine ON Time" required error={err("machineOnTime")} md={3} fieldKey="machineOnTime">
              <TimePicker name="machineOnTime" value={values.machineOnTime} onChange={handle} hasError={!!err("machineOnTime")} />
            </Field>
            <Field label="Machine OFF Time" required error={err("machineOffTime")} md={3} fieldKey="machineOffTime">
              <TimePicker
                name="machineOffTime"
                value={values.machineOffTime}
                onChange={handle}
                hasError={!!err("machineOffTime")}
                minTime={offEarliest}
              />
            </Field>
          </Row>
          {booked.length > 0 && (
            <p className="text-muted small mb-1">
              Already booked for this machine on this date: <b>{booked.join(", ")}</b> — pick a time outside it.
            </p>
          )}
        </Line>

        <Line id={5} errors={errors} isSubmit={isSubmit} values={values}>
          <Row className="g-1">
            <Field label="Actual OK Quantity" required error={err("okQty")} md={4} fieldKey="okQty">
              <NumberInput
                name="okQty"
                value={values.okQty}
                onChange={handle}
                decimals={false}
                invalid={!!err("okQty")}
                max={qtyRoom("rejectedQty")}
                onExceedMax={exceedIdeal("rejectedQty")}
              />
            </Field>
            <Field label="Rejected Quantity" required error={err("rejectedQty")} md={4} fieldKey="rejectedQty">
              <NumberInput
                name="rejectedQty"
                value={values.rejectedQty}
                onChange={handle}
                decimals={false}
                invalid={!!err("rejectedQty")}
                max={qtyRoom("okQty")}
                onExceedMax={exceedIdeal("okQty")}
              />
            </Field>
          </Row>
          <OeeCheck calc={oeeCalc} over={overMetrics} />
        </Line>

        <Line id={7} errors={errors} isSubmit={isSubmit} values={values} optional openByDefault={!plannedLock} countFields={["lunchMin"]} summary={plannedLock ? "Fixed — nothing to enter" : ""}>
          <Row className="g-1">
            <Field label="Planned Operator Shift (hr.min)" required error={err("plannedOperatorShiftHours")} md={4} fieldKey="plannedOperatorShiftHours">
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
                      : "Type hours.minutes — 3.30 is 3 h 30 min."}
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

        <Line id={8} errors={errors} isSubmit={isSubmit} values={values} optional>
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
          </>
        )}

        <Line id={12} errors={errors} isSubmit={isSubmit} values={values} optional>
          <div className="mb-2">
            <Label className={labelClass}>Remarks</Label>
            <Input type="textarea" bsSize="sm" name="remarks" value={values.remarks} onChange={handle} maxLength={500} style={{ height: "60px" }} />
          </div>
        </Line>
      </div>
    </div>
  );
};

const RivetEntryForm = ({
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

export default RivetEntryForm;
