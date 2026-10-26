import '../../../../core/api/endpoints.dart';
import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_line_context.dart';
import '../../process/process_spec.dart';
import '../../shared/limit_notice.dart' as limit show firstOverLimit, rubberWords;
import '../../shared/limit_notice.dart' show OverLimit;
import '../../shared/production_entry_validation.dart' show TimeWords;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../shared/quantity_rules.dart' show applyRejectSplitChange;
import '../../sheet/sheet_model.dart';
import '../../sheet/table/sheet_columns.dart';
import 'rubber_calc.dart';
import 'rubber_columns.dart';
import 'rubber_detail.dart';
import 'rubber_lines.dart';
import 'rubber_metrics.dart';
import 'rubber_validation.dart';
import 'rubber_values.dart';

/// The RUBBER sheet's Data Entry page (client/src/pages/RubberDataEntry.jsx,
/// Components/Production/RubberEntryForm.jsx, rubberColumns.jsx,
/// utils/rubberSheet.js and rubberValidation.js).
///
/// After Powder Coating's twin: the sheet has no machine, an entry is keyed by
/// (date, WORKER, slot). The worker's id sits in each row's `machine` (the API
/// maps it), so the shared list, table and day formulas group by worker; each
/// worker stands in as a "machine" of the page's process ([scopeMachines]). On
/// the wire the id travels as `worker` (PUT body, `?worker=` list filter and
/// occupied lookup). Its quantities are the CNC form's Production Master and
/// Rejection Master; its figures the standard day calc.
class RubberSpec extends ProcessSpec {
  const RubberSpec();

  // ── identity ──
  @override
  String get key => 'rubber';
  @override
  String get label => 'RUBBER';
  @override
  String get routePath => '/production/rubber-data-entry';
  @override
  String get pageTitle => 'RUBBER Data Entry';
  @override
  String get addTitle => 'Add RUBBER Entry';
  @override
  String get editTitle => 'Update RUBBER Entry';
  @override
  String get draftKey => 'rubberEntryDraft';

  /// The page a process is linked to, matched the way the web page does it:
  /// the route path with any role-slug prefix stripped.
  @override
  bool ownsProcess(Json process) {
    final url = process['dataEntryMenu'];
    if (url is! String || url.isEmpty) return false;
    final here = url.replaceFirst(RegExp(r'^/[^/]+'), '').replaceFirst(RegExp(r'/$'), '');
    return here == routePath;
  }

  // The row key is a worker.
  @override
  String get machineLabel => 'Worker Name';
  @override
  String get machineNoun => 'worker';
  @override
  String machineBlockTitle(String name, int index) => name.isEmpty ? 'Worker ${index + 1}' : name;
  @override
  String? get noMachinesMessage => 'No workers yet — assign them to RUBBER in Production › Operators.';
  @override
  bool get uniqueMachinePerDate => true;
  @override
  bool get checksOperatorClash => false;
  @override
  String? savedMachineName(Json row) {
    final name = row['operator'];
    return (name is String && name.trim().isNotEmpty) ? name : '—';
  }

  // A worker's own Start / End, not a machine's ON / OFF (RUBBER_TIME_WORDS).
  @override
  TimeWords get timeWords => const TimeWords(start: 'Working Start Time', end: 'Working End Time', owner: 'this worker');

  // A worker who already has three entries that date — the server's own
  // refusal, said on the box ("This worker" when unnamed), like the web page's
  // `slotsFullErrors`.
  @override
  int? get maxEntriesPerDay => 3;

  // The Filters panel: Worker Name / Part only; search item, worker, vendor.
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

  /// This sheet's workers: active Operator Master names assigned to the page's
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

  @override
  Map<String, String> get extraReference => const {'vendors': '${Endpoints.v1}/vendors'};

  // ── web-parity extras ──
  // Vendor Name: the page's process (not a machine) decides whether the box and
  // the table column show — RubberDataEntry.jsx `processVendors` /
  // `showVendorColumn`.
  @override
  bool get usesVendors => true;

  // Process Master's Operator Planned Shift reaches a block through its worker
  // (each worker stands in as a "machine" of the page's process, see
  // [scopeMachines]) — `plannedLocks` in the page.
  @override
  bool get usesPlannedShiftSetting => true;

  // Stoppage past the Worker Shift Time pops up why (RUBBER_WORDS). Quantity
  // has no ceiling here (qtyKey null): OK + Rejected may beat Ideal and goes to
  // OEE Review instead.
  @override
  bool get showLimitPopups => true;
  @override
  OverLimit? firstOverLimit(List<Json> blocks, List<Map<String, String>> errors, {Map<String, String> machineNames = const {}}) =>
      limit.firstOverLimit(blocks, errors, rowCalc, qtyKey: null, words: limit.rubberWords, machineName: machineNames);

  @override
  String? get unlinkedProcessMessage =>
      'Link this page to the RUBBER process in Process Master (Data Entry Page) before adding entries.';

  @override
  Json finishPayload(Json payload, {required Json? process}) => {...payload, 'process': process?['_id']};

  // ── server ──
  @override
  SheetApi get api => SheetApi.segment('rubber-sheet', machineParam: 'worker');

  // ── figures ──
  @override
  Json rowCalc(Json row) => rubberRowCalc(row);
  @override
  List<Json> dayCalc(List<Json> sortedRows) => [
        // The day card's headline chip reads `oeeLosses`; this sheet has no such
        // column — its day figure is Productivity (without Lunch, Tea, etc.).
        for (final d in rubberDayCalc(sortedRows)) {...d, 'oeeLosses': d['productivity']},
      ];
  @override
  EntryMetrics metrics(Json values) => RubberMetrics(values);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => validateRubberEntry(values, saved: saved);
  @override
  List<String> get fieldOrder => rubberFieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => rubberEmptyEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) => rubberToFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) => rubberToPayload(values, isEdit: isEdit, processId: null);
  @override
  bool hasAnyEntryData(List<Json> blocks) => rubberHasAnyEntryData(blocks);
  @override
  bool entryHasData(Json values) => rubberEntryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) => rubberApplyItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) => rubberNewBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) => rubberMergeDraft(draft, now: now);
  @override
  Json applyRejectChange(Json values, String reason, dynamic value) => applyRejectSplitChange(values, reason, value);

  // ── form ──
  @override
  EntryLines get lines => const RubberEntryLines();

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => rubberColumns(open);
  @override
  Map<String, String> get formulas => rubberFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) => rubberDetail(row, calc, day);
}

/// The one shared RUBBER spec.
const RubberSpec rubberSpec = RubberSpec();
