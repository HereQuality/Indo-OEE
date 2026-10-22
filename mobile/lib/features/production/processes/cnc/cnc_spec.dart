import '../../../../core/api/endpoints.dart';
import '../../entry_form/entry_form_logic.dart' as form;
import '../../entry_form/entry_line_context.dart';
import '../../process/process_spec.dart';
import '../../shared/limit_notice.dart' as limit show firstOverLimit;
import '../../shared/limit_notice.dart' show OverLimit;
import '../../shared/production_entry_validation.dart' as rules;
import '../../shared/production_sheet_calc.dart' as calc;
import '../../sheet/editor/entry_editor_logic.dart' as logic;
import '../../sheet/sheet_model.dart';
import '../../sheet/table/sheet_columns.dart';
import '../../sheet/widgets/sheet_style.dart';
import 'cnc_columns.dart';
import 'cnc_detail.dart';
import 'cnc_lines.dart';

/// The CNC Data Entry page (client/src/pages/ProductionSheet.jsx and
/// utils/productionSheet.js) — the reference implementation every other process
/// is ported next to. The "twin" processes whose formulas are CNC's own
/// (Contact, Trobe, Spring) extend this class and override only [key], [label],
/// [routePath], [api], [draftKey] and whatever their web twin does differently.
class CncSpec extends ProcessSpec {
  const CncSpec();

  @override
  String get key => 'cnc';
  @override
  String get label => 'CNC';
  @override
  String get routePath => '/production/cnc-data-entry';
  @override
  List<String> get routeAliases => const ['/production/data-entry'];
  @override
  String get draftKey => 'productionEntryDraft';

  // The web CNC page scopes the Part picker to its process (plus parts with no
  // process yet) — ProductionSheet.jsx `scopedItems` — so the phone does too.
  // (The default; it used to be switched off here.)
  @override
  bool get scopeItemsToProcess => true;

  // ── web-parity extras (all four are on for CNC) ──
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
  SheetApi get api => const SheetApi(
        Endpoints.productionSheet,
        operators: Endpoints.productionSheetOperators,
        rejectReasons: Endpoints.productionSheetRejectReasons,
      );

  // ── figures ──
  @override
  Json rowCalc(Json row) => calc.rowCalc(row);
  @override
  List<Json> dayCalc(List<Json> sortedRows) => calc.dayCalc(sortedRows);

  // ── rules ──
  @override
  Map<String, String> validateEntry(Json values, {Json? saved}) => rules.validateEntry(values, saved: saved);
  @override
  List<String> get fieldOrder => rules.fieldOrder;

  // ── values ──
  @override
  Json emptyEntry({DateTime? now}) => logic.emptyEntry(now: now);
  @override
  Json toFormValues(Json row, {DateTime? now}) => logic.toFormValues(row, now: now);
  @override
  Json toPayload(Json values, {required bool isEdit}) => logic.toPayload(values, isEdit: isEdit);
  @override
  bool hasAnyEntryData(List<Json> blocks) => logic.hasAnyEntryData(blocks);
  @override
  bool entryHasData(Json values) => form.entryHasData(values);
  @override
  Json applyItemSelection(Json values, String itemId, List<Json> items) => logic.applyItemSelection(values, itemId, items);
  @override
  Json newBlockAfter(List<Json> blocks, {DateTime? now}) => logic.newBlockAfter(blocks, now: now);
  @override
  Json mergeDraftEntry(Json draft, {DateTime? now}) => logic.mergeDraftEntry(draft, now: now);

  @override
  Json applyRejectChange(Json values, String reason, dynamic value) {
    final current = values['rejectBreakdown'];
    return {
      ...values,
      'rejectBreakdown': <String, dynamic>{
        if (current is Map) ...Map<String, dynamic>.from(current),
        reason: value,
      },
    };
  }

  // ── form ──
  @override
  EntryLines get lines => const CncEntryLines();

  // ── list ──
  @override
  SheetColumns columns(Set<String> open) => cncColumns(open);
  @override
  Map<String, String> get formulas => sheetFormulas;
  @override
  List<Json> remarkParts(Json row) => calc.remarkParts(row);
  @override
  DetailModel detail(Json row, Json calc, Json day) => cncDetail(row, calc, day);
}

/// The one shared CNC spec (also the default of every framework widget).
const CncSpec cncSpec = CncSpec();
