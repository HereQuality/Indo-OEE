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
  // Before AFTER POWDER COATING's pattern, which "BEFORE POWDER COATING" also matches.
  [/before\s*powder\s*coating/i, "/hqepl/production/before-powder-coating-data-entry"],
  [/powder\s*coating/i, "/hqepl/production/powder-coating-data-entry"],
  [/\brubber\b/i, "/hqepl/production/rubber-data-entry"],
  // FINAL ASSEMBLY — the whole name, so MODULAR FRAME ASSEMBLY is never taken for it.
  [/\bfinal\s*assembly\b/i, "/hqepl/production/final-assembly-data-entry"],
  [/\binjection\b/i, "/hqepl/production/injection-moulding-data-entry"],
  [/\bembossing\b/i, "/hqepl/production/embossing-data-entry"],
  [/\bprinting\b/i, "/hqepl/production/printing-data-entry"],
  // RAW CASTING — no other pattern above matches it, nor this one any other name.
  [/\braw\s*casting\b/i, "/hqepl/production/raw-casting-data-entry"],
  // MODULAR FRAME DRILLING — the whole name, so neither "DRILLING" alone nor any
  // other process is ever taken for it (utils/mfdSheet.js isMfdProcess).
  [/\bmodular\s*frame\s*drilling\b/i, "/hqepl/production/modular-frame-drilling-data-entry"],
  // MODULAR FRAME ASSEMBLY — the whole name, so it is never MODULAR FRAME
  // DRILLING's or FINAL ASSEMBLY's page, nor theirs this one (utils/mfaSheet.js isMfaProcess).
  [/\bmodular\s*frame\s*assembly\b/i, "/hqepl/production/modular-frame-assembly-data-entry"],
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
