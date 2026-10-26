import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_line_context.dart';
import '../../process/process_spec.dart';
import '../../shared/limit_notice.dart' as limit show firstOverLimit;
import '../../shared/limit_notice.dart' show OverLimit;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../sheet/sheet_model.dart';
import '../../sheet/table/sheet_columns.dart';
import 'injection_calc.dart';
import 'injection_columns.dart';
import 'injection_detail.dart';
import 'injection_lines.dart';
import 'injection_metrics.dart';
import 'injection_validation.dart';
import 'injection_values.dart';

/// The INJECTION MOULDING Data Entry page (client/src/pages/InjectionDataEntry.jsx,
/// InjectionEntryForm.jsx, injectionColumns.jsx, utils/injection{Sheet,Validation}.js,
/// server /injection-sheet). SPRING FOR PINS's twin by machine, in the paper
/// sheet's words: Item Name and Standard Time per Piece (prefilled from the
/// Part), TOTAL QTY. / OK QTY. typed with Rejected = TOTAL − OK and no Rejection
/// Master, Effective Machine Run Time on TOTAL QTY., Ideal Quantity shown to 2
/// decimals (the cap is the whole number under it), and every entry worked out
/// on its own (`entryDayCalc`) — combined across the machine's day only on
/// Process Master's lock.
class InjectionSpec extends ProcessSpec {
  const InjectionSpec();

  @override
  String get key => 'injection';
  @override
  String get label => 'INJECTION MOULDING';
  @override
  String get routePath => '/production/injection-moulding-data-entry';
  @override
  String get pageTitle => 'INJECTION MOULDING Data Entry';
  @override
  String get addTitle => 'Add INJECTION MOULDING Entry';
  @override
  String get editTitle => 'Update INJECTION MOULDING Entry';
  @override
  String get draftKey => 'injectionEntryDraft';

  // The sheet calls the machine "MC No." everywhere.
  @override
  String get machineLabel => 'MC No.';
  @override
  String? get noMachinesMessage => 'No machines yet — add them to INJECTION MOULDING in Production › Machines.';
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
      limit.firstOverLimit(blocks, errors, rowCalc, qtyKey: 'actualQty', machineName: machineNames);

  @override
  SheetApi get api => SheetApi.segment('injection-sheet');

  // ── figures ──
  @override
  Json rowCalc(Json row) => injectionRowCalc(row);
  @override
  List<Json> dayCalc(List<Json> sortedRows) => injectionDayCalc(sortedRows);
  @override
  EntryMetrics metrics(Json values) => InjectionMetrics(values);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => validateInjectionEntry(values, saved: saved);
  @override
  List<String> get fieldOrder => injectionFieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => injectionEmptyEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) => injectionToFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) => injectionToPayload(values, isEdit: isEdit);
  @override
  bool hasAnyEntryData(List<Json> blocks) => injectionHasAnyEntryData(blocks);
  @override
  bool entryHasData(Json values) => injectionEntryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) => injectionApplyItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) => injectionNewBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) => injectionMergeDraft(draft, now: now);

  // ── form ──
  @override
  EntryLines get lines => const InjectionEntryLines();

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => injectionColumns(open);
  @override
  Map<String, String> get formulas => injectionFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) => injectionDetail(row, calc, day);
}

/// The one shared INJECTION MOULDING spec.
const InjectionSpec injectionSpec = InjectionSpec();
