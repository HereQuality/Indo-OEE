import '../../../../core/api/endpoints.dart';
import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_line_context.dart';
import '../../process/process_spec.dart';
import '../../shared/limit_notice.dart' as limit show firstOverLimit;
import '../../shared/limit_notice.dart' show OverLimit, printingWords;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../sheet/sheet_model.dart';
import '../../sheet/table/sheet_columns.dart';
import 'printing_calc.dart';
import 'printing_columns.dart';
import 'printing_detail.dart';
import 'printing_lines.dart';
import 'printing_metrics.dart';
import 'printing_validation.dart';
import 'printing_values.dart';

/// The PRINTING sheet's Data Entry page (client/src/pages/PrintingDataEntry.jsx,
/// Components/Production/PrintingEntryForm.jsx, printingColumns.jsx,
/// utils/printingSheet.js and printingValidation.js).
///
/// Kept per OPERATOR: an entry is keyed by (date, operator, slot). The
/// operator's id sits in each row's `machine` (the API maps it), so the shared
/// list, table and day formulas group by operator; each operator stands in as a
/// "machine" of the page's process ([scopeMachines]). On the wire the id
/// travels as `worker`. The optional MC No. is `mcMachine` (+ its saved name
/// `mcName`) — one of the process's machines, loaded as `extra['machines']`.
///
/// Unlike the other per-worker sheets, one operator may run two jobs at
/// overlapping times, so there is no overlap rule and the same operator may be
/// added twice in one form — up to [printingMaxEntries] entries a date.
class PrintingSpec extends ProcessSpec {
  const PrintingSpec();

  // ── identity ──
  @override
  String get key => 'printing';
  @override
  String get label => 'PRINTING';
  @override
  String get routePath => '/production/printing-data-entry';
  @override
  String get pageTitle => 'PRINTING Data Entry';
  @override
  String get addTitle => 'Add PRINTING Entry';
  @override
  String get editTitle => 'Update PRINTING Entry';
  @override
  String get draftKey => 'printingEntryDraft';

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
  String get machineLabel => 'Operator';
  @override
  String get machineNoun => 'operator';
  @override
  String machineBlockTitle(String name, int index) => name.isEmpty ? 'Entry ${index + 1}' : name;
  @override
  String? get noMachinesMessage => 'No operators yet — assign them to PRINTING in Production › Operators.';
  // The same operator may be added twice on one date (two jobs at once).
  @override
  bool get uniqueMachinePerDate => false;
  @override
  bool get checksOperatorClash => false;
  @override
  bool get checksTimeOverlap => false;
  @override
  int? get maxEntriesPerDay => printingMaxEntries;
  @override
  String get selectMachinePrompt => 'Select an operator — their entry fields open automatically';
  @override
  String get selectMachineFirst => 'Select an operator first';
  @override
  String get addAnotherLabel => 'Add another entry';
  @override
  String? get addAnotherNote => 'The same operator can be added again — e.g. a second job at the same time.';
  @override
  String? savedMachineName(Json row) {
    final name = row['operator'];
    return (name is String && name.trim().isNotEmpty) ? name : '—';
  }

  // The Filters panel: Operator / Item only; search item, operator, MC No., vendor.
  @override
  bool get showOperatorFilter => false;
  @override
  String get machineFilterTitle => 'Operator';
  @override
  String get machineFilterPlaceholder => 'All operators';
  @override
  String get machineChipPrefix => 'Operator';
  @override
  List<String> get searchKeys => const ['itemName', 'operator', 'mcName', 'vendorName'];
  @override
  String get searchHint => 'Search item, operator, MC No., vendor…';

  /// This sheet's operators: active Operator Master names assigned to the page's
  /// process, plus any not given a process yet — each standing in as a
  /// "machine" of that process (which is how the Operator Planned Shift lock
  /// reaches them on the web: `operatorMachines`).
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

  /// The machines the MC No. box picks from (this process's, see
  /// `printingMcMachines`).
  @override
  Map<String, String> get extraReference => const {'machines': Endpoints.machines};

  // ── web-parity extras ──
  @override
  bool get usesVendors => true;

  // Process Master's Operator Planned Shift reaches a block through its operator.
  @override
  bool get usesPlannedShiftSetting => true;

  // TOTAL QTY past the Ideal Quantity, or downtime past the Machine Shift Time,
  // pops up why (PRINTING_WORDS) before Save takes the operator to it.
  @override
  bool get showLimitPopups => true;
  @override
  OverLimit? firstOverLimit(List<Json> blocks, List<Map<String, String>> errors, {Map<String, String> machineNames = const {}}) =>
      limit.firstOverLimit(blocks, errors, rowCalc,
          qtyKey: 'actualQty', qtyLabel: 'TOTAL QTY', words: printingWords, machineName: machineNames);

  @override
  String? get unlinkedProcessMessage =>
      'Link this page to the PRINTING process in Process Master (Data Entry Page) before adding entries.';

  @override
  Json finishPayload(Json payload, {required Json? process}) => {...payload, 'process': process?['_id']};

  // ── server ──
  @override
  SheetApi get api => SheetApi.segment('printing-sheet', machineParam: 'worker');

  // ── figures ──
  @override
  Json rowCalc(Json row) => printingRowCalc(row);
  @override
  List<Json> dayCalc(List<Json> sortedRows) => printingDayCalc(sortedRows);
  @override
  EntryMetrics metrics(Json values) => PrintingMetrics(values);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => validatePrintingEntry(values, saved: saved);
  @override
  List<String> get fieldOrder => printingFieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => printingEmptyEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) => printingToFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) => printingToPayload(values, isEdit: isEdit, processId: null);
  @override
  bool hasAnyEntryData(List<Json> blocks) => printingHasAnyEntryData(blocks);
  @override
  bool entryHasData(Json values) => printingEntryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) => printingApplyItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) => printingNewBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) => printingMergeDraft(draft, now: now);

  // ── form ──
  @override
  EntryLines get lines => const PrintingEntryLines();

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => printingColumns(open);
  @override
  Map<String, String> get formulas => printingFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) => printingDetail(row, calc, day);
}

/// The one shared PRINTING spec.
const PrintingSpec printingSpec = PrintingSpec();
