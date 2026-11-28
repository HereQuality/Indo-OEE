import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Col, Input, Label, Row, Spinner } from "reactstrap";
import { AlarmClock, CalendarClock, CheckCircle2, Clock, History, Mail, RefreshCw, Send, Server, Users, X, XCircle } from "lucide-react";
import { cancelSummaryMailTest, getSummaryMail, scheduleSummaryMailTest, sendSummaryMailNow, updateSummaryMail } from "../../api/summaryMail.api";
import { useAlert } from "../../context/AlertContext";

/**
 * Components/Common/SummaryMailCard.jsx — Company page › "Email reports" tab
 * ───────────────────────────────────────────────────────────────────────────
 * Everything about the OEE and OK Qty summary emails (server
 * jobs/summaryMail.js), which the server sends on its own:
 *
 *   - status: is email set up on the server, and a live countdown to the
 *     next daily and weekly send (or why it won't go out)
 *   - who gets them, and when: daily on the ticked weekdays at its time, for
 *     the previous day (standard: every day at 9:00 AM, so Saturday's
 *     arrives on Sunday); weekly on the chosen weekday, for the previous
 *     Monday to Sunday (standard: Monday 9:30 AM). "Use standard schedule"
 *     fills those in.
 *   - test: send one right now, or book one for a time (today, or tomorrow
 *     if the time has passed) — the server sends it then exactly as it sends
 *     the real ones, so it proves the schedule works, not just the mail
 *   - the last sends, from the audit log (scheduled, test and "send now")
 *
 * Times are Indian Standard Time. The countdowns use the server's clock.
 */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Day chips in week order, Monday first.
const DAY_CHIPS = [1, 2, 3, 4, 5, 6, 0];
const DEFAULT_DAILY_DAYS = [0, 1, 2, 3, 4, 5, 6];
// The standard schedule: the previous day every morning at 9:00 (Saturday's
// on Sunday), the previous week on Monday at 9:30.
const STANDARD = { dailyEnabled: true, dailySendAt: "09:00", dailyDays: DEFAULT_DAILY_DAYS, weeklyEnabled: true, weeklyDay: 1, weeklySendAt: "09:30" };
const TZ = "Asia/Kolkata";
const REFRESH_MS = 30 * 1000;

const blank = { recipients: [], dailyEnabled: true, weeklyEnabled: true, dailySendAt: "09:00", dailyDays: DEFAULT_DAILY_DAYS, weeklySendAt: "09:30", weeklyDay: 1 };

// "Mon to Sat", "every day", "Mon, Wed, Fri"
const daysLabel = (days) => {
  const d = [...new Set((days || []).map(Number))].filter((x) => x >= 0 && x <= 6);
  if (d.length === 7) return "every day";
  const inOrder = DAY_CHIPS.filter((x) => d.includes(x));
  if (!inOrder.length) return "no day";
  const short = (x) => WEEKDAYS[x].slice(0, 3);
  const run = inOrder.every((x, i) => i === 0 || DAY_CHIPS.indexOf(x) === DAY_CHIPS.indexOf(inOrder[i - 1]) + 1);
  return run && inOrder.length > 2 ? `${short(inOrder[0])} to ${short(inOrder[inOrder.length - 1])}` : inOrder.map(short).join(", ");
};
const sameDays = (a, b) => daysLabel(a) === daysLabel(b);

// "18:00" → "6:00 PM"
const to12h = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

// "Sat 28 Nov, 6:00 PM" in India
const whenText = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : "";

// "in 2d 3h", "in 3h 12m", "in 4m 10s", "in 12s"
const countdown = (ms) => {
  if (ms <= 0) return "due now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `in ${d}d ${h}h`;
  if (h) return `in ${h}h ${m}m`;
  if (m) return `in ${m}m ${String(sec).padStart(2, "0")}s`;
  return `in ${sec}s`;
};

// The time in India `mins` minutes from now, as "HH:mm".
const istClockIn = (mins, offsetMs = 0) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(Date.now() + offsetMs + mins * 60000))
    .replace(/^24/, "00");

const KIND_LABEL = { daily: "daily", weekly: "weekly", both: "daily and weekly" };

function StatusTile({ icon: Icon, title, tone, big, sub }) {
  const colors = { ok: "#16a34a", warn: "#d97706", off: "var(--vz-secondary-color, #6b7280)", info: "#4f46e5" };
  return (
    <Card className="h-100 mb-0">
      <CardBody className="py-2 px-3">
        <div className="d-flex align-items-center gap-1 text-muted small">
          <Icon size={14} /> {title}
        </div>
        <div style={{ fontSize: "1.15rem", fontWeight: 700, color: colors[tone] || "inherit", lineHeight: 1.3 }}>{big}</div>
        {sub ? (
          <div className="small text-muted text-truncate" title={typeof sub === "string" ? sub : undefined}>
            {sub}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export default function SummaryMailCard() {
  const toast = useAlert();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState("");
  // What the server has (settings + status); the form is what's being edited.
  const [saved, setSaved] = useState(blank);
  const [form, setForm] = useState(blank);
  const [recipientsText, setRecipientsText] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testKind, setTestKind] = useState("daily");
  const [testAt, setTestAt] = useState(() => istClockIn(2));
  const [booking, setBooking] = useState(false);
  // Server clock minus this browser's clock, so countdowns use the server's time.
  const offset = useRef(0);
  const [now, setNow] = useState(Date.now());

  const apply = useCallback((d, { keepForm = false } = {}) => {
    const data = { ...blank, ...(d || {}) };
    if (data.serverTime) offset.current = new Date(data.serverTime).getTime() - Date.now();
    setSaved(data);
    if (!keepForm) {
      setForm(data);
      setRecipientsText((data.recipients || []).join("\n"));
    }
  }, []);

  // Background refresh: the countdowns, the booked test and the last sends —
  // never what's being typed in the form.
  const refresh = useCallback(
    async ({ quiet = true } = {}) => {
      if (!quiet) setRefreshing(true);
      try {
        const res = await getSummaryMail();
        apply(res?.data?.data, { keepForm: true });
      } catch (err) {
        if (!quiet) toast.error(err?.response?.data?.message || "Couldn't refresh");
      } finally {
        if (!quiet) setRefreshing(false);
      }
    },
    [apply, toast],
  );

  useEffect(() => {
    getSummaryMail()
      .then((res) => {
        apply(res?.data?.data);
        setTestAt(istClockIn(2, offset.current));
      })
      .catch((err) => toast.error(err?.response?.data?.message || "Couldn't load the email report settings"))
      .finally(() => setLoading(false));
    const t = setInterval(() => refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The clock for the countdowns, once a second.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // A booked test's time has come: look again shortly after, to show how it went.
  const testMs = saved.test?.at ? new Date(saved.test.at).getTime() - (now + offset.current) : null;
  useEffect(() => {
    if (testMs === null || testMs > 0) return undefined;
    const t = setTimeout(() => refresh(), 15000);
    return () => clearTimeout(t);
  }, [testMs !== null && testMs <= 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const typedRecipients = recipientsText.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const isDirty =
    typedRecipients.join() !== (saved.recipients || []).join() ||
    form.dailyEnabled !== saved.dailyEnabled ||
    form.weeklyEnabled !== saved.weeklyEnabled ||
    form.dailySendAt !== saved.dailySendAt ||
    !sameDays(form.dailyDays, saved.dailyDays) ||
    form.weeklySendAt !== saved.weeklySendAt ||
    Number(form.weeklyDay) !== Number(saved.weeklyDay);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateSummaryMail({ ...form, recipients: typedRecipients });
      apply(res?.data?.data);
      toast.success("Email report settings saved.");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save the email report settings.");
    } finally {
      setSaving(false);
    }
  };

  const sendNow = async (kind) => {
    setSending(kind);
    try {
      const res = await sendSummaryMailNow({ kind, ...(testTo.trim() ? { to: testTo.trim() } : {}) });
      toast.success(res?.data?.message || "Sent.");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Couldn't send the summary.");
    } finally {
      setSending("");
      refresh();
    }
  };

  const bookTest = async (body) => {
    setBooking(true);
    try {
      const res = await scheduleSummaryMailTest({ kind: testKind, ...(testTo.trim() ? { to: testTo.trim() } : {}), ...body });
      apply(res?.data?.data, { keepForm: true });
      toast.success(res?.data?.message || "Test booked.");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Couldn't book the test.");
    } finally {
      setBooking(false);
      refresh();
    }
  };

  const cancelTest = async () => {
    try {
      const res = await cancelSummaryMailTest();
      apply(res?.data?.data, { keepForm: true });
      toast.success("Test send cancelled.");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Couldn't cancel the test.");
    } finally {
      refresh();
    }
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleDay = (d) =>
    setForm((f) => {
      const days = (f.dailyDays || []).map(Number);
      return { ...f, dailyDays: days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b) };
    });
  const dailyDays = (form.dailyDays || []).map(Number);
  const isStandard =
    form.dailyEnabled && form.weeklyEnabled && form.dailySendAt === STANDARD.dailySendAt && sameDays(dailyDays, STANDARD.dailyDays) && Number(form.weeklyDay) === 1 && form.weeklySendAt === STANDARD.weeklySendAt;
  // What the next few emails will be, in words.
  const dayAfter = (d) => WEEKDAYS[(d + 1) % 7];
  const satArrives = dailyDays.includes(0) ? "Sunday" : dailyDays.includes(1) ? "Monday, together with Sunday's" : "the next send day";

  if (loading) {
    return (
      <Card>
        <CardBody className="text-center py-5">
          <Spinner size="sm" />
        </CardBody>
      </Card>
    );
  }

  const serverNow = now + offset.current;
  const configured = !!saved.mailConfigured;
  const hasRecipients = (saved.recipients || []).length > 0;
  // What a "next send" tile says: the countdown, or why it won't go.
  const nextTile = (enabled, at) => {
    if (!enabled) return { tone: "off", big: "Off", sub: "Switched off below" };
    if (!configured) return { tone: "warn", big: "Won't send", sub: "Email isn't set up on the server" };
    if (!hasRecipients) return { tone: "warn", big: "Won't send", sub: "No recipients saved yet" };
    if (!at) return { tone: "off", big: "—", sub: "" };
    const ms = new Date(at).getTime() - serverNow;
    return { tone: "info", big: ms <= 0 ? "Going out now" : countdown(ms), sub: ms <= 0 ? "Within a minute" : whenText(at) };
  };
  const daily = nextTile(saved.dailyEnabled, saved.nextDailyAt);
  const weekly = nextTile(saved.weeklyEnabled, saved.nextWeeklyAt);
  const history = saved.history || [];

  const recipientsCount = (saved.recipients || []).length;
  const iconBtn = "d-inline-flex align-items-center gap-1 text-nowrap";
  const sectionTitle = { fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" };

  return (
    <div className="d-flex flex-column gap-3">
      {/* ── Header + status ── */}
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div>
          <h5 className="mb-0 d-flex align-items-center gap-2">
            <Mail size={20} /> Email reports
          </h5>
          <div className="text-muted small">OEE & OK Qty summary with the Efficiency Report PDF. The server sends them by itself. Times are IST.</div>
        </div>
        <Button size="sm" color="light" className={iconBtn} onClick={() => refresh({ quiet: false })} disabled={refreshing} title="Check again">
          {refreshing ? <Spinner size="sm" /> : <RefreshCw size={14} />} Refresh
        </Button>
      </div>

      <Row className="g-3">
        <Col xs="6" xl="3">
          <StatusTile icon={Server} title="Email server" tone={configured ? "ok" : "warn"} big={configured ? "Connected" : "Not set up"} sub={configured ? "Ready to send" : "SMTP missing in server .env"} />
        </Col>
        <Col xs="6" xl="3">
          <StatusTile icon={CalendarClock} title="Next daily report" {...daily} />
        </Col>
        <Col xs="6" xl="3">
          <StatusTile icon={CalendarClock} title="Next weekly report" {...weekly} />
        </Col>
        <Col xs="6" xl="3">
          <StatusTile icon={Users} title="Recipients" tone={recipientsCount ? "ok" : "warn"} big={recipientsCount || "None"} sub={recipientsCount ? (saved.recipients || []).slice(0, 2).join(", ") + (recipientsCount > 2 ? ` +${recipientsCount - 2}` : "") : "Add at least one below"} />
        </Col>
      </Row>

      {!configured && (
        <Alert color="warning" className="mb-0 py-2 small">
          Email isn't set up on the server. Add <code>SMTP_HOST</code>, <code>SMTP_USER</code> and <code>SMTP_PASS</code> to the server's <code>.env</code> and restart it. What you save here is kept until then.
        </Alert>
      )}
      {saved.test?.at && (
        <Alert color="info" className="mb-0 py-2 d-flex flex-wrap align-items-center justify-content-between gap-2">
          <span className="d-flex align-items-center gap-2 small">
            <AlarmClock size={16} className="flex-shrink-0" />
            <span>
              Test {KIND_LABEL[saved.test.kind] || "daily"} email at <b>{whenText(saved.test.at)}</b> (<b>{testMs > 0 ? countdown(testMs) : "going out now"}</b>) to{" "}
              {(saved.test.to?.length ? saved.test.to : saved.recipients || []).join(", ") || "the recipients"}
            </span>
          </span>
          <Button size="sm" color="light" className={iconBtn} onClick={cancelTest}>
            <X size={14} /> Cancel test
          </Button>
        </Alert>
      )}

      <Row className="g-3">
        {/* ── Left: recipients + schedule ── */}
        <Col xs="12" xl="7">
          <Card className="mb-0 h-100">
            <CardBody className="d-flex flex-column gap-3">
              <div>
                <div className="d-flex align-items-center justify-content-between mb-1">
                  <Label htmlFor="sm-recipients" className="mb-0 text-muted" style={sectionTitle}>
                    Send to
                  </Label>
                  <span className="small text-muted">{typedRecipients.length ? `${typedRecipients.length} recipient${typedRecipients.length === 1 ? "" : "s"}` : "Nothing is sent until you add one"}</span>
                </div>
                <Input
                  id="sm-recipients"
                  type="textarea"
                  rows={3}
                  value={recipientsText}
                  onChange={(e) => setRecipientsText(e.target.value)}
                  placeholder={"owner@company.com\nplant.head@company.com"}
                />
                <div className="form-text">One email per line (commas work too).</div>
              </div>

              <div>
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                  <span className="text-muted" style={sectionTitle}>
                    Schedule
                  </span>
                  <Button
                    size="sm"
                    color={isStandard ? "light" : "primary"}
                    outline={!isStandard}
                    disabled={isStandard}
                    className={iconBtn}
                    onClick={() => setForm((f) => ({ ...f, ...STANDARD }))}
                    title="Daily: every day 9:00 AM for the previous day. Weekly: Monday 9:30 AM for the previous week."
                  >
                    {isStandard ? <CheckCircle2 size={14} /> : <CalendarClock size={14} />} {isStandard ? "Standard schedule" : "Use standard schedule"}
                  </Button>
                </div>

                {/* Daily */}
                <div className="border rounded p-3 mb-2" style={{ background: "var(--vz-secondary-bg)" }}>
                  <div className="d-flex flex-wrap align-items-center gap-3">
                    <div className="form-check form-switch mb-0" style={{ minWidth: 150 }}>
                      <Input id="sm-daily" type="checkbox" className="form-check-input" role="switch" checked={form.dailyEnabled} onChange={(e) => set("dailyEnabled", e.target.checked)} />
                      <Label htmlFor="sm-daily" className="form-check-label fw-semibold">
                        Daily report
                      </Label>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <Label htmlFor="sm-daily-time" className="mb-0 small text-muted">
                        at
                      </Label>
                      <Input id="sm-daily-time" type="time" bsSize="sm" style={{ width: 130 }} value={form.dailySendAt} onChange={(e) => set("dailySendAt", e.target.value || "09:00")} disabled={!form.dailyEnabled} />
                    </div>
                    <div className="d-flex flex-wrap gap-1" role="group" aria-label="Daily send days">
                      {DAY_CHIPS.map((d) => (
                        <Button
                          key={d}
                          type="button"
                          size="sm"
                          color={dailyDays.includes(d) ? "primary" : "light"}
                          outline={!dailyDays.includes(d)}
                          disabled={!form.dailyEnabled}
                          onClick={() => toggleDay(d)}
                          aria-pressed={dailyDays.includes(d)}
                          style={{ minWidth: 42, padding: "2px 6px" }}
                        >
                          {WEEKDAYS[d].slice(0, 3)}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="small text-muted mt-2">
                    {form.dailyEnabled ? (
                      <>
                        The previous day's entries in full, {daysLabel(dailyDays)} at {to12h(form.dailySendAt)}. Friday's arrives {dayAfter(5)}, Saturday's on {satArrives}.
                      </>
                    ) : (
                      "Off: no daily email."
                    )}
                  </div>
                  {!dailyDays.length && <div className="small text-danger mt-1">Pick at least one day.</div>}
                </div>

                {/* Weekly */}
                <div className="border rounded p-3" style={{ background: "var(--vz-secondary-bg)" }}>
                  <div className="d-flex flex-wrap align-items-center gap-3">
                    <div className="form-check form-switch mb-0" style={{ minWidth: 150 }}>
                      <Input id="sm-weekly" type="checkbox" className="form-check-input" role="switch" checked={form.weeklyEnabled} onChange={(e) => set("weeklyEnabled", e.target.checked)} />
                      <Label htmlFor="sm-weekly" className="form-check-label fw-semibold">
                        Weekly report
                      </Label>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <Label htmlFor="sm-day" className="mb-0 small text-muted">
                        every
                      </Label>
                      <Input id="sm-day" type="select" bsSize="sm" style={{ width: 140 }} value={form.weeklyDay} onChange={(e) => set("weeklyDay", Number(e.target.value))} disabled={!form.weeklyEnabled}>
                        {WEEKDAYS.map((d, i) => (
                          <option key={d} value={i}>
                            {d}
                          </option>
                        ))}
                      </Input>
                      <Label htmlFor="sm-weekly-time" className="mb-0 small text-muted">
                        at
                      </Label>
                      <Input id="sm-weekly-time" type="time" bsSize="sm" style={{ width: 130 }} value={form.weeklySendAt} onChange={(e) => set("weeklySendAt", e.target.value || "09:30")} disabled={!form.weeklyEnabled} />
                    </div>
                  </div>
                  <div className="small text-muted mt-2">{form.weeklyEnabled ? <>The previous Monday to Sunday, every {WEEKDAYS[form.weeklyDay]} at {to12h(form.weeklySendAt)}.</> : "Off: no weekly email."}</div>
                </div>
              </div>

              <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-auto pt-1">
                <span className="small text-muted">
                  {saved.lastDailyFor && <>Last daily: {saved.lastDailyFor}. </>}
                  {saved.lastWeeklyFor && <>Last weekly: {saved.lastWeeklyFor}.</>}
                </span>
                <div className="d-flex align-items-center gap-2">
                  {isDirty && <span className="small text-warning">Unsaved changes</span>}
                  <Button color="primary" className="px-4" disabled={saving || !isDirty || !dailyDays.length} style={{ opacity: !isDirty && !saving ? 0.6 : 1 }} onClick={handleSave}>
                    {saving ? (
                      <>
                        <Spinner size="sm" className="me-1" /> Saving...
                      </>
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        </Col>

        {/* ── Right: test + last sends ── */}
        <Col xs="12" xl="5" className="d-flex flex-column gap-3">
          <Card className="mb-0">
            <CardBody className="d-flex flex-column gap-3">
              <div className="text-muted" style={sectionTitle}>
                Test it
              </div>
              <Row className="g-2">
                <Col xs="12" sm="7">
                  <Input type="email" bsSize="sm" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="To (blank = saved recipients)" aria-label="Send the test to" />
                </Col>
                <Col xs="12" sm="5">
                  <Input type="select" bsSize="sm" value={testKind} onChange={(e) => setTestKind(e.target.value)} aria-label="Which report">
                    <option value="daily">Daily report</option>
                    <option value="weekly">Weekly report</option>
                    <option value="both">Both</option>
                  </Input>
                </Col>
              </Row>
              <div>
                <div className="small fw-semibold mb-1 d-flex align-items-center gap-1">
                  <Clock size={14} /> Send at a time
                </div>
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <Input type="time" bsSize="sm" value={testAt} onChange={(e) => setTestAt(e.target.value)} style={{ width: 130 }} aria-label="Test time (IST)" />
                  <Button size="sm" color="primary" className={iconBtn} disabled={booking || !configured || !testAt} onClick={() => bookTest({ at: testAt })}>
                    {booking ? <Spinner size="sm" /> : <AlarmClock size={14} />} Book
                  </Button>
                  <span className="small text-muted">or</span>
                  {[2, 5, 15].map((m) => (
                    <Button key={m} size="sm" color="light" disabled={booking || !configured} onClick={() => bookTest({ inMinutes: m })}>
                      {m} min
                    </Button>
                  ))}
                </div>
                <div className="form-text">The server's timer sends it, just like the real reports. A time already gone today means tomorrow.</div>
              </div>
              <div>
                <div className="small fw-semibold mb-1 d-flex align-items-center gap-1">
                  <Send size={14} /> Send right now
                </div>
                <div className="d-flex flex-wrap gap-2">
                  <Button size="sm" color="light" className={iconBtn} disabled={!!sending || !configured} onClick={() => sendNow(testKind === "weekly" ? "weekly" : "daily")}>
                    {sending ? <Spinner size="sm" /> : <Send size={14} />} Send {testKind === "weekly" ? "weekly" : "daily"} now
                  </Button>
                  {testKind === "both" && (
                    <Button size="sm" color="light" className={iconBtn} disabled={!!sending || !configured} onClick={() => sendNow("weekly")}>
                      <Send size={14} /> Send weekly now
                    </Button>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          <Card className="mb-0 flex-grow-1">
            <CardBody className="p-0 d-flex flex-column">
              <div className="d-flex align-items-center justify-content-between px-3 pt-3 pb-2">
                <span className="text-muted d-flex align-items-center gap-1" style={sectionTitle}>
                  <History size={14} /> Last sends
                </span>
                <Link to="/hqepl/logs?module=summaryMail" className="small">
                  Open in Logs
                </Link>
              </div>
              {history.length ? (
                <ul className="list-unstyled mb-0" style={{ maxHeight: 260, overflowY: "auto" }}>
                  {history.map((h, i) => (
                    <li key={`${h.at}-${i}`} className="d-flex align-items-start gap-2 px-3 py-2" style={{ borderTop: "1px solid var(--vz-border-color)" }}>
                      {h.success ? <CheckCircle2 size={15} className="text-success flex-shrink-0 mt-1" /> : <XCircle size={15} className="text-danger flex-shrink-0 mt-1" />}
                      <div className="flex-grow-1" style={{ minWidth: 0 }}>
                        <div className="small" style={{ wordBreak: "break-word" }}>
                          {h.remark || "Sent"}
                        </div>
                        <div className="small text-muted">
                          {whenText(h.at)}
                          {h.by ? ` · ${h.by}` : ""}
                        </div>
                      </div>
                      {!h.success && (
                        <Badge color="danger" pill className="flex-shrink-0">
                          Failed
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-muted small px-3 pb-3">Nothing sent yet.</div>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
