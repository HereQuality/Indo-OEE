import '../../entry_form/entry_line_context.dart';
import '../../entry_form/entry_form_logic.dart';
import '../../process/process_spec.dart';
import '../../shared/limit_notice.dart' as limit show firstOverLimit;
import '../../shared/limit_notice.dart' show OverLimit;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../sheet/sheet_model.dart';
import '../../sheet/table/sheet_columns.dart';
import 'vmc_calc.dart';
import 'vmc_columns.dart';
import 'vmc_detail.dart';
import 'vmc_lines.dart';
import 'vmc_validation.dart';
import 'vmc_values.dart';

/// The VMC Data Entry page (client/src/pages/VmcDataEntry.jsx, utils/vmcSheet.js
/// and utils/vmcValidation.js). CNC's twin with its cycle time from the Part's
/// program (Program Time x 60 / pieces per program), OK and Rejected both typed,
/// nine downtime boxes and a Working / Non Working status.
class VmcSpec extends ProcessSpec {
  const VmcSpec();

  @override
  String get key => 'vmc';
  @override
  String get label => 'VMC';
  @override
  String get routePath => '/production/vmc-data-entry';
  @override
  String get addTitle => 'Add VMC Entry';
  @override
  String get editTitle => 'Update VMC Entry';
  @override
  String get draftKey => 'vmcEntryDraft';

  // The web VMC page scopes the Part picker to its process (plus parts with no
  // process yet) — VmcDataEntry.jsx `scopedItems` (the default).
  @override
  bool get scopeItemsToProcess => true;

  // ── web-parity extras ──
  @override
  bool get usesVendors => true;
  @override
  bool get usesPlannedShiftSetting => true;
  @override
  bool get showLimitPopups => true;
  @override
  OverLimit? firstOverLimit(List<Json> blocks, List<Map<String, String>> errors, {Map<String, String> machineNames = const {}}) =>
      limit.firstOverLimit(blocks, errors, rowCalc, qtyKey: 'okQty', machineName: machineNames);

  @override
  SheetApi get api => SheetApi.segment('vmc-sheet');

  // ── figures ──
  @override
  Json rowCalc(Json row) => vmcRowCalc(row);
  @override
  List<Json> dayCalc(List<Json> sortedRows) => vmcDayCalc(sortedRows);
  @override
  EntryMetrics metrics(Json values) => VmcMetrics(values);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => validateVmcEntry(values, saved: saved);
  @override
  List<String> get fieldOrder => vmcFieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => emptyVmcEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) => vmcToFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) => vmcToPayload(values, isEdit: isEdit);
  @override
  bool hasAnyEntryData(List<Json> blocks) => hasAnyVmcEntryData(blocks);
  @override
  bool entryHasData(Json values) => vmcEntryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) => applyVmcItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) => newVmcBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) => mergeVmcDraftEntry(draft, now: now);

  // The web VMC page also searches the Work Order No.
  @override
  List<String> get searchKeys => const ['itemName', 'operator', 'drawingNo', 'workOrderNo'];
  @override
  String get searchHint => 'Search part, operator, drawing / work order no…';

  // ── form ──
  @override
  EntryLines get lines => const VmcEntryLines();

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => vmcColumns(open);
  @override
  Map<String, String> get formulas => vmcFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) => vmcDetail(row, calc, day);
}

/// The one shared VMC spec.
const VmcSpec vmcSpec = VmcSpec();
