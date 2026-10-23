import { useContext } from "react";
import { useParams } from "react-router-dom";
import { MenuContext } from "../context/MenuContext";
import { toRolePath } from "./roleUrl";

/**
 * utils/processAccess.js
 * ────────────────────────
 * Which processes a person may see on the Production Dashboard: the ones whose
 * data-entry page their role can View in Manage Role — the same pages the
 * sidebar shows them. Super Admin sees every process.
 *
 * A process's page is the one it's linked to in Process Master (its "Data
 * Entry Page"); a process not linked yet is taken by its name, the way each
 * sheet recognises its own process (utils/*Sheet.js).
 * The server refuses the rest the same way — keep in step with
 * server/utils/processAccess.js.
 */

const PAGE_BY_NAME = [
  [/\bcnc\b/i, "/hqepl/production/cnc-data-entry"],
  [/\bvmc\b/i, "/hqepl/production/vmc-data-entry"],
  [/\bspm\b/i, "/hqepl/production/spm-data-entry"],
  [/\brivet\b/i, "/hqepl/production/rivet-data-entry"],
  [/\bpress\b/i, "/hqepl/production/press-data-entry"],
  [/\bcontact\b/i, "/hqepl/production/contact-data-entry"],
  [/\btrobe\b/i, "/hqepl/production/trobe-data-entry"],
  [/\bspring\b/i, "/hqepl/production/spring-data-entry"],
  [/powder\s*coating/i, "/hqepl/production/powder-coating-data-entry"],
  [/\brubber\b/i, "/hqepl/production/rubber-data-entry"],
];

export const dataEntryPageOf = (process) =>
  process?.dataEntryMenu || PAGE_BY_NAME.find(([re]) => re.test(process?.processName || ""))?.[1] || null;

// → { canView(process), ready } — ready once the role's menus have loaded, so
// a page doesn't briefly decide "no access" before it knows.
export const useProcessAccess = () => {
  const { roleSlug } = useParams();
  const { isAdmin, loading, findMenuIdByUrl, getPermissionsForMenu } = useContext(MenuContext) || {};
  const canView = (process) => {
    if (isAdmin) return true;
    const page = dataEntryPageOf(process);
    if (!page || !roleSlug) return false;
    const menuId = findMenuIdByUrl?.(toRolePath(page, roleSlug));
    return !!menuId && !!getPermissionsForMenu?.(menuId)?.view;
  };
  return { canView, ready: !loading };
};
