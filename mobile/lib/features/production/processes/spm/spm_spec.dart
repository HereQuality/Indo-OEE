import '../../entry_form/entry_form_logic.dart' show EntryMetrics;
import '../../entry_form/entry_line_context.dart';
import '../../process/process_spec.dart';
import '../../shared/limit_notice.dart' as limit show firstOverLimit;
import '../../shared/limit_notice.dart' show OverLimit;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../shared/quantity_rules.dart' show applyRejectSplitChange;
import '../../sheet/sheet_model.dart';
import '../../sheet/table/sheet_columns.dart';
import 'spm_calc.dart';
import 'spm_columns.dart';
import 'spm_detail.dart';
import 'spm_lines.dart';
import 'spm_validation.dart';
import 'spm_values.dart';

/// The SPM Data Entry page (client/src/pages/SpmDataEntry.jsx + SpmEntryForm.jsx +
/// utils/spmSheet.js / spmValidation.js). Its cycle time is the Part's own Loading /
/// Process / Unloading and Cleaning / Other Operations, its OK and Rejected
/// quantities are both typed (no reject-reason split) and its stoppage allowance is
/// the Machine Shift; everything else (the sheet endpoints, the overlap rules, the
/// list, the editor) is the shared framework's.
class SpmSpec extends ProcessSpec {
  const SpmSpec();

  @override
  String get key => 'spm';
  @override
  String get label => 'SPM';
  @override
  String get routePath => '/production/spm-data-entry';
  @override
  String get pageTitle => 'SPM data entry';
  @override
  String get addTitle => 'Add SPM Entry';
  @override
  String get editTitle => 'Update SPM Entry';
  @override
  String get draftKey => 'spmEntryDraft';

  // The web SPM page scopes the Part picker to its process (plus parts with no
  // process yet) — SpmDataEntry.jsx `scopedItems` (the default).
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
      limit.firstOverLimit(blocks, errors, rowCalc, qtyKey: 'actualQty', machineName: machineNames);

  @override
  SheetApi get api => SheetApi.segment('spm-sheet');

  // ── figures ──
  @override
  Json rowCalc(Json row) => spmRowCalc(row);
  @override
  List<Json> dayCalc(List<Json> sortedRows) => spmDayCalc(sortedRows);
  @override
  EntryMetrics metrics(Json values) => SpmMetrics(values);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => validateSpmEntry(values, saved: saved);
  @override
  List<String> get fieldOrder => spmFieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => spmEmptyEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) => spmToFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) => spmToPayload(values, isEdit: isEdit);
  @override
  bool hasAnyEntryData(List<Json> blocks) => spmHasAnyEntryData(blocks);
  @override
  bool entryHasData(Json values) => spmEntryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) => spmApplyItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) => spmNewBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) => spmMergeDraftEntry(draft, now: now);

  // One Rejection Master box changed.
  @override
  Json applyRejectChange(Json values, String reason, dynamic value) => applyRejectSplitChange(values, reason, value);

  // ── form ──
  @override
  EntryLines get lines => const SpmEntryLines();

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => spmColumns(open);
  @override
  Map<String, String> get formulas => spmFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) => spmDetail(row, calc, day);
}

/// The one shared SPM spec.
const SpmSpec spmSpec = SpmSpec();
