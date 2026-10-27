import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_line_context.dart';
import '../../process/process_spec.dart';
import '../../shared/limit_notice.dart' as limit show firstOverLimit, workerWords;
import '../../shared/limit_notice.dart' show OverLimit;
import '../../shared/production_entry_validation.dart' show TimeWords;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../shared/quantity_rules.dart' show applyRejectSplitChange;
import '../../sheet/sheet_model.dart';
import '../../sheet/table/sheet_columns.dart';
import 'raw_casting_calc.dart';
import 'raw_casting_columns.dart';
import 'raw_casting_detail.dart';
import 'raw_casting_lines.dart';
import 'raw_casting_metrics.dart';
import 'raw_casting_validation.dart';
import 'raw_casting_values.dart';

/// The RAW CASTING inspection sheet's Data Entry page (sheet key "rawCasting" —
/// client/src/pages/RawCastingDataEntry.jsx, Components/Production/
/// RawCastingEntryForm.jsx, rawCastingColumns.jsx, utils/rawCastingSheet.js and
/// rawCastingValidation.js). After Powder Coating's twin: per WORKER (the id in
/// `machine`, `worker` on the wire), each entry worked out on its own, up to
/// [rawCastingMaxEntriesPerDay] a day, and one worker's entries MAY overlap.
class RawCastingSpec extends ProcessSpec {
  const RawCastingSpec();

  // ── identity ──
  @override
  String get key => 'raw-casting';
  @override
  String get label => 'RAW CASTING';
  @override
  String get routePath => '/production/raw-casting-data-entry';
  @override
  String get pageTitle => 'RAW CASTING Data Entry';
  @override
  String get addTitle => 'Add RAW CASTING Entry';
  @override
  String get editTitle => 'Update RAW CASTING Entry';
  @override
  String get draftKey => 'rawCastingEntryDraft';

  /// The page a process is linked to, matched the way the web page does it:
  /// the route path with any role-slug prefix stripped.
  @override
  bool ownsProcess(Json process) {
    final url = process['dataEntryMenu'];
    if (url is! String || url.isEmpty) return false;
    final here = url.replaceFirst(RegExp(r'^/[^/]+'), '').replaceFirst(RegExp(r'/$'), '');
    return here == routePath;
  }

  // The row key is an operator.
  @override
  String get machineLabel => 'Worker Name';
  @override
  String get machineNoun => 'worker';
  @override
  String machineBlockTitle(String name, int index) => name.isEmpty ? 'Worker ${index + 1}' : name;
  @override
  String? get noMachinesMessage => 'No workers yet — assign them to RAW CASTING in Production › Operators.';
  @override
  String get selectMachinePrompt => 'Select a worker — their entry fields open automatically';
  @override
  String get selectMachineFirst => 'Select a worker first';
  // Unlike RUBBER, one operator often has several entries a day (the paper has
  // up to six), so another block may name the same operator.
  @override
  bool get uniqueMachinePerDate => false;
  @override
  bool get checksTimeOverlap => false;
  @override
  String get addAnotherLabel => 'Add another entry';
  @override
  int? get maxEntriesPerDay => rawCastingMaxEntriesPerDay;
  @override
  bool get checksOperatorClash => false;
  @override
  String? savedMachineName(Json row) {
    final name = row['operator'];
    return (name is String && name.trim().isNotEmpty) ? name : '—';
  }

  // The sheet's Machine ON / OFF Time, kept per worker.
  @override
  TimeWords get timeWords => const TimeWords(start: 'Inspection Start Time', end: 'Inspection End Time', owner: 'this worker');

  // The Filters panel: Operator / Item only; search item, operator, vendor.
  @override
  bool get showOperatorFilter => false;
  @override
  String get machineFilterTitle => 'Worker Name';
  @override
  String get machineFilterPlaceholder => 'All workers';
  @override
  String get machineChipPrefix => 'Worker';
  @override
  List<String> get searchKeys => const ['itemName', 'operator', 'vendorName'];
  @override
  String get searchHint => 'Search item, worker, vendor…';

  /// This sheet's operators: active Operator Master names assigned to the page's
  /// process, plus any not given a process yet — each standing in as a
  /// "machine" of that process (which is how the Operator Planned Shift lock
  /// reaches them on the web).
  @override
  List<Json> scopeMachines({required List<Json> machines, required List<Json> operators, required Json? lockedProcess}) {
    String idOf(Object? v) => v is Map ? '${v['_id']}' : '${v ?? ''}';
    final pid = lockedProcess == null ? null : '${lockedProcess['_id']}';
    return [
      for (final o in operators)
        if (o['isActive'] != false &&
            (pid == null ||
                o['processes'] is! List ||
                (o['processes'] as List).isEmpty ||
                (o['processes'] as List).any((p) => idOf(p) == pid)))
          {'_id': '${o['_id']}', 'machineName': '${o['name'] ?? ''}', 'process': pid},
    ];
  }

  // ── web-parity extras ──
  // Vendor Name: the page's process (not a machine) decides whether the box and
  // the table column show — `processVendors` / `showVendorColumn` in the page.
  @override
  bool get usesVendors => true;

  // Process Master's Operator Planned Shift reaches a block through its operator
  // (each operator stands in as a "machine" of the page's process, see
  // [scopeMachines]) — `plannedLocks` in the page.
  @override
  bool get usesPlannedShiftSetting => true;

  // Idle time past the Machine Shift Time pops up why (BPC_WORDS). TOTAL QTY has
  // no ceiling here (qtyKey null): beating Ideal goes to OEE Review instead.
  @override
  bool get showLimitPopups => true;
  @override
  OverLimit? firstOverLimit(List<Json> blocks, List<Map<String, String>> errors, {Map<String, String> machineNames = const {}}) =>
      limit.firstOverLimit(blocks, errors, rowCalc, qtyKey: null, words: limit.workerWords, machineName: machineNames);

  @override
  String? get unlinkedProcessMessage =>
      'Link this page to the RAW CASTING process in Process Master (Data Entry Page) before adding entries.';

  @override
  Json finishPayload(Json payload, {required Json? process}) => {...payload, 'process': process?['_id']};

  // ── server ──
  @override
  SheetApi get api => SheetApi.segment('raw-casting-sheet', machineParam: 'worker');

  // ── figures ──
  @override
  Json rowCalc(Json row) => rawCastingRowCalc(row);
  @override
  List<Json> dayCalc(List<Json> sortedRows) => rawCastingDayCalc(sortedRows);
  /// Which OEE figures the table has (web OEE_FIGURE_KEYS): the two Productivity figures.
  @override
  String get oeeFigureKind => 'worker';

  @override
  EntryMetrics metrics(Json values) => RawCastingMetrics(values);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => validateRawCastingEntry(values, saved: saved);
  @override
  List<String> get fieldOrder => rawCastingFieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => rawCastingEmptyEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) => rawCastingToFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) => rawCastingToPayload(values, isEdit: isEdit, processId: null);
  @override
  bool hasAnyEntryData(List<Json> blocks) => rawCastingHasAnyEntryData(blocks);
  @override
  bool entryHasData(Json values) => rawCastingEntryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) => rawCastingApplyItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) => rawCastingNewBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) => rawCastingMergeDraft(draft, now: now);
  @override
  Json applyRejectChange(Json values, String reason, dynamic value) => applyRejectSplitChange(values, reason, value);

  // ── form ──
  @override
  EntryLines get lines => const RawCastingEntryLines();

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => rawCastingColumns(open);
  @override
  Map<String, String> get formulas => rawCastingFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) => rawCastingDetail(row, calc, day);
}

/// The one shared RAW CASTING spec.
const RawCastingSpec rawCastingSpec = RawCastingSpec();
