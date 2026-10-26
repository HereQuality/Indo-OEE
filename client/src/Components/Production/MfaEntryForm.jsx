import React, { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Col, Input, Label, Row } from "reactstrap";
import DatePicker from "../Common/DatePicker";
import TimePicker from "../Common/TimePicker";
import NumberInput from "./NumberInput";
import MachineStatusSelect from "./MachineStatusSelect";
import OeeCheck from "./OeeCheck";
import FormLine from "./FormLine";
import SearchablePartSelect from "./SearchablePartSelect";
import { ProductionMasterFields } from "./QuantityMaster";
import { useAlert } from "../../context/AlertContext";
import { stoppageNotice } from "../../utils/limitNotice";
import { MACHINE_STATUSES, fmtNum, isNonWorking, metricsOver100, normalizeTime, partCycleLabel } from "../../utils/productionSheet";
import { isEndBeforeStartMessage, isLiveMessage, stoppageLimitMin, withDecimalPlanned } from "../../utils/entryValidation";
import { MFA_LABELS, MFA_WORDS, isStatusOnly, mfaRowCalc } from "../../utils/mfaSheet";
import { hoursToHm, parseShiftHours } from "../../utils/shiftHours";

/**
 * components/Production/MfaEntryForm.jsx
 * ────────────────────────────────────────
 * The MODULAR FRAME ASSEMBLY form — RawCastingEntryForm's twin, kept per
 * WORKER: one block per entry behind its own "+", "Add another entry" for
 * several in one Save, one block open at a time, Save scrolling to the first
 * incomplete field, grey boxes calculated live, typed boxes capped so they
 * can't go past what the Assembly Working Hours allow (Idle Time + Other
 * Activity within the working hours — a popup explains it with its figures).
 * TOTAL QTY is NOT capped at the Ideal Assembly Quantity: a person can beat the
 * standard time, and such an entry goes to OEE Review.
 *
 * Its own:
 *  - The same worker may be added more than once on one date, at overlapping
 *    times too.
 *  - TOTAL QTY and OK QTY are typed, Rejected QTY = TOTAL − OK; no reason
 *    split — the Remarks box only. No Vendor Name, no Challan No.
 *  - Its timing boxes take their words from MFA_LABELS (utils/mfaSheet.js).
 *
 * The worker is this sheet's row key, so there's no separate Operator box;
 * each block's worker id sits in `values.machine`, where every sheet's page
 * keeps its row key. The rules live in utils/mfaValidation.js; the figures in
 * utils/mfaSheet.js.
 */

const labelClass = "form-label small text-muted mb-1";

// Reasons For Not Working: a worker has no machine to break down, so a new
// entry isn't offered "Machine Breakdown" (one saved with it still shows it).
const WORKER_STATUSES = MACHINE_STATUSES.filter((s) => s !== "Machine Breakdown");

// Column widths keyed to the modal's own width, not just the viewport's:
// Bootstrap's modal is only 500px wide until 992px, so `md` (768px) columns
// would squeeze four fields into ~110px each on an iPad in portrait. One per
// row on phones, two from `sm`, the full 4-/3-up layout only from `lg`.
const QUARTER = { xs: 12, sm: 6, lg: 3 };
const THIRD = { xs: 12, sm: 6, lg: 4 };
const FULL = { xs: 12 };

// Decimal hours as the sheet writes them, with the clock reading beside: "7.75 hr (7:45)".
const hoursText = (h) => (h === null || h === undefined || !Number.isFinite(h) ? "" : `${fmtNum(h)} hr (${hoursToHm(h)})`);

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
  { id: 1, title: "Date, Worker Name, Working Status", fields: ["date", "machine", "machineStatus"] },
  { id: 2, title: "Item Name, Standard Assembly Time", fields: ["itemName", "totalCycleSec"] },
  { id: 3, title: "Assembly Start – End Time, Working Hours", fields: ["machineOnTime", "machineOffTime"] },
  { id: 5, title: "TOTAL QTY, OK QTY, Rejected QTY", fields: ["actualQty", "okQty"] },
  { id: 6, title: "Other Activity Carried Out", fields: ["otherActivity", "otherActivityMin"] },
  // Lunch / Tea sits beside Planned Operator Shift on the form, though it is
  // still just one of the two Idle Time boxes toward the total.
  { id: 7, title: "Planned Operator Shift, Lunch / Tea", fields: ["plannedOperatorShiftHours", "lunchMin"] },
  { id: 8, title: "Idle Time — Other (Min)", fields: ["otherMin", "stoppageTotal", "otherMinRemark"] },
  { id: 12, title: "Remarks", fields: ["remarks"] },
];

// The quantity boxes in the paper sheet's own words.
const QTY_LABELS = { actual: "TOTAL QTY", ok: "OK QTY", rejected: "Rejected QTY" };

const findLine = (id) => LINES.find((l) => l.id === id);

// A titled box around one line's fields. Kept at module scope — defining it
// inside EntryBlock would make React see a brand-new component type on every
// keystroke and remount the whole subtree, dropping focus out of whatever input
// was being typed in.
const Line = ({ id, ...rest }) => <FormLine title={findLine(id).title} fields={findLine(id).fields} {...rest} />;

// Everything a block can hold beyond the worker itself — used to tell a
// collapsed block that still has typing in it from an untouched one.
const DATA_KEYS = LINES.flatMap((l) => l.fields).filter((k) => !["date", "machine", "stoppageTotal"].includes(k));

const hasData = (v) => v.workingMode === "Non Working" || DATA_KEYS.some((k) => (Array.isArray(v[k]) ? v[k].length > 0 : v[k] !== "" && v[k] !== undefined && v[k] !== null));

const EntryBlock = ({
  values,
  errors,
  isSubmit,
  workers,
  items,
  isEdit,
  index,
  canRemove,
  expanded,
  booked = [],
  plannedLock = null,
  onExpand,
  onChange,
  onItemSelect,
  onRemove,
  registerRef,
}) => {
  const { warning, notice } = useAlert();
  const nonWorking = isNonWorking(values);
  const calc = useMemo(() => mfaRowCalc(values), [values]);
  // Availability / Performance / Quality as Save will work them out (planned
  // shift converted from its typed decimal hours first) — any above 100% sends the
  // entry to Admin review, so it's flagged here before Save.
  const oeeCalc = useMemo(() => mfaRowCalc(withDecimalPlanned(values)), [values]);
  const overMetrics = metricsOver100(oeeCalc);
  const statusOnly = isStatusOnly(values) || nonWorking;
  // The picked Part's own assembly time — what this entry's box was filled
  // in with, shown as a hint once the box has been changed for the day.
  const partCycle = useMemo(() => {
    const n = items.find((it) => it._id === values.item)?.totalCycleSec;
    return n === null || n === undefined || n === "" || !Number.isFinite(Number(n)) ? null : Number(n);
  }, [items, values.item]);

  const planned = useMemo(() => parseShiftHours(values.plannedOperatorShiftHours).hours, [values.plannedOperatorShiftHours]);
  // Idle Time and Other Activity together have to fit in the working hours.
  const awayLimit = useMemo(() => stoppageLimitMin(values), [values]);
  const workingMin = calc.shiftHours === null || calc.shiftHours === undefined ? null : Math.round(calc.shiftHours * 60);
  // Not while End isn't after Start — that "shift" wraps past midnight, and
  // the End box already says what's wrong.
  const plannedBelowWorking = !isEndBeforeStartMessage(errors.machineOffTime) && planned !== null && workingMin !== null && Math.round(planned * 60) < workingMin;
  const awayMin = (calc.totalStoppageMin || 0) + (Number(values.otherActivityMin) || 0);
  const overAway = awayLimit !== null && awayMin > awayLimit;
  const otherIdleUsed = Number(values.otherMin) > 0;

  // What each minutes box (Other Activity, Lunch / Tea, Other idle) may still
  // take: whatever of the working hours the other two haven't used.
  const minutesBox = (key) => {
    const room = awayLimit === null ? 1440 : Math.min(1440, Math.max(0, awayLimit - (awayMin - (Number(values[key]) || 0))));
    return {
      max: room,
      onExceedMax: (max, typed) =>
        awayLimit === null
          ? warning("Minutes can't be more than 1440 (a day).")
          : notice(...stoppageNotice({ limitMin: awayLimit, totalMin: awayMin - (Number(values[key]) || 0) + typed, words: MFA_WORDS })),
    };
  };

  // The End-after-Start rule shows as soon as the times are picked (and a typed
  // time that isn't one, or a worker already full for the date, as soon as it's
  // there); everything else waits until Save has been pressed.
  const err = (key) => (isSubmit || isLiveMessage(errors[key]) ? errors[key] : undefined);

  // An End picker offers nothing at or before its Start time.
  const after = (on) => {
    const t = normalizeTime(on);
    if (!t) return null;
    const next = Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + 1;
    return next >= 1440 ? null : `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
  };
  const endEarliest = useMemo(() => after(values.machineOnTime), [values.machineOnTime]);
  const errorCount = Object.keys(errors).length;
  const handle = (e) => onChange(index, e.target.name, e.target.value);

  // Picking a worker in a closed block opens its entry fields straight away —
  // no separate "+" press needed (the "+" stays for reopening a collapsed one).
  const handleWorker = (e) => {
    handle(e);
    if (!isEdit && !expanded && e.target.value) onExpand(index);
  };

  const workerSelect = (
    <Input type="select" bsSize="sm" name="machine" value={values.machine} onChange={handleWorker} disabled={isEdit} invalid={!!err("machine")}>
      <option value="">Select worker</option>
      {workers.map((w) => (
        <option key={w._id} value={w._id}>
          {w.name}
        </option>
      ))}
    </Input>
  );

  const removeButton = canRemove && (
    <button type="button" className="btn btn-sm btn-soft-danger btn-icon flex-shrink-0" title="Remove this entry" onClick={() => onRemove(index)}>
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

  // Collapsed: just the worker and its "+". A filled-in block gets a subtle
  // tint so "press + to reopen it" reads as "there's saved work here".
  if (!expanded) {
    return (
      <div
        ref={registerRef}
        data-entry-index={index}
        className={`entry-block-in border rounded mb-1 px-2 pt-1 transition-colors ${isSubmit && errorCount > 0 ? "border-danger" : ""} ${
          hasData(values) ? "bg-primary bg-opacity-10" : ""
        }`}
      >
        <Row className="align-items-start g-1">
          <Field label="Worker Name" required error={err("machine")} cols={{ xs: 8, sm: 6, lg: 4 }} fieldKey="machine">
            {workerSelect}
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
                  title={values.machine ? "Open the entry fields" : "Select a worker first"}
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
                (!workers.length
                  ? "No workers yet — assign them to MODULAR FRAME ASSEMBLY in Production › Operators."
                  : !values.machine
                    ? "Select a worker — their entry fields open automatically"
                    : hasData(values)
                      ? "Entry filled in — press + to reopen it"
                      : "Press + to fill this worker's entry")}
            </div>
          </Col>
        </Row>
      </div>
    );
  }

  const workerLabel = workers.find((w) => w._id === values.machine)?.name;

  return (
    <div
      ref={registerRef}
      data-entry-index={index}
      data-expanded="true"
      className={`entry-block-in border rounded mb-2 transition-colors ${isSubmit && errorCount > 0 ? "border-danger" : "border-primary"}`}
    >
      <div className="d-flex align-items-center gap-2 px-2 py-1 bg-light border-bottom rounded-top">
        <button
          type="button"
          className="btn btn-sm btn-primary d-inline-flex align-items-center justify-content-center p-0 flex-shrink-0 rounded-circle"
          style={{ width: 24, height: 24 }}
          onClick={() => onExpand(isEdit ? index : null)}
          title="Collapse this entry"
          aria-label="Collapse this entry"
        >
          <Minus size={15} />
        </button>
        <span className="fw-semibold small text-truncate">{workerLabel || `Entry ${index + 1}`}</span>
        {incompleteBadge}
        <span className="ms-auto">{removeButton}</span>
      </div>

      <div className="p-2">
        <Line id={1} errors={errors} isSubmit={isSubmit} values={values}>
          <Row className="g-1">
            <Field label="Date" required error={err("date")} fieldKey="date">
              <DatePicker name="date" value={values.date} onChange={handle} hasError={!!err("date")} />
            </Field>
            <Field label="Worker Name" required error={err("machine")} fieldKey="machine">
              {workerSelect}
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
                  statuses={WORKER_STATUSES}
                />
              </Field>
            )}
          </Row>
          {statusOnly && (
            <p className="text-muted small mb-2">
              {nonWorking ? (
                <>
                  <b>Non Working</b> — no assembly that day, so nothing else is needed. Pick a reason (or write one, like W.OFF, in Remarks) and press Save.
                </>
              ) : (
                <>
                  <b>{values.workingStatus}</b> — no assembly that day, so only Date, Worker Name and Working Status are saved (and Remarks, if filled in).
                </>
              )}
            </p>
          )}
        </Line>

        {!statusOnly && (
          <>
            <Line id={2} errors={errors} isSubmit={isSubmit} values={values}>
              <Row className="g-1">
                <Field label="Item Name" required error={err("itemName")} cols={{ xs: 12, lg: 8 }} fieldKey="itemName">
                  <SearchablePartSelect
                    items={items}
                    value={values.item || ""}
                    itemName={values.itemName}
                    onSelect={(itemId) => onItemSelect(index, itemId)}
                    invalid={!!err("itemName")}
                    label={partCycleLabel}
                  />
                </Field>
                <Field label={`${MFA_LABELS.cycle} (Sec)`} required error={err("totalCycleSec")} cols={{ xs: 12, sm: 6, lg: 4 }} fieldKey="totalCycleSec">
                  <NumberInput name="totalCycleSec" value={values.totalCycleSec} onChange={handle} invalid={!!err("totalCycleSec")} />
                  {/* Filled in from the Part when picked; today's may differ. */}
                  {!err("totalCycleSec") && partCycle !== null && Number(values.totalCycleSec) !== partCycle && (
                    <p className="text-muted small mb-0 mt-1">Part's usual: {fmtNum(partCycle)} sec</p>
                  )}
                </Field>
              </Row>
            </Line>

            <Line id={3} errors={errors} isSubmit={isSubmit} values={values}>
              <Row className="g-1">
                <Field label={MFA_LABELS.start} required error={err("machineOnTime")} cols={THIRD} fieldKey="machineOnTime">
                  <TimePicker name="machineOnTime" value={values.machineOnTime} onChange={handle} hasError={!!err("machineOnTime")} />
                </Field>
                <Field label={MFA_LABELS.end} required error={err("machineOffTime")} cols={THIRD} fieldKey="machineOffTime">
                  <TimePicker name="machineOffTime" value={values.machineOffTime} onChange={handle} hasError={!!err("machineOffTime")} minTime={endEarliest} />
                </Field>
                <Calc label={MFA_LABELS.hours} value={hoursText(calc.shiftHours)} cols={THIRD} title={`${MFA_LABELS.end} − ${MFA_LABELS.start}`} />
              </Row>
              {booked.length > 0 && (
                <p className="text-muted small mb-1">
                  Already entered for this worker on this date: <b>{booked.join(", ")}</b> — overlapping times are fine on this sheet.
                </p>
              )}
            </Line>

            <Line id={5} errors={errors} isSubmit={isSubmit} values={values}>
              {/* Not capped at the Ideal Assembly Quantity: a person can beat the standard time; over-Ideal goes to OEE Review. */}
              <ProductionMasterFields values={values} calc={calc} err={err} onChange={handle} md={4} capByIdeal={false} notice={{ words: MFA_WORDS }} labels={QTY_LABELS} />
              <Row className="g-1">
                <Calc
                  label={MFA_LABELS.idealQty}
                  value={fmtNum(calc.idealQty)}
                  cols={THIRD}
                  title={`${MFA_LABELS.hours} × 3600 ÷ ${MFA_LABELS.cycle} — not rounded down`}
                />
                <Calc label={MFA_LABELS.idealQtyPerHour} value={fmtNum(calc.idealQtyPerHour)} cols={THIRD} title={`3600 ÷ ${MFA_LABELS.cycle}`} />
                <Calc label={MFA_LABELS.effective} value={hoursText(calc.effectiveHours)} cols={THIRD} title={`TOTAL QTY × ${MFA_LABELS.cycle} ÷ 3600`} />
              </Row>
              <OeeCheck calc={oeeCalc} over={overMetrics} />
            </Line>

            <Line id={6} errors={errors} isSubmit={isSubmit} values={values} optional>
              <Row className="g-1">
                <Field label="Other Activity Carried Out" required={Number(values.otherActivityMin) > 0} error={err("otherActivity")} cols={{ xs: 12, lg: 8 }} fieldKey="otherActivity">
                  <Input
                    type="text"
                    bsSize="sm"
                    name="otherActivity"
                    value={values.otherActivity || ""}
                    onChange={handle}
                    maxLength={200}
                    placeholder="e.g. Other machining work"
                    invalid={!!err("otherActivity")}
                  />
                </Field>
                <Field label="Time consume in Other Activity (min)" error={err("otherActivityMin")} cols={{ xs: 12, lg: 4 }} fieldKey="otherActivityMin">
                  <NumberInput
                    name="otherActivityMin"
                    value={values.otherActivityMin}
                    onChange={handle}
                    decimals={false}
                    invalid={!!err("otherActivityMin")}
                    {...minutesBox("otherActivityMin")}
                  />
                </Field>
              </Row>
            </Line>

            <Line
              id={7}
              errors={errors}
              isSubmit={isSubmit}
              values={values}
              optional
              openByDefault={!plannedLock}
              countFields={["lunchMin"]}
              summary={plannedLock ? "Shift fixed — Lunch / Tea optional" : ""}
            >
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
                    <p className={`mb-0 small mt-1 ${plannedBelowWorking ? "text-danger" : "text-muted"}`}>
                      {plannedBelowWorking
                        ? `Can't be less than the ${MFA_LABELS.hours} (${hoursToHm(workingMin / 60)}).`
                        : planned !== null
                          ? `= ${hoursToHm(planned)} hr`
                          : `Type hours — 9.42 is 9 h 25 min. The same as the ${MFA_LABELS.hours} gives the sheet's own figures.`}
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
                <Field label="Lunch / Tea / Washroom etc (Min)" error={err("lunchMin")} cols={THIRD} fieldKey="lunchMin">
                  <NumberInput name="lunchMin" value={values.lunchMin} onChange={handle} decimals={false} invalid={!!err("lunchMin")} {...minutesBox("lunchMin")} />
                </Field>
                <Calc
                  label="Minutes Allowed"
                  value={awayLimit === null ? "" : String(awayLimit)}
                  cols={THIRD}
                  title={`The ${MFA_LABELS.hours} in minutes: the most Idle Time plus Other Activity can add up to`}
                />
              </Row>
            </Line>

            <Line id={8} errors={errors} isSubmit={isSubmit} values={values} optional>
              <Row className="g-1">
                <Field label="Other (Min)" error={err("otherMin")} fieldKey="otherMin">
                  <NumberInput name="otherMin" value={values.otherMin} onChange={handle} decimals={false} invalid={!!err("otherMin")} {...minutesBox("otherMin")} />
                </Field>
                <Calc label="Total Idle Time (Min)" value={fmtNum(calc.totalStoppageMin) || "0"} title="Lunch / Tea / Washroom + Other" />
              </Row>
              {/* Idle Time and Other Activity both have to fit in the working
                  hours, so their running total sits next to that allowance. */}
              <div className="mb-2 small" data-field="stoppageTotal">
                <span className="text-muted">Idle Time + Other Activity: </span>
                <span className={overAway ? "text-danger fw-semibold" : "fw-semibold"}>{fmtNum(awayMin) || 0} min</span>
                <span className="text-muted">
                  {awayLimit === null ? ` — enter ${MFA_LABELS.start} / End Time to see the allowance` : ` of ${awayLimit} min allowed`}
                </span>
                {err("stoppageTotal") && <p className="text-danger mb-0 mt-1">{err("stoppageTotal")}</p>}
              </div>
              {otherIdleUsed && (
                <Row className="g-1">
                  <Field label="Remark for Other idle time" required error={err("otherMinRemark")} cols={FULL} fieldKey="otherMinRemark">
                    <Input
                      type="textarea"
                      bsSize="sm"
                      name="otherMinRemark"
                      value={values.otherMinRemark || ""}
                      onChange={handle}
                      maxLength={300}
                      placeholder="What was the “Other” idle time?"
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

const MfaEntryForm = ({
  entries = [],
  errors = [],
  isSubmit = false,
  focusTarget = null,
  workers = [],
  items = [],
  isEdit = false,
  booked = [],
  plannedLocks = [],
  onChange,
  onItemSelect,
  onAdd,
  onRemove,
}) => {
  // Only one block is ever open at a time: opening one collapses whichever
  // else was open. Editing shows a single block, always open. "Add Entry" with
  // a worker already chosen (the sheet's Worker filter, or a restored draft)
  // opens that block at once instead of waiting for a "+".
  const [expandedIndex, setExpandedIndex] = useState(() => {
    if (isEdit) return 0;
    const first = entries.findIndex((v) => v.machine);
    return first === -1 ? null : first;
  });

  // One scroll owned by the parent, not one independent effect per block —
  // see SpringEntryForm for why two competing scrolls raced each other.
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
  // rendered and put the cursor in it.
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

  // "Add another entry": once the new block is on screen, scroll to it and
  // put the cursor in its worker box.
  const askWorkerFor = useRef(null);
  useEffect(() => {
    const index = askWorkerFor.current;
    if (index === null || index !== entries.length - 1) return;
    askWorkerFor.current = null;
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
          workers={workers}
          items={items}
          isEdit={isEdit}
          canRemove={!isEdit && entries.length > 1}
          expanded={isEdit || expandedIndex === i}
          booked={booked[i] || []}
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
            onClick={() => {
              // The new block stays closed and asks for its worker first. The
              // same worker may be picked again — one worker often has several
              // entries a day, at overlapping times too.
              askWorkerFor.current = entries.length;
              onAdd();
            }}
          >
            <Plus size={16} /> Add another entry
          </button>
        </div>
      )}
    </div>
  );
};

export default MfaEntryForm;
