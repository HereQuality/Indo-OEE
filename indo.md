# PRD — Dynamic Production Data Entry & OEE Module
### (Indo — MERN RBAC Platform extension)

---

## 1. Background & Goal

The existing platform (`Indo`) is a MERN app with Company/Department/Employee/Role/Menu masters and RBAC already built (models: `Company`, `Department`, `Employee`, `Role`, `RoleMaster`, `MenuMaster`, `Team`, `Ticket`, etc.).

The new requirement (from the shared screenshots of the current Google Sheet + Form) is a **Production / Shop-floor Data Entry system** that replaces the Google Sheet + Google Form workflow, with everything **admin-configurable** instead of hardcoded:

- Admin can dynamically add **Machines (M/C)** — currently "M/C 1, M/C 2, M/C 3…"
- Admin can dynamically add **Operators** — currently a "Select Operator" dropdown
- Admin can dynamically build/edit the **Data Entry Form itself** — field labels, types, order, required/optional — since you said "there are more things which I need to add in form" later, and want to just edit fields from admin without a developer.
- Submitted entries flow into a **spreadsheet-style data view**, one tab per machine (like image 3 & 4), with **auto-calculated formula columns** (Total Stoppage, Available Working Time, OEE%, etc.)

This PRD is scoped to be built **incrementally, one module at a time**, per your instruction.

---

## 2. Finalized Field List — Production Data Entry Form (Glass Grinding)

Superseding the initial molded-piece field list, the confirmed field set is:

| # | Field | Type | Required? |
|---|---|---|---|
| 1 | M/C Name | Dropdown (from Machine Master) | **Required** |
| 2 | Number of Process Qty | Number (≥1) | **Required** |
| 3 | Number of OK Grinding Glass Quantity | Number (≥0) | **Required** |
| 4 | Number of Rejected Qty | Number (≥0) | **Required** |
| 5 | M/C Start Time | Time | **Required** |
| 6 | M/C Off Time | Time | **Required** |
| 7 | Size in mm (Width X Height) | Number X Number | **Required** |
| 8 | Thickness in mm | Number (>0) | **Required** |
| 9 | Standard Time of Grinding One Glass (Minutes) | Number (>0) | **Required** |
| 10 | Planned Downtime (Minutes) | Number, default 0 | Optional |
| 11 | Overtime (Minutes) | Number, default 0 | Optional |
| 12 | No Manpower (Minutes) | Number, default 0 | Optional |
| 13 | Mechanical Breakdown (Minutes) | Number, default 0 | Optional |
| 14 | Electrical Breakdown (Minutes) | Number, default 0 | Optional |
| 15 | Raw Material Not Available (Minutes) | Number, default 0 | Optional |
| 16 | Stoppage (Human Error) (Minutes) | Number, default 0 | Optional |
| 17 | Changeover (Minutes) | Number, default 0 | Optional |
| 18 | Raw Material Problem (Minutes) | Number, default 0 | Optional |
| 19 | No Power (Minutes) | Number, default 0 | Optional |
| 20 | Others (Minutes) | Number, default 0 | Optional |

**Validation & limits enforced (both client and server-side):**
- All 9 required fields above must be filled; only "*" marked fields block submission — every other field is genuinely optional and defaults to 0, no fake asterisks.
- `okQty + rejectedQty` cannot exceed `processQty`.
- `M/C Off Time` cannot equal `M/C Start Time`; shift duration is computed handling overnight shifts (off time past midnight).
- Width, Height, Thickness, Standard Time must be > 0.
- All stoppage-reason minute fields are clamped to 0–1440 (one day) if entered.
- M/C dropdown only allows selecting an existing, **active** Machine (validated server-side against the Machine Master, not just trusted from the client).

✅ **Status: Phase 1–3 below are implemented** (Machine Master, the Production Data Entry form with this exact field list + validation, and the calculated Production Sheet). See section 7.

---

## 3. Reference: What the original Google Sheet does (context / OEE formula source)

**Form (Image 1 & 2) fields, in order:**

| Field | Type | Notes |
|---|---|---|
| APG M/C No. | Dropdown (dynamic) | e.g. M/C 1, M/C 2, M/C 3 |
| Number of Cavities in Die | Number | |
| Date | Date | |
| Item Name | Text | |
| Operator | Dropdown (dynamic) | "Select Operator" |
| Planned Downtime (Minutes) | Number, default 0 | |
| Overtime (Minutes) | Number, default 0 | |
| No Manpower (Minutes) | Number, default 0 | Stoppage reason |
| Mechanical Breakdown (Minutes) | Number, default 0 | Stoppage reason |
| Electrical Breakdown (Minutes) | Number, default 0 | Stoppage reason |
| Raw Material Not Available (Minutes) | Number, default 0 | Stoppage reason |
| Stoppage (Human Error) (Minutes) | Number, default 0 | Stoppage reason |
| Changeover (Minutes) | Number, default 0 | Stoppage reason |
| Raw Material Problem (Minutes) | Number, default 0 | Stoppage reason |
| No Power (Minutes) | Number, default 0 | Stoppage reason |
| Others (Minutes) | Number, default 0 | Stoppage reason |
| Standard Time for 1 Molded Piece (Minutes) * | Number, required | |
| Actual Number of Molded Pieces Produced * | Number, required | |
| Number of OK Molded Pieces * | Number, required | |

**Sheet output (Image 3 & 4), one tab per machine, columns:**

`Date | Item Name | Operator Name | Planned Downtime (mins) | Overtime (Mins) | Working/scheduled time (min) | [STOPPAGE REASON group: No Manpower, Mechanical BD, Electrical BD, RM not available, Stoppage any human error, Changeover, R.M. problem, No Power, Others] | Total Stoppage | Available Working Time (mins) | Actual No. of Moulded Pieces produced | No. of Cavity in Die | Standard time for 1 Moulded Piece (mins) | Actual time required for no. of Moulded Pieces (mins) | Unreported time (mins) | No. of OK Moulded Pieces | Availability Ratio | Performance Ratio | Quality Ratio | OEE% |`

**Derived formulas (standard OEE logic, inferred from headers):**

```
Working/Scheduled Time      = Shift Time − Planned Downtime
Total Stoppage               = Sum of all Stoppage Reason minutes
Available Working Time       = Working/Scheduled Time − Total Stoppage + Overtime
Actual time required for
  produced pieces             = Actual No. of Moulded Pieces Produced × Standard Time for 1 Piece
Unreported Time               = Available Working Time − Actual time required for produced pieces
Availability Ratio            = Available Working Time / Working (Scheduled) Time
Performance Ratio             = Actual time required for produced pieces / Available Working Time
Quality Ratio                 = No. of OK Moulded Pieces / Actual No. of Moulded Pieces Produced
OEE %                         = Availability Ratio × Performance Ratio × Quality Ratio × 100
```
> ⚠️ These formulas are inferred from column names/standard OEE practice — we will validate exact values with your existing sheet's live formulas before finalizing (open one sheet cell and confirm), since "Shift Time" per machine isn't shown yet and needs a source (likely a machine-level setting, e.g. 1440 min/day or per-shift config).

---

## 4. Design Principle: Everything Dynamic, Nothing Hardcoded

Three independent "master" concerns, each with its own CRUD admin screen, reusable across the whole app (not just this module):

1. **Machine Master** — Admin CRUD: Machine Code/Name, Cavities default, Shift hours/day, Active flag.
2. **Operator Master** — Admin CRUD: Operator Name, Employee link (optional, can reuse existing `Employee` model), Active flag.
3. **Dynamic Form Builder** — Admin CRUD over **Form Definitions**: a form is a named ordered list of Field Definitions. Each Field Definition has: label, key, type (text/number/date/dropdown/textarea), dropdown source (static list OR a Master collection like Machine/Operator), default value, required flag, "isStoppageReason" flag (so the OEE engine knows which fields to sum into Total Stoppage), display order, section grouping.

This means: when you later say "add a field for X", the admin just adds a Field Definition — no code deployment needed, and the Data Sheet auto-adds the column.

---

## 5. Data Model (MongoDB / Mongoose)

```
Machine
 ├─ code            String (unique)     e.g. "MC-1"
 ├─ name             String              e.g. "APG M/C No. 1"
 ├─ defaultCavities   Number
 ├─ shiftMinutesPerDay Number             e.g. 1440 or 480
 ├─ companyId         ObjectId → Company
 ├─ isActive           Boolean
 └─ timestamps

Operator
 ├─ name              String
 ├─ employeeId        ObjectId → Employee (optional link)
 ├─ companyId          ObjectId → Company
 ├─ isActive            Boolean
 └─ timestamps

FormDefinition
 ├─ name                String   e.g. "Production Data Entry Form"
 ├─ slug                String (unique)
 ├─ appliesTo           String   e.g. "production_entry"
 ├─ isActive             Boolean
 ├─ version              Number   (bump on structural edits, keep old data intact)
 └─ timestamps

FormField  (belongs to FormDefinition)
 ├─ formDefinitionId    ObjectId → FormDefinition
 ├─ key                  String   e.g. "mechanicalBreakdownMin"  (auto-slugged from label, editable)
 ├─ label                String   e.g. "Mechanical Breakdown (Minutes)"
 ├─ type                 Enum [text, number, date, dropdown, textarea]
 ├─ dropdownSource       Enum [none, static, machineMaster, operatorMaster] 
 ├─ staticOptions        [String]           (if dropdownSource = static)
 ├─ defaultValue         Mixed
 ├─ isRequired           Boolean
 ├─ isStoppageReason     Boolean   (flags it for Total Stoppage sum)
 ├─ section              String    e.g. "Header" / "Stoppage Reasons" / "Output"
 ├─ order                Number
 └─ timestamps

ProductionEntry   (the actual submitted data — one row per submission)
 ├─ formDefinitionId    ObjectId → FormDefinition (+ version, to survive form edits)
 ├─ machineId            ObjectId → Machine
 ├─ operatorId            ObjectId → Operator
 ├─ date                   Date
 ├─ itemName               String
 ├─ values                 Map<String, Mixed>   (fieldKey → entered value, fully dynamic)
 ├─ calculated             {
 │     totalStoppageMin, workingScheduledMin, availableWorkingMin,
 │     actualTimeRequiredMin, unreportedTimeMin,
 │     availabilityRatio, performanceRatio, qualityRatio, oeePercent
 │   }
 ├─ createdBy               ObjectId → user
 ├─ companyId                ObjectId → Company
 └─ timestamps
```

Keeping `values` as a flexible Map (rather than one Mongoose field per stoppage reason) is what makes the form truly dynamic — new fields don't need schema migrations.

---

## 6. Backend API (new routes/controllers, following existing pattern)

```
/api/machines           GET, POST, PUT, DELETE   (Machine Master CRUD)
/api/operators          GET, POST, PUT, DELETE   (Operator Master CRUD)
/api/form-definitions   GET, POST, PUT, DELETE   (Form + nested Field CRUD)
/api/form-definitions/:slug/schema   GET          (returns active field list, resolved dropdown options)
/api/production-entries GET, POST, PUT, DELETE
/api/production-entries/sheet?machineId=&from=&to=   GET  (calculated sheet rows for a machine, paginated)
/api/production-entries/dashboard?machineId=&range=   GET (OEE trend, downtime pareto, etc.)
```

- **Calculation happens server-side** (in `services/oeeCalculation.service.js`) at entry-save time and is stored in `calculated`, not computed on the fly in the frontend — so historical numbers don't shift if formulas change later, and the sheet view is just a fast read.
- Reuse existing `middlewares` (auth + RBAC permission guard) — add these as new Menu entries in `MenuMaster` so they slot into your existing dynamic-menu RBAC system automatically.

---

## 7. Frontend (React) Pieces

1. `pages/MachineMaster.jsx` — CRUD table+modal, same pattern as `Department.jsx`/`Skills.jsx`.
2. `pages/OperatorMaster.jsx` — CRUD table+modal, same pattern.
3. `pages/FormBuilder.jsx` — Admin screen: list of Form Definitions → click in → drag-orderable list of Field rows, "+ Add Field" button opens field editor (label, type, dropdown source, required, stoppage-reason toggle). This is the piece that replaces "editing the Google Form."
4. `Components/DynamicForm.jsx` — reusable renderer: takes a `formDefinitionId`, fetches `/schema`, renders inputs generically based on field type (this is the "+Add" modal shown above the sheet — matches Image 1 & 2 exactly, but driven by data not hardcoded JSX).
5. `pages/ProductionSheet.jsx` — spreadsheet-style table (tabs per machine, like Image 3/4), calculated columns rendered read-only, with an "Add Entry" button opening `DynamicForm` in a modal.
6. `pages/ProductionDashboard.jsx` (Phase 4/5, later) — OEE trend charts, downtime Pareto, per-operator/per-machine comparison — using `recharts`, consistent with your stack.

---

## 8. Build Plan (phased, one at a time as requested)

| Phase | Deliverable | Status |
|---|---|---|
| **Phase 1** | `Machine` model, controller, routes, and `MachineMaster.jsx` admin CRUD page | ✅ **Built** |
| **Phase 2** | `ProductionEntry` model + validation + `productionCalculation.service.js` (server-side OEE formula engine) | ✅ **Built** |
| **Phase 3** | `ProductionEntry.jsx` — the exact data-entry form (finalized field list in §2) as a modal, plus the calculated spreadsheet view with per-machine tabs | ✅ **Built** |
| **Phase 4** | Generic `FormDefinition`/`FormField` admin **Form Builder**, so *you* can add/rename/reorder fields yourself without a developer (per your original ask) | ⏳ Next |
| **Phase 5** | RBAC wiring (add new menus to `MenuMaster` + permission checks), Operator master (if needed), Dashboard/analytics view | ⏳ Later |

### Files created in this pass

**Backend**
- `server/models/Machine.js`, `server/controllers/machine.controller.js`, `server/routes/machine.routes.js`
- `server/models/ProductionEntry.js`, `server/controllers/productionEntry.controller.js`, `server/routes/productionEntry.routes.js`
- `server/services/productionCalculation.service.js` (OEE formula engine)
- Registered both route sets in `server/routes/index.js` under `/api/v1/machines` and `/api/v1/production-entries`

**Frontend**
- `client/src/api/machines.api.js`, `client/src/hooks/useMachines.jsx`
- `client/src/api/productionEntries.api.js`
- `client/src/pages/MachineMaster.jsx` — Machine (M/C) Master admin CRUD
- `client/src/pages/ProductionEntry.jsx` — the data-entry form + calculated production sheet (per-machine tabs)
- Registered both pages in `client/src/Routes/allRoutes.jsx` at `/production/machines` and `/production/data-entry`
- Added `MACHINES` and `PRODUCTION_ENTRIES` to `client/src/api/endpoints.jsx`

### Still to do before this is production-ready
1. **Menu entries**: add `/production/machines` and `/production/data-entry` to `MenuMaster`/`RoleMaster` (via the Menu Master screen or a seed script) so they show up in the sidebar and are covered by RBAC — right now they're reachable by URL for any logged-in SuperAdmin/Employee but not yet menu-gated.
2. **Shift duration source** — currently computed purely from `M/C Start Time` → `M/C Off Time` per entry (handles overnight shifts). Confirm this is correct vs. a fixed shift-length setting on the Machine.
3. Run `npm install` (no new packages were added) and smoke-test the two new screens end-to-end against a real Mongo instance.


---

## 9. Open Questions Before Phase 2

1. **Shift time source**: Is "Working/Scheduled Time" a fixed value per machine (e.g. 1440 min/day, 3 shifts) or does it vary by date/shift entry? This determines whether `shiftMinutesPerDay` lives on the Machine Master or needs its own per-day input on the form.
2. Should **Operators** be a standalone new list, or should we reuse your existing `Employee` model (filtered by department, e.g. "Production")?
3. Should `Machine` be scoped per `Company` (multi-tenant, since your platform already has a `Company` model), or global?
4. For the Form Builder — do you want **one single form** (Production Data Entry) to be editable, or the ability to create **multiple different forms** for different processes down the line (e.g. Quality Check form, Maintenance form)? This affects whether we build a full generic Form Builder now or a lighter "edit this one form's fields" screen first.

---

*Once you confirm the open questions, I'll start Phase 1 (Machine Master + Operator Master: models, routes, controllers, and admin UI) directly in the codebase.*