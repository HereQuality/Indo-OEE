import React, { useContext, useEffect } from "react";
import { useLocation } from "react-router-dom";
import dayjs from "dayjs";
import { useCompany } from "./hooks/useCompany";
import { useMaintenanceStatus } from "./hooks/useMaintenance";
import { useAnnouncementStatus } from "./hooks/useAnnouncement";
import { useOncePerDayPopup } from "./hooks/useOncePerDayPopup";
import { AuthContext } from "./context/AuthContext";
import { logout } from "./api/auth.api";
import defaultFavicon from "./assets/Fevicon_hqepl.png";
const API_URL = import.meta.env.VITE_API_BASE_URL;

// Import Main Routes
import Route from "./Routes";
import UnderMaintenance from "./pages/UnderMaintenance";
import MaintenanceAnnouncementModal from "./Components/Common/MaintenanceAnnouncementModal";
import AnnouncementModal from "./Components/Common/AnnouncementModal";
import FullPageLoader from "./Components/Common/FullPageLoader";

import "./index.css";

// Stays reachable even while maintenance mode is blocking everything else
// — a logged-out (or about-to-switch-accounts) SuperAdmin still needs a
// way to actually sign in. Every other URL renders UnderMaintenance
// instead of its real content while blocked — see the `blocked` check
// below and middlewares/maintenance.middleware.js for the server-side
// enforcement this UI gate is paired with.
const MAINTENANCE_BYPASS_PATHS = ["/", "/login", "/landing"];

function App() {
  const { data: companyDetails } = useCompany();
  const { adminData, isSessionVerified } = useContext(AuthContext);
  const location = useLocation();

  // `isPending` (not `isLoading`) — in TanStack Query v5, `isLoading` is
  // `isPending && isFetching`, so it flips to false the moment a failed
  // request's retries are exhausted, EVEN WITH NO DATA EVER RECEIVED.
  // Gating on `isLoading` would let `maintenance` stay `undefined` and
  // `!!maintenance?.isActive` silently read as "not active," letting a
  // non-SuperAdmin straight through to the full app instead of the block
  // screen. `isPending` stays true until real data arrives, so we keep
  // showing the loader instead of failing open.
  const { data: maintenance, isPending: maintenanceLoading, isFetching, refetch } = useMaintenanceStatus();
  const { data: announcement } = useAnnouncementStatus();

  // "Show once a day" is decided per-popup, but the two popups are
  // SEQUENCED here rather than shown independently — both are full-screen
  // centered overlays, so if both fired at once one would just silently
  // cover the other. Maintenance takes priority; the announcement only
  // opens once the maintenance popup has nothing left pending.
  const maintenanceReady = !!maintenance?.scheduledAt && dayjs(maintenance.scheduledAt).isValid();
  const [maintenancePending, dismissMaintenance] = useOncePerDayPopup(
    "indo_maintenance_announcement_seen",
    maintenanceReady,
    maintenance?.updatedAt
  );
  const announcementReady = !!announcement?.isLive && !!announcement?.message;
  const [announcementPending, dismissAnnouncement] = useOncePerDayPopup(
    "indo_announcement_seen",
    announcementReady,
    announcement?.updatedAt
  );

  useEffect(() => {
    if (companyDetails) {
      const { name, favicon } = companyDetails;

      if (name) {
        // Dynamically update the suffix of the current document title
        const titleParts = document.title.split(' | ');
        if (titleParts.length > 0) {
          document.title = `${titleParts[0]} | ${name}`;
        } else {
          document.title = name;
        }
      }

      // Update favicon: use company-uploaded favicon or fall back to default
      let link = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = favicon ? favicon : defaultFavicon;
    }
  }, [companyDetails]);

  const bypassRoute = MAINTENANCE_BYPASS_PATHS.includes(location.pathname);

  // Bypass paths render immediately, no waiting on anything. Every other
  // path waits for BOTH the session check and the maintenance check to
  // resolve before mounting the real route tree: without this, an
  // anonymous visitor deep-linking to a protected URL could get bounced
  // to /login by RoleRoute (a bypass path) before the maintenance fetch
  // lands, never seeing the block screen at all.
  if (!bypassRoute && (!isSessionVerified || maintenanceLoading)) {
    return <FullPageLoader label="Checking access..." />;
  }

  const isSuperAdmin = adminData?.roleType === "SuperAdmin";
  // SuperAdmin bypasses entirely (server-side too). Everyone else, logged
  // in or not, sees UnderMaintenance in place of the whole app the moment
  // isActive flips on, except on the few bypass paths above.
  const blocked = !!maintenance?.isActive && !isSuperAdmin && !bypassRoute;

  if (blocked) {
    return (
      <UnderMaintenance
        message={maintenance?.message}
        scheduledAt={maintenance?.scheduledAt}
        companyName={companyDetails?.name}
        companyLogo={companyDetails?.logo}
        companyFavicon={companyDetails?.favicon}
        isLoggedIn={!!adminData}
        onSignOut={logout}
        onRefresh={refetch}
        checking={isFetching}
      />
    );
  }

  return (
    <React.Fragment>
      {isSessionVerified && !isSuperAdmin && (
        <MaintenanceAnnouncementModal
          open={maintenancePending}
          onDismiss={dismissMaintenance}
          scheduledAt={maintenance?.scheduledAt}
          message={maintenance?.message}
        />
      )}
      {isSessionVerified && !isSuperAdmin && (
        <AnnouncementModal
          open={!maintenancePending && announcementPending}
          onDismiss={dismissAnnouncement}
          message={announcement?.message}
        />
      )}
      <Route />
    </React.Fragment>
  );
}

export default App;