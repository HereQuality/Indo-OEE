/**
 * seed/verifyPaperExamples.mjs
 * ──────────────────────────────
 * Read-only check of what seed/seedPaperExamples.js loaded. Each sheet's May
 * 2024 entries are read back through its controller's getSheet, the same call
 * the Data Entry list makes. Each entry's figures are then worked out with the
 * client's own adapters (printingDayCalc / injectionDayCalc / bpcDayCalc, which
 * wrap entryDayCalc) and compared with the paper's OEE and Unreported Time in
 * client/src/utils/paperSheets.test.mjs, the same way that test compares them.
 *
 * LOCAL DATABASE ONLY, and it writes nothing.
 *
 *   node seed/verifyPaperExamples.mjs
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = path.resolve(SERVER, "../client");
const require = createRequire(path.join(SERVER, "package.json"));
require("dotenv").config({ path: path.join(SERVER, ".env") });

const LOCAL = /^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;
const uri = process.env.MONGO_URI || "";
if (!LOCAL.test(uri)) {
  console.error("Refusing to run: MONGO_URI in server/.env must be a local database (mongodb://localhost or mongodb://127.0.0.1)");
  process.exit(1);
}

const mongoose = require("mongoose");
const User = require(path.join(SERVER, "models/user.model"));
const SHEETS = [
  { key: "printing", name: "PRINTING", controller: require(path.join(SERVER, "controllers/printingSheet.controller")) },
  { key: "injection", name: "INJECTION MOULDING", controller: require(path.join(SERVER, "controllers/injectionSheet.controller")) },
  { key: "bpc", name: "BEFORE POWDER COATING", controller: require(path.join(SERVER, "controllers/bpcSheet.controller")) },
];

// The client adapters use the bundler's extensionless imports, so they are
// bundled in memory with the client's own esbuild, as its tests are.
const esbuild = createRequire(path.join(CLIENT, "package.json"))("esbuild");
const bundle = await esbuild.build({
  stdin: {
    contents: [
      'export { printingDayCalc, printingRowCalc } from "./printingSheet";',
      'export { injectionDayCalc, injectionRowCalc } from "./injectionSheet";',
      'export { bpcDayCalc, bpcRowCalc } from "./bpcSheet";',
      'export { sortByMachineOn } from "./productionSheet";',
    ].join("\n"),
    resolveDir: path.join(CLIENT, "src/utils"),
    loader: "js",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "warning",
});
const calc = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const DAY_CALC = { printing: calc.printingDayCalc, injection: calc.injectionDayCalc, bpc: calc.bpcDayCalc };
const ROW_CALC = { printing: calc.printingRowCalc, injection: calc.injectionRowCalc, bpc: calc.bpcRowCalc };

// The paper's figures, as paperSheets.test.mjs holds them.
const testSource = fs.readFileSync(path.join(CLIENT, "src/utils/paperSheets.test.mjs"), "utf8");
const paperMatch = /const SHEETS = (\{.*?\});\n/s.exec(testSource);
if (!paperMatch) throw new Error("No SHEETS in client/src/utils/paperSheets.test.mjs");
const PAPER = JSON.parse(paperMatch[1]);

const keyOf = (on, off, std, total) => `${on}|${off}|${std}|${total}`;
const pct = (v) => Math.round(v * 10000) / 100;

const call = async (handler, req) => {
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  await handler({ headers: {}, cookies: {}, params: {}, body: {}, ...req }, res);
  return res;
};

await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
if (!["127.0.0.1", "localhost"].includes(mongoose.connection.host)) {
  console.error("Not a local database — stopping");
  process.exit(1);
}
const user = await User.findOne({ roleType: "SuperAdmin", isActive: { $ne: false } }).select("-password");

let failures = 0;
for (const sheet of SHEETS) {
  // Every page of May 2024, as the list shows it.
  const rows = [];
  for (let page = 1, total = 1; page <= total; page += 1) {
    const res = await call(sheet.controller.getSheet, { user, query: { from: "2024-05-01", to: "2024-05-31", page: String(page) } });
    if (res.statusCode !== 200) throw new Error(`${sheet.name} getSheet: ${res.payload?.message}`);
    rows.push(...res.payload.data);
    total = res.payload.meta.totalPages;
  }

  // Each operator's (or machine's) date is worked out together, as the list does.
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.date}|${r.machine}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const figures = new Map();
  for (const group of groups.values()) {
    const sorted = calc.sortByMachineOn(group);
    DAY_CALC[sheet.key](group).forEach((d, i) => figures.set(sorted[i]._id, d));
  }

  const paperByKey = new Map();
  for (const p of PAPER[sheet.key]) {
    const k = keyOf(p.row.on, p.row.off, p.row.std, p.row.total);
    if (paperByKey.has(k)) throw new Error(`${sheet.name}: two paper rows share ${k}`);
    paperByKey.set(k, p);
  }

  const matched = new Set();
  const problems = [];
  let good = 0;
  for (const r of rows) {
    const k = keyOf(r.machineOnTime, r.machineOffTime, r.totalCycleSec, r.actualQty);
    const p = paperByKey.get(k);
    const who = `${r.date} ${r.operator || ""} ${r.machineOnTime}–${r.machineOffTime} ${r.itemName}`;
    if (!p) {
      problems.push(`${who}: no paper row with these times / Standard Time / TOTAL`);
      continue;
    }
    matched.add(k);
    const d = figures.get(r._id);
    const issues = [];
    const oee = [d.oeeLosses, d.oeeLunch, d.oeeLunchCot].slice(0, p.paper.oee.length).map(pct);
    if (JSON.stringify(oee) !== JSON.stringify(p.paper.oee)) issues.push(`OEE ${oee.join(" / ")} vs paper ${p.paper.oee.join(" / ")}`);
    const dp = p.paper.unrepDp ?? 6;
    if (Number(d.unreportedMin.toFixed(dp)) !== Number(p.paper.unrep.toFixed(dp))) {
      issues.push(`Unreported ${d.unreportedMin.toFixed(dp)} vs paper ${p.paper.unrep}`);
    }
    if (p.paper.eff !== undefined) {
      const eff = ROW_CALC[sheet.key](r).effectiveHours ?? 0;
      if (Math.abs(eff - p.paper.eff) > 1e-6) issues.push(`Effective ${eff} vs paper ${p.paper.eff}`);
    }
    if (r.plannedLocked !== false) issues.push("Planned shift came from the lock");
    const shiftMin = Number(r.machineOffTime.slice(0, 2)) * 60 + Number(r.machineOffTime.slice(3)) - (Number(r.machineOnTime.slice(0, 2)) * 60 + Number(r.machineOnTime.slice(3)));
    if (Math.round(r.plannedOperatorShiftHours * 60) !== shiftMin) issues.push(`Planned ${r.plannedOperatorShiftHours} h is not the Machine Shift`);
    if (issues.length) problems.push(`${who}: ${issues.join("; ")}`);
    else good += 1;
  }
  const notSaved = PAPER[sheet.key].filter((p) => !matched.has(keyOf(p.row.on, p.row.off, p.row.std, p.row.total)));

  failures += problems.length;
  console.log(`\n${sheet.name}: ${rows.length} entries in May 2024 — ${good} match the paper exactly (OEE and Unreported Time)`);
  for (const line of problems) console.log(`  ✗ ${line}`);
  if (notSaved.length) {
    console.log(`  Paper rows with no saved entry: ${notSaved.length}`);
    for (const p of notSaved) console.log(`    - ${p.row.on}–${p.row.off}, Standard Time ${p.row.std ?? "blank"}, TOTAL ${p.row.total}`);
  }
}

await mongoose.disconnect();
console.log(failures ? `\n${failures} saved entr${failures === 1 ? "y differs" : "ies differ"} from the paper` : "\nEvery saved entry matches the paper.");
process.exit(failures ? 1 : 0);
