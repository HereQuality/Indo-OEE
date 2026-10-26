// The pure parts of client/src/pages/VmcDataEntry.jsx's handlers: emptyEntry,
// toFormValues, toPayload, hasAnyEntryData, the Part pick (withPart) and drafts.
//
// A block is a `Map` with the web's exact keys; typed fields are Strings
// ('' = blank). Where the web leaves a stored number as it is, the phone turns it
// into the text its box shows — the rules and the payload read both alike.

import '../../entry_form/entry_form_logic.dart' show isBlankValue;
import '../../shared/production_sheet_calc.dart';
import '../../shared/quantity_rules.dart';
import '../../shared/shift_hours.dart';
import '../../sheet/editor/entry_editor_logic.dart' show numText;
import '../../sheet/sheet_model.dart';

final List<String> _stoppageKeys = [for (final f in stoppageFields) f['key'] as String];

/// `workOrderNo` is only shown on the web — the server takes the number from the work order.
const List<String> vmcTextFields = ['operator', 'machineNotRun', 'workOrderNo', 'itemName', 'drawingNo', 'setupNo', 'remarks', 'rejectOtherRemark', 'otherMinRemark'];
const List<String> vmcTimeFields = ['machineOnTime', 'machineOffTime'];
final List<String> vmcNumberFields = [
  'programTimeMin',
  'pcsPerProgram',
  'actualQty',
  'okQty',
  'plannedOperatorShiftHours',
  ..._stoppageKeys,
];

/// A blank machine block dated today.
Json emptyVmcEntry({DateTime? now}) => <String, dynamic>{
      'date': isoDay(now ?? DateTime.now()),
      'machine': '',
      // Any of Machine Breakdown / No Manpower / No Planning (Non Working only).
      'machineStatus': <dynamic>[],
      // Working (default) or Non Working.
      'workingMode': 'Working',
      // Assigned on save from the machine's free slots; kept only because an
      // edited record has to save back to its own slot.
      'slot': 1,
      'item': '',
      'vendor': '',
      'vendorName': '',
      'workOrder': '',
      // Which of Program Time / No. of Piece In One Program is unticked — a
      // per-entry note only.
      'excludedOps': <dynamic>[],
      for (final k in vmcTextFields) k: '',
      for (final k in vmcTimeFields) k: '',
      for (final k in vmcNumberFields) k: '',
      // Rejection Master: {reason: qty}, typed per reason; has to add up to Rejected (Actual − OK).
      'rejectBreakdown': <String, dynamic>{},
    };

/// A saved record -> form values ('' for anything unset, so inputs stay controlled).
Json vmcToFormValues(Json row, {DateTime? now}) {
  final out = <String, dynamic>{...emptyVmcEntry(now: now)};
  for (final e in row.entries) {
    if (e.value != null) out[e.key] = e.value;
  }
  for (final k in [...vmcNumberFields, ...vmcTextFields, ...vmcTimeFields]) {
    final v = out[k];
    out[k] = v is String ? v : numText(v);
  }
  out['item'] = jsTruthy(row['item']) ? '${row['item']}' : '';
  out['workOrder'] = jsTruthy(row['workOrder']) ? '${row['workOrder']}' : '';
  out['vendor'] = jsTruthy(row['vendor']) ? '${row['vendor']}' : '';
  out['slot'] = row['slot'];
  out['machineStatus'] = row['machineStatus'] is List ? List<dynamic>.from(row['machineStatus'] as List) : <dynamic>[];
  out['excludedOps'] = row['excludedOps'] is List ? List<dynamic>.from(row['excludedOps'] as List) : <dynamic>[];
  // Actual Quantity and the Rejection Master split (an older entry has neither: Actual = OK + Rejected).
  out.addAll(quantityFormValues(row));
  // A stored shift is decimal hours; the box shows it as typed (5 h 20 min -> "5.33").
  out['plannedOperatorShiftHours'] =
      isBlankValue(row['plannedOperatorShiftHours']) ? '' : hoursToShiftInput(jsToNumber(row['plannedOperatorShiftHours']));
  return out;
}

/// Whole numbers go out as ints (60, not 60.0), like JSON.stringify; NaN/Infinity
/// become null like JSON.stringify.
Object? _wire(double n) {
  if (!n.isFinite) return null;
  return n == n.truncateToDouble() && n.abs() < 1e15 ? n.toInt() : n;
}

Object? _number(Object? v) => (v == '' || v == null) ? '' : _wire(jsToNumber(v));

/// Form values -> the exact body of `PUT /vmc-sheet/row`. '' tells the server to
/// unset that field.
Json vmcToPayload(Json v, {required bool isEdit}) {
  final nonWorking = v['workingMode'] == 'Non Working';
  String text(String k) => jsTrim(jsString(v[k] ?? ''));
  return <String, dynamic>{
    // Tells the server which exact document this edit belongs to, so changing
    // Date or Machine No. moves that document instead of creating a second one.
    if (isEdit && jsTruthy(v['_id'])) '_id': v['_id'],
    'date': v['date'],
    'machine': v['machine'],
    // Status belongs to a Non Working day only; a Working entry carries none.
    'machineStatus': nonWorking ? (jsTruthy(v['machineStatus']) ? v['machineStatus'] : <dynamic>[]) : <dynamic>[],
    'workingMode': jsTruthy(v['workingMode']) ? v['workingMode'] : 'Working',
    // An edited record saves back to its own slot; a new one asks the server for
    // the machine's next free slot on that date.
    'slot': isEdit ? (v['slot'] == null ? null : _wire(jsToNumber(v['slot']))) : 'auto',
    'item': jsTruthy(v['item']) ? v['item'] : null,
    'vendor': jsTruthy(v['vendor']) ? v['vendor'] : null,
    'excludedOps': jsTruthy(v['excludedOps']) ? v['excludedOps'] : <dynamic>[],
    'workOrder': jsTruthy(v['workOrder']) ? v['workOrder'] : null,
    for (final k in vmcTextFields) k: text(k),
    // A remark only belongs to an "Others" that is still in use.
    'otherMinRemark': jsToNumber(v['otherMin']) > 0 ? text('otherMinRemark') : '',
    for (final k in vmcTimeFields) k: v[k] ?? '',
    for (final k in vmcNumberFields) k: _number(v[k]),
    // The Rejection Master split and its "Other" remark. rejectedQty is never sent: the server derives it (Actual − OK).
    ...rejectPayload(v, _wire),
    // Typed as decimal hours like the sheet, taken to the whole minute (5.33 -> 5 h 20 min).
    'plannedOperatorShiftHours': () {
      final hours = parseShiftHours(v['plannedOperatorShiftHours']).hours;
      return hours == null ? '' : _wire(hmToWireHours(hours));
    }(),
    // Lunch is optional on the form; the server wants a 0 rather than nothing.
    'lunchMin': (v['lunchMin'] == '' || v['lunchMin'] == null) ? 0 : _wire(jsToNumber(v['lunchMin'])),
  };
}

bool _filled(Object? v) => v != null && v != '';

/// Whether any block holds something worth keeping as a draft (web hasAnyEntryData).
bool hasAnyVmcEntryData(List<Json> list) => list.any((v) {
      if (jsTruthy(v['machine'])) return true;
      if (hasRejectData(v)) return true;
      return [...vmcTextFields, ...vmcTimeFields, ...vmcNumberFields].any((k) => _filled(v[k]));
    });

// Everything a block can hold beyond the machine itself (web DATA_KEYS) — tells a
// collapsed block that still has typing in it from an untouched one.
const List<String> _dataKeys = [
  'machineStatus',
  'operator',
  'itemName',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  'okQty',
  'rejectOtherRemark',
  'plannedOperatorShiftHours',
  'lunchMin',
  'plannedDownMin',
  'setupMin',
  'noManPowerMin',
  'materialShiftingMin',
  'noMaterialMin',
  'bdMechMin',
  'bdEleMin',
  'noPowerMin',
  'otherMin',
  'otherMinRemark',
  'remarks',
];

/// Whether ONE block holds typed work (web `hasData`).
bool vmcEntryHasData(Json v) =>
    v['workingMode'] == 'Non Working' ||
    _dataKeys.any((k) {
      final x = v[k];
      return x is List ? x.isNotEmpty : _filled(x);
    }) ||
    (v['rejectBreakdown'] is Map && (v['rejectBreakdown'] as Map).values.any(_filled));

/// Picking a Part copies its details onto the block — still editable, so a later
/// change to the master never rewrites saved records (web handleItemSelect /
/// withPart). A Work Order belongs to one part, so picking a part lets go of it.
Json applyVmcItemSelection(Json v, String itemId, List<Json> items) {
  const noWorkOrder = {'workOrder': '', 'workOrderNo': ''};
  if (itemId.isEmpty) return {...v, 'item': '', 'itemName': '', 'drawingNo': '', ...noWorkOrder};
  Json? it;
  for (final c in items) {
    if ('${c['_id']}' == itemId) {
      it = c;
      break;
    }
  }
  if (it == null) return {...v, 'item': '', ...noWorkOrder};
  return {
    ...v,
    'item': '${it['_id']}',
    'itemName': '${it['itemName'] ?? ''}',
    'drawingNo': jsTruthy(it['drawingNo']) ? '${it['drawingNo']}' : '',
    'setupNo': jsTruthy(it['setupNo']) ? '${it['setupNo']}' : v['setupNo'],
    'programTimeMin': numText(it['programTimeMin']),
    'pcsPerProgram': numText(it['pcsPerProgram']),
    // A freshly (re)picked part starts with both ticked.
    'excludedOps': <dynamic>[],
    ...noWorkOrder,
  };
}

/// A new machine block copies the date of the block above it — nothing else.
Json newVmcBlockAfter(List<Json> list, {DateTime? now}) {
  final base = emptyVmcEntry(now: now);
  final prev = list.isEmpty ? null : list.last['date'];
  if (jsTruthy(prev)) base['date'] = prev;
  return base;
}

/// A draft saved before a field existed lacks it — fill those in as blank.
Json mergeVmcDraftEntry(Json draft, {DateTime? now}) {
  final out = <String, dynamic>{...emptyVmcEntry(now: now), ...draft};
  out['machineStatus'] = draft['machineStatus'] is List ? List<dynamic>.from(draft['machineStatus'] as List) : <dynamic>[];
  out['excludedOps'] = draft['excludedOps'] is List ? List<dynamic>.from(draft['excludedOps'] as List) : <dynamic>[];
  return out;
}
