// When the summary emails next go out (jobs/summaryMail.js nextSendAt), the
// "send a test at" time (controllers/summaryMail.controller.js), and a booked
// test being cleared and logged by the scheduler. No database, no mail server.
const test = require("node:test");
const assert = require("node:assert/strict");
const SummaryMailSetting = require("../models/SummaryMailSetting");
const AuditLog = require("../models/AuditLog");
const { nextSendAt, tick } = require("../jobs/summaryMail");
const { _nextIstTime } = require("../controllers/summaryMail.controller");

// 2026-11-28 is a Saturday. 10:00 IST = 04:30 UTC.
const ist = (date, hhmm) => new Date(`${date}T${hhmm}:00.000+05:30`);
const MON_SAT = [1, 2, 3, 4, 5, 6];

test("nextSendAt: later today, tomorrow once today's has gone, skipping days it doesn't send on", () => {
  const now = ist("2026-11-28", "10:00"); // Saturday
  assert.equal(nextSendAt({ days: MON_SAT, hhmm: "18:00" }, now).toISOString(), ist("2026-11-28", "18:00").toISOString());
  // Already sent today → next send day; Sunday is off, so Monday.
  assert.equal(nextSendAt({ days: MON_SAT, hhmm: "18:00", sentFor: "2026-11-28" }, now).toISOString(), ist("2026-11-30", "18:00").toISOString());
  // Weekly on Monday at 9:30.
  assert.equal(nextSendAt({ days: [1], hhmm: "09:30" }, now).toISOString(), ist("2026-11-30", "09:30").toISOString());
  // Weekly on Saturday at 9:30, already sent today → a week later.
  assert.equal(nextSendAt({ days: [6], hhmm: "09:30", sentFor: "2026-11-28" }, now).toISOString(), ist("2026-12-05", "09:30").toISOString());
});

test("nextSendAt: a send whose time passed today without going out is due now", () => {
  const now = ist("2026-11-28", "10:00");
  assert.equal(nextSendAt({ days: MON_SAT, hhmm: "09:00" }, now).getTime(), now.getTime());
  // Just after midnight IST (still the previous day in UTC) counts as the new day.
  const early = ist("2026-11-30", "00:10"); // Monday
  assert.equal(nextSendAt({ days: [1], hhmm: "09:30" }, early).toISOString(), ist("2026-11-30", "09:30").toISOString());
});

test("a test time is the next time that clock time comes round in India", () => {
  const now = ist("2026-11-28", "14:20");
  assert.equal(_nextIstTime("14:25", now).toISOString(), ist("2026-11-28", "14:25").toISOString());
  assert.equal(_nextIstTime("14:20", now).toISOString(), ist("2026-11-29", "14:20").toISOString());
  assert.equal(_nextIstTime("09:00", now).toISOString(), ist("2026-11-29", "09:00").toISOString());
});

test("the scheduler clears a booked test once its time comes and logs it, even when it can't be sent", async () => {
  const saved = [];
  const doc = {
    _id: "64b0c0ffee0000000000a001",
    recipients: [],
    dailyEnabled: true,
    weeklyEnabled: true,
    dailyDays: MON_SAT,
    dailySendAt: "18:00",
    weeklyDay: 1,
    weeklySendAt: "09:30",
    lastDailyFor: "",
    lastWeeklyFor: "",
    testAt: ist("2026-11-28", "14:25"),
    testKind: "daily",
    testTo: [],
    testByName: "Tester",
    save: async function save() {
      saved.push({ testAt: this.testAt });
      return this;
    },
  };
  const written = [];
  const orig = { findOne: SummaryMailSetting.findOne, findById: SummaryMailSetting.findById, create: AuditLog.create, host: process.env.SMTP_HOST };
  SummaryMailSetting.findOne = async () => doc;
  SummaryMailSetting.findById = async () => doc;
  AuditLog.create = async (row) => (written.push(row), row);
  process.env.SMTP_HOST = "smtp.invalid";
  try {
    // Before its time: nothing happens.
    await tick(ist("2026-11-28", "14:24"));
    assert.equal(written.length, 0);
    assert.ok(doc.testAt);
    // At its time: cleared first (so it never repeats), then logged as not sent.
    await tick(ist("2026-11-28", "14:25"));
    assert.equal(doc.testAt, null);
    assert.equal(saved[0].testAt, null);
    assert.equal(written.length, 1);
    assert.equal(written[0].success, false);
    assert.match(written[0].remark, /^TEST daily booked by Tester .* NOT sent: No recipients are set/);
    // The next check does nothing more.
    await tick(ist("2026-11-28", "14:26"));
    assert.equal(written.length, 1);
  } finally {
    SummaryMailSetting.findOne = orig.findOne;
    SummaryMailSetting.findById = orig.findById;
    AuditLog.create = orig.create;
    if (orig.host === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = orig.host;
  }
});
