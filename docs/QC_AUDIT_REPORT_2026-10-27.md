# Software Quality Control Audit Report — INDO OEE

Date: 2026-10-27. Environment: local copies of the database only (never the live Atlas database); real Chromium for the website; Flutter widget tests for the phone/tablet app. No physical phone or tablet, no Safari/Firefox, no real on-screen keyboard was used.

## A. Executive summary

**Release recommendation: READY AFTER MINOR FIXES** (see section J).

| Area | Executed | Result |
|---|---|---|
| Calculations (18 sheets, independent formulas) | about 765,000 case-checks, 135,000 random rows, 54,102 machine/worker-days, 163 real entries, 25 hand-worked cases | 6 bugs found; 5 fixed, 1 awaiting decision. 0 differences between independent check, website, server, app and dashboard afterwards. |
| Pasted Excel rows, 8 new processes, 3 Planned-shift modes | 121 working rows x 3 modes | all match (Modular Frame Drilling matches its chosen formula) |
| API / data entry / security | 3,158 checks | 2,895 pass, 232 fail (16 distinct bugs), 31 notes |
| Browser workflows (website) | 429 cases | 341 pass, 22 fail (7 findings), 54 notes, 11 blocked, 1 n/a |
| Responsive layout (website) | 2,152 page x viewport checks, 22 viewports | 16 bugs (1 critical, 3 high, 4 medium, 8 low); no horizontal page overflow anywhere |
| Phone/tablet app | 1,845 automated tests, 2,592 form layout runs, 432 list/detail runs | 7 findings |
| Final regression run | server 299/299, website 148/152 (the 4 old VMC test failures), app 1,847/1,847, website build passes | see section I |

Critical release risks found and fixed: six dashboards crashed (RESP-001/WEB-001); one entry silently lost under simultaneous saves (API-001).
Still open and needing your decision (all would change a rule or a figure, so they were left alone): cross-process saves (API-002), server-side Rejected-split check (API-003), quantity and date limits (API-004/006), Availability on locked days (CALC-005), case-insensitive operator overlap (API-014), what happens to entries when a process is deleted.

## B. Coverage

- All 18 processes: CNC, VMC, SPM, RIVET, PRESS, CONTACT, TROBE, SPRING FOR PINS, AFTER POWDER COATING, RUBBER, PRINTING, INJECTION MOULDING, BEFORE POWDER COATING, RAW CASTING, MODULAR FRAME DRILLING, MODULAR FRAME ASSEMBLY, EMBOSSING, FINAL ASSEMBLY.
- Pages: Data Entry (list, add, edit, delete), dashboards, OEE Review, Process/Machine/Part/Operator/Vendor/Role/Menu masters, login and session handling.
- Browsers/viewports: Chromium only (emulated): phones 320x568 to 430x932 plus landscape, tablets 600x960 to 1280x800, desktops 1366x768 to 2560x1440, zoom 150%/200%, light and dark themes.
- Not tested: real devices, Safari/WebKit, Firefox, real keyboards, the OS large-text setting, the app's integration_test suite, socket notifications, the live site, and AFTER POWDER COATING's add form (its data copy had no usable data).

## C. Test results (summary; full tables are in the audit folders)

Complete test-case tables: `scratchpad/qa/api/api_report.md` (3,158 rows), `scratchpad/qa/web/web_report.md` (429 rows), `scratchpad/qa/responsive/responsive_report.md`, `scratchpad/qa/mobile/mobile_report.md`, `scratchpad/qa/calc/calc_report.md` (all under the session scratchpad).

## D. Calculation verification

Method: a plain-JS oracle written from the written formulas and the paper sheets, compared on the same rows with the website's adapters, the server's `entryMetrics`/`dayOeeFor`, the Dart port, the dashboard `summarize` and the real `/processes/entries` feed, in unlocked, 12 h locked and typed-Planned modes.

| ID | Calculation | Input | Expected | Before fix | After fix | Status |
|---|---|---|---|---|---|---|
| CALC-001 | Ideal Quantity floor | 00:00-03:00 at 2.7 s | 4000 | 3999 (server refused a legal 4000) | 4000 | Fixed |
| CALC-001 | Ideal, RIVET | 02:35 at 37.2 s | 250 | 249 | 250 | Fixed |
| CALC-001 | Ideal, VMC/PRESS | 180 min x 15 pcs / 2.7 min | 1000 | 999 | 1000 | Fixed |
| CALC-002 | MFD dashboard Ideal | 08:15-18:55, lunch 30, 50 s | 732 | 768 | 732 | Fixed |
| CALC-003 | "-0" display | fmtNum(-2.8e-14), fmtPct(-0.00001) | 0, 0.00% | "-0", "-0.00%" | "0", "0.00%" | Fixed |
| CALC-004 | Form live OEE, extra entry on locked day | two locked 4 h entries + 17:00-21:00 | 83.33% / 120 | 41.67% / 840 | 83.33% / 120 | Fixed |
| CALC-006 | Unticked operations | RIVET 33.1 minus 21.4 and 11.7 | blank cycle | cycle 7.1e-15, Ideal 5e17 | blank | Fixed |
| CALC-005 | Availability on a locked day | three 4 h entries on 12 h lock | day Availability 100% | 33.3% each (A x P x Q = 27.8% vs OEE 83.33%) | unchanged | OPEN, needs your decision (changes review flags) |
| CALC-007 | 4 old website tests | n/a | n/a | 4 failing tests assert superseded rules | unchanged | Known test debt |

Business questions (not bugs): RIVET lunch in Ideal; over-Ideal refusal differs by process; Ideal/hour uses two conventions; Unutilized hard-codes 12 and 11 h; Modular Frame Drilling Effective = OK x Cycle (your choice; differs from the Excel on purpose).

## E. Data entry and process coverage

- The 8 new processes: every column of every pasted row maps to an input, a stored field, a table column and an app field; checked on all 121 working rows in 3 modes, 0 mismatches.
- Rows not loaded (by design): day-only W.OFF/Leave rows without a person or machine, GANGARAM's second-machine overlap row and a row with no Standard Time (Injection Moulding).
- Fields stored by the server with no input on any screen: CNC Setting ON/OFF and Setup No., VMC Machine Not Run, a legacy workingStatus. No paper column lists exist in the repo for 12 older processes, so only app-field coverage was possible there.

## F. Responsive design

Result: no horizontal page overflow and no off-screen controls in any of the 2,152 checks. Fixed: Save/Cancel unreachable with large text or short screens (all 18 forms), Part dropdown clipped, entries table leaving 36-148 px on phones, touch targets, date picker, keyboard-open height, labels/contrast, truncated names.
Not a pass: touch targets that are still under 44 px (collapsed accordion bars, the Home "Manage" button, disabled checkboxes). OEE Review shows cards at every width (the table needed narrower columns to fit). Open design items: sidebar drawer below 992 px, phone gutters, grey chart axis text, hard-coded preview card on login, table header truncation, other master pages' cell truncation.

## G. Bug register

| ID | Module | Title | Severity / Priority | Status |
|---|---|---|---|---|
| RESP-001 / WEB-001 | Dashboard | 7 worker-process dashboards crash ("Something went wrong") | Critical / P0 | Fixed, test added |
| API-001 | All 18 sheets | Simultaneous new entries: one silently lost | High / P1 | Fixed (see trade-off) |
| RESP-002 | Entry forms | Save/Cancel off-screen with large text or short screens | High / P1 | Fixed |
| RESP-003 | Part dropdown | Clipped on landscape phone and 320 px | High / P1 | Fixed |
| RESP-004 | OEE Review | Approve button clipped at 1920x1080 | High / P1 | Mitigated: cards at all widths (decision) |
| API-002 | Saves | A user limited to one process can save a row against another process's machine | Medium / P1 | OPEN, needs your OK |
| API-003 | 10 sheets | Server doesn't check the Rejected split adds up | Medium / P2 | OPEN, needs your OK |
| API-004 | 8 sheets | Quantities like 1e308 accepted and escape review | Medium / P2 | OPEN, needs your OK |
| API-006 / WEB-002 | Dates | 1800, 2999, future dates accepted; holiday 31 Feb stored as 3 Mar | Medium / P2 | OPEN, needs your OK |
| CALC-001..004, 006 | Calculations | see section D | Medium/Low | Fixed |
| CALC-005 | Availability | locked day | Medium / P2 | OPEN, decision |
| API-008 | Errors | Production returned 500 for bad JSON / big body | Medium / P2 | Fixed |
| WEB-003 | Login | Username enumeration (different message for unknown user) | Medium / P2 | Fixed: same message for both cases. Still open: the lock message (3rd wrong password, locked account) reveals that a username exists; left because it is lock logic. |
| WEB-004 | Forms | Unlabelled fields (axe: label x13, select-name x3), low contrast | Medium / P2 | Fixed (axe 0 on all 18 add forms) |
| RESP-005..008 | Layout | frozen columns, touch targets, date picker, keyboard | Medium / P2 | Fixed (touch targets mostly) |
| API-007, 009, 010, 011, 015, 016 | API | object text stored as "[object Object]", 500 on bad ids, login object credentials, review prototype keys, edit moves slot, machine colour | Low-Medium / P3 | Fixed |
| API-005 | API | loose number parsing (`true`, `[5]`, `0x10` accepted) | Low / P3 | Fixed: strict numbers; blank and normal values unchanged; a spaces-only box now counts as blank instead of 0 |
| API-012 (part) | Masters | machine created with a non-existent process, role permission for a non-existent menu | Low-Medium / P3 | Fixed (400 on bad ids). Still open: entries left pointing at a deleted process |
| API-013, 014 | API | role slug/permission read; case-sensitive operator overlap | Low-Medium / P3 | OPEN |
| WEB-005..007 | Website | truncated names, inactive machine shown as active, no skip link | Low / P3 | Fixed |
| MOB-001 | App | expanded entry heading overflows (4 processes) | Low / P2 | Fixed |
| MOB-002 | App | "Entered By" missing from table and detail | Low-Medium / P2 | OPEN |
| MOB-003 | App | maintenance mode and announcements not honoured | Medium / P2 | OPEN |
| MOB-004 | App | 15 screens still "being built"; no Parts, Vendors, Work Orders, OEE Review in the app | Medium / P3 | OPEN (by design so far) |
| MOB-005 | Repo | some new app files uncommitted | P1 for commit | Commit everything together |
| MOB-006 | Android | release build signs with the debug key if key.properties is missing | Medium / P2 | OPEN, add signing key before the shareable APK |
| MOB-007 | App | draft not cleared on logout (found by reading code) | Low / P3 | Fixed: all saved drafts deleted when a session ends; normal 60-second restore unchanged |

Trade-off for API-001: on Printing, Raw Casting, Modular Frame Drilling, Modular Frame Assembly and Final Assembly (which allow overlapping times on purpose), five identical saves sent at the same moment now give five rows. Blocking that would be a new business rule.

## H. Risk and gap analysis

- Access: API-002 and the unread permission matrix (API-013) are the main security risks. SUS items: CORS reflects any origin when ALLOWED_ORIGIN is unset; the server trusts the role inside the signed token; cycle time is trusted from the client (a tiny value bypasses the Actual-above-Ideal refusal).
- Process rules that differ between sheets: some refuse Actual above Ideal, others send it to review; waiting for your senior.
- Draft handling: browser Back or session expiry discards an unsaved entry; no unload prompt.
- Live deployment: the 8 new processes, menus and the review-rule backfill still need to be created on the live database and nothing has been pushed.

## I. Fixes and regression

Fix areas: dashboards, responsive layout, accessibility, API hardening, calculation fixes, app heading. Final run on the finished code:
- server `npm test`: 299 of 299 pass;
- website `npm test`: 148 of 152 pass; the 4 failures are the same old VMC tests that failed before these changes (CALC-007);
- website build: passes;
- app `flutter test`: 1,847 of 1,847 pass; `flutter analyze`: 42 minor style notes, no errors (same baseline);
- paper-sheet tests for the 8 new processes: unchanged.

## J. Final release recommendation: READY AFTER MINOR FIXES

Release-blocking items: none open that crash or corrupt data. Before going live: decide API-002, API-003, API-004/006, CALC-005, API-014 and the process-delete behaviour; add the Android signing key; commit all files together; create the 8 processes and menus on the live database and run the review backfill; run a manual pass on a real phone and tablet. Re-test the touched areas on a staging copy of the live data before pushing.
