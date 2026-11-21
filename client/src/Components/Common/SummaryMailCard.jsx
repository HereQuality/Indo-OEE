import React, { useEffect, useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, Col, Input, Label, Row, Spinner } from "reactstrap";
import { Mail, Send } from "lucide-react";
import { getSummaryMail, sendSummaryMailNow, updateSummaryMail } from "../../api/summaryMail.api";
import { useAlert } from "../../context/AlertContext";

/**
 * Components/Common/SummaryMailCard.jsx
 * ──────────────────────────────────────
 * On the Company page: who gets the Production Dashboard's OEE and OK Qty
 * summary by email, and when (server jobs/summaryMail.js):
 *
 *   Daily    every day at its send time (6:00 PM by default), for that same
 *            day — the entries saved from 12:00 AM up to then
 *   Weekly   on the chosen weekday at its send time (Monday 8:00 AM by
 *            default), for the previous Monday to Sunday
 *
 * "Send now" mails the summary straight away to check the setup. The server
 * needs SMTP details in its .env; the card says so when they're missing.
 */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const blank = { recipients: [], dailyEnabled: true, weeklyEnabled: true, dailySendAt: "18:00", weeklySendAt: "08:00", weeklyDay: 1 };

// "18:00" → "6:00 PM"
const to12h = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export default function SummaryMailCard() {
  const toast = useAlert();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState("");
  const [saved, setSaved] = useState(blank);
  const [recipientsText, setRecipientsText] = useState("");
  const [form, setForm] = useState(blank);
  const [testTo, setTestTo] = useState("");

  useEffect(() => {
    getSummaryMail()
      .then((res) => {
        const d = { ...blank, ...(res?.data?.data || {}) };
        setSaved(d);
        setForm(d);
        setRecipientsText(d.recipients.join("\n"));
      })
      .catch((err) => toast.error(err?.response?.data?.message || "Couldn't load the summary email settings"))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const typedRecipients = recipientsText.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const isDirty =
    typedRecipients.join() !== saved.recipients.join() ||
    form.dailyEnabled !== saved.dailyEnabled ||
    form.weeklyEnabled !== saved.weeklyEnabled ||
    form.dailySendAt !== saved.dailySendAt ||
    form.weeklySendAt !== saved.weeklySendAt ||
    Number(form.weeklyDay) !== Number(saved.weeklyDay);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateSummaryMail({ ...form, recipients: typedRecipients });
      const d = { ...blank, ...(res?.data?.data || {}) };
      setSaved(d);
      setForm(d);
      setRecipientsText(d.recipients.join("\n"));
      toast.success("Summary email settings saved.");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save the summary email settings.");
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
    }
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Card>
      <CardHeader>
        <div className="d-flex align-items-center gap-2">
          <Mail size={20} />
          <h5 className="mb-0">Summary Email — OEE & OK Qty</h5>
        </div>
      </CardHeader>
      <CardBody>
        {loading ? (
          <div className="text-center py-4"><Spinner size="sm" /></div>
        ) : (
          <>
            {!saved.mailConfigured && (
              <Alert color="warning" className="mb-3">
                Email isn't set up on the server yet — add <code>SMTP_HOST</code>, <code>SMTP_USER</code> and <code>SMTP_PASS</code> to the server's <code>.env</code> and restart it. Settings saved here are kept and used once that's done.
              </Alert>
            )}
            <p className="text-muted small mb-3">
              The Efficiency Report (OEE) for every process and machine, as a PDF with the OEE and OK Qty summary in the mail: the <b>daily</b> one goes out at {to12h(form.dailySendAt)} with that day's entries from 12:00 AM up to then; the <b>weekly</b> one on {WEEKDAYS[form.weeklyDay]} at {to12h(form.weeklySendAt)} with the previous Monday to Sunday. Times are Indian Standard Time.
            </p>
            <Row className="g-3">
              <Col xs="12" md="6">
                <Label htmlFor="sm-recipients" className="mb-1">Send to (one email per line)</Label>
                <Input id="sm-recipients" type="textarea" rows={5} value={recipientsText} onChange={(e) => setRecipientsText(e.target.value)} placeholder={"owner@company.com\nplant.head@company.com"} />
                <div className="form-text">{typedRecipients.length ? `${typedRecipients.length} recipient${typedRecipients.length === 1 ? "" : "s"}` : "No recipients yet"}</div>
              </Col>
              <Col xs="12" md="6">
                <div className="border rounded p-3 mb-3" style={{ background: "var(--vz-secondary-bg)" }}>
                  <div className="form-check form-switch mb-2">
                    <Input id="sm-daily" type="checkbox" className="form-check-input" role="switch" checked={form.dailyEnabled} onChange={(e) => set("dailyEnabled", e.target.checked)} />
                    <Label htmlFor="sm-daily" className="form-check-label">Daily report (same day, 12:00 AM to send time)</Label>
                  </div>
                  <Row className="g-2 mb-3 ps-4">
                    <Col xs="12" sm="6">
                      <Label htmlFor="sm-daily-time" className="mb-1 small">Daily send time</Label>
                      <Input id="sm-daily-time" type="time" bsSize="sm" value={form.dailySendAt} onChange={(e) => set("dailySendAt", e.target.value || "18:00")} disabled={!form.dailyEnabled} />
                    </Col>
                  </Row>
                  <div className="form-check form-switch mb-2">
                    <Input id="sm-weekly" type="checkbox" className="form-check-input" role="switch" checked={form.weeklyEnabled} onChange={(e) => set("weeklyEnabled", e.target.checked)} />
                    <Label htmlFor="sm-weekly" className="form-check-label">Weekly report (previous Monday to Sunday)</Label>
                  </div>
                  <Row className="g-2 ps-4">
                    <Col xs="12" sm="6">
                      <Label htmlFor="sm-day" className="mb-1 small">Weekly on</Label>
                      <Input id="sm-day" type="select" bsSize="sm" value={form.weeklyDay} onChange={(e) => set("weeklyDay", Number(e.target.value))} disabled={!form.weeklyEnabled}>
                        {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                      </Input>
                    </Col>
                    <Col xs="12" sm="6">
                      <Label htmlFor="sm-weekly-time" className="mb-1 small">Weekly send time</Label>
                      <Input id="sm-weekly-time" type="time" bsSize="sm" value={form.weeklySendAt} onChange={(e) => set("weeklySendAt", e.target.value || "08:00")} disabled={!form.weeklyEnabled} />
                    </Col>
                  </Row>
                </div>
                {(saved.lastDailyFor || saved.lastWeeklyFor) && (
                  <div className="form-text mt-2">
                    {saved.lastDailyFor && <>Last daily sent on {saved.lastDailyFor}. </>}
                    {saved.lastWeeklyFor && <>Last weekly sent on {saved.lastWeeklyFor}.</>}
                  </div>
                )}
              </Col>
            </Row>

            <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-3">
              <div className="d-flex flex-wrap align-items-center gap-2">
                <Input type="email" bsSize="sm" style={{ maxWidth: 260 }} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Send now to… (blank = saved recipients)" aria-label="Send now to" />
                <Button size="sm" color="light" outline={false} disabled={!!sending || !saved.mailConfigured} onClick={() => sendNow("daily")} title="Mail today's report (entries so far) right now">
                  {sending === "daily" ? <Spinner size="sm" /> : <Send size={14} />} <span className="ms-1">Send daily now</span>
                </Button>
                <Button size="sm" color="light" disabled={!!sending || !saved.mailConfigured} onClick={() => sendNow("weekly")} title="Mail last week's summary right now">
                  {sending === "weekly" ? <Spinner size="sm" /> : <Send size={14} />} <span className="ms-1">Send weekly now</span>
                </Button>
              </div>
              <Button color="primary" className="px-4" disabled={saving || !isDirty} style={{ opacity: !isDirty && !saving ? 0.6 : 1 }} onClick={handleSave}>
                {saving ? <><Spinner size="sm" className="me-1" /> Saving...</> : "Save Settings"}
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
