import '../../shared/production_sheet_calc.dart';
import '../../shared/shift_hours.dart';
import 'rivet_calc.dart';
import 'rivet_validation.dart' show rivetDowntimeKeys;

// The pure parts of client/src/pages/RivetDataEntry.jsx: emptyEntry,
// toFormValues, toPayload, hasAnyEntryData and the part-pick copy. A block is a
// Map with the web's exact keys; typed fields are Strings ('' = blank).

final List<String> _stoppageKeys = [for (final f in stoppageFields) f['key'] as String];

const List<String> rivetTextFields = ['operator', 'processType', 'itemName', 'drawingNo', 'remarks', 'otherMinRemark'];
const List<String> rivetTimeFields = ['machineOnTime', 'machineOffTime'];

/// Every field sent as a number (blank stays '' so the server unsets it).
final List<String> rivetNumberFields = [
  'noOfHoles',
  ...rivetOpKeys,
  'totalCycleSec',
  'okQty',
  'rejectedQty',
  'plannedOperatorShiftHours',
  ..._stoppageKeys,
];

bool _blank(Object? v) => v == null || v == '';

/// A stored number as the text a form box shows (90 -> '90'); text is kept.
String _text(Object? v) {
  if (v == null) return '';
  if (v is String) return v;
  if (v is num) return v.isFinite ? jsNumStr(v) : '';
  return v.toString();
}

/// A blank machine block dated today (`emptyEntry`).
Map<String, dynamic> rivetEmptyEntry({DateTime? now}) => <String, dynamic>{
      'date': isoDay(now ?? DateTime.now()),
      'machine': '',
      // Machine Working Status: Working (default) or Non Working + its reasons.
      'machineStatus': <dynamic>[],
      'workingMode': 'Working',
      // Assigned on save from the machine's free slots; kept only because an
      // edited record has to save back to its own slot.
      'slot': 1,
      'item': '',
      'vendor': '',
      'vendorName': '',
      // Which of the four operations this entry has unticked.
      'excludedOps': <dynamic>[],
      for (final k in rivetTextFields) k: '',
      for (final k in rivetTimeFields) k: '',
      for (final k in rivetNumberFields) k: '',
    };

/// A saved record -> form values ('' for anything unset). Stored numbers become
/// their text (the form's boxes are text); the payload comes out the same.
Map<String, dynamic> rivetToFormValues(Map<String, dynamic> row, {DateTime? now}) {
  final out = <String, dynamic>{...rivetEmptyEntry(now: now)};
  for (final e in row.entries) {
    if (e.value != null) out[e.key] = e.value;
  }
  for (final k in [...rivetNumberFields, ...rivetTextFields, ...rivetTimeFields]) {
    final v = out[k];
    out[k] = v is String ? v : _text(v);
  }
  out['item'] = jsTruthy(row['item']) ? row['item'] : '';
  out['slot'] = row['slot'];
  out['plannedOperatorShiftHours'] = hoursToHmInput(row['plannedOperatorShiftHours']);
  if (out['excludedOps'] is! List) out['excludedOps'] = <dynamic>[];
  if (out['machineStatus'] is! List) out['machineStatus'] = <dynamic>[];
  return out;
}

/// What `Number(x)` is on the wire: JSON.stringify turns NaN / Infinity into
/// null, and a whole number goes out as an int.
Object? _wire(double n) {
  if (!n.isFinite) return null;
  return n == n.truncateToDouble() && n.abs() < 1e15 ? n.toInt() : n;
}

/// Form values -> the exact body of PUT /rivet-sheet/row. '' tells the server
/// to unset that field.
Map<String, dynamic> rivetToPayload(Map<String, dynamic> v, {required bool isEdit}) {
  final nonWorking = v['workingMode'] == 'Non Working';
  final planned = parseHm(v['plannedOperatorShiftHours']).hours;
  final status = jsTruthy(v['machineStatus']) ? v['machineStatus'] : <dynamic>[];
  final ops = jsTruthy(v['excludedOps']) ? v['excludedOps'] : <dynamic>[];
  return <String, dynamic>{
    // Tells the server which document this edit belongs to, so changing Date or
    // Machine No. moves it rather than creating a second one.
    if (isEdit && jsTruthy(v['_id'])) '_id': v['_id'],
    // (JSON drops an undefined key; a Dart map says so with containsKey.)
    if (v.containsKey('date')) 'date': v['date'],
    if (v.containsKey('machine')) 'machine': v['machine'],
    // Status belongs to a Non Working day only; a Working entry carries none.
    'machineStatus': nonWorking ? status : <dynamic>[],
    'workingMode': jsTruthy(v['workingMode']) ? v['workingMode'] : 'Working',
    // An edited record saves back to its own slot; a new one asks the server
    // for the machine's next free slot.
    'slot': isEdit ? _wire(v.containsKey('slot') ? jsToNumber(v['slot']) : double.nan) : 'auto',
    'item': jsTruthy(v['item']) ? v['item'] : null,
    'vendor': jsTruthy(v['vendor']) ? v['vendor'] : null,
    'excludedOps': ops,
    for (final k in rivetTextFields) k: jsTrim(jsString(v[k] ?? '')),
    // A remark only belongs to an "Others" that is still in use.
    'otherMinRemark': jsToNumber(v['otherMin']) > 0 ? jsTrim(jsString(v['otherMinRemark'] ?? '')) : '',
    for (final k in rivetTimeFields) k: v[k] ?? '',
    for (final k in rivetNumberFields) k: (v[k] == '' || !v.containsKey(k)) ? '' : _wire(jsToNumber(v[k])),
    // Typed as H.MM, saved as decimal hours (3.30 -> 3.5).
    'plannedOperatorShiftHours': planned == null ? '' : _wire(hmToWireHours(planned)),
    // Lunch is optional on the form; the server wants a 0 rather than nothing.
    'lunchMin': (v['lunchMin'] == '' || !v.containsKey('lunchMin')) ? 0 : _wire(jsToNumber(v['lunchMin'])),
  };
}

/// True when any block carries something worth keeping as a draft.
bool rivetHasAnyEntryData(List<Map<String, dynamic>> list) => list.any((v) {
      if (jsTruthy(v['machine'])) return true;
      return [...rivetTextFields, ...rivetTimeFields, ...rivetNumberFields].any((k) => !_blank(v[k]));
    });

// Everything a block can hold beyond the machine itself — tells a collapsed
// block that still has typing in it from an untouched one (RivetEntryForm's
// DATA_KEYS: every line's fields but date, machine and the stoppage total).
const List<String> _dataKeys = [
  'operator',
  'machineStatus',
  'processType',
  'itemName',
  'noOfHoles',
  'machineOnTime',
  'machineOffTime',
  'okQty',
  'rejectedQty',
  'plannedOperatorShiftHours',
  'lunchMin',
  ...rivetDowntimeKeys,
  'otherMinRemark',
  'remarks',
];

/// RivetEntryForm's `hasData`.
bool rivetEntryHasData(Map<String, dynamic> v) =>
    v['workingMode'] == 'Non Working' ||
    _dataKeys.any((k) {
      final x = v[k];
      return x is List ? x.isNotEmpty : !_blank(x);
    });

/// Picking a part copies its master values onto the block (`withPart`) — still
/// editable, so a later change to the master never rewrites saved records. A
/// freshly picked part starts with every operation ticked.
Map<String, dynamic> rivetApplyItemSelection(Map<String, dynamic> v, String itemId, List<Map<String, dynamic>> items) {
  if (itemId.isEmpty) return {...v, 'item': '', 'itemName': '', 'drawingNo': ''};
  Map<String, dynamic>? it;
  for (final candidate in items) {
    if ('${candidate['_id']}' == itemId) {
      it = candidate;
      break;
    }
  }
  if (it == null) return {...v, 'item': ''};
  return {
    ...v,
    'item': '${it['_id']}',
    'itemName': _text(it['itemName']),
    'drawingNo': jsTruthy(it['drawingNo']) ? _text(it['drawingNo']) : '',
    'totalCycleSec': _text(it['totalCycleSec']),
    for (final k in rivetOpKeys) k: _text(it[k]),
    'excludedOps': <dynamic>[],
  };
}

/// A new machine block copies the date of the block above it.
Map<String, dynamic> rivetNewBlockAfter(List<Map<String, dynamic>> list, {DateTime? now}) {
  final base = rivetEmptyEntry(now: now);
  final prev = list.isEmpty ? null : list.last['date'];
  if (jsTruthy(prev)) base['date'] = prev;
  return base;
}

/// A draft saved before a field existed lacks it — fill those in (draft wins).
Map<String, dynamic> rivetMergeDraftEntry(Map<String, dynamic> draft, {DateTime? now}) {
  final out = <String, dynamic>{...rivetEmptyEntry(now: now), ...draft};
  out['excludedOps'] = draft['excludedOps'] is List ? List<dynamic>.from(draft['excludedOps'] as List) : <dynamic>[];
  out['machineStatus'] = draft['machineStatus'] is List ? List<dynamic>.from(draft['machineStatus'] as List) : <dynamic>[];
  return out;
}
