"use strict";
/**
 * seed/seedCompanyFiguresExamples.js
 * ────────────────────────────────────
 * Puts example business figures for the current year (Jan to last month) into
 * the LOCAL database so the Company Level Objective board can be looked at
 * populated — sales, target, order booking, salary, electricity, FG / RM /
 * WIP, inventory turnover, on-time delivery, complaints, in the same range as
 * the company's old Power BI board. Re-runnable: it overwrites those months.
 *
 * Refuses to run against anything but a local MongoDB.
 *
 *   node seed/seedCompanyFiguresExamples.js            # load
 *   node seed/seedCompanyFiguresExamples.js --remove   # take them out again
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const CompanyMonthly = require("../models/CompanyMonthly");

const uri = process.env.MONGO_URI || "";
if (!/127\.0\.0\.1|localhost/.test(uri)) {
  console.error("Refusing: MONGO_URI is not a local database.");
  process.exit(1);
}

const year = new Date().getFullYear();
const upTo = Math.max(1, new Date().getMonth()); // last full month
const round = (n) => Math.round(n);

(async () => {
  await mongoose.connect(uri);
  if (process.argv.includes("--remove")) {
    const r = await CompanyMonthly.deleteMany({ year, updatedByName: "example seed" });
    console.log(`Removed ${r.deletedCount} example month(s) for ${year}.`);
  } else {
    for (let m = 1; m <= upTo; m++) {
      const wave = Math.sin((m / 12) * Math.PI * 2);
      const sales = round(20_500_000 + wave * 2_400_000 + m * 180_000);
      const values = {
        sales,
        targetSales: round(21_500_000 + m * 150_000),
        orderBooking: round(sales * (1.02 + wave * 0.06)),
        salary: round(1_130_000 + m * 9_000),
        electricityBill: round(58_000 + wave * 9_000 + m * 900),
        fgValue: round(26_500_000 + wave * 1_500_000),
        rmValue: round(24_200_000 - wave * 1_100_000),
        wipValue: round(23_500_000 + m * 120_000),
        inventoryTurnover: Number((6.2 + m * 0.11).toFixed(2)),
        onTimeDelivery: Number((85 + wave * 4 + m * 0.3).toFixed(1)),
        customerComplaints: Math.max(5, round(18 - m * 0.6 + wave * 3)),
      };
      await CompanyMonthly.findOneAndUpdate({ year, month: m }, { $set: { values, updatedByName: "example seed", source: "entry" } }, { upsert: true, setDefaultsOnInsert: true });
    }
    console.log(`Loaded example figures for Jan–${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][upTo - 1]} ${year}.`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
