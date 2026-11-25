import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AuditLogList, { LogRow } from "./AuditLogList.jsx";
import AuditLogTab from "../OeeReview/AuditLogTab.jsx";

// The shared audit row, rendered to HTML as the page / modal / OEE tab show it.
const html = (el) => renderToStaticMarkup(el);
const base = { _id: "l1", createdAt: "2026-11-25T08:30:00.000Z", actor: { id: "u1", model: "Operator", name: "Mann", role: "Admin" }, client: "web" };

test("a Marked Not running row shows its badge, module, reasons and remarks", () => {
  const out = html(
    <LogRow
      log={{
        ...base,
        action: "marked",
        module: "CNC data entry",
        label: "CNC · 7A · 25/11/2026",
        changes: [
          { field: "reasons", label: "Reasons", to: ["Breakdown", "No operator"] },
          { field: "remarks", label: "Remarks", to: "Spindle bearing replaced" },
        ],
      }}
    />,
  );
  assert.match(out, /Marked Not running/);
  assert.match(out, /text-warning-emphasis/);
  assert.match(out, /CNC data entry/);
  assert.match(out, /CNC · 7A · 25\/11\/2026/);
  assert.match(out, /by Mann · Admin · Web/);
  assert.match(out, /Reasons/);
  assert.match(out, /Breakdown, No operator/);
  assert.match(out, /Spindle bearing replaced/);
});

test("an edited mark shows old → new; an undone mark shows what was removed", () => {
  const edited = html(<LogRow log={{ ...base, action: "marked", label: "x", changes: [{ field: "remarks", label: "Remarks", from: "Power cut", to: "Power cut — back at 2pm" }] }} />);
  assert.match(edited, /Power cut<\/span>/);
  assert.match(edited, /Power cut — back at 2pm/);
  const undone = html(<LogRow log={{ ...base, action: "unmarked", label: "x", client: "app", changes: [{ field: "reasons", label: "Reasons", from: ["Holiday / plant off"] }], remark: "Back to Not filled yet" }} />);
  assert.match(undone, /Not running undone/);
  assert.match(undone, /text-secondary-emphasis/);
  assert.match(undone, /Holiday \/ plant off/);
  assert.match(undone, /Back to Not filled yet/);
  assert.match(undone, /· App/);
});

test("sign-in rows: Signed in is green with its remark, Sign-in failed is red", () => {
  const ok = html(<LogRow log={{ ...base, action: "login", module: "Sign-in", label: "Mann", remark: "Remember me" }} />);
  assert.match(ok, /Signed in/);
  assert.match(ok, /text-success-emphasis/);
  assert.match(ok, /Remember me/);
  const failed = html(<LogRow log={{ ...base, action: "loginFailed", module: "Sign-in", label: "mann", actor: { name: "mann" }, client: "", remark: "Wrong password" }} />);
  assert.match(failed, /Sign-in failed/);
  assert.match(failed, /text-danger-emphasis/);
  assert.match(failed, /Wrong password/);
  assert.match(failed, /by mann</);
  assert.doesNotMatch(failed, /· Web|· App/);
});

test("a create folds the whole record after 8 fields; the OEE tab hides the module chip", () => {
  const changes = Array.from({ length: 11 }, (_, i) => ({ field: `f${i}`, label: `Field ${i}`, to: i }));
  const out = html(<LogRow log={{ ...base, action: "create", module: "Machine Master", label: "7A", changes }} />);
  assert.match(out, /Created/);
  assert.match(out, /Show all 11 fields/);
  assert.match(out, /Field 7/);
  assert.doesNotMatch(out, /Field 8/);
  const noModule = html(<LogRow log={{ ...base, action: "create", module: "Machine Master", label: "7A", changes: [] }} showModule={false} />);
  assert.doesNotMatch(noModule, /Machine Master/);
  assert.doesNotMatch(noModule, /· Web/);
});

test("the list has loading, error and empty states", () => {
  assert.match(html(<AuditLogList loading />), /Loading…/);
  const err = html(<AuditLogList error="Server down" onRetry={() => {}} />);
  assert.match(err, /Server down/);
  assert.match(err, /Try again/);
  assert.match(html(<AuditLogList logs={[]} emptyText="Nothing between these dates." />), /Nothing between these dates\./);
});

test("the OEE Review audit tab still renders with its action filter", () => {
  const out = html(<AuditLogTab />);
  assert.match(out, /All actions/);
  assert.match(out, /Edited/);
  assert.match(out, /Over 100%/);
  assert.match(out, /Setting changed/);
  assert.match(out, /Loading…/);
});
