// The server's day OEE figures (dayOeeFor, utils/oeeMetrics.js) against the
// browser's own (every sheet's xxxDayCalc in client/src/utils): the same rows
// run through both must give the same figures — this is what decides which
// entries go to Admin review, so the two can't drift:
//   node --test utils/dayOee.test.js
// The client's ES modules are bundled in memory with the client's own esbuild;
// the test is skipped where the client isn't installed.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { dayOeeFor, SHEET_DAY } = require("./oeeMetrics");

const CLIENT = path.join(__dirname, "..", "..", "client");
let esbuild = null;
try {
  esbuild = require(path.join(CLIENT, "node_modules", "esbuild"));
} catch {
  /* client not installed */
}

// Each sheet's client function that works its rows out (one result per row, sortByMachineOn order).
const CLIENT_DAY = {
  cnc: ["productionSheet", "dayCalc", {}],
  vmc: ["vmcSheet", "vmcDayCalc", {}],
  spm: ["spmSheet", "spmDayCalc", {}],
  rivet: ["rivetSheet", "rivetDayCalc", {}],
  press: ["pressSheet", "pressDayCalc", {}],
  contact: ["contactSheet", "contactDayCalc", {}],
  trobe: ["trobeSheet", "trobeDayCalc", {}],
  spring: ["springSheet", "springDayCalc", {}],
  powder: ["powderCoatingSheet", "powderDayCalc", {}],
  rubber: ["rubberSheet", "rubberDayCalc", {}],
  injection: ["injectionSheet", "injectionDayCalc", {}],
  embossing: ["embossingSheet", "embossingDayCalc", {}],
  bpc: ["bpcSheet", "bpcDayCalc", {}],
  printing: ["printingSheet", "printingDayCalc", {}],
  finalAssembly: ["finalAssemblySheet", "faDayCalc", {}],
  rawCasting: ["rawCastingSheet", "rawCastingDayCalc", {}],
  mfd: ["mfdSheet", "mfdDayCalc", {}],
  mfa: ["mfaSheet", "mfaDayCalc", {}],
};

const loadClient = async () => {
  const names = [...new Set(Object.values(CLIENT_DAY).map(([file]) => file))];
  const contents = names.map((file) => `export * as ${file} from ${JSON.stringify(path.join(CLIENT, "src", "utils", file + ".js"))};`).join("\n");
  const out = await esbuild.build({ stdin: { contents, resolveDir: CLIENT, loader: "js" }, bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
};

// A row as the server stores it, with the fields each sheet's cycle time reads.
const base = (o) => ({
  itemName: "Part",
  plannedOperatorShiftHours: 4,
  totalCycleSec: 45,
  lunchMin: 0,
  ...o,
});
const forSheet = (sheet, row) => {
  const r = { ...row };
  if (sheet === "vmc") Object.assign(r, { programTimeMin: 3, pcsPerProgram: 4 });
  if (sheet === "press") Object.assign(r, { standardTimeMin: 3, pcsPerStandardTime: 4 });
  if (sheet === "spm") Object.assign(r, { loadingSec: 5, excludedOps: ["loadingSec"] });
  if (sheet === "rivet") Object.assign(r, { rivetLoadingSec: 5, excludedOps: ["rivetLoadingSec"] });
  if (sheet === "printing") Object.assign(r, { askQueryQcMin: 7, stockCountingMin: 4 });
  if (sheet === "powder") Object.assign(r, { otherActivityMin: 12, lessCoatingQty: 3, okQty: r.actualQty - 3, rejectedQty: 3 });
  if (["rawCasting", "mfa", "finalAssembly"].includes(sheet)) Object.assign(r, { otherActivityMin: 9 });
  return r;
};

// Days of rows, each with a different shape: three entries with lunch / setup / downtime,
// a day with a locked Planned Operator Shift (12 h counted once), a lone entry, and a day
// with a non-working entry and one without an item.
const DAYS = {
  "three entries": [
    { _id: "a", machineOnTime: "08:00", machineOffTime: "12:00", plannedOperatorShiftHours: 4.5, lunchMin: 30, setupMin: 20, actualQty: 380, okQty: 372, rejectedQty: 8 },
    { _id: "b", machineOnTime: "13:00", machineOffTime: "16:30", plannedOperatorShiftHours: 3.5, bdMechMin: 25, otherMin: 5, actualQty: 301, okQty: 301 },
    { _id: "c", machineOnTime: "17:00", machineOffTime: "19:00", plannedOperatorShiftHours: 2, noManPowerMin: 10, actualQty: 170, okQty: 168 },
  ],
  "locked 12 h day": [
    { _id: "a", machineOnTime: "08:00", machineOffTime: "12:00", plannedOperatorShiftHours: 12, plannedLocked: true, lunchMin: 30, actualQty: 300, okQty: 295 },
    { _id: "b", machineOnTime: "13:00", machineOffTime: "17:00", plannedOperatorShiftHours: 12, plannedLocked: true, setupMin: 15, actualQty: 330, okQty: 330 },
    { _id: "c", machineOnTime: "17:30", machineOffTime: "19:00", plannedOperatorShiftHours: 1.5, actualQty: 120, okQty: 119 },
  ],
  "one entry over": [{ _id: "a", machineOnTime: "09:00", machineOffTime: "12:00", plannedOperatorShiftHours: 3, actualQty: 290, okQty: 285 }],
  "non working and no part": [
    { _id: "a", machineOnTime: "08:00", machineOffTime: "10:00", plannedOperatorShiftHours: 2, actualQty: 150, okQty: 150 },
    { _id: "b", workingMode: "Non Working" },
    { _id: "c", itemName: "", machineOnTime: "11:00", machineOffTime: "13:00", plannedOperatorShiftHours: 2, lunchMin: 15, actualQty: 10, okQty: 10 },
  ],
};

const near = (a, b, msg) => {
  if (a === null || b === null || a === undefined || b === undefined) return assert.equal(a ?? null, b ?? null, msg);
  assert.ok(Math.abs(a - b) < 1e-9, `${msg}: server ${a} ≠ client ${b}`);
};

test("every sheet: the server's day OEE figures are the browser's", { skip: !esbuild && "client not installed" }, async () => {
  const client = await loadClient();
  let compared = 0;
  let nonNull = 0;
  for (const [sheet, [file, fn, options]] of Object.entries(CLIENT_DAY)) {
    for (const [dayName, rows] of Object.entries(DAYS)) {
      const stored = rows.map((r) => forSheet(sheet, base(r)));
      // Results line up with the client's own sort order; match them back by _id.
      const sortedRows = client.productionSheet.sortByMachineOn(stored);
      const results = client[file][fn](sortedRows, options);
      sortedRows.forEach((row, i) => {
        const server = dayOeeFor(sheet, row, stored);
        assert.deepEqual(Object.keys(server), SHEET_DAY[sheet].figures, `${sheet}: the sheet's figures`);
        for (const key of SHEET_DAY[sheet].figures) {
          near(server[key], results[i][key], `${sheet} / ${dayName} / entry ${row._id} / ${key}`);
          compared += 1;
          if (server[key] !== null) nonNull += 1;
        }
      });
    }
  }
  assert.ok(compared > 200, `only ${compared} figures compared`);
  assert.ok(nonNull > compared / 2, "most figures are real numbers, not blanks");
});
