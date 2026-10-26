import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_line_context.dart';
import '../../process/process_spec.dart';
import '../../shared/limit_notice.dart' as limit show firstOverLimit;
import '../../shared/limit_notice.dart' show OverLimit;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../sheet/sheet_model.dart';
import '../../sheet/table/sheet_columns.dart';
import 'mfd_calc.dart';
import 'mfd_columns.dart';
import 'mfd_detail.dart';
import 'mfd_lines.dart';
import 'mfd_metrics.dart';
import 'mfd_validation.dart';
import 'mfd_values.dart';

/// The MODULAR FRAME DRILLING Data Entry page (client/src/pages/
/// ModularFrameDrillingDataEntry.jsx, MfdEntryForm.jsx, mfdColumns.jsx,
/// utils/mfd{Sheet,Validation}.js, server /mfd-sheet). INJECTION MOULDING's
/// twin by machine, in the paper sheet's words: up to 8 entries a machine a day
/// that may overlap in time (only an operator on two machines at once is
/// refused); the Part's Drawing No., Process, Holes and Stroke copied onto the
/// entry; Setting Time ON / OFF; an IDEAL Quantity with Lunch / Tea taken out
/// (unrounded, the cap the whole number under it); Effective on OK Quantity;
/// Efficiency; and every entry worked out on its own (`entryDayCalc`).
class MfdSpec extends ProcessSpec {
  const MfdSpec();

  @override
  String get key => 'mfd';
  @override
  String get label => 'MODULAR FRAME DRILLING';
  @override
  String get routePath => '/production/modular-frame-drilling-data-entry';
  @override
  String get pageTitle => 'MODULAR FRAME DRILLING Data Entry';
  @override
  String get addTitle => 'Add MODULAR FRAME DRILLING Entry';
  @override
  String get editTitle => 'Update MODULAR FRAME DRILLING Entry';
  @override
  String get draftKey => 'mfdEntryDraft';

  // The sheet calls the machine "MC NO."; a block is an entry, not a machine.
  @override
  String get machineLabel => 'MC NO.';
  @override
  String machineBlockTitle(String name, int index) => name.isEmpty ? 'Entry ${index + 1}' : 'MC $name';
  @override
  String? get noMachinesMessage => 'No machines yet — add them to MODULAR FRAME DRILLING in Production › Machines.';
  @override
  String get addAnotherLabel => 'Add another entry';
  @override
  String? get addAnotherNote => 'The same machine can take several entries a day, even at overlapping times.';

  // One machine may take several entries on a date, at overlapping times — up
  // to 8; one operator still can't be on two machines at once.
  @override
  bool get uniqueMachinePerDate => false;
  @override
  bool get checksTimeOverlap => false;
  @override
  int? get maxEntriesPerDay => mfdMaxSlots;
  @override
  bool get entriesByMachineOn => true;

  @override
  List<String> get searchKeys => const ['itemName', 'operator', 'drawingNo', 'operation'];

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
  SheetApi get api => SheetApi.segment('mfd-sheet');

  // ── figures ──
  @override
  Json rowCalc(Json row) => mfdRowCalc(row);
  @override
  List<Json> dayCalc(List<Json> sortedRows) => mfdDayCalc(sortedRows);
  @override
  EntryMetrics metrics(Json values) => MfdMetrics(values);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => validateMfdEntry(values, saved: saved);
  @override
  List<String> get fieldOrder => mfdFieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => mfdEmptyEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) => mfdToFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) => mfdToPayload(values, isEdit: isEdit);
  @override
  bool hasAnyEntryData(List<Json> blocks) => mfdHasAnyEntryData(blocks);
  @override
  bool entryHasData(Json values) => mfdEntryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) => mfdApplyItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) => mfdNewBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) => mfdMergeDraft(draft, now: now);

  // ── form ──
  @override
  EntryLines get lines => const MfdEntryLines();

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => mfdColumns(open);
  @override
  Map<String, String> get formulas => mfdFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) => mfdDetail(row, calc, day);
}

/// The one shared MODULAR FRAME DRILLING spec.
const MfdSpec mfdSpec = MfdSpec();
