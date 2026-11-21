import React, { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader, Label, Button, Alert, Spinner } from 'reactstrap';
import dayjs from 'dayjs';
import { Smartphone, Power, PackageCheck } from 'lucide-react';
import { useAppUpdateStatus, useUpdateAppUpdate } from '../../hooks/useAppUpdate';
import { useAlert } from '../../context/AlertContext';

/**
 * Components/Common/AppUpdateModeCard.jsx
 * ──────────────────────────────────────────
 * SuperAdmin-only control panel (embedded in pages/CompanyManagement.jsx,
 * /hqepl/company, right below Maintenance/Announcement Mode) for the
 * MOBILE app's force-update gate — see the Flutter app's (mobile/)
 * lib/providers/app_update_provider.dart + update_required_screen.dart.
 *
 * "Last Reported Build" up top is read-only — it's set by
 * mobile/scripts/report_version.sh right after a real
 * `flutter build`, not typed here, so it reflects what was actually just
 * published instead of an admin's memory of it.
 *
 * ONE "Minimum Required Version" field for both Android and iOS — Flutter
 * ships a single version number to both stores at once, so there was never
 * a real case for these to differ, and two separate inputs just risked
 * someone setting one platform and forgetting the other.
 *
 * Web is never gated by this — a browser always serves the latest build on
 * refresh, there's no "stuck on an old install" problem to force here.
 */
export default function AppUpdateModeCard() {
  const toast = useAlert();
  const { data: appUpdate, isLoading } = useAppUpdateStatus();
  const { mutateAsync, isPending } = useUpdateAppUpdate();

  const [localActive, setLocalActive] = useState(false);
  const [localMinVersion, setLocalMinVersion] = useState('');
  const [localLatestVersion, setLocalLatestVersion] = useState('');
  const [localMessage, setLocalMessage] = useState('');
  const [localSoftMessage, setLocalSoftMessage] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState(false);

  // Same host this web app itself is talking to (client/.env's
  // VITE_API_BASE_URL, or this page's own origin when that is blank and the
  // API is served same-origin behind the proxy) — whichever deployment this
  // page is running on, the report script targets that SAME backend.
  const apiOrigin = (import.meta.env.VITE_API_BASE_URL || window.location.origin).replace(/\/+$/, '');
  const reportCommand = `./scripts/report_version.sh --url ${apiOrigin}/api/v1 --secret <SECRET>`;

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(reportCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy — select the command text manually.');
    }
  };

  // Hydrate local form state once the real doc arrives — only once, so an
  // in-progress edit isn't clobbered by a background refetch.
  useEffect(() => {
    if (!appUpdate || hydrated) return;
    setLocalActive(!!appUpdate.isActive);
    setLocalMinVersion(appUpdate.minVersion || '');
    setLocalLatestVersion(appUpdate.latestVersion || '');
    setLocalMessage(appUpdate.message || '');
    setLocalSoftMessage(appUpdate.softMessage || '');
    setHydrated(true);
  }, [appUpdate, hydrated]);

  const isValidVersion = (v) => v === '' || /^\d+(\.\d+){0,3}$/.test(v.trim());

  const handleSave = async () => {
    if (!isValidVersion(localLatestVersion)) {
      toast.error('Latest version must look like "1.3.0" (numbers and dots only), or be left blank.');
      return;
    }

    if (!isValidVersion(localMinVersion)) {
      toast.error('Version must look like "1.3.0" (numbers and dots only), or be left blank.');
      return;
    }

    // Enabling this is high-blast-radius (locks every mobile install below
    // the floor out of the app entirely) — confirm before flipping it on,
    // same pattern as MaintenanceModeCard's own kill-switch.
    if (localActive && !appUpdate?.isActive) {
      const ok = await toast.confirm(
        'This immediately blocks anyone on the mobile app (Android and iOS) below the minimum version you set, until they update.',
        { title: 'Enable Force Update?', confirmText: 'Yes, Enable Now', cancelText: 'Cancel', tone: 'danger' }
      );
      if (!ok) return;
    }

    try {
      await mutateAsync({
        isActive: localActive,
        minVersion: localMinVersion.trim(),
        latestVersion: localLatestVersion.trim(),
        message: localMessage,
        softMessage: localSoftMessage,
      });
      toast.success(localActive ? 'Force update is now active.' : 'App update settings saved.');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save app update settings.');
    }
  };

  const isDirty =
    hydrated &&
    appUpdate &&
    (localActive !== !!appUpdate.isActive ||
      localMinVersion.trim() !== (appUpdate.minVersion || '') ||
      localLatestVersion.trim() !== (appUpdate.latestVersion || '') ||
      localMessage !== (appUpdate.message || '') ||
      localSoftMessage !== (appUpdate.softMessage || ''));

  return (
    <Card>
      <CardHeader>
        <div className="d-flex align-items-center gap-2">
          <Smartphone size={20} />
          <h5 className="mb-0">App Update</h5>
        </div>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <div className="text-center py-4"><Spinner size="sm" /></div>
        ) : (
          <>
            <p className="text-muted mb-4">
              Require everyone on the mobile app (Android and iOS both) to update to a newer version. Turn the
              switch on and set a minimum version below — anyone on an older install sees a full-screen
              "Update Required" page until they update, on their very next app open. Separately, and regardless
              of that switch, you can also set a Latest Available Version below to nudge anyone below it with a
              small dismissible bar, without blocking them.
            </p>

            {appUpdate?.isActive && (
              <Alert color="warning" className="d-flex align-items-center gap-2 mb-4">
                <Power size={16} />
                <span>Force update is <strong>currently active</strong> — installs below the minimum version are blocked.</span>
              </Alert>
            )}

            <div className="d-flex align-items-start gap-2 border rounded p-3 mb-4" style={{ background: 'var(--vz-secondary-bg)' }}>
              <PackageCheck size={18} className="text-muted flex-shrink-0 mt-1" />
              <div className="flex-grow-1" style={{ minWidth: 0 }}>
                <div className="fw-semibold">
                  Last Reported Build:{' '}
                  {appUpdate?.reportedVersion ? (
                    <span className="text-primary">{appUpdate.reportedVersion}</span>
                  ) : (
                    <span className="text-muted fw-normal">none yet</span>
                  )}
                </div>
                <div className="text-muted small mb-2">
                  {appUpdate?.reportedVersion
                    ? `Reported ${dayjs(appUpdate.reportedAt).format('D MMM YYYY, h:mm A')} — set automatically by the command below, run after each build.`
                    : 'Run the command below (from the mobile/ folder) after your next build to see it here.'}
                </div>
                <div className="d-flex align-items-center gap-2">
                  <code
                    className="d-block flex-grow-1 p-2 rounded"
                    style={{ background: 'rgba(0,0,0,0.35)', fontSize: '0.76rem', overflowX: 'auto', whiteSpace: 'pre', color: '#e2e8f0' }}
                  >
                    {reportCommand}
                  </code>
                  <Button color="light" size="sm" className="border flex-shrink-0" onClick={handleCopyCommand}>
                    {copied ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
                <div className="text-muted mt-1" style={{ fontSize: '0.72rem' }}>
                  Replace <code>&lt;SECRET&gt;</code> with the <code>APP_UPDATE_REPORT_SECRET</code> value from <code>server/.env</code> — it's deliberately not shown on this page.
                </div>
              </div>
            </div>

            <div className="d-flex align-items-center justify-content-between border rounded p-3 mb-4" style={{ background: 'var(--vz-secondary-bg)' }}>
              <div>
                <div className="fw-semibold">Enable Force Update</div>
                <div className="text-muted small">Blocks the mobile app with an "Update Required" screen for anyone below the minimum version set below.</div>
              </div>
              <div className="form-check form-switch" style={{ transform: 'scale(1.4)', transformOrigin: 'right center' }}>
                <input
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  id="appUpdateActiveSwitch"
                  checked={localActive}
                  onChange={(e) => setLocalActive(e.target.checked)}
                />
              </div>
            </div>

            <div className="mb-4">
              <Label className="fw-semibold">Minimum Required Version</Label>
              <input
                type="text"
                className="form-control"
                placeholder="Blank = never block anyone"
                value={localMinVersion}
                onChange={(e) => setLocalMinVersion(e.target.value)}
              />
              <div className="text-muted small mt-1">Applies to both Android and iOS. Anyone below this is blocked, once the switch above is on.</div>
            </div>

            <div className="mb-4">
              <Label className="fw-semibold">Latest Available Version (optional)</Label>
              <input
                type="text"
                className="form-control"
                placeholder="Blank = no update nudge shown"
                value={localLatestVersion}
                onChange={(e) => setLocalLatestVersion(e.target.value)}
              />
              <div className="text-muted small mt-1">
                Shows a small dismissible "Update available" bar at the bottom of the app to anyone below this
                version — does NOT block them, unlike Minimum Required Version above.
              </div>
              <Button
                color="light"
                size="sm"
                className="border mt-2"
                onClick={() => setLocalLatestVersion(appUpdate?.reportedVersion || '')}
                disabled={!appUpdate?.reportedVersion}
              >
                Use Last Reported Build ({appUpdate?.reportedVersion || 'none yet'})
              </Button>
            </div>

            <div className="mb-4">
              <Label className="fw-semibold">Soft Update Message</Label>
              <textarea
                className="form-control"
                rows={2}
                maxLength={500}
                placeholder="e.g. Update available! Update now for the latest features."
                value={localSoftMessage}
                onChange={(e) => setLocalSoftMessage(e.target.value)}
              />
              <div className="text-muted small mt-1">
                Shown on the mobile bottom-bar nudge above — separate from the force-update Message below. Optional —
                defaults to "Update available" if left blank.
              </div>
            </div>

            <div className="mb-4">
              <Label className="fw-semibold">Message</Label>
              <textarea
                className="form-control"
                rows={2}
                maxLength={500}
                placeholder="e.g. A required update is available. Please update to continue using the app."
                value={localMessage}
                onChange={(e) => setLocalMessage(e.target.value)}
              />
              <div className="text-muted small mt-1">Shown on the mobile full-screen "Update Required" block only. Optional — a sensible default is used if left blank.</div>
            </div>

            {appUpdate?.updatedAt && (
              <div className="text-muted small mb-3">Last updated {dayjs(appUpdate.updatedAt).format('D MMM YYYY, h:mm A')}</div>
            )}

            <div className="text-end mt-3">
              <Button color="primary" onClick={handleSave} disabled={isPending || !isDirty} className="px-4" style={{ opacity: (!isDirty && !isPending) ? 0.6 : 1 }}>
                {isPending ? <><Spinner size="sm" className="me-1" /> Saving...</> : 'Save App Update Settings'}
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
