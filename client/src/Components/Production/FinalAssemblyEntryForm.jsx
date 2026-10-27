import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { withControlId } from "./controlId";
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
import { FA_WORDS, stoppageNotice } from "../../utils/limitNotice";
import { MACHINE_STATUSES, fmtNum, isNonWorking, dayFiguresFor, metricsOver100, withDayFigures, normalizeTime, partCycleLabel } from "../../utils/productionSheet";
import { cleanSplit, isEndBeforeStartMessage, isLiveMessage, stoppageLimitMin, withDecimalPlanned } from "../../utils/entryValidation";
import { FA_DEFECT_REASONS, FA_LABELS as L, faDayCalc, faRowCalc, isStatusOnly } from "../../utils/finalAssemblySheet";
import { hoursToHm, parseShiftHours } from "../../utils/shiftHours";

/**
 * components/Production/FinalAssemblyEntryForm.jsx
 * ──────────────────────────────────────────────────
 * The FINAL ASSEMBLY form — AFTER POWDER COATING's form (PowderCoatingEntryForm)
 * for this sheet, kept per WORKER: one block per entry behind its own "+",
 * "Add another entry" for several in one Save, one block open at a time, Save
 * scrolling to the first incomplete field, grey boxes calculated live, idle
 * boxes capped so they can't go past the Working Hours.
 *
 * Its own rules: the same worker may be picked in several blocks, at
 * OVERLAPPING times (several jobs at once — up to 12 a date); Standard Time
 * per Piece is optional (PACKING has none: Ideal blank, Effective 0); Total
 * QTY and the four Types of Defects are typed, and Total Defects and OK QTY
 * worked out; Total QTY is NOT capped at Ideal (over-Ideal goes to OEE
 * Review). Labels come from FA_LABELS (utils/finalAssemblySheet.js).
 *
 * The rules live in utils/finalAssemblyValidation.js; the figures in
 * utils/finalAssemblySheet.js.
 */

const labelClass = "form-label small text-muted mb-1";

// Reasons For Not Working: a worker has no machine to break down, so a new
// entry isn't offered "Machine Breakdown" (one saved with it still shows it).
const WORKER_STATUSES = MACHINE_STATUSES.filter((s) => s !== "Machine Breakdown");

// Column widths keyed to the modal's own width, not just the viewport's:
// Bootstrap's modal is only 500px wide until 992px. One per row on phones, two
// from `sm`, the full 4-/3-up layout only from `lg`.
const QUARTER = { xs: 12, sm: 6, lg: 3 };
const THIRD = { xs: 12, sm: 6, lg: 4 };
const FULL = { xs: 12 };

// A calculated box — greyed so nobody tries to type in it.
const Calc = ({ label, value, cols = QUARTER, title }) => {
  const id = useId();
  return (
    <Col {...cols}>
      <div className="mb-1" title={title}>
        <Label htmlFor={id} className={labelClass}>{label}</Label>
        <Input id={id} type="text" bsSize="sm" value={value ?? ""} readOnly disabled className="bg-light" />
      </div>
    </Col>
  );
};

// A typed field. `fieldKey` is what Save's scroll-to-first-error looks for.
const Field = ({ label, required, error, children, cols = QUARTER, fieldKey }) => {
  const id = useId();
  return (
    <Col {...cols}>
      <div className="mb-1" data-field={fieldKey}>
        <Label htmlFor={id} className={labelClass}>
          {label} {required && <span className="text-danger">*</span>}
        </Label>
        {withControlId(children, id)}
        {error && <p className="text-danger mb-0 small mt-1">{error}</p>}
      </div>
    </Col>
  );
};

// Decimal hours as the sheet shows them: "1.5 hr".
const hrs = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "" : `${fmtNum(v)} hr`);

// The lines, in sheet order. `fields` lists the typed keys in each line, so a
// line containing a validation error can flag itself in its heading.
const LINES = [
  { id: 1, title: `Date, ${L.worker}, ${L.workingStatus}`, fields: ["date", "machine", "machineStatus"] },
  { id: 2, title: `${L.itemName}, Standard Time per Piece`, fields: ["itemName", "vendor", "totalCycleSec"] },
  { id: 3, title: `Start – End Time, ${L.hours}`, fields: ["machineOnTime", "machineOffTime"] },
  { id: 5, title: `${L.totalQty}, ${L.defects}`, fields: ["actualQty", "rejectBreakdown", "rejectOtherRemark"] },
  { id: 6, title: L.otherActivity, fields: ["otherActivity", "otherActivityMin"] },
  // Lunch / Tea sits beside Planned Operator Shift on the form, though it is
  // still just one of the two Idle boxes toward the total.
  { id: 7, title: "Planned Operator Shift, Lunch / Tea", fields: ["plannedOperatorShiftHours", "lunchMin"] },
  { id: 8, title: "Idle — Other (min)", fields: ["otherMin", "stoppageTotal", "otherMinRemark"] },
  { id: 12, title: L.remarks, fields: ["remarks"] },
];

const findLine = (id) => LINES.find((l) => l.id === id);

// A titled box around one line's fields. Kept at module scope — defining it
// inside EntryBlock would make React see a brand-new component type on every
// keystroke and remount the whole subtree, dropping focus out of whatever input
// was being typed in.
const Line = ({ id, ...rest }) => <FormLine title={findLine(id).title} fields={findLine(id).fields} {...rest} />;

// Everything a block can hold beyond the worker itself — used to tell a
// collapsed block that still has typing in it from an untouched one.
const DATA_KEYS = LINES.flatMap((l) => l.fields).filter((k) => !["date", "machine", "stoppageTotal", "rejectBreakdown"].includes(k));

const hasData = (v) =>
  v.workingMode === "Non Working" ||
  DATA_KEYS.some((k) => (Array.isArray(v[k]) ? v[k].length > 0 : v[k] !== "" && v[k] !== undefined && v[k] !== null)) ||
  Object.values(v.rejectBreakdown || {}).some((n) => n !== "" && n !== undefined && n !== null);

const EntryBlock = ({
  values,
  errors,
  isSubmit,
  workers,
  items,
  vendors,
  isEdit,
  index,
  canRemove,
  expanded,
  booked = [],
  plannedLock = null,
  savedRows = [],
  onExpand,
  onChange,
  onItemSelect,
  onRejectChange,
  onRemove,
  registerRef,
}) => {
  const { warning, notice } = useAlert();
  const nonWorking = isNonWorking(values);
  const calc = useMemo(() => faRowCalc(values), [values]);
  // Availability / Performance / Quality as Save will work them out (planned
  // shift converted from its typed decimal hours first) — any above 100% sends
  // the entry to Admin review, so it's flagged here before Save.
  // The day's OEE figures too (this machine's / worker's date, with the entries
  // already saved on it) — any above 100% also sends the entry to Admin review.
  const dayFigures = useMemo(
    () => dayFiguresFor(faDayCalc, withDecimalPlanned(values, plannedLock), savedRows.filter((r) => String(r.machine) === String(values.machine) && r.date === values.date)),
    [values, savedRows, plannedLock],
  );
  const oeeCalc = useMemo(() => withDayFigures(faRowCalc(withDecimalPlanned(values, plannedLock)), dayFigures, "worker"), [values, dayFigures, plannedLock]);
  const overMetrics = metricsOver100(oeeCalc);
  const statusOnly = isStatusOnly(values) || nonWorking;
  // Vendor Name shows only when this process has vendors (Vendor Master) — or
  // the entry already names one, so editing never hides it.
  const showVendor = vendors.length > 0 || !!values.vendor;
  // The picked Part's own Standard Time — shown as a hint once this entry's
  // box has been changed for the day.
  const partCycle = useMemo(() => {
    const n = items.find((it) => it._id === values.item)?.totalCycleSec;
    return n === null || n === undefined || n === "" || !Number.isFinite(Number(n)) ? null : Number(n);
  }, [items, values.item]);

  const planned = useMemo(() => parseShiftHours(values.plannedOperatorShiftHours).hours, [values.plannedOperatorShiftHours]);
  // Idle Time + Other Activity together have to fit in the Working Hours.
  const stoppageLimit = useMemo(() => stoppageLimitMin(values), [values]);
  const shiftMin = calc.shiftHours === null || calc.shiftHours === undefined ? null : Math.round(calc.shiftHours * 60);
  const plannedBelowShift = !isEndBeforeStartMessage(errors.machineOffTime) && planned !== null && shiftMin !== null && Math.round(planned * 60) < shiftMin;
  const awayMin = (calc.totalStoppageMin || 0) + (Number(values.otherActivityMin) || 0);
  const overAway = stoppageLimit !== null && awayMin > stoppageLimit;
  const otherIdleUsed = Number(values.otherMin) > 0;
  const otherDefectUsed = (cleanSplit(values.rejectBreakdown).Other || 0) > 0;

  // What each idle / other-activity box may still take: whatever of the
  // Working Hours the others haven't used.
  const minutesBox = (key) => {
    const room = stoppageLimit === null ? 1440 : Math.min(1440, Math.max(0, stoppageLimit - (awayMin - (Number(values[key]) || 0))));
    return {
      max: room,
      onExceedMax: (max, typed) =>
        stoppageLimit === null
          ? warning("Minutes can't be more than 1440 (a day).")
          : notice(...stoppageNotice({ limitMin: stoppageLimit, totalMin: awayMin - (Number(values[key]) || 0) + typed, words: FA_WORDS })),
    };
  };

  // What a defect box may still take: whatever of Total QTY the others haven't used.
  const total = Number(values.actualQty) || 0;
  const defectsTyped = calc.totalDefect || 0;
  const defectRoom = (reason) => Math.max(0, total - (defectsTyped - (Number(values.rejectBreakdown?.[reason]) || 0)));

  // The time rule (End after Start) shows as soon as the times are picked;
  // everything else waits until Save has been pressed.
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

  // Picking a worker in a closed block opens its entry fields straight away.
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

  const incompleteBadge = isSubmit && errorCount > 0 && (
    <span className="badge bg-danger-subtle text-danger">
      Incomplete — {errorCount} field{errorCount === 1 ? "" : "s"} need{errorCount === 1 ? "s" : ""} attention
    </span>
  );

  // Collapsed: just the worker and its "+".
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
          <Field label={L.worker} required error={err("machine")} cols={{ xs: 8, sm: 6, lg: 4 }} fieldKey="machine">
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
                  ? `No workers yet — assign them to ${L.sheet} in Production › Operators.`
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
            <Field label={L.worker} required error={err("machine")} fieldKey="machine">
              {workerSelect}
            </Field>
            <Field label={L.workingStatus} error={err("workingMode")} fieldKey="workingMode">
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
              <Field label={L.reasons} error={err("machineStatus")} fieldKey="machineStatus">
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
                  <b>Non Working</b> — no work that day, so nothing else is needed. Pick a reason if you like and press Save.
                </>
              ) : (
                <>
                  <b>{values.workingStatus}</b> — no work that day, so only Date, {L.worker} and {L.workingStatus} are saved (and {L.remarks}, if filled in).
                </>
              )}
            </p>
          )}
        </Line>

        {!statusOnly && (
          <>
            <Line id={2} errors={errors} isSubmit={isSubmit} values={values}>
              <Row className="g-1">
                <Field label={L.itemName} required error={err("itemName")} cols={{ xs: 12, lg: showVendor ? 5 : 9 }} fieldKey="itemName">
                  <SearchablePartSelect
                    items={items}
                    value={values.item || ""}
                    itemName={values.itemName}
                    onSelect={(itemId) => onItemSelect(index, itemId)}
                    invalid={!!err("itemName")}
                    label={partCycleLabel}
                  />
                </Field>
                {showVendor && (
                  <Field label="Vendor Name" error={err("vendor")} cols={{ xs: 12, sm: 6, lg: 4 }} fieldKey="vendor">
                    <VendorSelect
                      vendors={vendors}
                      value={values.vendor || ""}
                      vendorName={values.vendorName}
                      onSelect={(vendorId) => onChange(index, "vendor", vendorId)}
                      invalid={!!err("vendor")}
                    />
                  </Field>
                )}
                <Field label={L.std} error={err("totalCycleSec")} cols={{ xs: 12, sm: 6, lg: 3 }} fieldKey="totalCycleSec">
                  <NumberInput name="totalCycleSec" value={values.totalCycleSec} onChange={handle} invalid={!!err("totalCycleSec")} placeholder="Optional" />
                  {!err("totalCycleSec") && (
                    <p className="text-muted small mb-0 mt-1">
                      {partCycle !== null && Number(values.totalCycleSec) !== partCycle
                        ? `Part's usual: ${fmtNum(partCycle)} sec`
                        : values.totalCycleSec === "" || values.totalCycleSec === undefined
                          ? "Blank (e.g. PACKING): no Ideal, Effective 0"
                          : ""}
                    </p>
                  )}
                </Field>
              </Row>
            </Line>

            <Line id={3} errors={errors} isSubmit={isSubmit} values={values}>
              <Row className="g-1">
                <Field label={L.start} required error={err("machineOnTime")} cols={THIRD} fieldKey="machineOnTime">
                  <TimePicker name="machineOnTime" value={values.machineOnTime} onChange={handle} hasError={!!err("machineOnTime")} />
                </Field>
                <Field label={L.end} required error={err("machineOffTime")} cols={THIRD} fieldKey="machineOffTime">
                  <TimePicker name="machineOffTime" value={values.machineOffTime} onChange={handle} hasError={!!err("machineOffTime")} minTime={endEarliest} />
                </Field>
                <Calc
                  label={L.hours}
                  value={calc.shiftHours === null || calc.shiftHours === undefined ? "" : `${hrs(calc.shiftHours)} (${hoursToHm(calc.shiftHours)})`}
                  cols={THIRD}
                  title={`${L.end} − ${L.start}`}
                />
              </Row>
              {booked.length > 0 && (
                <p className="text-muted small mb-1">
                  Already entered for this worker on this date: <b>{booked.join(", ")}</b> — overlapping times are fine on this sheet.
                </p>
              )}
            </Line>

            <Line id={5} errors={errors} isSubmit={isSubmit} values={values}>
              <Row className="g-1">
                <Field label={L.totalQty} required error={err("actualQty")} fieldKey="actualQty">
                  <NumberInput name="actualQty" value={values.actualQty} onChange={handle} decimals={false} invalid={!!err("actualQty")} />
                </Field>
                <Calc label={L.idealQty} value={fmtNum(calc.idealQty)} title={`${L.hours} × 3600 ÷ Standard Time — not rounded down`} />
                <Calc label={L.idealQtyPerHour} value={fmtNum(calc.idealQtyPerHour)} title="3600 ÷ Standard Time" />
                <Calc label={L.effective} value={hrs(calc.effectiveHours)} title={`${L.totalQty} × Standard Time ÷ 3600 — 0 without a Standard Time`} />
              </Row>
              <div data-field="rejectBreakdown">
                <Row className="g-1">
                  {FA_DEFECT_REASONS.map((reason) => (
                    <Field key={reason} label={`${reason} (Qty)`} cols={QUARTER}>
                      <NumberInput
                        name={reason}
                        value={values.rejectBreakdown?.[reason] ?? ""}
                        onChange={(e) => onRejectChange(index, reason, e.target.value)}
                        decimals={false}
                        invalid={!!err("rejectBreakdown")}
                        max={values.actualQty === "" || values.actualQty === undefined ? undefined : defectRoom(reason)}
                        onExceedMax={() => warning(`${L.defects} can't add up to more than ${L.totalQty} (${fmtNum(total)}).`)}
                      />
                    </Field>
                  ))}
                </Row>
                {err("rejectBreakdown") && <p className="text-danger mb-1 small">{err("rejectBreakdown")}</p>}
              </div>
              <Row className="g-1">
                <Calc label={L.totalDefects} value={fmtNum(calc.totalDefect)} cols={{ xs: 6, lg: 3 }} title={FA_DEFECT_REASONS.join(" + ")} />
                <Calc label={L.okQty} value={fmtNum(calc.okQty)} cols={{ xs: 6, lg: 3 }} title={`${L.totalQty} − ${L.totalDefects}`} />
              </Row>
              {otherDefectUsed && (
                <Row className="g-1">
                  <Field label="Remark for “Other” defects" required error={err("rejectOtherRemark")} cols={FULL} fieldKey="rejectOtherRemark">
                    <Input
                      type="textarea"
                      bsSize="sm"
                      name="rejectOtherRemark"
                      value={values.rejectOtherRemark || ""}
                      onChange={handle}
                      maxLength={300}
                      placeholder="What were the “Other” defects?"
                      invalid={!!err("rejectOtherRemark")}
                      style={{ height: "52px" }}
                    />
                  </Field>
                </Row>
              )}
              <OeeCheck calc={oeeCalc} over={overMetrics} />
            </Line>

            <Line id={6} errors={errors} isSubmit={isSubmit} values={values} optional>
              <Row className="g-1">
                <Field label={L.otherActivity} required={Number(values.otherActivityMin) > 0} error={err("otherActivity")} cols={{ xs: 12, lg: 8 }} fieldKey="otherActivity">
                  <Input
                    type="text"
                    bsSize="sm"
                    name="otherActivity"
                    value={values.otherActivity || ""}
                    onChange={handle}
                    maxLength={200}
                    placeholder="e.g. Material Shifting"
                    invalid={!!err("otherActivity")}
                  />
                </Field>
                <Field label={L.otherActivityMin} error={err("otherActivityMin")} cols={{ xs: 12, lg: 4 }} fieldKey="otherActivityMin">
                  <NumberInput name="otherActivityMin" value={values.otherActivityMin} onChange={handle} decimals={false} invalid={!!err("otherActivityMin")} {...minutesBox("otherActivityMin")} />
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
                    <p className={`mb-0 small mt-1 ${plannedBelowShift ? "text-danger" : "text-muted"}`}>
                      {plannedBelowShift
                        ? `Can't be less than the ${L.hours} (${hoursToHm(shiftMin / 60)}).`
                        : planned !== null
                          ? `= ${hoursToHm(planned)} hr`
                          : `Type hours — 1.5 is 1 h 30 min. The same as the ${L.hours} gives the sheet's own figures.`}
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
                <Field label={L.lunchMin} error={err("lunchMin")} cols={THIRD} fieldKey="lunchMin">
                  <NumberInput name="lunchMin" value={values.lunchMin} onChange={handle} decimals={false} invalid={!!err("lunchMin")} {...minutesBox("lunchMin")} />
                </Field>
                <Calc
                  label="Idle + Other Activity Allowed (min)"
                  value={stoppageLimit === null ? "" : String(stoppageLimit)}
                  cols={THIRD}
                  title={`The ${L.hours} in minutes: the most Idle Time and Other Activity together can add up to`}
                />
              </Row>
            </Line>

            <Line id={8} errors={errors} isSubmit={isSubmit} values={values} optional>
              <Row className="g-1">
                <Field label={L.otherMin} error={err("otherMin")} cols={THIRD} fieldKey="otherMin">
                  <NumberInput name="otherMin" value={values.otherMin} onChange={handle} decimals={false} invalid={!!err("otherMin")} {...minutesBox("otherMin")} />
                </Field>
                <Calc label={L.totalIdle} value={fmtNum(calc.totalStoppageMin) || "0"} cols={THIRD} title="Lunch / Tea / Washroom + Other" />
              </Row>
              <div className="mb-2 small" data-field="stoppageTotal">
                <span className="text-muted">Idle + Other Activity: </span>
                <span className={overAway ? "text-danger fw-semibold" : "fw-semibold"}>{fmtNum(awayMin) || 0} min</span>
                <span className="text-muted">
                  {stoppageLimit === null ? " — enter Start / End Time to see the allowance" : ` of ${stoppageLimit} min allowed`}
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
            <Label htmlFor={`remarks-${index}`} className={labelClass}>{L.remarks}</Label>
            <Input
              id={`remarks-${index}`}
              type="textarea"
              bsSize="sm"
              name="remarks"
              value={values.remarks}
              onChange={handle}
              maxLength={500}
              placeholder="e.g. helpers: AMIT, DILIP"
              style={{ height: "60px" }}
            />
          </div>
        </Line>
      </div>
    </div>
  );
};

const FinalAssemblyEntryForm = ({
  entries = [],
  errors = [],
  isSubmit = false,
  focusTarget = null,
  workers = [],
  items = [],
  vendors = [],
  isEdit = false,
  booked = [],
  plannedLocks = [],
  savedRows = [],
  onChange,
  onItemSelect,
  onRejectChange,
  onAdd,
  onRemove,
}) => {
  // Only one block is ever open at a time. Editing shows a single block,
  // always open. "Add Entry" with a worker already chosen opens that block.
  const [expandedIndex, setExpandedIndex] = useState(() => {
    if (isEdit) return 0;
    const first = entries.findIndex((v) => v.machine);
    return first === -1 ? null : first;
  });

  // One scroll owned by the parent, not one independent effect per block.
  const blockRefs = useRef({});
  const lastExpandedRef = useRef(expandedIndex);
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

  const removeBlock = (i) => {
    setExpandedIndex((open) => (open === null || open < i ? open : open === i ? null : open - 1));
    onRemove(i);
  };

  // "Add another entry": once the new block is on screen, scroll to it and put
  // the cursor in its worker box.
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
          vendors={vendors}
          isEdit={isEdit}
          canRemove={!isEdit && entries.length > 1}
          expanded={isEdit || expandedIndex === i}
          booked={booked[i] || []}
          plannedLock={plannedLocks[i] || null}
          savedRows={savedRows}
          onExpand={setExpandedIndex}
          onChange={onChange}
          onItemSelect={onItemSelect}
          onRejectChange={onRejectChange}
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

export default FinalAssemblyEntryForm;
