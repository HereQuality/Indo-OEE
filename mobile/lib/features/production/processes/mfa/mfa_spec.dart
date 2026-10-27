import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_line_context.dart';
import '../../process/process_spec.dart';
import '../../shared/limit_notice.dart' as limit show firstOverLimit;
import '../../shared/limit_notice.dart' show OverLimit;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../sheet/sheet_model.dart';
import '../../sheet/table/sheet_columns.dart';
import 'mfa_calc.dart';
import 'mfa_columns.dart';
import 'mfa_detail.dart';
import 'mfa_lines.dart';
import 'mfa_metrics.dart';
import 'mfa_validation.dart';
import 'mfa_values.dart';

/// The MODULAR FRAME ASSEMBLY sheet's Data Entry page (client/src/pages/
/// ModularFrameAssemblyDataEntry.jsx, MfaEntryForm.jsx, mfaColumns.jsx,
/// utils/mfaSheet.js, mfaValidation.js). Per WORKER (the id sits in `machine`,
/// `worker` on the wire); TOTAL / OK typed, each entry worked out on its own,
/// no overlap check, up to 8 entries a day, no Vendor.
class MfaSpec extends ProcessSpec {
  const MfaSpec();

  // ── identity ──
  @override
  String get key => 'mfa';
  @override
  String get label => 'MODULAR FRAME ASSEMBLY';
  @override
  String get routePath => '/production/modular-frame-assembly-data-entry';
  @override
  String get pageTitle => 'MODULAR FRAME ASSEMBLY Data Entry';
  @override
  String get addTitle => 'Add MODULAR FRAME ASSEMBLY Entry';
  @override
  String get editTitle => 'Update MODULAR FRAME ASSEMBLY Entry';
  @override
  String get draftKey => 'mfaEntryDraft';

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
  String? get noMachinesMessage => 'No workers yet — assign them to MODULAR FRAME ASSEMBLY in Production › Operators.';
  @override
  bool get checksOperatorClash => false;
  @override
  String? savedMachineName(Json row) {
    final name = row['operator'];
    return (name is String && name.trim().isNotEmpty) ? name : '—';
  }


  // A worker who already has three entries that date — the server's own
  // refusal, said on the box ("This worker" when unnamed), like the web page's
  // `slotsFullErrors`.
  @override
  int? get maxEntriesPerDay => mfaMaxEntriesPerDay;
  // One worker may have several entries a day, at overlapping times too.
  @override
  bool get checksTimeOverlap => false;
  @override
  bool get uniqueMachinePerDate => false;
  @override
  String get addAnotherLabel => 'Add another entry';
  @override
  String? get addAnotherNote => 'The same worker can be added again — e.g. a second job at the same time.';
  @override
  String machineBlockTitle(String name, int index) => name.isEmpty ? 'Entry ${index + 1}' : name;

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
  List<String> get searchKeys => const ['itemName', 'operator'];
  @override
  String get searchHint => 'Search item, worker…';

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


  // ── web-parity extras ──
  // Vendor Name: the page's process (not a machine) decides whether the box and
  // the table column show — RubberDataEntry.jsx `processVendors` /
  // `showVendorColumn`.
  // No Vendor on this sheet.

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
      limit.firstOverLimit(blocks, errors, rowCalc, qtyKey: null, words: mfaWords, machineName: machineNames);

  @override
  String? get unlinkedProcessMessage =>
      'Link this page to the MODULAR FRAME ASSEMBLY process in Process Master (Data Entry Page) before adding entries.';

  @override
  Json finishPayload(Json payload, {required Json? process}) => {...payload, 'process': process?['_id']};

  // ── server ──
  @override
  SheetApi get api => SheetApi.segment('mfa-sheet', machineParam: 'worker');

  // ── figures ──
  @override
  Json rowCalc(Json row) => mfaRowCalc(row);
  @override
  List<Json> dayCalc(List<Json> sortedRows) => [
        // The day card's headline chip reads `oeeLosses`; this sheet has no such
        // column — its day figure is Productivity (without Lunch, Tea, etc.).
        for (final d in mfaDayCalc(sortedRows)) {...d, 'oeeLosses': d['productivity']},
      ];
  /// Which OEE figures the table has (web OEE_FIGURE_KEYS): the two Productivity figures.
  @override
  String get oeeFigureKind => 'worker';

  @override
  EntryMetrics metrics(Json values) => MfaMetrics(values);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => validateMfaEntry(values, saved: saved);
  @override
  List<String> get fieldOrder => mfaFieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => mfaEmptyEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) => mfaToFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) => mfaToPayload(values, isEdit: isEdit, processId: null);
  @override
  bool hasAnyEntryData(List<Json> blocks) => mfaHasAnyEntryData(blocks);
  @override
  bool entryHasData(Json values) => mfaEntryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) => mfaApplyItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) => mfaNewBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) => mfaMergeDraft(draft, now: now);

  // ── form ──
  @override
  EntryLines get lines => const MfaEntryLines();

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => mfaColumns(open);
  @override
  Map<String, String> get formulas => mfaFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) => mfaDetail(row, calc, day);
}

/// The one shared RUBBER spec.
const MfaSpec mfaSpec = MfaSpec();
