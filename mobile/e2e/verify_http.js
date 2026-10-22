'use strict';
// HTTP smoke of the running e2e backend: logs in every seeded user, reads
// /menus /processes /machines, and does one real save (PUT <x>-sheet/row)
// per process endpoint. Talks only to http://127.0.0.1:<port> (the harness).
//   node mobile/e2e/verify_http.js
const fs = require('fs');
const path = require('path');
const env = JSON.parse(fs.readFileSync(path.join(__dirname, 'e2e_env.json'), 'utf8'));
const BASE = `${env.baseUrl}/api/v1`;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.baseUrl)) throw new Error('E2E SAFETY: baseUrl must be local');

let failures = 0;
const ok = (c, msg, extra = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}${extra ? '  ' + extra : ''}`); if (!c) failures++; };
async function call(method, url, token, body) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch (_) {}
  return { status: r.status, json };
}
// A recent non-Sunday date (weekly off is Sunday) so nothing about the day is special.
function entryDate() {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - 1);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
const DATE = entryDate();
const first = (k, p) => env[k][p][0];

// One valid save per sheet. Keep these in step with the controllers' entryRuleError.
function payloads() {
  const common = { date: DATE, slot: 'auto', machineOnTime: '08:00', machineOffTime: '16:00', plannedOperatorShiftHours: 12, lunchMin: 30, remarks: 'e2e' };
  const m = (p) => first('machines', p).id;
  const op = (p) => first('machineOperators', p).name;
  const it = (p) => first('items', p);
  return {
    CNC: ['/production-sheet/row', { ...common, machine: m('CNC'), operator: op('CNC'), item: it('CNC').id, itemName: it('CNC').name, drawingNo: 'DRG-C101', setupNo: 'S-11', totalCycleSec: 60, actualQty: 400, okQty: 390 }],
    VMC: ['/vmc-sheet/row', { ...common, machine: m('VMC'), operator: op('VMC'), item: it('VMC').id, itemName: it('VMC').name, programTimeMin: 6, pcsPerProgram: 2, okQty: 150, rejectedQty: 5 }],
    SPM: ['/spm-sheet/row', { ...common, machine: m('SPM'), operator: op('SPM'), item: it('SPM').id, itemName: it('SPM').name, noOfHoles: 4, piecesPerCycle: 2, strokeRequired: 4, loadingSec: 6, processSec: 10, unloadingCleaningSec: 4, otherOperationsSec: 0, totalCycleSec: 20, okQty: 1000, rejectedQty: 20 }],
    RIVET: ['/rivet-sheet/row', { ...common, machine: m('RIVET'), operator: op('RIVET'), item: it('RIVET').id, itemName: it('RIVET').name, processType: 'Rivet', noOfHoles: 2, rivetLoadingSec: 5, rivetProcessSec: 8, rivetUnloadingCleaningSec: 3, rivetOtherOperationsSec: 0, totalCycleSec: 16, okQty: 1500, rejectedQty: 10 }],
    PRESS: ['/press-sheet/row', { ...common, machine: m('PRESS'), operator: op('PRESS'), item: it('PRESS').id, itemName: it('PRESS').name, operation: 'Blank', standardTimeMin: 2, pcsPerStandardTime: 60, okQty: 10000, rejectedQty: 50 }],
    CONTACT: ['/contact-sheet/row', { ...common, machine: m('CONTACT'), operator: op('CONTACT'), workingStatus: 'PRESENT', item: it('CONTACT').id, itemName: it('CONTACT').name, totalCycleSec: 12, okQty: 2000, rejectedQty: 20 }],
    TROBE: ['/trobe-sheet/row', { ...common, machine: m('TROBE'), operator: op('TROBE'), workingStatus: 'PRESENT', item: it('TROBE').id, itemName: it('TROBE').name, totalCycleSec: 25, okQty: 1000, rejectedQty: 10 }],
    'SPRING FOR PINS': ['/spring-sheet/row', { ...common, machine: m('SPRING FOR PINS'), operator: op('SPRING FOR PINS'), workingStatus: 'PRESENT', item: it('SPRING FOR PINS').id, itemName: it('SPRING FOR PINS').name, totalCycleSec: 8, okQty: 3000, rejectedQty: 30 }],
    'AFTER POWDER COATING': ['/powder-coating-sheet/row', { date: DATE, slot: 'auto', worker: first('machineOperators', 'AFTER POWDER COATING').id, process: env.processes['AFTER POWDER COATING'].id, workingStatus: 'PRESENT', item: it('AFTER POWDER COATING').id, itemName: it('AFTER POWDER COATING').name, totalCycleSec: 30, machineOnTime: '09:00', machineOffTime: '13:00', actualQty: 400, plannedOperatorShiftHours: 12 }],
  };
}
const SHEET_BASE = { CNC: '/production-sheet', VMC: '/vmc-sheet', SPM: '/spm-sheet', RIVET: '/rivet-sheet', PRESS: '/press-sheet', CONTACT: '/contact-sheet', TROBE: '/trobe-sheet', 'SPRING FOR PINS': '/spring-sheet', 'AFTER POWDER COATING': '/powder-coating-sheet' };

(async () => {
  console.log(`# e2e HTTP verify against ${BASE}  (entry date ${DATE})`);
  const tokens = {};
  for (const u of Object.values(env.users)) {
    const r = await call('POST', '/auth/login', null, { username: u.username, password: u.password });
    ok(r.status === 200 && r.json?.token, `login ${u.username} (${u.role})`, `HTTP ${r.status} redirect=${r.json?.redirectUrl}`);
    tokens[u.username] = r.json?.token;
  }
  const bad = await call('POST', '/auth/login', null, { username: 'e2e_vmc', password: 'wrong' });
  ok(bad.status === 401, 'wrong password -> 401', `HTTP ${bad.status}`);

  // read endpoints per user
  for (const u of Object.values(env.users)) {
    const t = tokens[u.username];
    const menus = await call('GET', '/menus/by-groups', t);
    const names = (menus.json?.data || []).flatMap((g) => (g.isLink ? [g.groupName] : g.menus.map((x) => x.name)));
    ok(menus.status === 200, `/menus/by-groups as ${u.username}`, `[${names.join(', ')}]`);
    const procs = await call('GET', '/processes', t);
    ok(procs.status === 200 && procs.json.data.length === 10, `/processes as ${u.username}`, `${procs.json?.data?.length} processes (HTTP ${procs.status})`);
    const mach = await call('GET', '/machines', t);
    ok(mach.status === 200, `/machines as ${u.username}`, `${mach.json?.data?.length} machines`);
  }

  // permission matrix
  const P = payloads();
  const expect = (user, proc, status) => ({ user, proc, status });
  const matrix = [
    expect('e2e_vmc', 'VMC', 200), expect('e2e_vmc', 'CNC', 403),
    expect('e2e_viewonly', 'VMC', 403),
    expect('e2e_multi', 'PRESS', 200), expect('e2e_multi', 'CNC', 200), expect('e2e_multi', 'SPM', 403),
  ];
  // one real save per process as admin (SuperAdmin), including RUBBER (no sheet endpoint)
  const saved = {};
  for (const [proc, [url, body]] of Object.entries(P)) {
    const r = await call('PUT', url, tokens.e2e_admin, body);
    ok(r.status === 200 && r.json?.isOk && r.json?.data?._id, `PUT ${url} (${proc}) as SuperAdmin`, r.status === 200 ? `saved ${r.json.data._id} slot ${r.json.data.slot}` : `HTTP ${r.status} ${r.json?.message}`);
    saved[proc] = r.json?.data;
    // read it back
    const g = await call('GET', `${SHEET_BASE[proc]}?from=${DATE}&to=${DATE}&page=1${proc === 'AFTER POWDER COATING' ? '' : ''}`, tokens.e2e_admin);
    ok(g.status === 200 && (g.json?.data || []).some((x) => x._id === saved[proc]?._id), `GET ${SHEET_BASE[proc]} returns the saved row`, `HTTP ${g.status}`);
  }
  // role-restricted users: write by role. The VMC/PRESS/CNC saves above took slot 1 with fixed times,
  // so use a non-overlapping window and a different operator for these.
  for (const { user, proc, status } of matrix) {
    const [url, body] = P[proc];
    const b = { ...body, machine: env.machines[proc]?.[1]?.id || body.machine, machineOnTime: '17:00', machineOffTime: '19:00', plannedOperatorShiftHours: 12, operator: env.machineOperators[proc][1].name, okQty: Math.min(body.okQty, 20), rejectedQty: 0, actualQty: body.actualQty ? 20 : undefined };
    const r = await call('PUT', url, tokens[user], b);
    ok(r.status === status, `permission: ${user} PUT ${proc} -> ${status}`, `HTTP ${r.status} ${r.status !== 200 ? r.json?.message : ''}`);
  }
  // validation is enforced (server re-checks the form's rules)
  const [vurl, vbody] = P.VMC;
  const over = await call('PUT', vurl, tokens.e2e_admin, { ...vbody, machine: env.machines.VMC[2].id, operator: env.machineOperators.VMC[2].name, okQty: 9999 });
  ok(over.status === 400, 'VMC: OK+Rejected over Ideal Quantity rejected (400)', over.json?.message);
  const rubber = await call('GET', '/processes', tokens.e2e_admin);
  const rub = rubber.json.data.find((p) => p.processName === 'RUBBER');
  ok(rub && !rub.dataEntryMenu, 'RUBBER has no dataEntryMenu (unsupported in app)');

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
