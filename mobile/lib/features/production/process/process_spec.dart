import 'package:flutter/material.dart';

import '../../../app/routes.dart';
import '../../../core/api/endpoints.dart';
import '../entry_form/entry_form_logic.dart';
import '../entry_form/entry_line_context.dart';
import '../shared/production_entry_validation.dart' as rules;
import '../shared/planned_shift.dart' show ShiftSetting;
import '../shared/production_sheet_calc.dart' show dayFiguresFor, metricsOver100, withDayFigures;
import '../sheet/sheet_model.dart';
import '../shared/limit_notice.dart' show OverLimit;
import '../sheet/table/sheet_columns.dart';

/// Everything that makes one process's Data Entry page different from another's,
/// in one object. The framework — [SheetController] (the list), the entry
/// editor, the entry form, the table, the day cards and the detail — never
/// names CNC (or any process) itself: it asks the [ProcessSpec] it was handed.
///
/// Adding a process is one folder, `features/production/processes/<key>/`, with
/// a class extending [ProcessSpec] (or an existing spec: Contact / Trobe /
/// Spring are CNC twins and can extend `CncSpec`), plus one line in
/// `process_registry.dart`. See `mobile/docs/PROCESS_PORTING.md`.
///
/// A spec is stateless and `const`-constructible: every member is a pure
/// function of its arguments, so one instance is shared by the whole app.
abstract class ProcessSpec {
  const ProcessSpec();

  // ── identity ─────────────────────────────────────────────────────────────

  /// Stable id: 'cnc', 'vmc', 'spm', 'rivet', 'press', 'contact', 'trobe',
  /// 'spring', 'powder-coating'.
  String get key;

  /// What the process is called in titles ("VMC").
  String get label;

  /// The menu URL WITHOUT the role slug, as in the web router
  /// ('/production/vmc-data-entry'). A process owns the page its
  /// `dataEntryMenu` resolves to ([ownsProcess]).
  String get routePath;

  /// Other menu URLs that open the same page (old bookmarks).
  List<String> get routeAliases => const [];

  /// App bar title of the list page.
  String get pageTitle => 'Data entry';

  /// App bar titles of the add / edit screen.
  String get addTitle => 'Add Production Entry';
  String get editTitle => 'Update Production Entry';

  /// SharedPreferences key of the add-form draft (one per process, so a VMC
  /// draft never turns up in the CNC form).
  String get draftKey => 'productionEntryDraft';

  /// Whether this process's Process document has [process] as its Data Entry
  /// Page — the same match the web uses (`stripSlug(p.dataEntryMenu) === here`),
  /// resolved through the app's route table so aliases count.
  bool ownsProcess(Json process) {
    final url = process['dataEntryMenu'];
    return url is String && url.isNotEmpty && AppRoutes.match(url)?.path == routePath;
  }

  /// The "machines" the machine picker offers (and the list's Machine column
  /// names). Default: with this page linked to one process, that process's
  /// machines — else every machine. Powder Coating overrides it: each worker
  /// stands in as a "machine" (the API stores the worker's id as the row's
  /// `machine`) — build `{_id, machineName, process}` maps from [operators].
  /// Must return maps with `_id` and `machineName`.
  List<Json> scopeMachines({
    required List<Json> machines,
    required List<Json> operators,
    required Json? lockedProcess,
  }) {
    if (lockedProcess == null) return machines;
    final pid = '${lockedProcess['_id']}';
    return machines.where((m) {
      final owner = m['process'];
      return (owner is Map ? '${owner['_id'] ?? ''}' : '${owner ?? ''}') == pid;
    }).toList();
  }

  /// Whether the Part picker offers only this process's parts (plus parts with
  /// no process), like the web pages do. CNC keeps the phone's original "every
  /// part" behaviour; new ports should return true.
  bool get scopeItemsToProcess => true;

  /// Extra reference lists the page loads once beside machines / parts /
  /// operators (e.g. {'workOrders': Endpoints.workOrders}); softly loaded into
  /// `SheetController.extra[name]` and handed to the form as `ctx.extra[name]`.
  Map<String, String> get extraReference => const {};

  // ── Wave-1 hooks: the web-parity extras. Every default is "off" — a spec that
  // does not override them behaves exactly as before. See PROCESS_PORTING.md
  // ("Wave 2 checklist") for what each one switches on. ─────────────────────

  /// Vendor Name (Vendor Master): load `/vendors` with the reference lists
  /// (`ctx.extra['vendors']`) and let the table hide/show its Vendor column
  /// (`vendorColumn()`). The form card is `vendorLine(c)` / `vendorCell(c)`.
  bool get usesVendors => false;

  /// Every reference list the page loads: [extraReference] plus `vendors` when
  /// [usesVendors] (unless the spec already names it, e.g. Powder Coating).
  Map<String, String> get referenceLists => usesVendors && !extraReference.containsKey('vendors')
      ? {...extraReference, 'vendors': Endpoints.vendors}
      : extraReference;

  /// Planned Operator Shift from Process Master (web `shiftSettingForMachine`):
  /// picking a machine fills the box with its process's hours and, when the
  /// process locks them, the box is read-only with the reason
  /// (`c.plannedShift`, shown by `shiftLine`). The server enforces the same.
  bool get usesPlannedShiftSetting => false;

  /// Raise the web's limit popups (client/src/utils/limitNotice.js) instead of
  /// a toast: when a quantity / stoppage box blocks a keystroke past its limit
  /// (`c.minutesBox`, `c.limitBox`) and on Save ([firstOverLimit]).
  bool get showLimitPopups => false;

  /// Web `firstOverLimit(entries, errors, rowCalc, {...})` for this sheet: the
  /// first block whose quantity / stoppage is past its limit, with the popup
  /// Save raises before it moves to that field. null = no popup. Only called
  /// when [showLimitPopups]. Build it with `firstOverLimit` from
  /// `shared/limit_notice.dart`.
  OverLimit? firstOverLimit(List<Json> blocks, List<Map<String, String>> errors, {Map<String, String> machineNames = const {}}) =>
      null;

  /// Also tell the person, once, on Save that an entry above 100% goes to Admin
  /// review. The web shows only the in-form banner (OeeCheck), so this is off
  /// everywhere; it is here for a process that wants the extra reminder.
  bool get noticeOnSaveForReview => false;

  /// What the row key is called on the form and in sentences. CNC: "Machine No."
  /// / "machine". Powder Coating's row key is a worker ("Worker Name" /
  /// "worker"): the form, the filters and the editor's messages follow.
  String get machineLabel => 'Machine No.';
  String get machineNoun => 'machine';

  /// The collapsed block's header text in the form ("Machine 7A"; a worker's
  /// block is headed by the worker's name).
  String machineBlockTitle(String name, int index) => 'Machine ${name.isEmpty ? index + 1 : name}';

  /// A line shown in a collapsed block when there is nothing to pick (no
  /// workers assigned to the process); null = nothing special.
  String? get noMachinesMessage => null;

  /// Whether one form may hold a row key (machine / worker) only once per date:
  /// a machine already in another block of the same date is "already added" in
  /// the picker, and "Add another machine" is off (with the web's note) once
  /// every machine is in the form for the date. Every web entry form does this,
  /// so the default is true.
  bool get uniqueMachinePerDate => true;

  /// Whether the editor also looks an Operator up (`occupied?date&operator`) so
  /// one operator can't be on two machines at once. Powder Coating has no
  /// separate operator (the worker IS the row key): off there.
  bool get checksOperatorClash => true;

  /// Whether one machine's (worker's) entries on a date may not overlap in time
  /// (web `overlapErrors`). PRINTING turns it off: one operator may run two
  /// jobs at once, as its paper sheet does.
  bool get checksTimeOverlap => true;

  /// The most entries one machine (worker) may have on a date, said on the box
  /// as soon as the date is full (web `slotsFullErrors(…, { max })`); null =
  /// left to the server's refusal on Save (today's behaviour).
  int? get maxEntriesPerDay => null;

  /// What a collapsed block with no row key yet says, and its "+" tooltip then
  /// (web: "Select a machine — its entry fields open automatically" / "Select a
  /// machine first"). A person's sheet says it its own way ("Select an operator
  /// — their entry fields open automatically").
  String get selectMachinePrompt => 'Select a $machineNoun — its entry fields open automatically';
  String get selectMachineFirst => 'Select a $machineNoun first';

  /// The "Add another …" button under the blocks, and the note beside it
  /// (null = none).
  String get addAnotherLabel => 'Add another $machineNoun';
  String? get addAnotherNote => null;

  /// How the time-overlap message names this sheet's two time boxes and its
  /// row key (web `overlapErrors(…, { words })`): "Machine ON Time … for this
  /// machine" by default; a worker sheet says its own ("Working Start Time …
  /// for this worker").
  rules.TimeWords get timeWords => rules.machineTimeWords;

  /// The name to show for a saved row whose machine (worker) is no longer
  /// offered; null = a generic "Noun (no longer active)".
  String? savedMachineName(Json row) => null;

  /// Row fields the list's search box looks in, and its placeholder.
  /// Whether a machine's entries on a date read in Machine ON order (then
  /// slot) rather than slot order — MODULAR FRAME DRILLING, whose entries may
  /// overlap in time (web `sortedRows`).
  bool get entriesByMachineOn => false;

  List<String> get searchKeys => const ['itemName', 'operator', 'drawingNo'];
  String get searchHint => 'Search part, operator, drawing no…';

  /// Whether the Filters sheet offers an Operator slicer, and how it words the
  /// machine slicer (title, placeholder).
  bool get showOperatorFilter => true;
  String get machineFilterTitle => 'MC No.';
  String get machineChipPrefix => 'MC';
  String get machineFilterPlaceholder => 'All machines';

  /// Non-null when new entries need the page linked to a process (Process
  /// Master › Data Entry Page) — the text of the error shown on Save otherwise.
  String? get unlinkedProcessMessage => null;

  /// A last touch on the PUT body before it is sent, with the process this page
  /// is linked to (null when it isn't). Powder Coating adds `process`.
  Json finishPayload(Json payload, {required Json? process}) => payload;

  // ── server ───────────────────────────────────────────────────────────────

  /// The `/…-sheet` endpoints of this process.
  SheetApi get api;

  // ── figures ──────────────────────────────────────────────────────────────

  /// The web's `…RowCalc`: one entry's derived figures (`calc` map). The
  /// framework relies on these keys existing (null when unknown):
  /// `shiftHours`, `actualQty`, `pctOk`, `totalStoppageMin` — the day card,
  /// the entry detail and the editor read them. Everything else in the map is
  /// private to this spec's own columns / detail / lines.
  Json rowCalc(Json row);

  /// The web's `…DayCalc`: one result per row of one machine's one date, in the
  /// order given (the controller sorts them by Machine ON time first).
  /// Keys read by the framework: `oeeLosses` (day card chip). The rest is for
  /// this spec's columns / detail.
  List<Json> dayCalc(List<Json> sortedRows);

  /// What the entry form derives from a block's values (caps, stoppage allowance,
  /// …). Override to subclass [EntryMetrics] with process-specific getters.
  EntryMetrics metrics(Json values) => EntryMetrics(values, calcFn: rowCalc);

  /// Which OEE figures this sheet's table has, as the web's OEE_FIGURE_KEYS:
  /// 'machine' (three OEE figures), 'bpc' (two) or 'worker' (the two
  /// Productivity figures). Decides which day figures can hold an entry for review.
  String get oeeFigureKind => 'machine';

  /// The metric keys above 100% that send this entry to Admin review: its own
  /// Availability / Performance / Quality as Save will work them out, plus the
  /// sheet's OEE (Productivity) figures of its day. [saved] are the sheet's loaded
  /// rows; those of the same machine (worker) and date join the entry in
  /// [dayCalc] — the web's `dayFiguresFor` + `withDayFigures` + `metricsOver100`.
  List<String> oeeOver100(Json values, {List<Json> saved = const [], ShiftSetting? plannedShift}) {
    final own = metrics(values).oeeCalc;
    final machine = '${values['machine'] ?? ''}';
    final date = values['date'];
    final day = dayFiguresFor(
      dayCalc,
      rules.withDecimalPlanned(values, plannedLocked: plannedShift != null && plannedShift.locked && !plannedShift.fromEntry),
      [
        for (final r in saved)
          if ('${r['machine'] ?? ''}' == machine && r['date'] == date) r,
      ],
    );
    return metricsOver100(withDayFigures(own, day, oeeFigureKind));
  }

  // ── rules ────────────────────────────────────────────────────────────────

  /// The web's `validateXEntry`: one block's values → {fieldKey: message}.
  /// Keys go in form order. [saved] is the row's times as loaded (edit mode).
  Map<String, String> validateEntry(Json values, {Json? saved});

  /// Top to bottom, the way the form reads — the first key with an error is
  /// where Save scrolls to.
  List<String> get fieldOrder;

  /// The first incomplete block / field (see [rules.firstError]).
  Map<String, dynamic>? firstError(List<Map<String, String>?> errors) =>
      rules.firstError(errors, order: fieldOrder);

  // ── values ───────────────────────────────────────────────────────────────
  // The pure parts of the web page's handlers (emptyEntry, toFormValues,
  // toPayload, …). A block is a `Map` with the web's exact keys; typed fields
  // are Strings ('' = blank).

  Json emptyEntry({DateTime? now});
  Json toFormValues(Json row, {DateTime? now});

  /// The exact body of `PUT <api.row>`. '' tells the server to unset a field.
  Json toPayload(Json values, {required bool isEdit});

  /// Whether any of [blocks] holds something worth keeping as a draft.
  bool hasAnyEntryData(List<Json> blocks);

  /// Whether ONE block holds typed work (a collapsed block's tint, the remove
  /// confirmation).
  bool entryHasData(Json values);

  /// Picking a Part copies its master values onto the block.
  Json applyItemSelection(Json values, String itemId, List<Json> items);

  /// A new machine block ("Add another machine").
  Json newBlockAfter(List<Json> blocks, {DateTime? now});

  /// A draft saved before a field existed lacks it — fill those in.
  Json mergeDraftEntry(Json draft, {DateTime? now});

  /// A reject-split box changed (CNC only; other specs may ignore it).
  Json applyRejectChange(Json values, String reason, dynamic value) => values;

  // ── form ─────────────────────────────────────────────────────────────────

  /// The cards of an open block (see [EntryLines]).
  EntryLines get lines;

  // ── list ─────────────────────────────────────────────────────────────────

  /// The table's columns, with the expandable breakdowns in [open] opened.
  /// Build them with the helpers in `sheet_columns.dart` ([SheetCol],
  /// [sheetSubCol], [addExpandable], [fitSheetColumn]).
  SheetColumns columns(Set<String> open);

  /// The plain-English formula behind each `formulaKey` a column / detail row
  /// declares (shown from its ⓘ tap).
  Map<String, String> get formulas;

  /// Every remark an entry carries, for the eye buttons: items
  /// `{key, title, figure, text}` with `key` in 'reject' | 'downtime' | 'general'.
  List<Json> remarkParts(Json row);

  /// The grey line under a part in the Part picker ("60 sec"); null for none.
  String? itemSubtitle(Json item) {
    final cycle = entryFmt(item['totalCycleSec']);
    return cycle.isEmpty ? null : '$cycle sec';
  }

  /// What the day card shows for one entry (the "ok / actual" pair and caption).
  EntryFigures figures(Json row, Json calc) => EntryFigures.fromCalc(row, calc);

  /// The expanded detail of one entry.
  DetailModel detail(Json row, Json calc, Json day);
}

/// The `/…-sheet` endpoint set of one process (all relative to the API root;
/// `Api.get` etc. take them as they are).
class SheetApi {
  const SheetApi(this.base, {this.operators, this.rejectReasons, this.machineParam = 'machine'});

  /// The query parameter that carries the row key (machine ids) on `list` and
  /// `occupied`: 'machine', or 'worker' for Powder Coating.
  final String machineParam;

  /// 'v1/production-sheet' — [Endpoints.productionSheet] for CNC.
  final String base;

  /// Only CNC has these (GET /operators, GET /reject-reasons); null elsewhere.
  final String? operators;
  final String? rejectReasons;

  /// GET list: `?from&to&page&machine&operator&item` → `{data, meta}`.
  String get list => base;

  /// PUT upsert, DELETE `/:id`, PUT `/:id/unlock`.
  String get row => '$base/row';

  /// GET `{from, to}` across every saved entry.
  String get extent => '$base/extent';

  /// GET `?from&to` → distinct machine / operator / item values.
  String get filterOptions => '$base/filter-options';

  /// GET `?date&machine` (a machine's booked slots) or `?date&operator`.
  String get occupied => '$base/occupied';

  /// The conventional endpoint set `<v1>/<segment>` ('vmc-sheet', 'spm-sheet', …).
  factory SheetApi.segment(String segment, {String machineParam = 'machine'}) =>
      SheetApi('${Endpoints.v1}/$segment', machineParam: machineParam);
}

/// What the day card shows for one entry. Defaults read the CNC way: the typed
/// OK quantity over the calculated Actual, with % OK underneath.
class EntryFigures {
  const EntryFigures({this.ok, this.actual, this.pctOk, this.shiftHours});

  /// A number or a blank-ish value as the row holds it (`row['okQty']`).
  final Object? ok;
  final Object? actual;
  final Object? pctOk;
  final Object? shiftHours;

  factory EntryFigures.fromCalc(Json row, Json calc) => EntryFigures(
        ok: row['okQty'],
        actual: calc['actualQty'],
        pctOk: calc['pctOk'],
        shiftHours: calc['shiftHours'],
      );
}

// ── detail model ───────────────────────────────────────────────────────────

/// The expanded view of one entry: the OEE tiles on top, then labelled groups.
class DetailModel {
  const DetailModel({required this.oee, required this.groups});
  final List<DetailOee> oee;
  final List<DetailGroup> groups;
}

/// One headline percentage (tap shows its formula).
class DetailOee {
  const DetailOee({required this.formulaKey, required this.title, required this.label, required this.value});
  final String formulaKey;
  final String title;
  final String label;
  final String value;
}

class DetailGroup {
  const DetailGroup({required this.title, required this.icon, required this.rows});
  final String title;
  final IconData icon;
  final List<DetailRow> rows;
}

sealed class DetailRow {
  const DetailRow();
}

/// A label / value line; a tap on a calculated one (it has a [tone]) shows its formula.
class DetailMetric extends DetailRow {
  const DetailMetric({
    required this.label,
    required this.value,
    this.tone,
    this.formulaKey,
    this.strong = false,
    this.maxLines = 2,
    this.remarks = const [],
    this.remarkTone,
    this.style,
  });

  /// Optional emphasis of the value (a review badge, a red over-100% figure) —
  /// the detail's counterpart of [SheetCol.style].
  final CellStyle? style;
  final String label;
  final String value;
  final Color? tone;
  final String? formulaKey;
  final bool strong;
  final int maxLines;
  final List<Json> remarks;
  final Color? remarkTone;
}

/// An indented line under a figure (one reject reason, one downtime cause, one
/// operation time).
class DetailSubRow extends DetailRow {
  const DetailSubRow({
    required this.label,
    required this.value,
    this.unit,
    this.struck = false,
    this.note,
    this.remarks = const [],
    this.remarkTone,
    this.remarkLabel,
  });
  final String label;
  final String value;
  final String? unit;
  final bool struck;
  final String? note;
  final List<Json> remarks;
  final Color? remarkTone;
  final String? remarkLabel;
}
