# Porting a process's Data Entry page to the phone app

The phone app has ONE Data Entry framework. CNC is the reference implementation; every other
process (VMC, SPM, Rivet, Press, Contact, Trobe, Spring, Powder Coating) is a **`ProcessSpec`**:
one folder under `lib/features/production/processes/<key>/` and one line in
`process/process_registry.dart`. Nothing in the framework names a process — it asks the spec.

Read `PORTING_GUIDE.md` first for the app-wide rules (client/ and server/ are READ-ONLY, theme
colours only, JS number semantics via the `js*` helpers…). This file is the per-process contract.

## Where things live

```
lib/features/production/
  process/process_spec.dart         ProcessSpec (the contract), SheetApi, EntryFigures, DetailModel…
  process/process_registry.dart     ProcessRegistry.all  <- one line per process
  processes/cnc/                    the reference spec — COPY THIS
    cnc_spec.dart                     CncSpec + `const cncSpec`
    cnc_lines.dart                    the form's cards (Part / Quantity / Reject) + CncEntryLines
    cnc_columns.dart                  the table's columns
    cnc_detail.dart                   the expanded entry (DetailModel)
  entry_form/common_lines.dart      cards every process shares (date/machine/operator, time,
                                    planned shift, downtime + stoppage meter, remarks)
  entry_form/entry_line_context.dart  EntryLines + EntryLineContext (helpers a card builds with)
  entry_form/entry_op_tile.dart     the tickable operation tile (CNC / SPM operations)
  sheet/…                           list controller, table, day cards, editor — generic, take a spec
  shared/                           production_sheet_calc.dart (CNC rowCalc/dayCalc + js* helpers),
                                    production_entry_validation.dart (generic time/overlap rules +
                                    CNC validateEntry), shift_hours.dart
```

The route table builds one `AppRoute` per registry entry (`routePath` + `routeAliases`, mounted as
`ProductionSheetScreen(spec: spec)`), so a registered spec is reachable at once — and gated by the
usual Manage Role / `PageGuard` rules with no extra work.

## The contract: `ProcessSpec`

(`const`-constructible, stateless. Override only what differs from `CncSpec` if you extend it.)

```dart
abstract class ProcessSpec {
  // identity
  String get key;                    // 'vmc'
  String get label;                  // 'VMC'
  String get routePath;              // '/production/vmc-data-entry'  (no role slug)
  List<String> get routeAliases;     // old bookmarks
  String get pageTitle;              // list app bar        ('Data entry')
  String get addTitle;               // 'Add Production Entry'
  String get editTitle;              // 'Update Production Entry'
  String get draftKey;               // SharedPreferences key of the add-form draft — UNIQUE
  bool ownsProcess(Json process);    // default: process.dataEntryMenu resolves to routePath
  List<Json> scopeMachines({machines, operators, lockedProcess}); // picker "machines" (workers for Powder Coating)
  bool get scopeItemsToProcess;      // Part picker: this process's parts + unassigned (web). Default true
  Map<String, String> get extraReference; // name -> endpoint, e.g. {'workOrders': '/api/v1/work-orders'}

  SheetApi get api;                  // endpoints — SheetApi.segment('vmc-sheet')

  // figures
  Json rowCalc(Json row);            // web `<x>RowCalc`
  List<Json> dayCalc(List<Json> sortedRows); // web `<x>DayCalc`
  EntryMetrics metrics(Json values); // form caps/derived boxes (subclass EntryMetrics if needed)

  // rules
  Map<String, String> validateEntry(Json values, {Json? saved}); // web `validate<X>Entry`
  List<String> get fieldOrder;       // web `<X>_FIELD_ORDER`
  Map<String, dynamic>? firstError(List<Map<String, String>?> errors); // (provided)

  // values (the pure parts of the web page's handlers)
  Json emptyEntry({DateTime? now});
  Json toFormValues(Json row, {DateTime? now});
  Json toPayload(Json values, {required bool isEdit});   // the PUT body, exact keys
  bool hasAnyEntryData(List<Json> blocks);
  bool entryHasData(Json values);                        // one block
  Json applyItemSelection(Json values, String itemId, List<Json> items);
  Json newBlockAfter(List<Json> blocks, {DateTime? now});
  Json mergeDraftEntry(Json draft, {DateTime? now});
  Json applyRejectChange(Json values, String reason, dynamic value); // only if the form has a split
  String? itemSubtitle(Json item);                       // grey line under a part in the picker

  // form
  EntryLines get lines;              // the cards of an open block

  // list
  SheetColumns columns(Set<String> open);   // table columns
  Map<String, String> get formulas;         // ⓘ texts by `formulaKey`
  List<Json> remarkParts(Json row);         // eye buttons: {key:'reject'|'downtime'|'general', title, figure, text}
  EntryFigures figures(Json row, Json calc);// day card: ok / actual / % ok / shift
  DetailModel detail(Json row, Json calc, Json day); // expanded entry
}
```

### What the framework assumes (do not break these)

* **`rowCalc` returns at least** `shiftHours`, `actualQty`, `pctOk`, `totalStoppageMin` (the day card,
  the entry detail and the editor read them; `null` when unknown) — and `idealQty` if the form caps
  quantities with it. **`dayCalc` returns** `oeeLosses` per row (the day card's chip).
* `rowCalc` / `dayCalc` / validation / `toPayload` are **faithful ports** of the web functions — same
  keys, same rounding, same messages. Use the `js*` helpers in `production_sheet_calc.dart`
  (`jsNumber`, `jsToNumber`, `jsRound`, `jsNumStr`, `jsTruthy`, `fmtNum`, `fmtPct`…) instead of Dart's
  `num` parsing/`round`.
* A block is a `Map<String, dynamic>` with the web's exact keys; typed fields are Strings (`''` =
  blank). Every row has `machine` / `date` / `slot` / `machineOnTime` / `machineOffTime` / `operator`
  / `_id`: the time-overlap and operator-overlap rules (`overlapErrors`, `operatorOverlapErrors`,
  `bookedRanges`) are shared and keyed on them. Their messages are what `isTimeRuleMessage` matches —
  keep the same wording for the time rules in your validation.
* The endpoints behave like CNC's: `GET list?from&to&page&machine&operator&item → {data, meta}`,
  `PUT row`, `DELETE row/:id`, `PUT row/:id/unlock`, `GET extent`, `GET filter-options`,
  `GET occupied?date&machine` / `?date&operator`. (Check `server/routes/<x>Sheet.routes.js`.)
* `scopeItemsToProcess` defaults to **true** (the web scopes parts to the page's process, plus parts
  with no process yet) — CNC included since Wave 1; leave it alone.

## Porting checklist (one process)

1. **Read the web twin** end to end: `client/src/pages/<X>DataEntry.jsx`,
   `Components/Production/<X>EntryForm.jsx`, `<x>Columns.jsx`, `utils/<x>Sheet.js`,
   `utils/<x>Validation.js`, `api/<x>Sheet.api.js`, `server/routes/<x>Sheet.routes.js`,
   `server/controllers/<x>Sheet.controller.js`, `server/models/<X>Entry.js`. Diff against the CNC
   files to see exactly what changes (the page is a template; most differences are in the form,
   calc, validation and columns).
2. `mkdir processes/<key>/` and add:
   * `<key>_spec.dart` — `class <X>Spec extends ProcessSpec` (or `extends CncSpec` for a **CNC twin**:
     Contact / Trobe / Spring share CNC's formulas — override `key`, `label`, `routePath`, `api`,
     `draftKey`, titles and only what their form really changes), plus `const <key>Spec = <X>Spec();`
   * `<key>_calc.dart` — the web `utils/<x>Sheet.js` (`rowCalc`/`dayCalc` adapters feed CNC's
     `rowCalc`: copy `withCycle`-style adapters, don't re-derive the shared formulas).
   * `<key>_validation.dart`, `<key>_values.dart` (emptyEntry / toFormValues / toPayload / …),
     `<key>_lines.dart` (+ any widget), `<key>_columns.dart`, `<key>_detail.dart`.
3. Register it: one line in `ProcessRegistry.all` (`process/process_registry.dart`). Routes, the list
   screen, the editor, the drafts and the process→page match all follow.
4. Add the `Endpoints` the process needs (`SheetApi.segment('<x>-sheet')` builds the standard set;
   work orders / vendors endpoints go in `core/api/endpoints.dart` and in `extraReference`).
5. **Tests** (below): golden parity for calc + validation + payload, a widget test for the form, and
   `flutter analyze` / `flutter test` clean.
6. Update `AppRoutes`-level expectations only if you add routes that are not specs (you should not).

### Building the table (`columns`)

Use the helpers in `sheet/table/sheet_columns.dart`: `SheetCol(key,label,width,text,tone,merge,
formulaKey,remarkKind…)`, `sheetSubCol(...)` for breakdown columns, `addExpandable(open, summary,
id, label, subs, out)` for a total with an opening breakdown, `fitSheetColumn(c)` to widen a header
to its label, and `SheetColumns(left:, middle:, expandSummary: {id: summaryKey})` (the table keeps the
summary column in view when the breakdown opens). Each `text:` closure gets `CellData(row, calc, day,
machineName)`. See `processes/cnc/cnc_columns.dart`.

### Building the form (`lines`)

`EntryLines.left(c)` / `.right(c)` return the cards (`Widget`s) of an open block: the left list then
the right list is the "next" focus order; narrow screens stack left then right, ≥ 700 px sits in two
columns. `c` is an `EntryLineContext`:

| | |
|---|---|
| `c.values`, `c.text(field)`, `c.index`, `c.isEdit`, `c.booked` | the block |
| `c.err(field)` / `c.lineHasError(keys)` | the message to show now (time rules at once, others after Save) |
| `c.set(field, value)`, `c.onItemSelect(i, id)`, `c.onRejectChange(i, reason, v)` | edits |
| `c.keyed(field, child)`, `c.nodeFor(field)` | what a failed Save scrolls to / focuses — wrap EVERY validated field |
| `c.numBox(field, max:, onExceed:, decimals:, maxLength:)`, `c.minutesBox(field, label)` | typed number boxes (capped) |
| `c.calcBox(key, value, label)` | grey calculated box |
| `c.metrics` | the spec's `EntryMetrics` (`calc`, `idealQty`, `stoppageLimit`, `minutesLimit(key)`…) |
| `c.items`, `c.operators`, `c.machines`, `c.extra['workOrders']` | master data |
| `c.pickItem`, `c.pickOperator`, `c.machineBox(enabled:)` | the shared pickers |

Reuse `dateMachineOperatorLine`, `timeLine`, `shiftLine`, `downtimeLine(c, boxes: …)`, `remarksLine`
from `entry_form/common_lines.dart` (pass your own downtime `boxes` — key + label — when the process
has fewer/more) and write only the cards that differ. Widget keys are `entry$index/<field>`; keep
that, the tests and the focus code rely on it. `collapsedSummary(values)` is the line a collapsed
block shows.

### Detail & day card

`detail(row, calc, day)` returns a `DetailModel`: `oee` tiles + `DetailGroup`s of `DetailMetric`
(a tap on one with a `tone` + `formulaKey` shows its formula) and `DetailSubRow`. `figures(row,
calc)` feeds the card's "ok / actual · % ok · shift hr"; the default reads CNC's keys, override it
when the process names them differently.

## Golden-vector parity (calc, validation, payload)

The calc and validation ports are verified against the REAL web JS. The CNC fixtures and generator
are the template: `test/production/calc/tool/gen_golden.mjs` (reads `client/src/utils/*.js`, writes
JSON under `test/production/calc/fixtures/`), loaded in Dart by `golden_support.dart` (`loadFixture(name, {dir})`,
`diff`, `showCase`; NaN/Infinity/undefined travel as `{"$n":…}` / `{"$u":1}`).

Recipe for process `<x>`:

1. Copy `tool/gen_golden.mjs` → `test/production/<x>/tool/gen_<x>_golden.mjs`. Import the web
   functions you port (`<x>RowCalc`, `<x>DayCalc`, `validate<X>Entry`, `<X>_FIELD_ORDER`,
   `firstError`, anything in `utils/<x>Sheet.js`). Keep the seeded generator (`mulberry32`, `pick`,
   `chance`, `int`) and feed it realistic AND hostile inputs (blank, `"abc"`, negative, huge, `null`,
   missing keys, unticked operations, edge times `00:00`/`23:59`, OFF ≤ ON for old rows). Emit
   `{row, out}` pairs for `rowCalc`, `{rows, out}` for `dayCalc`, `{values, errors}` for validation
   and, if you port `toPayload`, `{values, payload}` from the web page's handler logic (copy the
   function body into the generator — pages are not importable).
2. Bundle and run it (the `client/` node_modules has esbuild; nothing is written in `client/`):

   ```sh
   cd mobile
   ESB=../client/node_modules/.bin/esbuild
   $ESB test/production/<x>/tool/gen_<x>_golden.mjs --bundle --platform=node --format=esm \
        --outfile=/tmp/<x>-golden/gen.mjs
   OUT_DIR=test/production/<x>/fixtures TZ=Asia/Kolkata node /tmp/<x>-golden/gen.mjs
   ```
   (Use `SEED=…`/`SCALE=…` for one-off soak runs, as the CNC generator documents.)
3. Assert in Dart — `diff(actual, expected)` returns the first difference or `null`:

   ```dart
   final cases = loadFixture('row_calc.json', dir: 'test/production/<x>/fixtures') as List;
   for (var i = 0; i < cases.length; i++) {
     final c = cases[i] as Map;
     expect(diff(<x>Spec.rowCalc(Map<String, dynamic>.from(c['row'] as Map)), c['out']), isNull, reason: 'case $i ${showCase(c['row'])}');
   }
   ```
   Same for `dayCalc` (feed `sortByMachineOn(rows)` like the controller), `validateEntry`
   (`diff(spec.validateEntry(values), errors)`), `fieldOrder`/`firstError` and `toPayload`.
   Assert at least a few hundred cases per function; numbers match to 1e-9.
4. Commit the generated fixtures (the tests must not need node). Regenerate whenever the web utils
   change.

Also add (see `test/production/process_spec_test.dart` for the plumbing patterns):

* a **widget test of the form** through `EntryEditorScreen(spec: <x>Spec, …)` with `FakeApi`:
  required fields flag, the caps behave, Save PUTs the exact payload to `spec.api.row`;
* a **controller test** if your `scopeMachines` / `extraReference` / `figures` are non-default;
* the registry/route tests in `process_spec_test.dart` already cover every registered spec
  (unique paths and draft keys, route + alias resolution) — they run on your spec automatically.

## Things only CNC does today (so a port may need a hook, not a copy)

* **Reject split** (`rejectBreakdown`, `applyRejectChange`, `EntryMetrics.splitTotal/rejectRoom`) and
  the `'reject'` remark kind: CNC only. Others leave `applyRejectChange` at its default (no-op).
* **Operation ticks** (`excludedOps`, `EntryOpTile`) — CNC's eight operations; SPM has its own four
  (reuse `EntryOpTile`).
* **Planned Operator Shift from Process Master, Vendor Name, over-100% / OEE Review, Machine
  Working Status and the limit popups** are shared infrastructure now (Wave 1, proven on CNC): a
  port switches them on with spec hooks — see "Wave 2 checklist" below. **Work Order** and
  **Machine Not Run** are still per-process (add the endpoint, load it through `extraReference`,
  render it from your lines).
* `MachineDayCard`'s header and `SheetTable`'s remark eye assume remark kinds `reject` | `downtime`
  | `general` and a `SheetCol.remarkKind`; a new kind needs a title/tone in `showRemarkSheet`
  (`sheet_popovers.dart`).
* The filter sheet slices by machine / operator / part (`SheetFilters`) for every process — they are
  the server's query params.


## Wave 2 checklist (web-parity extras, shared infrastructure from Wave 1)

CNC (`processes/cnc/*`) is the reference for all six items — read it next to this list. Every hook
below **defaults to "off" / today's behaviour**, so a spec that overrides nothing is unchanged.
The old per-process variants (VMC's status chips / review text, Press's, Powder's vendor picker…)
keep working; switch a port to the shared piece when you touch it and delete its copy.

Quick map of what exists:

| | file |
|---|---|
| spec hooks | `process/process_spec.dart` (`usesVendors`, `referenceLists`, `usesPlannedShiftSetting`, `showLimitPopups`, `firstOverLimit`, `noticeOnSaveForReview`; `DetailMetric.style`) |
| vendors | `shared/vendors.dart` (`vendorsForProcess/Machine`, `anyVendorFor`, `vendorLabelFor`, `VendorsRepository`), `entry_form/web_parity_lines.dart` (`vendorCell`, `pickVendor`), `sheet/table/shared_columns.dart` (`vendorColumn`, `vendorMetric`) |
| planned shift | `shared/planned_shift.dart` (`ShiftSetting`, `plannedShiftFor`, `shiftSettingForMachine`, `shiftChangeAllowed`), `shiftLine` in `common_lines.dart`, `EntryEditorScreen(processes:)` |
| over 100% / review | `EntryMetrics.oeeCalc/oeeOver100`, `oeeCheck(c)` (`web_parity_lines.dart`), `SheetCol.style` + `CellStyle`/`CellMark` (`sheet/table/sheet_columns.dart`), `apqColumns/reviewColumn/apqMetrics/reviewRows` (`shared_columns.dart`) |
| working status | `entry_form/machine_status.dart` (`machineWorkingStatusCells`, `nonWorkingNote`, `MachineStatusSelect`), `dateMachineOperatorLine(c, workingStatus: true)`, `machineStatusColumn/Metric` (`shared_columns.dart`) |
| popups | `shared/limit_notice.dart` (`qtyNotice`, `stoppageNotice`, `firstOverLimit`, `EntryNotice`), `entry_form/entry_notice_dialog.dart` (`EntryNotices.show`), `EntryLineContext.notice/onLimit/popups` |

For each item: web files to read, what to override, copy-paste, test to copy
(`test/production/web_parity/`).

### 1. Vendor Name  (web: `utils/vendorsFor.js`, `VendorSelect.jsx`, `useVendors`, the page's `showVendorColumn`)

Only if the web form has `showVendor` / `VendorSelect` (CNC, VMC, SPM, Rivet, Press, Contact, Trobe,
Spring, After Powder Coating — check the form file; the rule is always: shown when the machine's
process has active vendors ticked in Vendor Master, or the entry already names one).

```dart
// <x>_spec.dart
@override bool get usesVendors => true;   // loads GET /vendors into ctx.extra['vendors'] and lets the
                                          // controller hide/show the column (SheetController.showVendorColumn)
```
```dart
// <x>_lines.dart — in the Part card's EntryGrid(cells: [...]); null while nothing to show
?vendorCell(c),                       // import entry_form/web_parity_lines.dart; add 'vendor' to the card's error keys
```
```dart
// <x>_columns.dart — right after Part Name (web order), before Drawing No.
vendorColumn(),                       // import sheet/table/shared_columns.dart (hidden via SheetCol.shownWhen)
// <x>_detail.dart — Entry group
?vendorMetric(row),
```
Values/payload (`<x>_values.dart`): `emptyEntry` has `'vendor': ''` and `'vendorName': ''`; `toFormValues`
keeps both (a populated `vendor` map -> its `_id`); `toPayload` sends `'vendor': jsTruthy(v['vendor']) ? v['vendor'] : null`
and **never** `vendorName` (the server derives it). Picking writes `vendor` only. Powder Coating already
loads `extraReference['vendors']` — keep it or drop it and set `usesVendors`; `referenceLists` merges
without duplicating. Parity test: `vendors.json` (vendorsFor.js).

### 2. Planned Operator Shift default & lock  (web: `utils/plannedShift.js`, `shiftHours.js`, page `plannedLocks`)

```dart
@override bool get usesPlannedShiftSetting => true;   // that is all, if the form uses the shared shiftLine(c)
```
The editor then (a) fills `plannedOperatorShiftHours` ("7.30") from the machine's process whenever
the machine changes, (b) keeps an EDITED entry's saved shift, (c) hands `c.plannedShift` to the form,
and `shiftLine` makes the box read-only with the reason ("Fixed at 12:00 hr — locked in Process Master"
/ "Kept as this entry was saved — set by Process Master"). An unlocked process or a machine in none
leaves the box to the person. If your lines draw their own planned-shift box (Powder Coating has no
machine), read `c.plannedShift` yourself (`enabled: c.plannedShift == null`) and for a row keyed on a
process rather than a machine build the setting with `shiftSettingOf(process)`. Required plumbing is
already done: `EntryEditorScreen(processes: _c.processes)` is passed by `ProductionSheetScreen`.
Changing the setting itself is Admin / Super Admin only (server `shiftChangeError`); the phone's Process
Master screen (`process_master_screen.dart`) offers the switch/hours only when
`ReviewAccessRepository().canReview()` (GET `/oee-review/access`) says so; `shiftChangeAllowed(current:, next:, isAdmin:)` is the same rule. Parity: `planned_shift.json`.

### 3. Over-100% / OEE Review  (web: `OeeCheck.jsx`, `ProductionEntriesTable.jsx` `APQ_COLUMNS`/`REVIEW_COLUMN`/`pctOver`, `metricsOver100`)

* **Form banner**: inside the quantity card, after the grid: `oeeCheck(c)` (reads
  `c.metrics.oeeOver100` = `metricsOver100(rowCalc(withDecimalPlanned(values)))`, so it uses *your*
  `rowCalc` through `EntryMetrics(calcFn:)`). The web VMC/SPM/Rivet… forms place it the same way.
* **Table**: after Setup Efficiency / before the OEE-losses columns `...apqColumns()`; after the last OEE
  column and before Remarks `reviewColumn()`. Red/pill emphasis comes from the new additive
  `SheetCol.style: CellStyle? Function(CellData)` — returns `CellStyle(mark: CellMark.danger|warn|ok,
  pill:, bold:)`, null = plain. Use it for any other value you need to mark:
  ```dart
  SheetCol(key: 'x', label: 'X', width: 90, text: (d) => ..., style: (d) => isOver100(d.calc['x']) ? CellStyle.danger : null)
  ```
* **Detail**: `...apqMetrics(calc)` then `...reviewRows(row)` in the Efficiency group (badge, plus
  "Over 100%", "Decision" and "Remark" sub-rows when present). `DetailMetric(style: CellStyle?)` is the
  detail's counterpart of `SheetCol.style`.
* `formulas` must carry `availability`, `performance`, `quality`, `review` (they are in `sheetFormulas`;
  VMC-style specs already merge their own).
* Optional: `noticeOnSaveForReview => true` shows a one-off "Goes to Admin review" notice on Save. The
  web shows only the banner, so nobody sets it today.
Parity: `over_100.json`, `review.json`.

### 4. Machine Working Status  (web: the "Machine Working Status" select + `MachineStatusSelect.jsx`)

```dart
// <x>_lines.dart
left(c) => isNonWorking(c.values)
    ? [dateMachineOperatorLine(c, workingStatus: true), nonWorkingNote(c)]       // Non Working: nothing else asked
    : [dateMachineOperatorLine(c, workingStatus: true), partLine(c), timeLine(c), ...],
right(c) => isNonWorking(c.values) ? [remarksLine(c)] : [..., remarksLine(c)],
```
Non Working: Operator becomes optional, Status chips (Machine Breakdown / No Manpower / No Planning +
**Remarks**) appear, switching back to Working clears them. "Remarks" is not stored: it opens the Remarks
box and focuses it, and stays ticked while that box has text. The validation must return after
Date + Machine for a Non Working entry (`isNonWorking(v)` early return, like `validateEntry`). Values:
`emptyEntry` has `machineStatus: []`, `workingMode: 'Working'`; `toPayload` sends
`machineStatus: nonWorking ? list : []` and `workingMode: v.workingMode || 'Working'`; `entryHasData` is
true for a Non Working entry (see `form.entryHasData`). Table: `machineStatusColumn()` right after
Operator; detail: `machineStatusMetric(row)`. Existing VMC/Press/Twin variants are left alone.
Parity: `working_status.json`, `payload_fields.json`.

### 5. Limit popups  (web: `utils/limitNotice.js`, `notice(...)` in `AlertContext`)

```dart
@override bool get showLimitPopups => true;
@override
OverLimit? firstOverLimit(List<Json> blocks, List<Map<String, String>> errors, {Map<String, String> machineNames = const {}}) =>
    limit.firstOverLimit(blocks, errors, rowCalc,
        qtyKey: 'okQty',                       // 'actualQty' for CNC; null = no quantity check
        // words: workerWords (Powder Coating), qtyLabel: 'OK + Rejected' (default for okQty)
        machineName: machineNames);            // import '../../shared/limit_notice.dart' as limit
```
* Downtime boxes (`c.minutesBox`) raise the stoppage popup by themselves when `showLimitPopups`.
* A quantity box: pass `onExceedTyped:` — `c.onLimit(popupBuilder, toastBuilder)` picks popup or toast:
  ```dart
  c.numBox('okQty', max: ceiling,
      onExceedTyped: c.onLimit(
        (typed) => qtyNotice(calc: m.calc, entered: typed, label: 'OK + Rejected'),   // web passes the OTHER box too:
        (max) => "OK Quantity can't be more than Ideal Quantity (${fmtNum(max)})"))
  ```
  The web's per-sheet label/entered figure is in each `<X>EntryForm.jsx` (`qtyNotice({ calc, entered, label })`) —
  copy it (CNC: `Actual Quantity`; the other sheets use `OK + Rejected` with entered = typed OK + Rejected).
* On Save, `EntryEditorScreen` calls `firstOverLimit` when an entry is incomplete, shows the popup
  (`EntryNotices.show`) and focuses that field afterwards. Anything else can raise a popup with
  `c.notice(EntryNotice(...))` (inside a line) or `EntryNotices.show(context, notice)` — one dialog at a time,
  however many keystrokes ask.
Parity: `limit_notice.json`, `first_over_limit.json` (web `qtyNotice`/`stoppageNotice`/`firstOverLimit`).

### 6. Table / detail columns  (web: `<x>Columns.jsx`)

Compare the web column list with `<x>_columns.dart` and add what is missing from the shared pieces
above (Machine Working Status, Vendor Name, Availability, Performance, Quality, OEE Review). The orders
to copy are CNC's: `operator, machineStatus, itemName, vendorName, drawingNo, … setupEff,
availability, performance, quality, oeeLosses, oeeLunch, oeeLunchCot, review, remarks`. Anything
optional (hidden on some pages) uses `SheetCol.shownWhen: (env) => …` — `SheetEnv` is built by
`SheetController.env`; add a field there for a new page-level fact.

### Testing a port (Wave 2)

* Unit/golden: nothing new for the shared logic (covered once in `test/production/web_parity/`). Add a golden
  only for logic *you* port. If you changed `toPayload`, extend your payload fixture with `machineStatus`,
  `workingMode`, `vendor`.
* Widget: copy `test/production/web_parity/cnc_web_parity_test.dart` — it drives `EntryEditorScreen(spec:, machines:
  [{… 'process': 'p1'}], processes:, extra: {'vendors': …})` through vendors, planned-shift lock, Non Working, the
  banner, popups (typing past a limit; Save with an over-limit entry), and the table/detail via
  `sheet_list_test.dart`'s `install/open/row` helpers (cells are keyed `<rowId>:<colKey>`, a pill `pill-<col>-<rowId>`).
* The list harness `install(...)` in `sheet_list_test.dart` registers `GET /vendors` (empty); a spec with
  `usesVendors` makes the list request it, so a fake API for such a process needs that route.
* Tests that call `EntryNotices.show` should `EntryNotices.reset()` in `setUp`.


## Form cards that fold, and the Part picker (web `FormLine optional`, `SearchablePartSelect`)

* `EntryLineCard(optional: true, hasValue:, openByDefault:, summary:, revealKey:)` is the web FormLine
  `optional`: folded to its header ("Optional — tap to add"), opens by itself when it holds a value,
  has an error after Save or `openByDefault`; fields stay mounted. The shared Planned Shift
  (`openByDefault: no Process Master setting`, `summary: 'Shift fixed — Lunch / Rest optional'`), Downtime, Remarks
  and CNC's Rejection cards use it. A card holding a box that is focused from outside (the Status
  "Remarks" tick) passes `revealKey: 'entry$index/<field>'`. Tests run with folding OFF
  (`test/flutter_test_config.dart`); `web_parity/line_fold_part_picker_test.dart` turns it on.
* There is NO "Machine Shift (hr)" box in the time card any more (the web removed it in a0d4600): the
  shift only appears in the Planned Operator Shift rule/hint.
* `partPickOptions` (`entry_form/part_options.dart`): parts with a process first, the rest under
  "Not in any process"; the search matches part name or Drawing No. only; "Drawing No.: x" line.
* VMC's list search also matches `workOrderNo` (`searchKeys`/`searchHint`).
