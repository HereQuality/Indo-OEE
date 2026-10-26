import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_line_context.dart';
import '../../process/process_spec.dart';
import '../../shared/limit_notice.dart' as limit show firstOverLimit;
import '../../shared/limit_notice.dart' show OverLimit;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../sheet/sheet_model.dart';
import '../../sheet/table/sheet_columns.dart';
import 'embossing_calc.dart';
import 'embossing_columns.dart';
import 'embossing_detail.dart';
import 'embossing_lines.dart';
import 'embossing_metrics.dart';
import 'embossing_validation.dart';
import 'embossing_values.dart';

/// The EMBOSSING Data Entry page (client/src/pages/EmbossingDataEntry.jsx,
/// EmbossingEntryForm.jsx, embossingColumns.jsx, utils/embossing{Sheet,Validation}.js,
/// server /embossing-sheet). INJECTION MOULDING's twin, with one difference:
/// TOTAL QTY. is NOT capped at Ideal Quantity — an operator can beat the
/// standard time; such an entry still saves and goes to OEE Review (web
/// `capByIdeal: false`, and Save's limit popup checks no quantity: `qtyKey: null`).
class EmbossingSpec extends ProcessSpec {
  const EmbossingSpec();

  @override
  String get key => 'embossing';
  @override
  String get label => 'EMBOSSING';
  @override
  String get routePath => '/production/embossing-data-entry';
  @override
  String get pageTitle => 'EMBOSSING Data Entry';
  @override
  String get addTitle => 'Add EMBOSSING Entry';
  @override
  String get editTitle => 'Update EMBOSSING Entry';
  @override
  String get draftKey => 'embossingEntryDraft';

  // The sheet calls the machine "MC No." everywhere.
  @override
  String get machineLabel => 'MC No.';
  @override
  String? get noMachinesMessage => 'No machines yet — add them to EMBOSSING in Production › Machines.';
  @override
  String get searchHint => 'Search item, operator, drawing no…';

  // Three entries per machine per date (the server's MAX_SLOTS): a full date is
  // said on the box as soon as it is picked, like the web page's `slotsFullErrors`.
  @override
  int? get maxEntriesPerDay => 3;

  // ── web-parity extras: Vendor Name, Process Master's Planned Operator Shift,
  // and the limit popups (typing past a limit, and on Save) ──
  @override
  bool get usesVendors => true;
  @override
  bool get usesPlannedShiftSetting => true;
  @override
  bool get showLimitPopups => true;
  @override
  OverLimit? firstOverLimit(List<Json> blocks, List<Map<String, String>> errors, {Map<String, String> machineNames = const {}}) =>
      // TOTAL past Ideal is OEE Review's business, never a limit popup (web `qtyKey: null`).
      limit.firstOverLimit(blocks, errors, rowCalc, qtyKey: null, machineName: machineNames);

  @override
  SheetApi get api => SheetApi.segment('embossing-sheet');

  // ── figures ──
  @override
  Json rowCalc(Json row) => embossingRowCalc(row);
  @override
  List<Json> dayCalc(List<Json> sortedRows) => embossingDayCalc(sortedRows);
  @override
  EntryMetrics metrics(Json values) => EmbossingMetrics(values);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => validateEmbossingEntry(values, saved: saved);
  @override
  List<String> get fieldOrder => embossingFieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => embossingEmptyEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) => embossingToFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) => embossingToPayload(values, isEdit: isEdit);
  @override
  bool hasAnyEntryData(List<Json> blocks) => embossingHasAnyEntryData(blocks);
  @override
  bool entryHasData(Json values) => embossingEntryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) => embossingApplyItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) => embossingNewBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) => embossingMergeDraft(draft, now: now);

  // ── form ──
  @override
  EntryLines get lines => const EmbossingEntryLines();

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => embossingColumns(open);
  @override
  Map<String, String> get formulas => embossingFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) => embossingDetail(row, calc, day);
}

/// The one shared EMBOSSING spec.
const EmbossingSpec embossingSpec = EmbossingSpec();
