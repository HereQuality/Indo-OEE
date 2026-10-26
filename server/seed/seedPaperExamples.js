"use strict";
/**
 * seed/seedPaperExamples.js
 * ───────────────────────────
 * Loads the real paper-sheet example rows the user pasted on 2026-10-26 for the
 * three sheets that work every entry out on its own: PRINTING, INJECTION
 * MOULDING and BEFORE POWDER COATING. All of them are dated May 2024, so pick
 * May 2024 in each Data Entry list to see them.
 *
 * LOCAL DATABASE ONLY: it refuses to run unless MONGO_URI points at
 * mongodb://localhost or mongodb://127.0.0.1.
 *
 * Every entry goes through its sheet's own saveRow, the code the Data Entry
 * page's Save calls, so the stored fields are exactly what the app stores:
 * Rejected, Availability / Performance / Quality, the OEE review flag of an
 * entry over 100%, and the audit log. It runs as the local Super Admin, the
 * same as saving from the page while logged in as Super Admin.
 *
 *  1. Master data, only what is missing, through the Master pages' own
 *     controllers:
 *     - Operators (Operator Master), each assigned to its process.
 *     - Machines (Machine Master): INJECTION MOULDING's MC No. values, and
 *       PRINTING's optional MC No. values (M/C 12, M/C 2) under PRINTING.
 *     - Parts (Item Master): one per distinct Item Name per process, with the
 *       Standard Time per Piece of the first row using it. Every entry still
 *       carries its own paper Standard Time.
 *  2. Each process's Operator Planned Shift lock is switched OFF while the rows
 *     are saved, so every entry is saved with Planned Operator Shift = its own
 *     Machine Shift (the paper has no Planned column) and its figures are the
 *     paper's. The lock is put back to what it was afterwards, even when the
 *     run fails part-way.
 *  3. Rows that can't be loaded are reported, never forced in:
 *     - a Not Working day with no operator or machine (W.OFF);
 *     - anything saveRow refuses, with the server's own message.
 *
 * Safe to re-run: an entry already saved for the same date + operator (or
 * machine on INJECTION MOULDING) + Machine ON Time is skipped. PRINTING also
 * matches the Item Name, because its paper has one operator on two jobs that
 * both start at 10:30 on 14/05.
 *
 * How the paper cells are read (every point is checked against the row's own
 * totals while loading, and the run stops if a column doesn't add up):
 *  - Dates are DD/MM/YYYY, except BEFORE POWDER COATING's first row, written
 *    "05-10-2024", which is 10 May 2024 (MM-DD-YYYY).
 *  - "8:15" is 08:15 and "17:55:00" is 17:55.
 *  - Item Names are trimmed and runs of spaces closed up.
 *  - BEFORE POWDER COATING: the column after OK QTY is the hand-typed Rejected
 *    QTY. Then come the five reject reasons, and then their total. Where OK
 *    QTY is blank, OK = TOTAL − that Rejected QTY. The app always works
 *    Rejected out as TOTAL − OK.
 *
 *   node seed/seedPaperExamples.js
 *   node seed/verifyPaperExamples.mjs   (read-only check against the paper)
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

const Process = require("../models/Process");
const MachineOperator = require("../models/MachineOperator");
const Machine = require("../models/Machine");
const Item = require("../models/Item");
const User = require("../models/user.model");
const PrintingEntry = require("../models/PrintingEntry");
const InjectionEntry = require("../models/InjectionEntry");
const BeforePowderCoatingEntry = require("../models/BeforePowderCoatingEntry");
const { STOPPAGE_KEYS } = require("../models/ProductionEntry");
const { PRINTING_STOPPAGE_KEYS } = PrintingEntry;
const { BPC_STOPPAGE_KEYS, BPC_REJECT_REASONS } = BeforePowderCoatingEntry;

const printingSheet = require("../controllers/printingSheet.controller");
const injectionSheet = require("../controllers/injectionSheet.controller");
const bpcSheet = require("../controllers/bpcSheet.controller");
const machineOperatorController = require("../controllers/machineOperator.controller");
const machineController = require("../controllers/machine.controller");
const itemController = require("../controllers/item.controller");

const LOCAL = /^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;

// ── The paper rows, cell for cell as pasted (trailing blank cells dropped) ──

// PRINTING's header row — its thirteen downtime columns are mapped by name below.
const PRINTING_HEADER = ["Date", "MC No.", "Item Name", "Operator", "Working Status", "Reasons For Not Working", "Machine ON Time", "Machine OFF Time", "Machine Shift Time (Hours)", "Standard Time per Piece (in Sec)", "TOTAL QTY.", "OK QTY.", "Rejected QTY", "Ok Quantity (%)", "Ideal Quantity", "Ideal Quantity/Hours", "Ask Query To QC Team (min)", "Empty Bag Tugging (min)", "Stock Counting (min)", "Planned Down Time (min)", "Setup Time (min)", "No Man Power (min)", "Material Shifting (min)", "No Material (min)", "B.D. Mech. (min)", "B.D. Ele. (min)", "No Power (min)", "Lunch / Tea / Washroom etc (Min)", "Other (Min)", "Total Idle Time (Min)", "Effective Machine Run Time (hours)", "Unreported Time (min)", "OEE considering losses (%)", "OEE not considering losses but lunch (%)", "OEE not considering losses but lunch and COT (%)", "Reason/Remarks for Rejection/ Rework"];

const PRINTING_ROWS = [
  ["11/05/2024", "", "58 PLUG PIN (BLACK SPRING SAT)", "SUREKHA", "Working", "", "09:10", "10:02", "0.8666666667", "7", "240", "240", "", "100.00%", "445.7142857", "514.2857143", "", "", "", "", "", "", "", "", "", "", "", "", "", "0", "0.4666666667", "24.0", "53.85%", "53.85%", "53.85%"],
  ["11/05/2024", "", "3 PIN MALE  CONNET.", "SUREKHA", "Working", "", "10:05", "17:50", "7.75", "11", "2124", "2124", "", "100.00%", "2536.363636", "327.2727273", "", "", "", "", "", "", "", "", "", "", "", "30", "", "30", "6.49", "45.6", "89.52%", "89.52%", "89.52%"],
  ["12/05/2024", "", "", "", "Not Working", "W.OFF"],
  ["13/05/2024", "", " 3 PIN MALE CONNECTOR", "SUREKHA", "Working", "", "09:00", "17:10", "8.166666667", "10", "2620", "2620", "", "100.00%", "2940", "360", "", "", "", "", "", "", "", "", "", "", "", "30", "", "30", "7.277777778", "23.3", "94.93%", "94.93%", "94.93%"],
  ["13/05/2024", "", "58 PLUG PIN (BLACK SPRING SAT)", "SUREKHA", "Working", "", "17:15", "17:50", "0.5833333333", "7", "168", "168", "", "100.00%", "300", "514.2857143", "", "", "", "", "", "", "", "", "", "", "", "", "", "0", "0.3266666667", "15.4", "56.00%", "56.00%", "56.00%"],
  ["13/05/2024", "", "10 PIN MALE CON. ABS", "RENUKA", "Working", "", "09:10", "12:00", "2.833333333", "20", "465", "465", "", "100.00%", "510", "180", "", "", "", "", "", "", "", "", "", "", "", "", "", "0", "2.583333333", "15.0", "91.18%", "91.18%", "91.18%"],
  ["13/05/2024", "", "ABS 10 PIN FEMA.LE STRIP INSERT", "RENUKA", "Working", "", "12:30", "15:45", "3.25", "22", "500", "500", "", "100.00%", "531.8181818", "163.6363636", "", "", "", "", "", "", "", "", "", "", "", "", "", "0", "3.055555556", "11.7", "94.02%", "94.02%", "94.02%"],
  ["14/05/2024", "", "3 PIN FEMALE", "SUREKHA", "Working", "", "10:30", "16:00", "5.5", "21", "874", "874", "", "100.00%", "942.8571429", "171.4285714", "", "", "", "", "", "", "", "", "", "", "", "30", "", "30", "5.098333333", "-5.9", "101.97%", "101.97%", "101.97%"],
  ["14/05/2024", "", "3 PIN (MALE", "SUREKHA", "Working", "", "10:30", "16:00", "5.5", "6", "3000", "3000", "", "100.00%", "3300", "600", "", "", "", "", "", "", "", "", "", "", "", "30", "", "30", "5", "0.0", "100.00%", "100.00%", "100.00%"],
  ["14/05/2024", "", "3 PIN FEMALE", "SHURAKA", "Working", "", "16:05", "17:30", "1.416666667", "5", "874", "874", "", "100.00%", "1020", "720", "", "", "", "", "", "", "", "", "", "", "", "", "", "0", "1.213888889", "12.2", "85.69%", "85.69%", "85.69%"],
  ["14/05/2024", "", "ABS 10 PIN FEMALE", "SUREKHA", "Working", "", "17:30", "17:50", "0.3333333333", "5", "100", "100", "", "100.00%", "240", "720", "", "", "", "", "", "", "", "", "", "", "", "", "", "0", "0.1388888889", "11.7", "41.67%", "41.67%", "41.67%"],
  ["14/05/2024", "", "58 PLUG PIN BLACK SPRING ", "SUREKHA", "Working", "", "08:30", "10:30", "2", "7", "480", "480", "", "100.00%", "1028.571429", "514.2857143", "", "", "", "", "", "", "", "", "", "", "", "", "", "0", "0.9333333333", "64.0", "46.67%", "46.67%", "46.67%"],
  ["13/05/2024", "", "58 PLUG PIN (BLACK SPRING SAT)", "VINA", "Working", "", "08:35", "09:00", "0.4166666667", "7", "96", "96", "", "100.00%", "214.2857143", "514.2857143", "", "", "", "", "", "", "", "", "", "", "", "", "", "0", "0.1866666667", "13.8", "44.80%", "44.80%", "44.80%"],
  ["13/05/2024", "M/C 12", "3 PIN MALE", "VINA", "Working", "", "09:05", "15:45", "6.666666667", "20", "1100", "1100", "", "100.00%", "1200", "180", "", "", "", "", "", "", "", "", "", "", "", "30", "", "30", "6.111111111", "3.3", "99.10%", "99.10%", "99.10%"],
  ["13/05/2024", "M/C 2", "EASY 1 PIN ", "VINA", "Working", "", "15:50", "16:45", "0.9166666667", "20", "90", "90", "", "100.00%", "165", "180", "", "", "", "", "", "", "", "", "", "", "", "", "", "0", "0.5", "25.0", "54.55%", "54.55%", "54.55%"],
  ["13/05/2024", "M/C 2", "3 PIN MALE", "VINA", "Working", "", "16:50", "17:55:00", "1.083333333", "10", "300", "300", "", "100.00%", "390", "360", "", "", "", "", "", "", "", "", "", "", "", "", "", "0", "0.8333333333", "15.0", "76.92%", "76.92%", "76.92%"],
  ["14/05/2024", "", "58 PLUG PIN ( BLACK SPRING SAT)", "VINA", "Working", "", "08:30", "09:05", "0.5833333333", "8", "240", "240", "", "100.00%", "262.5", "450", "", "", "", "", "", "", "", "", "", "", "", "", "", "0", "0.5333333333", "3.0", "91.43%", "91.43%", "91.43%"],
];
const INJECTION_ROWS = [
  ["11/05/2024", "110/A", " 3 PIN CONNECT. IF", "SANJAY THAKUR", "Working", "", "08:30", "18:00", "9.5", "20", "1608", "1600", "8", "99.50%", "1710", "180", "", "", "", "", "", "", "", "", "30", "", "30", "8.933333333", "4", "99.26%", "99.26%", "99.26%"],
  ["11/05/2024", "80/D", "4 PIN CONNECT.", "SURAJ", "Working", "", "08:30", "11:30", "3", "15", "608", "600", "8", "98.68%", "720", "240", "", "30", "", "", "", "", "", "", "", "", "30", "2.533333333", "-2", "101.33%", "84.44%", "101.33%", "MALE-300, FEMALE-300 ,MOLD CHANGED"],
  ["11/05/2024", "80/D", "3 PIN STRIP", "SURAJ", "Working", "", "12:30", "16:30", "4", "9", "1500", "1500", "", "100.00%", "1600", "400", "", "", "", "", "", "", "", "", "", "", "0", "3.75", "15", "93.75%", "93.75%", "93.75%"],
  ["11/05/2024", "80/C", "3 PIN MALE", "GANGARAM", "Working", "", "08:30", "19:00", "10.5", "4", "8608", "8600", "8", "99.91%", "9450", "900", "", "30", "", "", "", "", "", "", "30", "", "60", "9.564444444", "-3.866666667", "100.68%", "95.64%", "100.68%", "MOLD CHANGED"],
  ["13/05/2024", "110/A", "3 PIN FEMALE", "GANGARAM", "Working", "", "08:30", "17:55", "9.416666667", "38", "828", "825", "3", "99.64%", "892.1052632", "94.73684211", "", "", "", "", "", "", "", "", "30", "", "30", "8.74", "10.6", "98.02%", "98.02%", "98.02%"],
  ["13/05/2024", "80/C", "BLACK SPRING", "GANGARAM", "Working", "", "13:30", "19:00", "5.5", "1.5", "12800", "12800", "", "100.00%", "13200", "2400", "", "", "", "", "", "", "", "", "", "", "0", "5.333333333", "10", "96.97%", "96.97%", "96.97%"],
  ["13/05/2024", "80/D", "3 PIN (SEG) STRIP", "SURAJ", "Working", "", "08:30", "12:00", "3.5", "25", "494", "485", "9", "98.18%", "504", "144", "", "", "", "", "", "", "", "", "", "", "0", "3.430555556", "4.166666667", "98.02%", "98.02%", "98.02%"],
  ["14/05/2024", "110/A", "3 PIN FEMALE", "SANJAY", "Working", "", "08:30", "10:00", "1.5", "", "948", "937", "11", "98.84%", "", "", "", "", "", "", "", "", "", "", "", "", "0", "0", "90", "0.00%", "0.00%", "0.00%"],
  ["14/05/2024", "80/C", "BLACK SPRING", "GANGARAM", "Working", "", "08:30", "17:55", "9.416666667", "0.9", "35490", "35490", "", "100.00%", "37666.66667", "4000", "", "", "", "", "", "", "", "", "30", "", "30", "8.8725", "2.65", "99.50%", "99.50%", "99.50%"],
  ["15/05/2024", "110/A", "3 PIN FEMALE", "SANJAY", "Working", "", "08:30", "17:55", "9.416666667", "39", "800", "795", "5", "99.38%", "869.2307692", "92.30769231", "", "", "", "", "", "", "", "", "30", "", "30", "8.666666667", "15", "97.20%", "97.20%", "97.20%"],
  ["15/05/2024", "110/B", "16 PIN WSS", "DHARAM", "Working", "", "08:30", "18:55", "10.41666667", "36", "967", "961", "6", "99.38%", "1041.666667", "100", "", "", "", "", "", "", "", "", "30", "", "30", "9.67", "14.8", "97.51%", "97.51%", "97.51%"],
  ["15/05/2024", "80/C", "BLACK SPRING", "GANGARAM", "Working", "", "08:30", "18:55", "10.41666667", "0.88", "40088", "40088", "", "100.00%", "42613.63636", "4090.909091", "", "", "", "", "", "", "", "", "30", "", "30", "9.799288889", "7.042666667", "98.82%", "98.82%", "98.82%"],
  ["15/05/2024", "80/D", "3 PIN (SEG) STRIP", "SURAJ", "Working", "", "08:30", "18:55", "10.41666667", "4", "9042", "9036", "6", "99.93%", "9375", "900", "", "", "", "", "", "", "", "", "30", "", "30", "10.04666667", "-7.8", "101.31%", "101.31%", "101.31%"],
  ["16/05/2024", "110/A", "3 PIN FEMALE", "DHARAM", "Working", "", "13:00", "18:55", "5.916666667", "38", "547", "545", "2", "99.63%", "560.5263158", "94.73684211", "", "", "", "", "", "", "", "", "", "", "0", "5.773888889", "8.566666667", "97.59%", "97.59%", "97.59%"],
  ["16/05/2024", "80/C", "BLACK SPRING", "GANGARAM", "Working", "", "08:30", "11:00", "2.5", "0.7", "12141", "12109", "32", "99.74%", "12857.14286", "5142.857143", "", "", "", "", "", "", "", "", "", "", "0", "2.36075", "8.355", "94.43%", "94.43%", "94.43%"],
  ["16/05/2024", "80/C", "16 PIN SINGLE LEVER PLASTIC", "GANGARAM", "Working", "", "11:00", "12:00", "1", "5", "676", "670", "6", "99.11%", "720", "720", "", "", "", "", "", "", "", "", "", "", "0", "0.9388888889", "3.666666667", "93.89%", "93.89%", "93.89%"],
  ["16/05/2024", "80/D", "3 PIN (SEG) STRIP", "SURAJ", "Working", "", "08:30", "18:30", "10", "4", "8289", "8280", "9", "99.89%", "9000", "900", "", "", "", "", "", "", "", "", "30", "", "30", "9.21", "17.4", "96.95%", "96.95%", "96.95%"],
];
const BPC_ROWS = [
  ["05-10-2024", "3PIN HOOD S/E", "VIMALA", "Working", "", "8:15", "15:00", "6.75", "27", "796", "795", "", "", "", "", "", "", "0", "900.00", "133.3333333", "", "", "30", "", "30", "5.97", "16.8", "88.44%", "95.52%", "PIN BROKEN"],
  ["10/05/2024", "32 PIN (MIN) HOOD PG-21", "VIMALA", "Working", "", "15:00", "18:00", "3", "30", "345", "286", "59", "", "", "", "", "", "0", "360", "120", "", "", "", "", "0", "2.875", "7.5", "95.83%", "95.83%"],
  ["10/05/2024", "24 PIN B/C L/V CLAMP", "SANJU", "Working", "", "08:15", "15:00", "6.75", "45", "498", "494", "", "", "4", "", "", "", "4", "540", "80", "", "", "30", "", "30", "6.225", "1.5", "92.22%", "99.60%"],
  ["10/05/2024", "24 PIN B/C LV CLAMP", "SANJU", "Working", "", "15:00", "16:00", "1", "35", "90", "90", "90", "", "", "", "", "", "0", "102.8571429", "102.8571429", "", "", "", "", "0", "0.875", "7.5", "87.50%", "87.50%"],
  ["10/05/2024", "16 PIN B/O MIN S/C,MS", "SANJU", "Working", "", "16:00", "19:00", "3", "16", "625", "625", "", "", "", "", "", "", "0", "675", "225", "", "", "", "", "0", "2.777777778", "13.33333333", "92.59%", "92.59%"],
  ["11/05/2024", "6,10,PIN B/O,S/C (24,PIN B/O,D/C)", "SANJU", "Working", "", "08:15", "12:00", "3.75", "10", "1248", "1248", "", "", "", "", "", "", "0", "1350", "360", "", "", "", "", "0", "3.466666667", "17", "92.44%", "92.44%"],
  ["13/05/2024", "16 PIN B/CH/C,2 S/E,PG-29,DC,PC", "SANJU", "Working", "", "08:15", "09:30", "1.25", "35", "94", "94", "", "", "", "", "", "", "0", "128.5714286", "102.8571429", "", "", "", "", "0", "0.9138888889", "20.16666667", "73.11%", "73.11%"],
  ["13/05/2024", "16 PIN HOOD S/E,PG-21,DC,MS", "SANJU", "Working", "", "09:35", "11:10", "1.583333333", "42", "98", "98", "", "", "", "", "", "", "0", "135.7142857", "85.71428571", "", "", "", "", "0", "1.143333333", "26.4", "72.21%", "72.21%"],
  ["13/05/2024", "24 PIN HOOD S/E,PG-21,DC,MS", "SANJU", "Working", "", "11:15", "13:45", "2.5", "40", "150", "150", "", "", "", "", "", "", "0", "225", "90", "", "", "30", "", "30", "1.666666667", "20", "66.67%", "83.33%"],
  ["13/05/2024", "24 PIN B/O D/C,PC", "SANJU", "Working", "", "13:50", "16:25", "2.583333333", "23", "381", "381", "", "", "", "", "", "", "0", "404.3478261", "156.5217391", "", "", "", "", "0", "2.434166667", "8.95", "94.23%", "94.23%"],
  ["13/05/2024", "DUST COVER CLAMP", "SANJU", "Working", "", "16:30", "18:55", "2.416666667", "9", "915", "915", "", "", "", "", "", "", "0", "966.6666667", "400", "", "", "", "", "0", "2.2875", "7.75", "94.66%", "94.66%"],
  ["13/05/2024", "3 PIN HOOD ,S/E,PG-11,S/C,MS", "VIMALA", "Working", "", "09:00", "10:00", "1", "15", "168", "0", "168", "", "", "", "", "", "0", "240", "240", "", "", "", "", "0", "0.7", "18", "70.00%", "70.00%"],
  ["13/05/2024", "3 PIN HOOD T/E,PG-13.5,S/C,MS", "VIMALA", "Working", "", "10:00", "14:40", "4.666666667", "16", "913", "", "115", "", "", "", "", "", "0", "1050", "225", "", "", "30", "", "30", "4.057777778", "6.533333333", "86.95%", "97.39%"],
  ["13/05/2024", "16 PIN MIN B/O,S/C,MS", "VIMALA", "Working", "", "16:20", "17:55", "1.583333333", "10", "565", "565", "", "", "", "", "", "", "0", "570", "360", "", "", "", "", "0", "1.569444444", "0.8333333333", "99.12%", "99.12%"],
  ["14/05/2024", "16 PIN (MIN) 10 PIN B/C", "VIMALA", "Working", "", "09:15", "11:00", "1.75", "13", "452", "452", "", "", "", "", "", "", "0", "484.6153846", "276.9230769", "", "", "", "", "0", "1.632222222", "7.066666667", "93.27%", "93.27%"],
  ["14/05/2024", "24 PIN B/C,L/V ", "VIMALA", "Working", "", "12:30", "17:50", "5.333333333", "45", "393", "", "103", "", "", "", "", "", "0", "426.6666667", "80", "", "", "", "", "0", "4.9125", "25.25", "92.11%", "92.11%"],
  ["14/05/2024", "24 PIN HOOD D/C,S/E,PG-21,MS", "SANJU", "Working", "", "08:10", "10:00", "1.833333333", "30", "203", "203", "", "", "", "", "", "", "0", "220", "120", "", "", "", "", "0", "1.691666667", "8.5", "92.27%", "92.27%"],
  ["14/05/2024", "16 PIN HOOD REGULAR", "SANJU", "Working", "", "10:05", "11:55", "1.833333333", "40", "131", "131", "", "", "", "", "", "", "0", "165", "90", "", "", "", "", "0", "1.455555556", "22.66666667", "79.39%", "79.39%"],
];

// ── Where each figure sits on each sheet ────────────────────────────────────

// PRINTING's downtime columns by their header text: its own three, then the ten every sheet has.
const PRINTING_IDLE_KEY_BY_LABEL = {
  "Ask Query To QC Team (min)": "askQueryQcMin",
  "Empty Bag Tugging (min)": "emptyBagTuggingMin",
  "Stock Counting (min)": "stockCountingMin",
  "Planned Down Time (min)": "plannedDownMin",
  "Setup Time (min)": "setupMin",
  "No Man Power (min)": "noManPowerMin",
  "Material Shifting (min)": "materialShiftingMin",
  "No Material (min)": "noMaterialMin",
  "B.D. Mech. (min)": "bdMechMin",
  "B.D. Ele. (min)": "bdEleMin",
  "No Power (min)": "noPowerMin",
  "Lunch / Tea / Washroom etc (Min)": "lunchMin",
  "Other (Min)": "otherMin",
};
const headerCol = (label) => {
  const i = PRINTING_HEADER.indexOf(label);
  if (i < 0) throw new Error(`PRINTING header has no "${label}" column`);
  return i;
};
const PRINTING_COLS = {
  date: headerCol("Date"),
  mc: headerCol("MC No."),
  item: headerCol("Item Name"),
  operator: headerCol("Operator"),
  status: headerCol("Working Status"),
  reason: headerCol("Reasons For Not Working"),
  on: headerCol("Machine ON Time"),
  off: headerCol("Machine OFF Time"),
  shift: headerCol("Machine Shift Time (Hours)"),
  std: headerCol("Standard Time per Piece (in Sec)"),
  total: headerCol("TOTAL QTY."),
  ok: headerCol("OK QTY."),
  rejected: headerCol("Rejected QTY"),
  stops: Object.fromEntries(Object.entries(PRINTING_IDLE_KEY_BY_LABEL).map(([label, key]) => [key, headerCol(label)])),
  idleTotal: headerCol("Total Idle Time (Min)"),
  remarks: headerCol("Reason/Remarks for Rejection/ Rework"),
};

// INJECTION MOULDING (pasted without a header): the ten shared downtime
// columns in their usual order — row 2's Setup 30 and row 4's Setup 30 + Lunch 30
// land on Setup and Lunch, and every row's downtime adds up to its Total Idle Time.
const INJECTION_COLS = {
  date: 0,
  mc: 1,
  item: 2,
  operator: 3,
  status: 4,
  reason: 5,
  on: 6,
  off: 7,
  shift: 8,
  std: 9,
  total: 10,
  ok: 11,
  rejected: 12,
  stops: Object.fromEntries(STOPPAGE_KEYS.map((k, i) => [k, 16 + i])),
  idleTotal: 26,
  remarks: 32,
};

// BEFORE POWDER COATING (pasted with only part of its header, starting at "Blow
// Holes Casting"; lined up on its "Lunch / Tea / Washroom" column, the reasons
// are columns 12–16). Column 11, between OK QTY and the reasons, is the
// hand-typed Rejected QTY: it is not in the reasons' total (column 17).
const BPC_COLS = {
  date: 0,
  item: 1,
  operator: 2,
  status: 3,
  reason: 4,
  on: 5,
  off: 6,
  shift: 7,
  std: 8,
  total: 9,
  ok: 10,
  rejected: 11,
  reasons: Object.fromEntries(BPC_REJECT_REASONS.map((r, i) => [r, 12 + i])),
  reasonTotal: 17,
  stops: { setupMin: 20, bdMechMin: 21, lunchMin: 22, otherMin: 23 },
  idleTotal: 24,
  remarks: 29,
};

// ── Reading a paper cell ────────────────────────────────────────────────────

const cell = (row, i) => (i === undefined ? "" : String(row[i] ?? "").trim());
const num = (s) => {
  const t = String(s ?? "").trim().replace(/%$/, "").replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`"${s}" is not a number`);
  return n;
};
// The one date the paper writes MM-DD-YYYY (BEFORE POWDER COATING's first row).
const DATE_FIXES = { "05-10-2024": "2024-05-10" };
const isoDate = (s) => {
  if (DATE_FIXES[s]) return DATE_FIXES[s];
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) throw new Error(`Date "${s}" is not DD/MM/YYYY`);
  return `${m[3]}-${m[2]}-${m[1]}`;
};
// "8:15" -> "08:15", "17:55:00" -> "17:55".
const hhmm = (s) => {
  const m = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(s);
  if (!m) throw new Error(`Time "${s}" is not HH:mm`);
  return `${m[1].padStart(2, "0")}:${m[2]}`;
};
const clock = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const cleanName = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sum = (list) => list.reduce((s, v) => s + (v ?? 0), 0);
// Planned Operator Shift as the form sends it: decimal hours to 6 places (whole minutes).
const plannedHours = (shiftMin) => Number((shiftMin / 60).toFixed(6));
const blankIfNull = (v) => (v === null || v === undefined ? "" : v);

// One paper row -> what is entered. Throws when a column doesn't add up, so a
// wrong column map can never load wrong figures quietly.
const readRow = (sheet, cols, row, index) => {
  const r = {
    sheet,
    paperRow: index + 1,
    dateText: cell(row, cols.date),
    mcName: cleanName(cell(row, cols.mc)),
    itemName: cleanName(cell(row, cols.item)),
    operator: cleanName(cell(row, cols.operator)),
    status: cell(row, cols.status),
    reason: cell(row, cols.reason),
    notes: [],
  };
  r.date = isoDate(r.dateText);
  if (r.status !== "Working") return r;
  const where = `${sheet} row ${r.paperRow} (${r.dateText} ${r.operator || r.mcName})`;

  r.on = hhmm(cell(row, cols.on));
  r.off = hhmm(cell(row, cols.off));
  r.shiftMin = clock(r.off) - clock(r.on);
  const paperShift = num(cell(row, cols.shift));
  if (paperShift === null || Math.abs(paperShift - r.shiftMin / 60) > 1e-6) {
    throw new Error(`${where}: Machine Shift ${paperShift} h is not OFF − ON (${r.shiftMin} min)`);
  }
  r.std = num(cell(row, cols.std));
  r.total = num(cell(row, cols.total));
  r.ok = num(cell(row, cols.ok));
  r.stops = Object.fromEntries(Object.entries(cols.stops).map(([k, i]) => [k, num(cell(row, i))]));
  const idle = sum(Object.values(r.stops));
  const paperIdle = num(cell(row, cols.idleTotal)) ?? 0;
  if (idle !== paperIdle) throw new Error(`${where}: downtime columns add up to ${idle}, Total Idle Time is ${paperIdle}`);
  r.remarks = cell(row, cols.remarks);
  r.paperRejected = num(cell(row, cols.rejected));

  if (cols.reasons) {
    // BEFORE POWDER COATING's Rejection Master split.
    r.split = {};
    for (const [reason, i] of Object.entries(cols.reasons)) {
      const v = num(cell(row, i));
      if (v) r.split[reason] = v;
    }
    const splitTotal = sum(Object.values(r.split));
    const paperReasonTotal = num(cell(row, cols.reasonTotal)) ?? 0;
    if (splitTotal !== paperReasonTotal) throw new Error(`${where}: reject reasons add up to ${splitTotal}, their total is ${paperReasonTotal}`);
    if (r.ok === null && r.total !== null && r.paperRejected !== null) {
      r.ok = r.total - r.paperRejected;
      r.notes.push(`OK QTY is blank on the paper: entered as TOTAL ${r.total} − Rejected QTY ${r.paperRejected} = ${r.ok}`);
    }
    const rejected = r.total - r.ok;
    if (r.paperRejected !== null && r.paperRejected !== rejected) {
      r.notes.push(`paper's Rejected QTY "${r.paperRejected}" not used: TOTAL ${r.total} = OK ${r.ok}, so the app's Rejected (TOTAL − OK) is ${rejected}`);
    } else if (r.paperRejected === null && rejected > 0 && !splitTotal) {
      r.notes.push(`paper's Rejected QTY is blank, but TOTAL ${r.total} − OK ${r.ok} = ${rejected}`);
    }
    if (rejected > 0 && splitTotal < rejected) {
      r.notes.push(`no reject reason on the paper for ${rejected - splitTotal} of ${rejected} rejected — saved with no reason split (the form asks for one if this entry is edited)`);
    }
  } else if (r.total !== null && r.ok !== null && (r.paperRejected ?? 0) !== r.total - r.ok) {
    r.notes.push(`paper's Rejected QTY "${r.paperRejected ?? ""}" differs from TOTAL − OK = ${r.total - r.ok}`);
  }
  return r;
};

// ── Calling a controller the way Express does ───────────────────────────────

let ADMIN = null;
const call = async (handler, { body = {}, params = {}, query = {} } = {}) => {
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
  await handler({ user: ADMIN, body, params, query, headers: {}, cookies: {}, ip: "127.0.0.1" }, res);
  return res;
};
const ok = (res) => res.statusCode >= 200 && res.statusCode < 300 && res.payload?.isOk !== false;

// ── Master data: only what is missing ───────────────────────────────────────

const created = { operators: [], operatorsAssigned: [], machines: [], parts: [] };

const ensureOperator = async (name, proc) => {
  const found = await MachineOperator.findOne({ name: new RegExp(`^${escapeRe(name)}$`, "i"), isActive: true }).lean();
  if (!found) {
    const res = await call(machineOperatorController.createMachineOperator, { body: { name, processes: [String(proc._id)], isActive: true } });
    if (!ok(res)) throw new Error(`Operator "${name}": ${res.payload?.message}`);
    created.operators.push(`${name} (${proc.processName})`);
    return res.payload.data;
  }
  const processes = (found.processes || []).map(String);
  // An operator with no process yet is offered on every sheet already — left as it is.
  if (processes.length && !processes.includes(String(proc._id))) {
    const res = await call(machineOperatorController.updateMachineOperator, {
      params: { operatorId: String(found._id) },
      body: { processes: [...processes, String(proc._id)] },
    });
    if (!ok(res)) throw new Error(`Operator "${name}": ${res.payload?.message}`);
    created.operatorsAssigned.push(`${found.name} (+${proc.processName})`);
  }
  return found;
};

const ensureMachine = async (name, proc) => {
  const found = await Machine.findOne({ machineName: new RegExp(`^${escapeRe(name)}$`, "i"), isDeleted: { $ne: true } }).lean();
  if (found) {
    if (String(found.process || "") !== String(proc._id)) {
      throw new Error(`Machine "${found.machineName}" already exists outside ${proc.processName} — not moved; move it in Machine Master first`);
    }
    if (found.isActive === false) throw new Error(`Machine "${found.machineName}" is inactive`);
    return found;
  }
  const res = await call(machineController.createMachine, { body: { machineName: name, process: String(proc._id), isActive: true } });
  if (!ok(res)) throw new Error(`Machine "${name}": ${res.payload?.message}`);
  created.machines.push(`${name} (${proc.processName})`);
  return res.payload.data;
};

const ensurePart = async (name, std, proc) => {
  const found = await Item.findOne({ process: proc._id, itemName: new RegExp(`^${escapeRe(name)}$`, "i") }).lean();
  if (found) return found;
  const res = await call(itemController.createItem, {
    body: { itemName: name, drawingNo: "", setupNo: "", totalCycleSec: std ?? "", process: String(proc._id), isActive: true },
  });
  if (!ok(res)) throw new Error(`Part "${name}": ${res.payload?.message}`);
  created.parts.push(`${name} — ${std ?? "no"} sec (${proc.processName})`);
  return res.payload.data;
};

// ── The three sheets ────────────────────────────────────────────────────────

const SHEETS = [
  {
    key: "printing",
    processName: "PRINTING",
    rows: PRINTING_ROWS,
    cols: PRINTING_COLS,
    stopKeys: PRINTING_STOPPAGE_KEYS,
    controller: printingSheet,
    Model: PrintingEntry,
    byOperator: true,
    // Its paper has one operator on two jobs from 10:30 on one date: the Item tells them apart.
    existing: (r, ids) => ({ date: new Date(`${r.date}T00:00:00.000Z`), worker: ids.worker, machineOnTime: r.on, itemName: r.itemName }),
    body: (r, ids) => ({
      date: r.date,
      worker: String(ids.worker),
      process: String(ids.process),
      mcMachine: ids.mc ? String(ids.mc) : "",
      vendor: "",
      machineStatus: [],
      workingMode: "Working",
      slot: "auto",
      item: String(ids.item),
      workingStatus: "",
      itemName: r.itemName,
      remarks: r.remarks,
      otherMinRemark: "",
    }),
  },
  {
    key: "injection",
    processName: "INJECTION MOULDING",
    rows: INJECTION_ROWS,
    cols: INJECTION_COLS,
    stopKeys: STOPPAGE_KEYS,
    controller: injectionSheet,
    Model: InjectionEntry,
    byOperator: false,
    existing: (r, ids) => ({ date: new Date(`${r.date}T00:00:00.000Z`), machine: ids.mc, machineOnTime: r.on }),
    body: (r, ids) => ({
      date: r.date,
      machine: String(ids.mc),
      machineStatus: [],
      workingMode: "Working",
      slot: "auto",
      item: String(ids.item),
      vendor: null,
      operator: r.operator,
      workingStatus: "",
      itemName: r.itemName,
      drawingNo: "",
      remarks: r.remarks,
      otherMinRemark: "",
    }),
  },
  {
    key: "bpc",
    processName: "BEFORE POWDER COATING",
    rows: BPC_ROWS,
    cols: BPC_COLS,
    stopKeys: BPC_STOPPAGE_KEYS,
    controller: bpcSheet,
    Model: BeforePowderCoatingEntry,
    byOperator: true,
    existing: (r, ids) => ({ date: new Date(`${r.date}T00:00:00.000Z`), worker: ids.worker, machineOnTime: r.on }),
    body: (r, ids) => {
      const top = Object.entries(r.split).sort((a, b) => b[1] - a[1])[0];
      return {
        date: r.date,
        worker: String(ids.worker),
        process: String(ids.process),
        vendor: "",
        machineStatus: [],
        workingMode: "Working",
        slot: "auto",
        item: String(ids.item),
        workingStatus: "",
        itemName: r.itemName,
        remarks: r.remarks,
        otherMinRemark: "",
        rejectBreakdown: r.split,
        rejectReason: top ? top[0] : "",
        rejectOtherRemark: "",
      };
    },
  },
];

const label = (r) => `row ${r.paperRow} ${r.dateText} ${[r.mcName, r.operator].filter(Boolean).join(" / ")} ${r.on ? `${r.on}–${r.off} ` : ""}${r.itemName}`.trim();

async function run() {
  const uri = process.env.MONGO_URI || "";
  if (!LOCAL.test(uri)) {
    throw new Error("Refusing to run: MONGO_URI in server/.env must be a local database (mongodb://localhost or mongodb://127.0.0.1)");
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const host = mongoose.connection.host;
  if (!["127.0.0.1", "localhost"].includes(host)) throw new Error(`Connected to "${host}", not a local database — stopping`);
  console.log(`Local database "${mongoose.connection.name}" on ${host}`);

  ADMIN = await User.findOne({ roleType: "SuperAdmin", isActive: { $ne: false } }).select("-password");
  if (!ADMIN) throw new Error("No active Super Admin in the local database");
  ADMIN.roleType = "SuperAdmin";

  // Read every row first, so a column that doesn't add up stops the run before anything is written.
  for (const s of SHEETS) {
    if (s.stopKeys.length !== Object.keys(s.cols.stops).length || s.stopKeys.some((k) => !(k in s.cols.stops))) {
      throw new Error(`${s.processName}: downtime columns don't match the sheet's own list`);
    }
    s.proc = await Process.findOne({ processName: s.processName }).lean();
    if (!s.proc) throw new Error(`No "${s.processName}" process — run its seed/seed*Process.js first`);
    s.parsed = s.rows.map((row, i) => readRow(s.processName, s.cols, row, i));
    s.result = { saved: [], already: [], skipped: [], refused: [] };
  }

  // 1. Operators, machines and parts.
  for (const s of SHEETS) {
    const partStd = new Map();
    for (const r of s.parsed) {
      if (r.status !== "Working") continue;
      if (!partStd.has(r.itemName) || (partStd.get(r.itemName) === null && r.std !== null)) partStd.set(r.itemName, r.std);
    }
    s.ids = { operators: new Map(), machines: new Map(), parts: new Map() };
    for (const r of s.parsed) {
      if (r.status !== "Working") continue;
      if (r.operator && !s.ids.operators.has(r.operator)) s.ids.operators.set(r.operator, (await ensureOperator(r.operator, s.proc))._id);
      if (r.mcName && !s.ids.machines.has(r.mcName)) s.ids.machines.set(r.mcName, (await ensureMachine(r.mcName, s.proc))._id);
      if (!s.ids.parts.has(r.itemName)) s.ids.parts.set(r.itemName, (await ensurePart(r.itemName, partStd.get(r.itemName), s.proc))._id);
    }
  }

  // 2. Planned shift lock OFF while saving, put back afterwards whatever happens.
  const locks = [];
  try {
    for (const s of SHEETS) {
      const current = await Process.findById(s.proc._id).select("plannedShiftLocked").lean();
      locks.push({ id: s.proc._id, name: s.processName, was: current.plannedShiftLocked });
      await Process.updateOne({ _id: s.proc._id }, { $set: { plannedShiftLocked: false } });
    }

    // 3. The entries, in paper order, through saveRow.
    for (const s of SHEETS) {
      for (const r of s.parsed) {
        if (r.status !== "Working") {
          s.result.skipped.push(`${label(r)} — ${r.status}${r.reason ? ` (${r.reason})` : ""}, no operator or machine on the paper`);
          continue;
        }
        const ids = {
          process: s.proc._id,
          worker: s.ids.operators.get(r.operator),
          mc: r.mcName ? s.ids.machines.get(r.mcName) : null,
          item: s.ids.parts.get(r.itemName),
        };
        if (await s.Model.exists(s.existing(r, ids))) {
          s.result.already.push(label(r));
          continue;
        }
        const body = {
          ...s.body(r, ids),
          machineOnTime: r.on,
          machineOffTime: r.off,
          totalCycleSec: blankIfNull(r.std),
          actualQty: blankIfNull(r.total),
          okQty: blankIfNull(r.ok),
          // = the Machine Shift: the paper has no Planned column.
          plannedOperatorShiftHours: plannedHours(r.shiftMin),
          ...Object.fromEntries(s.stopKeys.map((k) => [k, blankIfNull(r.stops[k])])),
          // The form sends Lunch as 0 when it is left blank.
          lunchMin: r.stops.lunchMin ?? 0,
        };
        const res = await call(s.controller.saveRow, { body });
        if (ok(res) && res.payload?.data) {
          const doc = res.payload.data;
          const flagged = doc.review?.status === "pending" ? ` — held for OEE Review (${doc.review.flagged.map((f) => `${f.metric} ${(f.value * 100).toFixed(2)}%`).join(", ")})` : "";
          s.result.saved.push(`${label(r)}${flagged}`);
        } else {
          s.result.refused.push(`${label(r)} — ${res.statusCode}: ${res.payload?.message}`);
        }
      }
    }
  } finally {
    for (const l of locks) {
      if (l.was === undefined) await Process.updateOne({ _id: l.id }, { $unset: { plannedShiftLocked: "" } });
      else await Process.updateOne({ _id: l.id }, { $set: { plannedShiftLocked: l.was } });
    }
    if (locks.length) console.log(`Planned shift lock put back: ${locks.map((l) => `${l.name} ${l.was === false ? "unlocked" : "locked"}`).join(", ")}`);
  }

  // A flagged save's admin notification is sent without being awaited — let it finish.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // 4. Report.
  const list = (title, items) => {
    console.log(`  ${title}: ${items.length}`);
    for (const it of items) console.log(`    - ${it}`);
  };
  console.log("\nMaster data created:");
  list("Operators", created.operators);
  if (created.operatorsAssigned.length) list("Operators given a process", created.operatorsAssigned);
  list("Machines", created.machines);
  list("Parts", created.parts);
  for (const s of SHEETS) {
    console.log(`\n${s.processName}:`);
    list("Saved", s.result.saved);
    list("Already saved before (skipped)", s.result.already);
    list("Skipped", s.result.skipped);
    list("Refused by the app", s.result.refused);
    list("Notes on the paper", s.parsed.flatMap((r) => r.notes.map((n) => `${label(r)}: ${n}`)));
  }
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
