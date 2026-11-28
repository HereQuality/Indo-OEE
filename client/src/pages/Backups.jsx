import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { Container } from "reactstrap";
import { AlertTriangle, Archive, CheckCircle2, Clock, Download, FolderOpen, HardDrive, History, RefreshCw, ShieldCheck } from "lucide-react";
import { useAlert } from "../context/AlertContext";
import ConfirmAlert from "../Components/Common/ConfirmAlert";
import { apiOrigin, createBackup, getBackupLink, getBackups } from "../api/backups.api";
import { toRolePath } from "../utils/roleUrl";

/**
 * pages/Backups.jsx — Administration › Backups (Super Admin only; the API answers 403 to anyone else)
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * The server backs itself up once a day (server/jobs/dbBackup.js): the whole database plus every uploaded file
 * (profile pictures, logos, ticket attachments), as ONE file named by its India date and time. Here: when the
 * last one was made and whether it worked, when the next one is due, the backups kept (by date), Download, and
 * "Back up now". Every backup taken, failed or downloaded is also in Administration › Logs.
 */

const IST = "Asia/Kolkata";
const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: IST, weekday: "short", day: "2-digit", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true });
const fullFmt = new Intl.DateTimeFormat("en-IN", { timeZone: IST, day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

const sizeText = (bytes) => {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
};
const agoText = (iso) => {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))} min ago`;
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
};
const timeOf12 = (hhmm) => {
  const [h, m] = String(hhmm || "02:30").split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const inText = (ms) => {
  const mins = Math.max(1, Math.round(ms / 60000));
  return mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`;
};

const card = { borderRadius: 16, background: "var(--panel-bg)", border: "1px solid var(--panel-border)", boxShadow: "0 1px 3px rgba(15,23,42,0.04)" };
const muted = { color: "var(--panel-text-muted)" };
const text = { color: "var(--panel-text)" };

const Tile = ({ icon: Icon, tint, label, value, sub, testId }) => (
  <div className="p-3 h-100" style={card} data-testid={testId}>
    <div className="d-flex align-items-center gap-2 mb-2">
      <div style={{ width: 30, height: 30, borderRadius: 9, background: `${tint}1f`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={16} color={tint} />
      </div>
      <span style={{ ...muted, fontSize: "0.78rem", fontWeight: 600 }}>{label}</span>
    </div>
    <div style={{ ...text, fontWeight: 800, fontSize: "1.05rem" }}>{value}</div>
    {sub ? <div style={{ ...muted, fontSize: "0.76rem", marginTop: 2 }}>{sub}</div> : null}
  </div>
);

const Backups = () => {
  const toast = useAlert();
  const navigate = useNavigate();
  const { roleSlug } = useParams();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [downloading, setDownloading] = useState(null);

  useEffect(() => {
    document.title = `Backups | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME}`;
  }, []);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["backups"],
    queryFn: async () => (await getBackups())?.data?.data,
    // While a backup is running elsewhere (the daily one), look again until it is done.
    refetchInterval: (q) => (q.state.data?.running ? 5000 : false),
  });
  const backups = useMemo(() => data?.backups || [], [data]);
  const status = data?.status || {};
  const schedule = data?.schedule || {};
  const running = working || !!data?.running;

  // Grouped by India date, newest first.
  const byDay = useMemo(() => {
    const groups = [];
    for (const b of backups) {
      const last = groups[groups.length - 1];
      if (last && last.day === b.day) last.items.push(b);
      else groups.push({ day: b.day, items: [b] });
    }
    return groups;
  }, [backups]);

  const latest = backups[0];
  const last = status.lastSuccess;
  const failedLast = status.lastErrorAt && (!last || status.lastErrorAt > last.at);
  const totalSize = backups.reduce((s, b) => s + (b.size || 0), 0);

  const backUpNow = async () => {
    setConfirming(false);
    setWorking(true);
    try {
      const res = await createBackup();
      const r = res?.data?.data || {};
      toast.success(`Backup saved: ${r.name} (${sizeText(r.size)}, ${r.documents} records${r.files ? `, ${r.files} files` : ""})`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "The backup failed. Try again.");
    } finally {
      setWorking(false);
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    }
  };

  const download = async (name) => {
    setDownloading(name);
    try {
      const res = await getBackupLink(name);
      const url = res?.data?.data?.url;
      if (!url) throw new Error("no link");
      // A plain link: the browser downloads it straight to disk, however big.
      const a = document.createElement("a");
      a.href = `${apiOrigin()}${url}`;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not start the download. Try again.");
    } finally {
      setTimeout(() => setDownloading(null), 1500);
    }
  };

  const openLogs = () => navigate(`${toRolePath("/hqepl/logs", roleSlug || "hqepl")}?module=backup`);

  return (
    <div className="page-content">
      <style>{"@keyframes backup-spin { to { transform: rotate(360deg); } }"}</style>
      <Container fluid>
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-4 p-3" style={card}>
          <div className="d-flex align-items-center gap-2">
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg,#0f766e,#14b8a6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Archive size={19} color="#fff" />
            </div>
            <div>
              <h5 className="mb-0" style={{ ...text, fontWeight: 800 }}>Backups</h5>
              <div style={{ ...muted, fontSize: "0.78rem" }}>The whole database and every uploaded file, saved once a day — one file per date</div>
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <button type="button" className="btn btn-light border d-inline-flex align-items-center gap-2" style={{ borderRadius: 10, fontWeight: 600 }} onClick={openLogs}>
              <History size={15} /> Backup log
            </button>
            <button
              type="button"
              className="btn btn-primary d-inline-flex align-items-center gap-2"
              style={{ borderRadius: 10, fontWeight: 600 }}
              disabled={running || isLoading}
              onClick={() => setConfirming(true)}
              data-testid="backup-now"
            >
              <RefreshCw size={15} style={running ? { animation: "backup-spin 1s linear infinite" } : undefined} />
              {running ? "Backing up…" : "Back up now"}
            </button>
          </div>
        </div>

        {isError ? <div className="alert alert-danger">{error?.response?.status === 403 ? "Only the Super Admin can see the backups." : "Could not load the backups."}</div> : null}

        {failedLast ? (
          <div className="d-flex align-items-start gap-2 p-3 mb-3" style={{ ...card, borderColor: "#fca5a5", background: "rgba(239,68,68,0.06)" }} data-testid="backup-failed">
            <AlertTriangle size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: "0.85rem" }}>
              <div style={{ color: "#dc2626", fontWeight: 700 }}>The last backup failed ({fullFmt.format(new Date(status.lastErrorAt))})</div>
              <div style={muted}>{status.lastError}</div>
            </div>
          </div>
        ) : null}

        <div className="row g-3 mb-4">
          <div className="col-6 col-lg-3">
            <Tile
              icon={latest ? CheckCircle2 : AlertTriangle}
              tint={latest ? "#16a34a" : "#d97706"}
              label="Last backup"
              value={latest ? agoText(latest.createdAt) : isLoading ? "…" : "None yet"}
              sub={
                latest
                  ? `${fullFmt.format(new Date(latest.createdAt))} · ${sizeText(latest.size)}${last && last.name === latest.name ? ` · ${last.documents} records${last.files ? `, ${last.files} files` : ""}` : ""}`
                  : "Click “Back up now” to make the first one"
              }
              testId="backup-last"
            />
          </div>
          <div className="col-6 col-lg-3">
            <Tile
              icon={Clock}
              tint="#2563eb"
              label="Automatic backup"
              value={schedule.time ? `Daily, ${timeOf12(schedule.time)}` : isLoading ? "…" : "—"}
              sub={schedule.nextInMs != null ? `Next in ${inText(schedule.nextInMs)} · India time` : ""}
              testId="backup-schedule"
            />
          </div>
          <div className="col-6 col-lg-3">
            <Tile
              icon={ShieldCheck}
              tint="#7c3aed"
              label="Kept"
              value={`${backups.length} backup${backups.length === 1 ? "" : "s"}`}
              sub={`Every day for ${schedule.keepDays || 30} days, then the first of each month for ever`}
            />
          </div>
          <div className="col-6 col-lg-3">
            <Tile icon={HardDrive} tint="#0f766e" label="Disk space" value={data?.disk ? `${sizeText(data.disk.free)} free` : "—"} sub={`Backups use ${sizeText(totalSize)}`} />
          </div>
        </div>

        <div className="row g-3">
          <div className="col-lg-8">
            <div style={card} className="p-0 overflow-hidden" data-testid="backup-list">
              <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--panel-border)", ...text, fontWeight: 700 }}>
                Backups by date
              </div>
              {isLoading ? (
                <div className="p-4 text-center" style={muted}>
                  Loading…
                </div>
              ) : byDay.length === 0 ? (
                <div className="p-4 text-center" style={muted}>
                  No backups yet.
                </div>
              ) : (
                byDay.map((g) => (
                  <div key={g.day}>
                    <div className="px-3 py-1" style={{ background: "var(--panel-bg-subtle)", ...muted, fontSize: "0.74rem", fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase" }}>
                      {dayFmt.format(new Date(`${g.day}T12:00:00+05:30`))}
                    </div>
                    {g.items.map((b) => (
                      <div key={b.name} className="d-flex align-items-center gap-3 px-3 py-2" style={{ borderTop: "1px solid var(--panel-border)" }}>
                        <Archive size={16} style={muted} />
                        <div className="flex-grow-1" style={{ minWidth: 0 }}>
                          <div style={{ ...text, fontWeight: 600, fontSize: "0.88rem" }}>{timeFmt.format(new Date(b.createdAt))}</div>
                          <div style={{ ...muted, fontSize: "0.74rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</div>
                        </div>
                        <span style={{ ...muted, fontSize: "0.8rem", whiteSpace: "nowrap" }}>{sizeText(b.size)}</span>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
                          style={{ borderRadius: 8 }}
                          disabled={downloading === b.name}
                          onClick={() => download(b.name)}
                          data-testid={`backup-download-${b.name}`}
                        >
                          <Download size={14} /> {downloading === b.name ? "Starting…" : "Download"}
                        </button>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="col-lg-4">
            <div style={card} className="p-3">
              <div className="d-flex align-items-center gap-2 mb-2" style={{ ...text, fontWeight: 700 }}>
                <FolderOpen size={16} /> How to open a backup
              </div>
              <ol className="ps-3 mb-2" style={{ ...muted, fontSize: "0.82rem", lineHeight: 1.55, listStyle: "decimal" }}>
                <li>
                  Click <b>Download</b>. You get one <b>.zip</b> file, e.g. <code>INDO-2026-11-28_0230.zip</code>, named by its India date and time.
                </li>
                <li>Double-click it (Windows or Mac). A folder appears with:</li>
              </ol>
              <ul className="ps-3 mb-3" style={{ ...muted, fontSize: "0.8rem", lineHeight: 1.55, listStyle: "none" }}>
                <li>
                  <b style={text}>excel/</b> — every list as a spreadsheet: data-entry sheets, machines, parts, operators, the logs… Opens in Excel or Google Sheets.
                  Dates are India time; passwords are left out.
                </li>
                <li>
                  <b style={text}>uploads/</b> — every uploaded file: profile pictures, logos, ticket attachments.
                </li>
                <li>
                  <b style={text}>database/</b> — every record exactly as stored, for putting the data back.
                </li>
                <li>
                  <b style={text}>README.txt</b> — what is inside and how to restore it, step by step.
                </li>
              </ul>
              <div className="d-flex align-items-start gap-2 mb-3" style={{ ...muted, fontSize: "0.78rem", lineHeight: 1.5 }}>
                <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: 3 }} />
                <span>Before a backup is kept, the server opens it again and checks every file and every record count — a broken one is never saved.</span>
              </div>
              {schedule.standby ? (
                <div className="d-flex align-items-start gap-2 mb-3" style={{ ...muted, fontSize: "0.8rem", lineHeight: 1.5 }}>
                  <HardDrive size={14} style={{ flexShrink: 0, marginTop: 3 }} />
                  <span>
                    The standby database <b>{schedule.standby}</b> is refreshed from it every day.
                  </span>
                </div>
              ) : null}
              <div style={{ ...text, fontWeight: 700, fontSize: "0.85rem" }}>Put the data back</div>
              <div style={{ ...muted, fontSize: "0.8rem", lineHeight: 1.5 }}>
                A developer runs <code>node seed/backupDb.js --restore &lt;file.zip&gt; --uploads</code> (the unzipped folder works too): it loads everything into a new
                database and puts back any missing uploaded files. The README inside the zip has the exact steps, and how to do it with plain MongoDB tools.
              </div>
              <div className="mt-3 p-2" style={{ borderRadius: 10, background: "rgba(217,119,6,0.08)", color: "#b45309", fontSize: "0.78rem", lineHeight: 1.45 }}>
                Backups are kept on the server. Download one every week and keep it somewhere else (Google Drive, an office computer), so a copy survives even if
                the server itself is lost. The file holds all the company's data: keep it private.
              </div>
            </div>
          </div>
        </div>
      </Container>

      <ConfirmAlert
        isOpen={confirming}
        variant="info"
        title="Back up now?"
        message="Saves the whole database and every uploaded file as a new dated backup. It takes a few seconds; the app keeps working meanwhile."
        confirmText="Yes, back up now"
        cancelText="Cancel"
        onConfirm={backUpNow}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
};

export default Backups;
