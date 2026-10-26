import '../../sheet/editor/entry_editor_logic.dart' show numText;
import '../../sheet/sheet_model.dart' show Json;
import '../../shared/production_sheet_calc.dart';
import '../../shared/quantity_rules.dart';
import '../../shared/shift_hours.dart';
import 'spm_calc.dart';
import 'spm_validation.dart';

/// The pure parts of client/src/pages/SpmDataEntry.jsx (emptyEntry,
/// toFormValues, toPayload, hasAnyEntryData, withPart, the add-block / draft
/// rules) and of SpmEntryForm.jsx (`hasData`) — kept free of widgets so they can
/// be tested against the web's own functions.
///
/// A block is a `Map<String, dynamic>` with the web's exact keys. Typed fields
/// are Strings ('' = blank — the web keeps numbers it copied from a Part or
/// loaded from the server as numbers, the phone shows them as their text);
/// `excludedOps` and `machineStatus` are lists.

const List<String> spmTextFields = ['operator', 'itemName', 'drawingNo', 'remarks', 'rejectOtherRemark', 'otherMinRemark'];
const List<String> spmTimeFields = ['machineOnTime', 'machineOffTime'];

/// Every field sent as a number (blank stays '' so the server unsets it).
final List<String> spmNumberFields = [
  'noOfHoles',
  'piecesPerCycle',
  'strokeRequired',
  'loadingSec',
  'processSec',
  'unloadingCleaningSec',
  'otherOperationsSec',
  'totalCycleSec',
  'actualQty',
  'okQty',
  'plannedOperatorShiftHours',
  ...spmStoppageKeys,
];

/// A blank machine block dated today.
Json spmEmptyEntry({DateTime? now}) => <String, dynamic>{
      'date': isoDay(now ?? DateTime.now()),
      'machine': '',
      // Machine Working Status — any of Machine Breakdown / No Manpower / No Planning.
      'machineStatus': <dynamic>[],
      // Working (default) or Non Working.
      'workingMode': 'Working',
      // Assigned on save from the machine's free slots for that date; kept in the
      // values only because an edited record has to save back to its own slot.
      'slot': 1,
      'item': '',
      // Vendor Name — offered only when the machine's process has vendors.
      'vendor': '',
      'vendorName': '',
      // Which of the four operations this entry has unticked.
      'excludedOps': <dynamic>[],
      for (final k in spmTextFields) k: '',
      for (final k in spmTimeFields) k: '',
      for (final k in spmNumberFields) k: '',
      // Rejection Master: {reason: qty}, typed per reason; has to add up to Rejected (Actual − OK).
      'rejectBreakdown': <String, dynamic>{},
    };

bool _blank(Object? v) => v == null || v == '';

/// A saved record -> form values ('' for anything unset, so inputs stay
/// controlled; stored numbers become their text).
Json spmToFormValues(Json row, {DateTime? now}) {
  final out = <String, dynamic>{...spmEmptyEntry(now: now)};
  for (final e in row.entries) {
    if (e.value != null) out[e.key] = e.value;
  }
  for (final k in [...spmNumberFields, ...spmTextFields, ...spmTimeFields]) {
    final v = out[k];
    out[k] = v is String ? v : numText(v);
  }
  out['item'] = jsTruthy(row['item']) ? row['item'] : '';
  out['slot'] = row['slot'];
  // Actual Quantity and the Rejection Master split (an older entry has neither: Actual = OK + Rejected).
  out.addAll(quantityFormValues(row));
  // A stored shift is decimal hours; the box shows it as typed (5 h 20 min -> "5.33").
  out['plannedOperatorShiftHours'] = hoursToShiftInput(row['plannedOperatorShiftHours']);
  return out;
}

/// Whole numbers go out as ints (60, not 60.0), exactly like JSON.stringify.
num _wire(double n) => n.isFinite && n == n.truncateToDouble() && n.abs() < 1e15 ? n.toInt() : n;

/// Web `v[k] === "" || v[k] === undefined ? "" : Number(v[k])`: a MISSING key is
/// undefined (blank), a key holding null is Number(null) = 0. NaN / Infinity are
/// what JSON.stringify turns into null on the web.
Object? _numberOut(Json v, String k) {
  if (!v.containsKey(k) || v[k] == '') return '';
  final n = jsToNumber(v[k]);
  return n.isFinite ? _wire(n) : null;
}

String _text(Object? v) => jsTrim(jsString(v ?? ''));

/// Form values -> the exact body of PUT /spm-sheet/row. '' tells the server to
/// unset that field.
Json spmToPayload(Json v, {required bool isEdit}) {
  final nonWorking = v['workingMode'] == 'Non Working';
  final status = v['machineStatus'];
  final ops = v['excludedOps'];
  final planned = parseShiftHours(v['plannedOperatorShiftHours']).hours;
  return <String, dynamic>{
    // Tells the server which document an edit belongs to, so changing Date or
    // Machine No. moves it instead of creating a second one.
    if (isEdit && jsTruthy(v['_id'])) '_id': v['_id'],
    // (A key the block does not hold is `undefined` on the web and so not sent.)
    if (v.containsKey('date')) 'date': v['date'],
    if (v.containsKey('machine')) 'machine': v['machine'],
    // Status belongs to a Non Working day only; a Working entry carries none.
    'machineStatus': nonWorking ? (jsTruthy(status) ? status : <dynamic>[]) : <dynamic>[],
    'workingMode': jsTruthy(v['workingMode']) ? v['workingMode'] : 'Working',
    // An edited record saves back to its own slot; a new one asks the server for
    // the machine's next free slot on that date.
    'slot': isEdit ? _slotOut(v) : 'auto',
    'item': jsTruthy(v['item']) ? v['item'] : null,
    'vendor': jsTruthy(v['vendor']) ? v['vendor'] : null,
    'excludedOps': jsTruthy(ops) ? ops : <dynamic>[],
    for (final k in spmTextFields) k: _text(v[k]),
    // A remark only belongs to an "Others" still in use.
    'otherMinRemark': jsToNumber(v['otherMin']) > 0 ? _text(v['otherMinRemark']) : '',
    for (final k in spmTimeFields) k: v[k] ?? '',
    for (final k in spmNumberFields) k: _numberOut(v, k),
    // The Rejection Master split and its "Other" remark. rejectedQty is never sent: the server derives it (Actual − OK).
    ...rejectPayload(v, _wire),
    // Typed as decimal hours like the sheet, taken to the whole minute (5.33 -> 5 h 20 min).
    'plannedOperatorShiftHours': planned == null ? '' : _wire(hmToWireHours(planned)),
    // Lunch is optional on the form; the server wants a 0 rather than nothing.
    'lunchMin': _blank(v['lunchMin']) ? 0 : _numberOut(v, 'lunchMin'),
  };
}

Object? _slotOut(Json v) {
  // Number(undefined) is NaN (-> null on the wire), Number(null) is 0.
  if (!v.containsKey('slot')) return null;
  final n = jsToNumber(v['slot']);
  return n.isFinite ? _wire(n) : null;
}

/// True when any block carries something worth keeping as a draft.
bool spmHasAnyEntryData(List<Json> list) => list.any((v) {
      if (jsTruthy(v['machine'])) return true;
      if (hasRejectData(v)) return true;
      return [...spmTextFields, ...spmTimeFields, ...spmNumberFields].any((k) => !_blank(v[k]));
    });

final List<String> _dataKeys = [
  'operator',
  'machineStatus',
  'itemName',
  'noOfHoles',
  'piecesPerCycle',
  'strokeRequired',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  'okQty',
  'rejectOtherRemark',
  'plannedOperatorShiftHours',
  'lunchMin',
  ...spmDowntimeKeys,
  'otherMinRemark',
  'remarks',
];

/// The form's `hasData`: whether a block holds typed work (a collapsed block's
/// tint, the remove confirmation).
bool spmEntryHasData(Json v) {
  if (v['workingMode'] == 'Non Working') return true;
  final split = v['rejectBreakdown'];
  return _dataKeys.any((k) {
        final x = v[k];
        return x is List ? x.isNotEmpty : !_blank(x);
      }) ||
      (split is Map && split.values.any((n) => !_blank(n)));
}

/// Picking a Part copies its master values onto the block (web `withPart`): Drawing
/// No., Total Cycle Time, the four operations and the three reference figures —
/// still just this entry's copy, so a later change to the master never rewrites
/// saved records. A freshly picked part starts with every operation ticked.
Json spmApplyItemSelection(Json v, String itemId, List<Json> items) {
  if (itemId.isEmpty) return {...v, 'item': '', 'itemName': '', 'drawingNo': ''};
  Json? it;
  for (final candidate in items) {
    if ('${candidate['_id']}' == itemId) {
      it = candidate;
      break;
    }
  }
  if (it == null) return {...v, 'item': ''};
  final part = it;
  return {
    ...v,
    'item': '${part['_id']}',
    'itemName': numText(part['itemName']),
    'drawingNo': jsTruthy(part['drawingNo']) ? numText(part['drawingNo']) : '',
    'totalCycleSec': numText(part['totalCycleSec']),
    for (final k in spmOpKeys) k: numText(part[k]),
    for (final k in spmReferenceKeys) k: numText(part[k]),
    'excludedOps': <dynamic>[],
  };
}

/// A new machine block copies the date of the block above it — nothing else.
Json spmNewBlockAfter(List<Json> list, {DateTime? now}) {
  final base = spmEmptyEntry(now: now);
  final prev = list.isEmpty ? null : list.last['date'];
  if (jsTruthy(prev)) base['date'] = prev;
  return base;
}

/// A draft saved before a field existed lacks it — fill those in as blank
/// (draft values win), keeping the two list fields lists.
Json spmMergeDraftEntry(Json draft, {DateTime? now}) {
  final out = <String, dynamic>{...spmEmptyEntry(now: now), ...draft};
  final ops = draft['excludedOps'];
  out['excludedOps'] = ops is List ? List<dynamic>.from(ops) : <dynamic>[];
  final status = draft['machineStatus'];
  out['machineStatus'] = status is List ? List<dynamic>.from(status) : <dynamic>[];
  return out;
}
