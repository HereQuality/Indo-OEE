import '../../entry_form/entry_line_context.dart';
import '../../entry_form/entry_form_logic.dart';
import '../../process/process_spec.dart';
import '../../shared/limit_notice.dart' as limit show firstOverLimit;
import '../../shared/limit_notice.dart' show OverLimit;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../shared/quantity_rules.dart' show applyRejectSplitChange;
import '../../sheet/sheet_model.dart';
import '../../sheet/table/sheet_columns.dart';
import 'press_calc.dart';
import 'press_columns.dart';
import 'press_detail.dart';
import 'press_lines.dart';
import 'press_metrics.dart';
import 'press_validation.dart';
import 'press_values.dart';

/// The PRESS Data Entry page (client/src/pages/PressDataEntry.jsx and
/// utils/pressSheet.js / pressValidation.js) — Standard Time Taken and the
/// number of pieces made in it give the Product Cycle Time; Actual and OK
/// Quantity are typed (Rejected = Actual − OK, split across the reject reasons
/// like CNC); Operation and Setup No. are per-entry picks; all ten stoppage boxes.
class PressSpec extends ProcessSpec {
  const PressSpec();

  @override
  String get key => 'press';
  @override
  String get label => 'Press';
  @override
  String get routePath => '/production/press-data-entry';
  @override
  String get draftKey => 'pressEntryDraft';

  // ── web-parity extras (Wave 2) ──
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
  SheetApi get api => SheetApi.segment('press-sheet');

  // ── figures ──
  @override
  Json rowCalc(Json row) => pressRowCalc(row);
  @override
  List<Json> dayCalc(List<Json> sortedRows) => pressDayCalc(sortedRows);
  @override
  EntryMetrics metrics(Json values) => PressMetrics(values);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => validatePressEntry(values, saved: saved);
  @override
  List<String> get fieldOrder => pressFieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => pressEmptyEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) => pressToFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) => pressToPayload(values, isEdit: isEdit);
  @override
  bool hasAnyEntryData(List<Json> blocks) => pressHasAnyEntryData(blocks);
  @override
  bool entryHasData(Json values) => pressEntryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) => pressApplyItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) => pressNewBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) => pressMergeDraftEntry(draft, now: now);
  @override
  Json applyRejectChange(Json values, String reason, dynamic value) => applyRejectSplitChange(values, reason, value);

  // The web's Part picker shows the plain part name (PressEntryForm.jsx passes no
  // `label`, unlike Rivet's `partCycleLabel`), so no grey cycle line under it.
  @override
  String? itemSubtitle(Json item) => null;

  // ── form ──
  @override
  EntryLines get lines => const PressEntryLines();

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => pressColumns(open);
  @override
  Map<String, String> get formulas => pressFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) => pressDetail(row, calc, day);

}

/// The one shared PRESS spec.
const PressSpec pressSpec = PressSpec();
