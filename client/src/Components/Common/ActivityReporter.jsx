import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { reportClientError, reportPageView } from "../../api/auditTrail.api";

/**
 * Components/Common/ActivityReporter.jsx
 * ───────────────────────────────────────
 * Tells Administration › Logs what a signed-in person does in the web app that
 * the server can't see on its own:
 *   - each page they open (once per address; the page's own title, read a
 *     moment after it loads, names it in the log);
 *   - any error on their screen — a script error or a failed promise nobody
 *     handled (a crashed page is reported by ErrorBoundary itself).
 * Mounted once inside RoleRoute, so only for a valid session. Renders nothing,
 * and every report is fire-and-forget: nothing here can break a page.
 */

const TITLE_DELAY_MS = 1200;
const MAX_ERRORS_PER_SESSION = 20;
const sentErrors = new Set();

const report = (message, stack, source) => {
  const text = String(message || "").trim();
  // Noise every browser produces that says nothing about the app.
  if (!text || /ResizeObserver loop|Script error\.?$/i.test(text)) return;
  const key = `${source}|${text}`;
  if (sentErrors.has(key) || sentErrors.size >= MAX_ERRORS_PER_SESSION) return;
  sentErrors.add(key);
  reportClientError({ message: text, stack: String(stack || ""), path: window.location.pathname, source });
};

export default function ActivityReporter() {
  const { pathname } = useLocation();

  useEffect(() => {
    const t = setTimeout(() => reportPageView(pathname, document.title), TITLE_DELAY_MS);
    return () => clearTimeout(t);
  }, [pathname]);

  useEffect(() => {
    const onError = (e) => report(e?.error?.message || e?.message, e?.error?.stack, "script error");
    const onRejection = (e) => {
      const r = e?.reason;
      // A refused API call is already logged by the server, with its reason.
      if (r?.isAxiosError || r?.response) return;
      report(r?.message || r, r?.stack, "unhandled promise");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
