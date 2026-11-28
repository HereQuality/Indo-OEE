import test from "node:test";
import assert from "node:assert/strict";
import { ACTION_BY_KEY, AUDIT_ACTIONS, activeChips, actionLabel, badgeClass, buildAuditQuery, csvFileName, isRecordQuery } from "./auditTrail.js";

test("buildAuditQuery sends only the filters that are set, lists joined with commas, skip/limit always", () => {
  const params = buildAuditQuery(
    { from: "2026-11-01", to: "2026-11-25", module: ["machine", "item"], action: "create,delete", actor: "u1", q: "  7A  " },
    { skip: 100, limit: 50 },
  );
  assert.deepEqual(params, {
    from: "2026-11-01",
    to: "2026-11-25",
    module: "machine,item",
    action: "create,delete",
    actor: "u1",
    q: "7A",
    skip: 100,
    limit: 50,
  });
});

test("buildAuditQuery with nothing set is just the first page", () => {
  assert.deepEqual(buildAuditQuery(), { skip: 0, limit: 50 });
  assert.deepEqual(buildAuditQuery({ module: [], action: "", q: "   " }, { skip: -5, limit: 0 }), { skip: 0, limit: 50 });
});

test("buildAuditQuery carries a record query (entity, or sheet + date + machine)", () => {
  assert.deepEqual(buildAuditQuery({ entity: "e1" }, { limit: 10 }), { entity: "e1", skip: 0, limit: 10 });
  assert.deepEqual(buildAuditQuery({ sheet: "cnc", date: "2026-11-20", machine: "m1" }), { sheet: "cnc", date: "2026-11-20", machine: "m1", skip: 0, limit: 50 });
  assert.equal(isRecordQuery({ entity: "e1" }), true);
  assert.equal(isRecordQuery({ sheet: "cnc", date: "2026-11-20", machine: "" }), true);
  assert.equal(isRecordQuery({ sheet: "cnc" }), false);
  assert.equal(isRecordQuery({}), false);
});

test("the CSV download is named after the date range", () => {
  assert.equal(csvFileName({ from: "2026-10-27", to: "2026-11-25" }), "logs-2026-10-27_2026-11-25.csv");
  assert.equal(csvFileName({}), "logs-all_all.csv");
  assert.equal(csvFileName({ from: "2026-11-01" }), "logs-2026-11-01_all.csv");
});

test("every action in the contract has a label and a colour", () => {
  const keys = [
    "create", "update", "delete", "unlocked", "flagged", "cleared", "approved", "rejected", "setting", "marked", "unmarked",
    "login", "loginFailed", "logout", "passwordChange", "passwordReset", "impersonate", "blocked", "unblocked", "sent", "import", "download", "other", "view", "error",
  ];
  assert.deepEqual(AUDIT_ACTIONS.map((a) => a.key).sort(), keys.sort());
  assert.equal(actionLabel("marked"), "Marked Not running");
  assert.equal(actionLabel("unmarked"), "Not running undone");
  assert.equal(actionLabel("loginFailed"), "Sign-in failed");
  assert.equal(actionLabel("impersonate"), "Signed in as another user");
  assert.equal(actionLabel("update"), "Edited");
  assert.equal(actionLabel("flagged"), "Over 100%");
  assert.equal(actionLabel("somethingNew"), "somethingNew");
  assert.match(badgeClass("create"), /success/);
  assert.match(badgeClass("login"), /success/);
  assert.match(badgeClass("update"), /primary/);
  assert.match(badgeClass("delete"), /danger/);
  assert.match(badgeClass("loginFailed"), /danger/);
  assert.match(badgeClass("blocked"), /danger/);
  assert.match(badgeClass("unlocked"), /warning/);
  assert.match(badgeClass("marked"), /warning/);
  assert.match(badgeClass("unmarked"), /secondary/);
  assert.match(badgeClass("logout"), /secondary/);
  assert.equal(ACTION_BY_KEY.impersonate.tone, "purple");
  assert.match(badgeClass("unknown"), /secondary/);
});

test("filter chips name the module / action / user / search in force, not the dates or record", () => {
  const chips = activeChips(
    { from: "2026-11-01", to: "2026-11-25", module: ["machine"], action: ["create"], actor: "u1", q: " 7A ", entity: "e1" },
    { modules: [{ key: "machine", label: "Machine Master" }], actions: [{ key: "create", label: "Created" }], actors: [{ id: "u1", name: "Mann", role: "Admin" }] },
  );
  assert.deepEqual(chips.map((c) => c.label), ["Module: Machine Master", "Action: Created", "User: Mann", "Search: “7A”"]);
  assert.deepEqual(activeChips({ from: "2026-11-01", to: "2026-11-25" }), []);
});
