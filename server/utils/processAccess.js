"use strict";
/**
 * utils/processAccess.js
 * ────────────────────────
 * Which processes a person may see on the Production Dashboard: the ones whose
 * data-entry page their role can View in Manage Role — the same pages the
 * sidebar shows them. Super Admin sees every process.
 *
 * A process's page is the one it's linked to in Process Master (its "Data
 * Entry Page"); a process not linked yet is taken by its name, the way each
 * sheet recognises its own process (client/src/utils/*Sheet.js).
 * Keep in step with client/src/utils/processAccess.js.
 */

const MenuMaster = require("../models/MenuMaster");
const OperatorRoles = require("../models/OperatorRoles");

const PAGE_BY_NAME = [
  [/\bcnc\b/i, "/production/cnc-data-entry"],
  [/\bvmc\b/i, "/production/vmc-data-entry"],
  [/\bspm\b/i, "/production/spm-data-entry"],
  [/\brivet\b/i, "/production/rivet-data-entry"],
  [/\bpress\b/i, "/production/press-data-entry"],
  [/\bcontact\b/i, "/production/contact-data-entry"],
  [/\btrobe\b/i, "/production/trobe-data-entry"],
  [/\bspring\b/i, "/production/spring-data-entry"],
  // Before AFTER POWDER COATING's pattern, which "BEFORE POWDER COATING" also matches.
  [/before\s*powder\s*coating/i, "/production/before-powder-coating-data-entry"],
  [/powder\s*coating/i, "/production/powder-coating-data-entry"],
  [/\brubber\b/i, "/production/rubber-data-entry"],
  // FINAL ASSEMBLY — the whole name, so MODULAR FRAME ASSEMBLY (or any other
  // "… ASSEMBLY") is never taken for it, nor it for them.
  [/\bfinal\s*assembly\b/i, "/production/final-assembly-data-entry"],
  [/\bprinting\b/i, "/production/printing-data-entry"],
  [/\binjection\b/i, "/production/injection-moulding-data-entry"],
  [/\bembossing\b/i, "/production/embossing-data-entry"],
  // RAW CASTING — no other pattern above matches it, nor this one any other name.
  [/\braw\s*casting\b/i, "/production/raw-casting-data-entry"],
  // MODULAR FRAME DRILLING — the whole name, so neither "DRILLING" alone nor any
  // other process is ever taken for it.
  [/\bmodular\s*frame\s*drilling\b/i, "/production/modular-frame-drilling-data-entry"],
  // MODULAR FRAME ASSEMBLY — the whole name, so it is never MODULAR FRAME
  // DRILLING's or FINAL ASSEMBLY's page, nor theirs this one.
  [/\bmodular\s*frame\s*assembly\b/i, "/production/modular-frame-assembly-data-entry"],
];

const trimPath = (p) => String(p || "").split("?")[0].replace(/\/+$/, "");

const pageOf = (process) =>
  trimPath(process?.dataEntryMenu) || PAGE_BY_NAME.find(([re]) => re.test(process?.processName || ""))?.[1] || null;

// Menu URLs are stored under a role slug ("/hqepl/production/…"); compare from
// the second segment on, as the sidebar does (MenuContext.findMenuIdByUrl).
const samePage = (page, menuUrl) => {
  const url = trimPath(menuUrl);
  const tail = url.replace(/^\/[^/]+/, "");
  return !!tail && (page === url || page.endsWith(tail));
};

/**
 * (req, processes) → null when this person may see every process (Super
 * Admin, or a role that can view every active process's page), otherwise the
 * Set of process ids (strings) they may see. `processes` needs _id,
 * processName, dataEntryMenu and isActive.
 */
const viewableProcessIds = async (req, processes) => {
  if (req.user?.roleType === "SuperAdmin") return null;
  const role = req.user?.roleId
    ? await OperatorRoles.findOne({ roleId: req.user.roleId, isActive: true }).select("roles").lean()
    : null;
  const menuIds = (role?.roles || []).filter((r) => r.view && r.menuId).map((r) => r.menuId);
  const menus = menuIds.length ? await MenuMaster.find({ _id: { $in: menuIds }, isActive: true }).select("menuUrl").lean() : [];

  const ids = new Set();
  for (const p of processes) {
    const page = pageOf(p);
    if (page && menus.some((m) => samePage(page, m.menuUrl))) ids.add(String(p._id));
  }
  // Every active process open to them: nothing to hide — "All machines" then
  // also keeps the machines not in any process, as it does for Super Admin.
  const active = processes.filter((p) => p.isActive !== false);
  if (active.length && active.every((p) => ids.has(String(p._id)))) return null;
  return ids;
};

module.exports = { viewableProcessIds, pageOf };
