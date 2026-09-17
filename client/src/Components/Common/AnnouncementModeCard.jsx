import React, { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader, Label, Button, Alert, Spinner, Row, Col } from 'reactstrap';
import dayjs from 'dayjs';
import { Megaphone, CalendarRange, X } from 'lucide-react';
import DatePicker from '../DatePicker';
import { useAnnouncementStatus, useUpdateAnnouncement } from '../../hooks/useAnnouncement';
import { useAlert } from '../../context/AlertContext';

/**
 * Components/Common/AnnouncementModeCard.jsx
 * ─────────────────────────────────────────────
 * SuperAdmin-only control panel (embedded in pages/CompanyManagement.jsx,
 * /hqepl/company, right below MaintenanceModeCard) for a non-blocking,
 * once-a-day announcement popup shown to everyone (see
 * Components/Common/AnnouncementModal.jsx):
 *   - `isActive` — master on/off switch.
 *   - `startDate` / `endDate` — the inclusive window it's allowed to show
 *     in. Either can be left blank for an open-ended side.
 *   - It's only actually shown when `isActive` is on AND today falls
 *     inside the window — the server computes that as `isLive`.
 */
export default function AnnouncementModeCard() {
  const toast = useAlert();
  // App.jsx already owns the app-wide 45s poll for this query key — this
  // card only needs to read/update the shared cache, not run a second,
  // unsynchronized poll of its own (see useAnnouncementStatus).
  const { data: announcement, isLoading } = useAnnouncementStatus({ poll: false });
  const { mutateAsync, isPending } = useUpdateAnnouncement();

  const [localActive, setLocalActive] = useState(false);
  const [localMessage, setLocalMessage] = useState('');
  const [localStartDate, setLocalStartDate] = useState('');
  const [localEndDate, setLocalEndDate] = useState('');
  const [hydrated, setHydrated] = useState(false);

  // Hydrate local form state once the real doc arrives — only once, so
  // in-progress edits aren't clobbered by the 45s background refetch.
  useEffect(() => {
    if (!announcement || hydrated) return;
    setLocalActive(!!announcement.isActive);
    setLocalMessage(announcement.message || '');
    setLocalStartDate(announcement.startDate ? dayjs(announcement.startDate).format('YYYY-MM-DD') : '');
    setLocalEndDate(announcement.endDate ? dayjs(announcement.endDate).format('YYYY-MM-DD') : '');
    setHydrated(true);
  }, [announcement, hydrated]);

  const clearWindow = () => {
    setLocalStartDate('');
    setLocalEndDate('');
  };

  const handleSave = async () => {
    if (localActive && !localMessage.trim()) {
      toast.error('Write a message for the announcement first.');
      return;
    }

    if (localStartDate && localEndDate && dayjs(localEndDate).isBefore(dayjs(localStartDate))) {
      toast.error('The end date must be on or after the start date.');
      return;
    }

    const startDate = localStartDate ? dayjs(localStartDate).startOf('day').toISOString() : null;
    const endDate = localEndDate ? dayjs(localEndDate).endOf('day').toISOString() : null;

    try {
      await mutateAsync({ isActive: localActive, message: localMessage, startDate, endDate });
      toast.success(localActive ? 'Announcement is now live.' : 'Announcement settings saved.');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save announcement settings.');
    }
  };

  const isDirty =
    hydrated &&
    announcement &&
    (localActive !== !!announcement.isActive ||
      localMessage !== (announcement.message || '') ||
      localStartDate !== (announcement.startDate ? dayjs(announcement.startDate).format('YYYY-MM-DD') : '') ||
      localEndDate !== (announcement.endDate ? dayjs(announcement.endDate).format('YYYY-MM-DD') : ''));

  return (
    <Card>
      <CardHeader>
        <div className="d-flex align-items-center gap-2">
          <Megaphone size={20} />
          <h5 className="mb-0">Announcement Mode</h5>
        </div>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <div className="text-center py-4"><Spinner size="sm" /></div>
        ) : (
          <>
            {announcement?.isLive && (
              <Alert color="success" className="d-flex align-items-center gap-2 mb-4">
                <Megaphone size={16} />
                <span>Announcement is <strong>currently live</strong> — everyone gets it once today.</span>
              </Alert>
            )}

            {/* Master switch */}
            <div className="d-flex align-items-center justify-content-between border rounded p-3 mb-4" style={{ background: 'var(--vz-secondary-bg)' }}>
              <div>
                <div className="fw-semibold">Enable Announcement</div>
                <div className="text-muted small">Shows everyone a once-a-day popup while this is on and today is inside the window below.</div>
              </div>
              <div className="form-check form-switch" style={{ transform: 'scale(1.4)', transformOrigin: 'right center' }}>
                <input
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  id="announcementActiveSwitch"
                  checked={localActive}
                  onChange={(e) => setLocalActive(e.target.checked)}
                />
              </div>
            </div>

            {/* Message */}
            <div className="mb-4">
              <Label className="fw-semibold">Message</Label>
              <textarea
                className="form-control"
                rows={3}
                maxLength={1000}
                placeholder="e.g. New: you can now export audit evidence as a single PDF report. Check it out under Reports!"
                value={localMessage}
                onChange={(e) => setLocalMessage(e.target.value)}
              />
              <div className="text-muted small mt-1">Shown once a day, to every signed-in user, as a popup.</div>
            </div>

            {/* Display window */}
            <div className="mb-2">
              <Label className="fw-semibold d-flex align-items-center gap-1">
                <CalendarRange size={14} /> Display Window
              </Label>
              <div className="text-muted small mb-2">
                The announcement only shows while <strong>Enable Announcement</strong> is on and today is between these two dates. Leave either blank to leave that side open-ended.
              </div>
            </div>
            <Row className="mb-2">
              <Col md={5}>
                <DatePicker
                  id="announcement-start-date"
                  label="Start date"
                  value={localStartDate}
                  onChange={(e) => setLocalStartDate(e.target.value)}
                  maxDate={localEndDate || undefined}
                />
              </Col>
              <Col md={5}>
                <DatePicker
                  id="announcement-end-date"
                  label="End date"
                  value={localEndDate}
                  onChange={(e) => setLocalEndDate(e.target.value)}
                  minDate={localStartDate || undefined}
                />
              </Col>
              <Col md={2} className="d-flex align-items-end">
                {(localStartDate || localEndDate) && (
                  <Button color="light" size="sm" className="mb-1 d-flex align-items-center gap-1" onClick={clearWindow} title="Clear window">
                    <X size={14} /> Clear
                  </Button>
                )}
              </Col>
            </Row>

            {announcement?.updatedAt && (
              <div className="text-muted small mb-3">Last updated {dayjs(announcement.updatedAt).format('D MMM YYYY, h:mm A')}</div>
            )}

            <div className="text-end mt-3">
              <Button color="primary" onClick={handleSave} disabled={isPending || !isDirty} className="px-4" style={{ opacity: (!isDirty && !isPending) ? 0.6 : 1 }}>
                {isPending ? <><Spinner size="sm" className="me-1" /> Saving...</> : 'Save Announcement Settings'}
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
