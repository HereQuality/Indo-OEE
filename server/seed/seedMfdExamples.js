"use strict";
/**
 * seed/seedMfdExamples.js
 * ─────────────────────────
 * Loads the MODULAR FRAME DRILLING paper sheet's 19 example entries (10–13 May
 * 2024) into the LOCAL database, through the sheet's own save path
 * (controllers/mfdSheet.controller.js saveRow) as the local Super Admin — so
 * every rule, the derived Rejected Quantity, the A/P/Q figures, OEE Review and
 * the audit log are exactly what the form would produce.
 *
 *  - Creates, if missing, under MODULAR FRAME DRILLING: machines 4/A, 4/B, 4/E,
 *    5/B, M/17 (through Machine Master's own create, so they're numbered at the
 *    end); operators VISHAL, LILABEN, PRATIKSHA, BHURABHAI, MEENA (the paper
 *    spells LILABEN once as "LIALBEN" — taken as LILABEN); and one part per
 *    distinct Part Name + Process, with Drawing No., holes, stroke and Total
 *    Cycle Time from that pair's first row (the paper's "DRRILL/CHAM" is the
 *    Part's DRILL/CHAM). Each entry still carries its own paper cycle time.
 *  - The paper has no Planned column, so the process's planned-shift lock is
 *    turned OFF while loading and each entry's Planned is typed = its Machine
 *    Shift; the lock is put back as it was afterwards, whatever happens.
 *  - Re-runnable: an entry already saved for the same date + machine + Machine
 *    Time ON is skipped.
 *
 * Refuses to run against anything but a local MongoDB (127.0.0.1 / localhost):
 * these are example rows, never for the live database.
 *
 *   node seed/seedMfdExamples.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Process = require("../models/Process");
const Machine = require("../models/Machine");
const MachineOperator = require("../models/MachineOperator");
const Item = require("../models/Item");
const User = require("../models/user.model");
const MfdEntry = require("../models/MfdEntry");
const { MFD_OPERATIONS } = require("../models/Item");
const { STOPPAGE_KEYS } = require("../models/ProductionEntry");
const { createMachine } = require("../controllers/machine.controller");
const { createMachineOperator } = require("../controllers/machineOperator.controller");
const { createItem } = require("../controllers/item.controller");
const { saveRow } = require("../controllers/mfdSheet.controller");

const PROCESS_NAME = "MODULAR FRAME DRILLING";

// The paper sheet, in its own order: [Date, MC NO., Operator, Part Name,
// Drawing No., Process, No. of Holes, Stroke Required, Total Cycle Time (s),
// Machine Time ON, OFF, ACTUAL OK, Rejected, downtime (min)].
const PAPER = [
  ["10-05-2024", "4/B", "VISHAL", "24 PIN FRAME BIG", "IE0726", "DRILLING", 1, 1, 20, "14:50", "15:25", 75, 0, {}],
  ["10-05-2024", "4/B", "VISHAL", "24 PIN FRAME BIG", "IE0726", "DRILLING", 2, 2, 50, "08:15", "18:55", 99, 0, { materialShiftingMin: 115, lunchMin: 30 }],
  ["10-05-2024", "4/A", "LIALBEN", "24 PIN FRAME", "", "DRILLING", 2, 2, 22, "08:15", "12:00", 462, 0, {}],
  ["10-05-2024", "4/A", "PRATIKSHA", "24 PIN FRAME", "", "DRILLING", 2, 2, 23, "11:00", "18:00", 946, 0, { lunchMin: 30 }],
  ["10-05-2024", "5/B", "LILABEN", "24 PIN FRAME", "", "TAPPING", 4, 4, 35, "16:05", "18:55", 215, 0, {}],
  ["10-05-2024", "4/E", "BHURABHAI", "DUST COVER CLAMP", "IE0117", "DRILLING", 2, 2, 35, "08:15", "18:00", 900, 0, { lunchMin: 30 }],
  ["10-05-2024", "M/17", "MEENA", "3 PIN HOOD S/E,PG-11S/C MS,AND T/E,PG13.5 S/C,MS", "IE0019/IE0020", "DRILLING", 1, 1, 51, "08:00", "19:00", 666, 0, { lunchMin: 30 }],
  ["11-05-2024", "4/B", "VISHAL", "6 PIN FRAME", "", "DRILLING", 2, 2, 20, "18:15", "19:25", 162, 3, {}],
  ["11-05-2024", "4/E", "BHURABHAI", "DUST COVER CLAMP", "IE0117", "DRILLING", 2, 2, 36, "15:40", "18:00", 140, 7, {}],
  ["11-05-2024", "5/B", "LILABEN", "24 PIN FRAME", "", "TAPPING", 4, 4, 62, "08:15", "15:45", 322, 0, { lunchMin: 30 }],
  ["11-05-2024", "4/E", "BHURABHAI", "8 PIN B/O, D/C,P/C", "IE0003", "DRILLING", 4, 4, 20, "14:40", "15:40", 123, 0, {}],
  ["11-05-2024", "4/E", "BHURABHAI", "DUST COVER CLAMP", "IE0117", "DRILLING", 2, 2, 4, "08:10", "09:00", 697, 0, {}],
  ["11-05-2024", "M/17", "MEENA", "3 PIN HOOD S/E,PG-11,S/C,MS", "IE0019", "DRILLING", 1, 1, 56, "08:10", "18:45", 600, 0, { lunchMin: 30 }],
  ["11-05-2024", "4/A", "PRATIKSHA", "3 PIN B/O,S/C MS", "IE0001", "DRILLING", 4, 4, 15, "12:30", "18:00", 1180, 0, {}],
  ["11-05-2024", "4/A", "PRATIKSHA", "24 PIN FRAME", "", "DRILLING", 4, 4, 35, "08:10", "11:55", 311, 0, {}],
  ["13-05-2024", "4/A", "PRATIKSHA", "3 PIN B/O,D/C MS", "IE0001", "DRILLING", 2, 2, 12, "08:10", "08:30", 67, 0, {}],
  ["13-05-2024", "4/A", "PRATIKSHA", "24 PIN B/C,L/VCLAMP,HOLE 1S/E", "IE0307/A", "DRILLING", 4, 4, 15, "11:40", "12:00", 25, 0, {}],
  ["13-05-2024", "4/E", "BHURABHAI", "DUST COVER CLAMP", "IE0117", "DRRILL/CHAM", 2, 2, 47, "08:10", "15:00", 425, 5, { lunchMin: 30 }],
  ["13-05-2024", "4/E", "BHURABHAI", "DUST COVER CLAMP", "IE0117", "DRILLING", 2, 2, 45, "15:00", "17:30", 130, 13, {}],
];

const MACHINES = ["4/A", "4/B", "4/E", "5/B", "M/17"];
const OPERATOR_NAMES = { LIALBEN: "LILABEN" };
const OPERATION_NAMES = { "DRRILL/CHAM": "DRILL/CHAM" };
const operatorOf = (name) => OPERATOR_NAMES[name] || name;
const operationOf = (name) => OPERATION_NAMES[name] || name;

const isoOf = (dmy) => dmy.split("-").reverse().join("-");
const minutesOf = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sameName = (name) => ({ $regex: `^${escapeRe(name)}$`, $options: "i" });

// A controller called the way Express would, its reply caught.
const callApi = async (handler, req) => {
  const res = {
    statusCode: 200,
    payload: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(p) {
      this.payload = p;
      return this;
    },
  };
  await handler({ query: {}, params: {}, ...req }, res);
  return res;
};

const assertLocal = () => {
  const uri = process.env.MONGO_URI || "";
  const host = (() => {
    try {
      return new URL(uri.replace(/^mongodb(\+srv)?:/, "http:")).hostname;
    } catch {
      return "";
    }
  })();
  if (/^mongodb\+srv:/.test(uri) || !["127.0.0.1", "localhost"].includes(host)) {
    throw new Error("Refusing to load example entries: MONGO_URI is not a local MongoDB (127.0.0.1 / localhost).");
  }
};

async function run() {
  assertLocal();
  await connectDB();

  const user = await User.findOne({ roleType: "SuperAdmin" });
  if (!user) throw new Error("No Super Admin user in this database");
  const proc = await Process.findOne({ processName: PROCESS_NAME });
  if (!proc) throw new Error(`No "${PROCESS_NAME}" process — run seed/seedMfdProcess.js first`);
  const report = { machinesCreated: [], operatorsCreated: [], operatorsLinked: [], partsCreated: [], saved: 0, skipped: [], failed: [], notes: [] };

  // ── Machines ────────────────────────────────────────────────────────────
  const machineId = {};
  for (const name of MACHINES) {
    let m = await Machine.findOne({ isDeleted: { $ne: true }, machineName: sameName(name) }).lean();
    if (!m) {
      const res = await callApi(createMachine, { user, body: { machineName: name, isActive: true, process: String(proc._id) } });
      if (res.statusCode !== 201) throw new Error(`Machine ${name}: ${res.payload?.message}`);
      m = res.payload.data;
      report.machinesCreated.push(name);
    } else if (String(m.process || "") !== String(proc._id)) {
      throw new Error(`Machine ${name} already exists in another process — not moving it; fix it in Machine Master first`);
    }
    machineId[name] = String(m._id);
  }

  // ── Operators ───────────────────────────────────────────────────────────
  for (const name of [...new Set(PAPER.map((r) => operatorOf(r[2])))]) {
    const o = await MachineOperator.findOne({ name: sameName(name), isActive: true }).lean();
    if (!o) {
      const res = await callApi(createMachineOperator, { user, body: { name, processes: [String(proc._id)], isActive: true } });
      if (res.statusCode >= 300) throw new Error(`Operator ${name}: ${res.payload?.message}`);
      report.operatorsCreated.push(name);
    } else if ((o.processes || []).length && !o.processes.some((p) => String(p) === String(proc._id))) {
      // Offered only on its processes' machines: add this one too.
      await MachineOperator.updateOne({ _id: o._id }, { $addToSet: { processes: proc._id } });
      report.operatorsLinked.push(name);
    }
  }
  if (PAPER.some((r) => r[2] !== operatorOf(r[2]))) report.notes.push('"LIALBEN" on the paper is saved as LILABEN');

  // ── Parts: one per Part Name + Process, from that pair's first row ──────
  const partOf = {};
  for (const r of PAPER) {
    const [, , , itemName, drawingNo, process, holes, stroke, cycle] = r;
    const operation = operationOf(process);
    if (!MFD_OPERATIONS.includes(operation)) throw new Error(`Unknown Process "${process}"`);
    const key = `${itemName}|${operation}`;
    if (partOf[key]) continue;
    let it = await Item.findOne({ process: proc._id, itemName, mfdOperation: operation }).lean();
    if (!it) {
      const res = await callApi(createItem, {
        user,
        body: { itemName, drawingNo, setupNo: "", process: String(proc._id), mfdOperation: operation, noOfHoles: holes, strokeRequired: stroke, totalCycleSec: cycle, isActive: true },
      });
      if (res.statusCode !== 201) throw new Error(`Part ${itemName} (${operation}): ${res.payload?.message}`);
      it = res.payload.data;
      report.partsCreated.push(`${itemName} — ${operation} (holes ${holes}, stroke ${stroke}, ${cycle} s${drawingNo ? `, ${drawingNo}` : ", no Drawing No."})`);
    }
    partOf[key] = it;
  }
  if (PAPER.some((r) => r[5] !== operationOf(r[5]))) report.notes.push('Process "DRRILL/CHAM" on the paper is the Part\'s DRILL/CHAM');

  // ── Entries, through saveRow, with the planned-shift lock off meanwhile ──
  const lockBefore = proc.plannedShiftLocked;
  await Process.updateOne({ _id: proc._id }, { $set: { plannedShiftLocked: false } });
  try {
    for (const r of PAPER) {
      const [dmy, mc, operator, itemName, , process, holes, stroke, cycle, on, off, ok, rej, stops] = r;
      const date = isoOf(dmy);
      const machine = machineId[mc];
      const label = `${dmy} ${mc} ${on}–${off}`;
      if (await MfdEntry.exists({ date: new Date(`${date}T00:00:00.000Z`), machine, machineOnTime: on })) {
        report.skipped.push(`${label} (already saved)`);
        continue;
      }
      const part = partOf[`${itemName}|${operationOf(process)}`];
      if (part.noOfHoles !== holes || part.strokeRequired !== stroke) {
        report.notes.push(`${label}: paper holes/stroke ${holes}/${stroke}, the Part's ${part.noOfHoles}/${part.strokeRequired} are shown`);
      }
      const shiftMin = minutesOf(off) - minutesOf(on);
      const body = {
        date,
        machine,
        slot: "auto",
        workingMode: "Working",
        machineStatus: [],
        operator: operatorOf(operator),
        item: String(part._id),
        vendor: null,
        // The Part's own figures, as the form copies them…
        itemName: part.itemName,
        drawingNo: part.drawingNo || "",
        operation: part.mfdOperation || "",
        noOfHoles: part.noOfHoles ?? "",
        strokeRequired: part.strokeRequired ?? "",
        // …and this entry's own Total Cycle Time from the paper.
        totalCycleSec: cycle,
        machineOnTime: on,
        machineOffTime: off,
        settingOnTime: "",
        settingOffTime: "",
        actualQty: ok + rej,
        okQty: ok,
        // Planned typed = the Machine Shift (the paper has no Planned column).
        plannedOperatorShiftHours: Number((shiftMin / 60).toFixed(6)),
        ...Object.fromEntries(STOPPAGE_KEYS.map((k) => [k, stops[k] ?? (k === "lunchMin" ? 0 : "")])),
        remarks: "",
        otherMinRemark: "",
      };
      const res = await callApi(saveRow, { user, body });
      if (res.statusCode === 200) report.saved += 1;
      else report.failed.push(`${label}: ${res.payload?.message}`);
    }
  } finally {
    await Process.updateOne({ _id: proc._id }, { $set: { plannedShiftLocked: lockBefore !== false } });
  }

  console.log(JSON.stringify({ ...report, lockRestoredTo: lockBefore !== false }, null, 2));
  await mongoose.connection.close();
  process.exit(report.failed.length ? 1 : 0);
}

run().catch(async (err) => {
  console.error(err.message || err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
