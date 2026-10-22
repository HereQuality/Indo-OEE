import '../entry_form/entry_form_logic.dart' show EntryMetrics;
import '../entry_form/entry_line_context.dart';
import '../process/process_spec.dart';
import '../shared/limit_notice.dart' as limit show firstOverLimit;
import '../shared/limit_notice.dart' show OverLimit;
import '../shared/production_entry_validation.dart' as rules;
import '../shared/production_sheet_calc.dart' as calc;
import '../sheet/sheet_model.dart';
import '../sheet/table/sheet_columns.dart';
import 'cnc_twin_calc.dart';
import 'cnc_twin_columns.dart';
import 'cnc_twin_detail.dart';
import 'cnc_twin_formulas.dart';
import 'cnc_twin_lines.dart';
import 'cnc_twin_style.dart';
import 'cnc_twin_validation.dart';
import 'cnc_twin_values.dart';

export 'cnc_twin_style.dart' show TwinStyle;

/// The base of Contact, Trobe and Spring. Their web pages feed the plain CNC
/// formulas (`rowCalc` / `dayCalc` of utils/productionSheet.js, unchanged) but
/// the FORM is RIVET-shaped, not CNC's: OK and Rejected Quantity are typed
/// (no Actual Quantity, no reject-reason split), Total Cycle Time is the
/// entry's own prefilled figure (no named operations), Planned Down Time is a
/// downtime box, and a Working / Non Working day carries only its status. So
/// this sits next to [CncSpec] (reusing its calc through `shared/`) rather
/// than extending it. A concrete process names itself and picks its [style].
abstract class CncTwinSpec extends ProcessSpec {
  const CncTwinSpec();

  /// The wording / table variant (see [TwinStyle]).
  TwinStyle get style;

  /// What the web page calls the process in its headings ("Contact",
  /// "TROBE", "SPRING FOR PINS").
  String get displayName;

  /// The API segment: 'contact-sheet' -> `/api/v1/contact-sheet`.
  String get segment;

  @override
  String get label => displayName;
  @override
  String get pageTitle => '$displayName Data Entry';
  @override
  String get addTitle => 'Add $displayName Entry';
  @override
  String get editTitle => 'Update $displayName Entry';

  @override
  SheetApi get api => SheetApi.segment(segment);

  // ── web-parity extras (the web twins carry all four, like CNC) ──
  // Vendor Name (VendorSelect + VENDOR_COLUMN), the machine's Planned Operator
  // Shift from Process Master, and the limit popups on typing and on Save.
  @override
  bool get usesVendors => true;
  @override
  bool get usesPlannedShiftSetting => true;
  @override
  bool get showLimitPopups => true;
  @override
  OverLimit? firstOverLimit(
    List<Json> blocks,
    List<Map<String, String>> errors, {
    Map<String, String> machineNames = const {},
  }) => limit.firstOverLimit(
    blocks,
    errors,
    rowCalc,
    qtyKey: 'okQty',
    machineName: machineNames,
  );

  // ── figures ──
  @override
  Json rowCalc(Json row) => twinRowCalc(row, totalBasis: style.spring);
  @override
  List<Json> dayCalc(List<Json> sortedRows) =>
      twinDayCalc(sortedRows, totalBasis: style.spring);

  @override
  EntryMetrics metrics(Json values) => TwinMetrics(values, calcFn: rowCalc);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => twinValidate(
    values,
    saved: saved,
    rowCalcFn: rowCalc,
    wording: style.wording,
  );
  @override
  List<String> get fieldOrder => twinFieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => twinEmptyEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) =>
      twinToFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) =>
      twinToPayload(values, isEdit: isEdit);
  @override
  bool hasAnyEntryData(List<Json> blocks) => twinHasAnyEntryData(blocks);
  @override
  bool entryHasData(Json values) => twinEntryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) =>
      twinApplyItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) =>
      twinNewBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) =>
      twinMergeDraftEntry(draft, now: now);

  // ── form ──
  @override
  EntryLines get lines => CncTwinLines(style);

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => twinColumns(open, style);
  @override
  Map<String, String> get formulas =>
      style.spring ? springFormulasMap : twinFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) =>
      twinDetail(row, calc, day, style);

  /// The first incomplete block / field in THIS sheet's field order.
  @override
  Map<String, dynamic>? firstError(List<Map<String, String>?> errors) =>
      rules.firstError(errors, order: fieldOrder);
}
