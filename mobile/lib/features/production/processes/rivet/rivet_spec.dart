import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_line_context.dart';
import '../../process/process_spec.dart';
import '../../shared/limit_notice.dart' as limit show firstOverLimit;
import '../../shared/limit_notice.dart' show OverLimit;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../sheet/sheet_model.dart';
import '../../sheet/table/sheet_columns.dart';
import 'rivet_calc.dart';
import 'rivet_columns.dart';
import 'rivet_detail.dart';
import 'rivet_lines.dart';
import 'rivet_metrics.dart';
import 'rivet_validation.dart';
import 'rivet_values.dart';

/// The RIVET Data Entry page (client/src/pages/RivetDataEntry.jsx and
/// utils/rivetSheet.js / rivetValidation.js). SPM's twin: the four named
/// operations (Loading, Process, Unloading and Cleaning, Other Operations) are
/// set on the Part and sum to Total Cycle Time; OK and Rejected Quantity are
/// both typed (no reject-reason split); No. of Holes is a display-only figure.
class RivetSpec extends ProcessSpec {
  const RivetSpec();

  @override
  String get key => 'rivet';
  @override
  String get label => 'Rivet';
  @override
  String get routePath => '/production/rivet-data-entry';
  @override
  String get pageTitle => 'Rivet Data Entry';
  @override
  String get addTitle => 'Add Rivet Entry';
  @override
  String get editTitle => 'Update Rivet Entry';
  @override
  String get draftKey => 'rivetEntryDraft';

  // ── web-parity extras (Wave 2) ──
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
  SheetApi get api => SheetApi.segment('rivet-sheet');

  // ── figures ──
  @override
  Json rowCalc(Json row) => rivetRowCalc(row);
  @override
  List<Json> dayCalc(List<Json> sortedRows) => rivetDayCalc(sortedRows);

  @override
  EntryMetrics metrics(Json values) => RivetMetrics(values);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => validateRivetEntry(values, saved: saved);
  @override
  List<String> get fieldOrder => rivetFieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => rivetEmptyEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) => rivetToFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) => rivetToPayload(values, isEdit: isEdit);
  @override
  bool hasAnyEntryData(List<Json> blocks) => rivetHasAnyEntryData(blocks);
  @override
  bool entryHasData(Json values) => rivetEntryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) => rivetApplyItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) => rivetNewBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) => rivetMergeDraftEntry(draft, now: now);

  // ── form ──
  @override
  EntryLines get lines => const RivetEntryLines();

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => rivetColumns(open);
  @override
  Map<String, String> get formulas => rivetFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) => rivetDetail(row, calc, day);
}

/// The one shared Rivet spec.
const RivetSpec rivetSpec = RivetSpec();
