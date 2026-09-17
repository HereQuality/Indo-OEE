import React, { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader, Label, Button, Alert, Spinner, Row, Col } from 'reactstrap';
import dayjs from 'dayjs';
import { ShieldAlert, CalendarClock, Power, X } from 'lucide-react';
import DatePicker from '../DatePicker';
import TimePicker from '../TimePicker';
import { useMaintenanceStatus, useUpdateMaintenance } from '../../hooks/useMaintenance';
import { useAlert } from '../../context/AlertContext';

/**
 * Components/Common/MaintenanceModeCard.jsx
 * ────────────────────────────────────────────
 * SuperAdmin-only control panel (embedded in pages/CompanyManagement.jsx,
 * /hqepl/company) for the site-wide maintenance kill-switch:
 *   - `isActive` — flipping this ON immediately blocks every non-
 *     SuperAdmin request (see App.jsx +
 *     server/middlewares/maintenance.middleware.js).
 *   - `scheduledAt` + `message` — an advance heads-up shown to everyone
 *     as a once-a-day popup BEFORE the switch is flipped (see
 *     MaintenanceAnnouncementModal.jsx) — independent of `isActive`.
 */
export default function MaintenanceModeCard() {
  const toast = useAlert();
  // App.jsx already owns the app-wide 45s poll for this query key — this
  // card only needs to read/update the shared cache, not run a second,
  // unsynchronized poll of its own (see useMaintenanceStatus).
  const { data: maintenance, isLoading } = useMaintenanceStatus({ poll: false });
  const { mutateAsync, isPending } = useUpdateMaintenance();

  const [localActive, setLocalActive] = useState(false);
  const [localMessage, setLocalMessage] = useState('');
  const [localDate, setLocalDate] = useState('');
  const [localTime, setLocalTime] = useState('');
  const [hydrated, setHydrated] = useState(false);

  // Hydrate local form state once the real doc arrives — only once, so
  // in-progress edits aren't clobbered by the 45s background refetch
  // (see useMaintenanceStatus) while the admin is mid-edit.
  useEffect(() => {
    if (!maintenance || hydrated) return;
    setLocalActive(!!maintenance.isActive);
    setLocalMessage(maintenance.message || '');
    if (maintenance.scheduledAt) {
      const d = dayjs(maintenance.scheduledAt);
      setLocalDate(d.format('YYYY-MM-DD'));
      setLocalTime(d.format('HH:mm'));
    }
    setHydrated(true);
  }, [maintenance, hydrated]);

  const clearSchedule = () => {
    setLocalDate('');
    setLocalTime('');
  };

  const handleSave = async () => {
    if ((localDate && !localTime) || (!localDate && localTime)) {
      toast.error('Please pick both a date and a time for the schedule, or clear both.');
      return;
    }

    let scheduledAt = null;
    if (localDate && localTime) {
      const combined = dayjs(`${localDate}T${localTime}`);
      if (!combined.isValid()) {
        toast.error('That date/time is not valid.');
        return;
      }
      scheduledAt = combined.toISOString();
    }

    // Enabling the live block is high-blast-radius (locks out literally
    // everyone but SuperAdmin, immediately) — confirm
    // before flipping it on, same pattern as other destructive actions
    // in this app (see Layout.jsx's logout ConfirmAlert).
    if (localActive && !maintenance?.isActive) {
      const ok = await toast.confirm(
        'This immediately blocks access to the entire system for everyone except Super Admin, right now.',
        { title: 'Enable Maintenance Mode?', confirmText: 'Yes, Enable Now', cancelText: 'Cancel', tone: 'danger' }
      );
      if (!ok) return;
    }

    try {
      await mutateAsync({ isActive: localActive, message: localMessage, scheduledAt });
      toast.success(localActive ? 'Maintenance mode is now active.' : 'Maintenance settings saved.');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save maintenance settings.');
    }
  };

  const isDirty =
    hydrated &&
    maintenance &&
    (localActive !== !!maintenance.isActive ||
      localMessage !== (maintenance.message || '') ||
      (localDate && localTime ? dayjs(`${localDate}T${localTime}`).toISOString() : null) !== (maintenance.scheduledAt ? dayjs(maintenance.scheduledAt).toISOString() : null));

  return (
    <Card>
      <CardHeader>
        <div className="d-flex align-items-center gap-2">
          <ShieldAlert size={20} />
          <h5 className="mb-0">Maintenance Mode</h5>
        </div>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <div className="text-center py-4"><Spinner size="sm" /></div>
        ) : (
          <>
            {maintenance?.isActive && (
              <Alert color="danger" className="d-flex align-items-center gap-2 mb-4">
                <Power size={16} />
                <span>Maintenance mode is <strong>currently active</strong> — only Super Admin can access the system.</span>
              </Alert>
            )}

            {/* Live kill-switch */}
            <div className="d-flex align-items-center justify-content-between border rounded p-3 mb-4" style={{ background: 'var(--vz-secondary-bg)' }}>
              <div>
                <div className="fw-semibold">Enable Maintenance Mode</div>
                <div className="text-muted small">Blocks all access except Super Admin, immediately.</div>
              </div>
              <div className="form-check form-switch" style={{ transform: 'scale(1.4)', transformOrigin: 'right center' }}>
                <input
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  id="maintenanceActiveSwitch"
                  checked={localActive}
                  onChange={(e) => setLocalActive(e.target.checked)}
                />
              </div>
            </div>

            {/* Message shown on the block page + the popup */}
            <div className="mb-4">
              <Label className="fw-semibold">Message</Label>
              <textarea
                className="form-control"
                rows={2}
                maxLength={500}
                placeholder="e.g. We're upgrading the audit engine. Back shortly — thanks for your patience!"
                value={localMessage}
                onChange={(e) => setLocalMessage(e.target.value)}
              />
              <div className="text-muted small mt-1">Shown on the Under Maintenance page and in the scheduled-maintenance popup. Optional — a sensible default is used if left blank.</div>
            </div>

            {/* Scheduled announcement */}
            <div className="mb-2">
              <Label className="fw-semibold d-flex align-items-center gap-1">
                <CalendarClock size={14} /> Scheduled Maintenance Announcement
              </Label>
              <div className="text-muted small mb-2">
                Pick a date &amp; time to show everyone a one-time-per-day heads-up popup — this does <strong>not</strong> block anything by itself; flip the switch above when the work actually begins.
              </div>
            </div>
            <Row className="mb-2">
              <Col md={5}>
                <DatePicker
                  id="maintenance-date"
                  label="Date"
                  value={localDate}
                  onChange={(e) => setLocalDate(e.target.value)}
                />
              </Col>
              <Col md={5}>
                <TimePicker
                  id="maintenance-time"
                  label="Time"
                  value={localTime}
                  onChange={(e) => setLocalTime(e.target.value)}
                />
              </Col>
              <Col md={2} className="d-flex align-items-end">
                {(localDate || localTime) && (
                  <Button color="light" size="sm" className="mb-1 d-flex align-items-center gap-1" onClick={clearSchedule} title="Clear schedule">
                    <X size={14} /> Clear
                  </Button>
                )}
              </Col>
            </Row>

            {maintenance?.updatedAt && (
              <div className="text-muted small mb-3">Last updated {dayjs(maintenance.updatedAt).format('D MMM YYYY, h:mm A')}</div>
            )}

            <div className="text-end mt-3">
              <Button color="primary" onClick={handleSave} disabled={isPending || !isDirty} className="px-4" style={{ opacity: (!isDirty && !isPending) ? 0.6 : 1 }}>
                {isPending ? <><Spinner size="sm" className="me-1" /> Saving...</> : 'Save Maintenance Settings'}
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
