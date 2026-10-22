import '../../../../core/api/endpoints.dart';
import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_line_context.dart';
import '../../process/process_spec.dart';
import '../../shared/limit_notice.dart' as limit show firstOverLimit, workerWords;
import '../../shared/limit_notice.dart' show OverLimit;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../sheet/sheet_model.dart';
import '../../sheet/table/sheet_columns.dart';
import 'powder_calc.dart';
import 'powder_columns.dart';
import 'powder_detail.dart';
import 'powder_lines.dart';
import 'powder_metrics.dart';
import 'powder_validation.dart';
import 'powder_values.dart';

/// The After Powder Coating inspection sheet's Data Entry page
/// (client/src/pages/PowderCoatingDataEntry.jsx, Components/Production/
/// PowderCoatingEntryForm.jsx, powderCoatingColumns.jsx, utils/powderCoatingSheet.js
/// and powderCoatingValidation.js).
///
/// The sheet has no machine: an entry is keyed by (date, WORKER, slot). The
/// worker's id sits in each row's `machine` (the API maps it), so the shared
/// list, table and day formulas group by worker; each worker stands in as a
/// "machine" of the page's process ([scopeMachines]). On the wire the id travels
/// as `worker` (PUT body, `?worker=` list filter and occupied lookup).
class PowderCoatingSpec extends ProcessSpec {
  const PowderCoatingSpec();

  // ── identity ──
  @override
  String get key => 'powder-coating';
  @override
  String get label => 'After Powder Coating';
  @override
  String get routePath => '/production/powder-coating-data-entry';
  @override
  String get pageTitle => 'After Powder Coating Data Entry';
  @override
  String get addTitle => 'Add Powder Coating Entry';
  @override
  String get editTitle => 'Update Powder Coating Entry';
  @override
  String get draftKey => 'powderCoatingEntryDraft';

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
  String? get noMachinesMessage => 'No workers yet — assign them to AFTER POWDER COATING in Production › Operators.';
  @override
  bool get uniqueMachinePerDate => true;
  @override
  bool get checksOperatorClash => false;
  @override
  String? savedMachineName(Json row) {
    final name = row['operator'];
    return (name is String && name.trim().isNotEmpty) ? name : '—';
  }

  // The Filters panel: Worker Name / Item only; search item, worker, vendor.
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
  // the table column show — PowderCoatingDataEntry.jsx `processVendors` /
  // `showVendorColumn`.
  @override
  bool get usesVendors => true;

  // Process Master's Operator Planned Shift reaches a block through its worker
  // (each worker stands in as a "machine" of the page's process, see
  // [scopeMachines]) — `plannedLocks` in the page.
  @override
  bool get usesPlannedShiftSetting => true;

  // Idle Time + Other Activity past the Inspection Working Hours pops up why
  // (WORKER_WORDS). Total Qty has no ceiling here (qtyKey null): beating Ideal
  // goes to OEE Review instead.
  @override
  bool get showLimitPopups => true;
  @override
  OverLimit? firstOverLimit(List<Json> blocks, List<Map<String, String>> errors, {Map<String, String> machineNames = const {}}) =>
      limit.firstOverLimit(blocks, errors, rowCalc, qtyKey: null, words: limit.workerWords, machineName: machineNames);

  @override
  String? get unlinkedProcessMessage =>
      'Link this page to the AFTER POWDER COATING process in Process Master (Data Entry Page) before adding entries.';

  @override
  Json finishPayload(Json payload, {required Json? process}) => {...payload, 'process': process?['_id']};

  // ── server ──
  @override
  SheetApi get api => SheetApi.segment('powder-coating-sheet', machineParam: 'worker');

  // ── figures ──
  @override
  Json rowCalc(Json row) => powderRowCalc(row);
  @override
  List<Json> dayCalc(List<Json> sortedRows) => [
        // The day card's headline chip reads `oeeLosses`; this sheet has no such
        // column — its day figure is Productivity (without Lunch, Tea, etc.).
        for (final d in powderDayCalc(sortedRows)) {...d, 'oeeLosses': d['productivity']},
      ];
  @override
  EntryMetrics metrics(Json values) => PowderMetrics(values);
  @override
  EntryFigures figures(Json row, Json calc) =>
      EntryFigures(ok: calc['okQty'], actual: calc['actualQty'], pctOk: calc['pctOk'], shiftHours: calc['shiftHours']);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => validatePowderEntry(values, saved: saved);
  @override
  List<String> get fieldOrder => powderFieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => powderEmptyEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) => powderToFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) => powderToPayload(values, isEdit: isEdit, processId: null);
  @override
  bool hasAnyEntryData(List<Json> blocks) => powderHasAnyEntryData(blocks);
  @override
  bool entryHasData(Json values) => powderEntryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) => powderApplyItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) => powderNewBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) => powderMergeDraft(draft, now: now);

  // ── form ──
  @override
  EntryLines get lines => const PowderEntryLines();

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => powderColumns(open);
  @override
  Map<String, String> get formulas => powderFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) => powderDetail(row, calc, day);
}

/// The one shared After Powder Coating spec.
const PowderCoatingSpec powderCoatingSpec = PowderCoatingSpec();
