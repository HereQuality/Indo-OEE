import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_line_context.dart';
import '../../process/process_spec.dart';
import '../../shared/limit_notice.dart' as limit show firstOverLimit;
import '../../shared/limit_notice.dart' show OverLimit, faWords;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../shared/quantity_rules.dart' show applyRejectSplitChange;
import '../../sheet/sheet_model.dart';
import '../../sheet/table/sheet_columns.dart';
import 'fa_calc.dart';
import 'fa_columns.dart';
import 'fa_detail.dart';
import 'fa_lines.dart';
import 'fa_metrics.dart';
import 'fa_validation.dart';
import 'fa_values.dart';

/// The FINAL ASSEMBLY sheet's Data Entry page (client/src/pages/
/// FinalAssemblyDataEntry.jsx, Components/Production/FinalAssemblyEntryForm.jsx,
/// finalAssemblyColumns.jsx, utils/finalAssemblySheet.js and
/// finalAssemblyValidation.js).
///
/// Kept per WORKER (After Powder Coating's shape): an entry is keyed by (date,
/// worker, slot); the worker's id sits in each row's `machine` and travels as
/// `worker`. A worker's entries MAY overlap (several jobs at once), up to
/// [faMaxEntriesPerDay] a date. Standard Time per Piece is optional (PACKING has
/// none). The four Types of Defects are `rejectBreakdown`; OK = Total − Defects;
/// Total may beat Ideal (OEE Review).
class FinalAssemblySpec extends ProcessSpec {
  const FinalAssemblySpec();

  // ── identity ──
  @override
  String get key => 'final-assembly';
  @override
  String get label => FaLabels.sheet;
  @override
  String get routePath => '/production/final-assembly-data-entry';
  @override
  String get pageTitle => '${FaLabels.sheet} Data Entry';
  @override
  String get addTitle => 'Add ${FaLabels.sheet} Entry';
  @override
  String get editTitle => 'Update ${FaLabels.sheet} Entry';
  @override
  String get draftKey => 'finalAssemblyEntryDraft';

  @override
  bool ownsProcess(Json process) {
    final url = process['dataEntryMenu'];
    if (url is! String || url.isEmpty) return false;
    final here = url.replaceFirst(RegExp(r'^/[^/]+'), '').replaceFirst(RegExp(r'/$'), '');
    return here == routePath;
  }

  // The row key is a worker.
  @override
  String get machineLabel => FaLabels.worker;
  @override
  String get machineNoun => 'worker';
  @override
  String machineBlockTitle(String name, int index) => name.isEmpty ? 'Entry ${index + 1}' : name;
  @override
  String? get noMachinesMessage => 'No workers yet — assign them to ${FaLabels.sheet} in Production › Operators.';
  // The same worker may be picked in several blocks, at overlapping times.
  @override
  bool get uniqueMachinePerDate => false;
  @override
  bool get checksOperatorClash => false;
  @override
  bool get checksTimeOverlap => false;
  @override
  int? get maxEntriesPerDay => faMaxEntriesPerDay;
  @override
  String get selectMachinePrompt => 'Select a worker — their entry fields open automatically';
  @override
  String get selectMachineFirst => 'Select a worker first';
  @override
  String get addAnotherLabel => 'Add another entry';
  @override
  String? savedMachineName(Json row) {
    final name = row['operator'];
    return (name is String && name.trim().isNotEmpty) ? name : '—';
  }

  // The Filters panel: Worker Name / Item only; search item, worker, vendor.
  @override
  bool get showOperatorFilter => false;
  @override
  String get machineFilterTitle => FaLabels.worker;
  @override
  String get machineFilterPlaceholder => 'All workers';
  @override
  String get machineChipPrefix => 'Worker';
  @override
  List<String> get searchKeys => const ['itemName', 'operator', 'vendorName'];
  @override
  String get searchHint => 'Search item, worker, vendor…';

  /// Active Operator Master names assigned to the page's process, plus any not
  /// given a process yet — each standing in as a "machine" of that process.
  @override
  List<Json> scopeMachines({required List<Json> machines, required List<Json> operators, required Json? lockedProcess}) {
    String idOf(Object? v) => v is Map ? '${v['_id']}' : '${v ?? ''}';
    final pid = lockedProcess == null ? null : '${lockedProcess['_id']}';
    return [
      for (final o in operators)
        if (o['isActive'] != false &&
            (pid == null || o['processes'] is! List || (o['processes'] as List).isEmpty || (o['processes'] as List).any((p) => idOf(p) == pid)))
          {'_id': '${o['_id']}', 'machineName': '${o['name'] ?? ''}', 'process': pid},
    ];
  }

  // ── web-parity extras ──
  @override
  bool get usesVendors => true;
  @override
  bool get usesPlannedShiftSetting => true;

  // Idle Time + Other Activity past the Working Hours pops up why (FA_WORDS).
  // Total QTY has no ceiling (qtyKey null): beating Ideal goes to OEE Review.
  @override
  bool get showLimitPopups => true;
  @override
  OverLimit? firstOverLimit(List<Json> blocks, List<Map<String, String>> errors, {Map<String, String> machineNames = const {}}) =>
      limit.firstOverLimit(blocks, errors, rowCalc, qtyKey: null, words: faWords, machineName: machineNames);

  @override
  String? get unlinkedProcessMessage => 'Link this page to the ${FaLabels.sheet} process in Process Master (Data Entry Page) before adding entries.';

  @override
  Json finishPayload(Json payload, {required Json? process}) => {...payload, 'process': process?['_id']};

  // ── server ──
  @override
  SheetApi get api => SheetApi.segment('final-assembly-sheet', machineParam: 'worker');

  // ── figures ──
  @override
  Json rowCalc(Json row) => faRowCalc(row);
  @override
  List<Json> dayCalc(List<Json> sortedRows) => [
        // The day card's chip reads `oeeLosses`; this sheet's own figure is Productivity.
        for (final d in faDayCalc(sortedRows)) {...d, 'oeeLosses': d['productivity']},
      ];
  /// Which OEE figures the table has (web OEE_FIGURE_KEYS): the two Productivity figures.
  @override
  String get oeeFigureKind => 'worker';

  @override
  EntryMetrics metrics(Json values) => FaMetrics(values);
  @override
  EntryFigures figures(Json row, Json calc) =>
      EntryFigures(ok: calc['okQty'], actual: calc['actualQty'], pctOk: calc['pctOk'], shiftHours: calc['shiftHours']);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => validateFinalAssemblyEntry(values, saved: saved);
  @override
  List<String> get fieldOrder => faFieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => faEmptyEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) => faToFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) => faToPayload(values, isEdit: isEdit, processId: null);
  @override
  bool hasAnyEntryData(List<Json> blocks) => faHasAnyEntryData(blocks);
  @override
  bool entryHasData(Json values) => faEntryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) => faApplyItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) => faNewBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) => faMergeDraft(draft, now: now);
  @override
  Json applyRejectChange(Json values, String reason, dynamic value) => applyRejectSplitChange(values, reason, value);

  // ── form ──
  @override
  EntryLines get lines => const FaEntryLines();

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => faColumns(open);
  @override
  Map<String, String> get formulas => faFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) => faDetail(row, calc, day);
}

/// The one shared FINAL ASSEMBLY spec.
const FinalAssemblySpec finalAssemblySpec = FinalAssemblySpec();
