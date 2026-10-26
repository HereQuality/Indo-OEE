import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_line_context.dart';
import '../../process/process_spec.dart';
import '../../shared/limit_notice.dart' as limit show bpcWords, firstOverLimit;
import '../../shared/limit_notice.dart' show OverLimit;
import '../../shared/production_entry_validation.dart' show TimeWords;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../shared/quantity_rules.dart' show applyRejectSplitChange;
import '../../sheet/sheet_model.dart';
import '../../sheet/table/sheet_columns.dart';
import 'bpc_calc.dart';
import 'bpc_columns.dart';
import 'bpc_detail.dart';
import 'bpc_lines.dart';
import 'bpc_metrics.dart';
import 'bpc_validation.dart';
import 'bpc_values.dart';

/// The BEFORE POWDER COATING sheet's Data Entry page (sheet key "bpc" —
/// client/src/pages/BeforePowderCoatingDataEntry.jsx, Components/Production/
/// BpcEntryForm.jsx, bpcColumns.jsx, utils/bpcSheet.js and bpcValidation.js).
/// A different process from AFTER POWDER COATING (processes/powder_coating/).
///
/// The sheet has no MC No.: an entry is keyed by (date, OPERATOR, slot), up to
/// [bpcMaxEntriesPerDay] a day. The operator's id sits in each row's `machine`
/// (the API maps it), so the shared list, table and day formulas group by
/// operator; each operator stands in as a "machine" of the page's process
/// ([scopeMachines]). On the wire the id travels as `worker` (PUT body,
/// `?worker=` list filter and occupied lookup). One operator often has several
/// entries a day, so a form may name the same operator more than once — their
/// times just can't overlap.
class BpcSpec extends ProcessSpec {
  const BpcSpec();

  // ── identity ──
  @override
  String get key => 'bpc';
  @override
  String get label => 'BEFORE POWDER COATING';
  @override
  String get routePath => '/production/before-powder-coating-data-entry';
  @override
  String get pageTitle => 'BEFORE POWDER COATING Data Entry';
  @override
  String get addTitle => 'Add BEFORE POWDER COATING Entry';
  @override
  String get editTitle => 'Update BEFORE POWDER COATING Entry';
  @override
  String get draftKey => 'bpcEntryDraft';

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
  String machineBlockTitle(String name, int index) => name.isEmpty ? 'Operator ${index + 1}' : name;
  @override
  String? get noMachinesMessage => 'No operators yet — assign them to BEFORE POWDER COATING in Production › Operators.';
  @override
  String get selectMachinePrompt => 'Select an operator — their entry fields open automatically';
  @override
  String get selectMachineFirst => 'Select an operator first';
  // Unlike RUBBER, one operator often has several entries a day (the paper has
  // up to six), so another block may name the same operator.
  @override
  bool get uniqueMachinePerDate => false;
  @override
  String get addAnotherLabel => 'Add another entry';
  @override
  int? get maxEntriesPerDay => bpcMaxEntriesPerDay;
  @override
  bool get checksOperatorClash => false;
  @override
  String? savedMachineName(Json row) {
    final name = row['operator'];
    return (name is String && name.trim().isNotEmpty) ? name : '—';
  }

  // The sheet's Machine ON / OFF Time, kept per operator (BPC_TIME_WORDS).
  @override
  TimeWords get timeWords => bpcTimeWords;

  // The Filters panel: Operator / Item only; search item, operator, vendor.
  @override
  bool get showOperatorFilter => false;
  @override
  String get machineFilterTitle => 'Operator';
  @override
  String get machineFilterPlaceholder => 'All operators';
  @override
  String get machineChipPrefix => 'Operator';
  @override
  List<String> get searchKeys => const ['itemName', 'operator', 'vendorName'];
  @override
  String get searchHint => 'Search item, operator, vendor…';

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
      limit.firstOverLimit(blocks, errors, rowCalc, qtyKey: null, words: limit.bpcWords, machineName: machineNames);

  @override
  String? get unlinkedProcessMessage =>
      'Link this page to the BEFORE POWDER COATING process in Process Master (Data Entry Page) before adding entries.';

  @override
  Json finishPayload(Json payload, {required Json? process}) => {...payload, 'process': process?['_id']};

  // ── server ──
  @override
  SheetApi get api => SheetApi.segment('bpc-sheet', machineParam: 'worker');

  // ── figures ──
  @override
  Json rowCalc(Json row) => bpcRowCalc(row);
  @override
  List<Json> dayCalc(List<Json> sortedRows) => bpcDayCalc(sortedRows);
  @override
  EntryMetrics metrics(Json values) => BpcMetrics(values);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => validateBpcEntry(values, saved: saved);
  @override
  List<String> get fieldOrder => bpcFieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => bpcEmptyEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) => bpcToFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) => bpcToPayload(values, isEdit: isEdit, processId: null);
  @override
  bool hasAnyEntryData(List<Json> blocks) => bpcHasAnyEntryData(blocks);
  @override
  bool entryHasData(Json values) => bpcEntryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) => bpcApplyItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) => bpcNewBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) => bpcMergeDraft(draft, now: now);
  @override
  Json applyRejectChange(Json values, String reason, dynamic value) => applyRejectSplitChange(values, reason, value);

  // ── form ──
  @override
  EntryLines get lines => const BpcEntryLines();

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => bpcColumns(open);
  @override
  Map<String, String> get formulas => bpcFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) => bpcDetail(row, calc, day);
}

/// The one shared BEFORE POWDER COATING spec.
const BpcSpec bpcSpec = BpcSpec();
