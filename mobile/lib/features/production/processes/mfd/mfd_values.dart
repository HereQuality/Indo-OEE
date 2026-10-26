// The pure parts of client/src/pages/ModularFrameDrillingDataEntry.jsx
// (emptyEntry, toFormValues, toPayload, hasAnyEntryData, the part-pick copy)
// and of Components/Production/MfdEntryForm.jsx (the per-block "has typed
// work" test). Widget-free so the golden tests can run them on their own.
//
// A block is a `Map<String, dynamic>` with the web's exact keys; typed fields
// are Strings ('' = blank). No Rejection Master: Rejected (Actual − OK) is never
// sent. Drawing No., Process (`operation`), No. of Holes and Stroke Required
// are the Part's, copied onto the entry when it is picked.

import '../../entry_form/entry_form_logic.dart' show entryText;
import '../../shared/production_sheet_calc.dart';
import '../../shared/quantity_rules.dart' show quantityFormValues;
import '../../shared/shift_hours.dart';

final List<String> _stoppageKeys = [for (final f in stoppageFields) f['key'] as String];

const List<String> mfdTextFields = ['operator', 'itemName', 'drawingNo', 'operation', 'remarks', 'otherMinRemark'];
const List<String> mfdTimeFields = ['machineOnTime', 'machineOffTime', 'settingOnTime', 'settingOffTime'];
final List<String> mfdNumberFields = ['noOfHoles', 'strokeRequired', 'totalCycleSec', 'actualQty', 'okQty', 'plannedOperatorShiftHours', ..._stoppageKeys];

/// A Non Working day keeps just these — anything typed in the hidden production
/// boxes is sent blank.
const List<String> _statusOnlyKeys = [
  '_id',
  'date',
  'machine',
  'slot',
  'operator',
  'workingMode',
  'machineStatus',
  'remarks',
];

/// A blank entry block dated today.
Map<String, dynamic> mfdEmptyEntry({DateTime? now}) => <String, dynamic>{
      'date': isoDay(now ?? DateTime.now()),
      'machine': '',
      // Reasons For Not Working — any of Machine Breakdown / No Manpower / No Planning.
      'machineStatus': <dynamic>[],
      // Working (default) or Non Working.
      'workingMode': 'Working',
      // Assigned on save from the machine's free slots for that date; kept only
      // because an edited record has to save back to its own slot.
      'slot': 1,
      'item': '',
      // Vendor Name — offered only when the machine's process has vendors.
      'vendor': '',
      'vendorName': '',
      for (final k in mfdTextFields) k: '',
      for (final k in mfdTimeFields) k: '',
      for (final k in mfdNumberFields) k: '',
    };

/// A saved record -> form values ('' for anything unset). Typed fields come out
/// as Strings.
Map<String, dynamic> mfdToFormValues(Map<String, dynamic> row, {DateTime? now}) {
  final out = <String, dynamic>{...mfdEmptyEntry(now: now)};
  for (final e in row.entries) {
    if (e.value != null) out[e.key] = e.value;
  }
  for (final k in [...mfdNumberFields, ...mfdTextFields, ...mfdTimeFields]) {
    final v = out[k];
    out[k] = v is String ? v : entryText(v);
  }
  out['item'] = jsTruthy(row['item']) ? '${row['item']}' : '';
  // The vendor id (a populated vendor keeps its _id).
  final vendor = row['vendor'];
  out['vendor'] = vendor is Map ? '${vendor['_id'] ?? ''}' : (jsTruthy(vendor) ? '$vendor' : '');
  out['slot'] = row['slot'];
  // Actual Quantity (an entry saved before it existed reads as OK + Rejected) —
  // no Rejection Master split on this sheet.
  out['actualQty'] = quantityFormValues(row)['actualQty'];
  // A stored shift is decimal hours; the box shows it as the sheet writes it (5 h 20 min -> "5.33").
  out['plannedOperatorShiftHours'] = hoursToShiftInput(row['plannedOperatorShiftHours']);
  out['machineStatus'] = row['machineStatus'] is List ? List<dynamic>.from(row['machineStatus'] as List) : <dynamic>[];
  return out;
}

/// Whole numbers go out as ints (60, not 60.0), exactly like JSON.stringify;
/// NaN / Infinity go out as null (what JSON.stringify makes of them).
Object? _wire(double n) {
  if (!n.isFinite) return null;
  return n == n.truncateToDouble() && n.abs() < 1e15 ? n.toInt() : n;
}

/// JS `Number(v[key])` — an absent key is `undefined` (NaN), a present null is 0.
double _numberOf(Map<String, dynamic> v, String key) => v.containsKey(key) ? jsToNumber(v[key]) : double.nan;

bool _blankOrMissing(Map<String, dynamic> v, String key) => !v.containsKey(key) || v[key] == '';

/// Form values -> the exact body of `PUT /mfd-sheet/row`. '' tells the
/// server to unset that field; rejectedQty is never sent (the server works out
/// Actual − OK).
Map<String, dynamic> mfdToPayload(Map<String, dynamic> v, {required bool isEdit}) {
  String text(String k) => jsTrim(jsString(v[k] ?? ''));
  final nonWorking = v['workingMode'] == 'Non Working';

  final body = <String, dynamic>{
    // Which exact document this edit belongs to — absent on a new entry.
    if (isEdit && jsTruthy(v['_id'])) '_id': v['_id'],
    // (An absent key is `undefined` on the web and never reaches the wire.)
    if (v.containsKey('date')) 'date': v['date'],
    if (v.containsKey('machine')) 'machine': v['machine'],
    // Reasons belong to a Non Working day only; a Working entry carries none.
    'machineStatus': nonWorking ? (jsTruthy(v['machineStatus']) ? v['machineStatus'] : <dynamic>[]) : <dynamic>[],
    'workingMode': jsTruthy(v['workingMode']) ? v['workingMode'] : 'Working',
    // An edited record saves back to its own slot; a new one asks the server
    // for the machine's next free slot on that date.
    'slot': isEdit ? _wire(_numberOf(v, 'slot')) : 'auto',
    'item': jsTruthy(v['item']) ? v['item'] : null,
    'vendor': jsTruthy(v['vendor']) ? v['vendor'] : null,
    for (final k in mfdTextFields) k: text(k),
    // A remark only belongs to an "Other" that is still in use.
    'otherMinRemark': jsToNumber(v['otherMin']) > 0 ? text('otherMinRemark') : '',
    for (final k in mfdTimeFields) k: v[k] ?? '',
    for (final k in mfdNumberFields) k: _blankOrMissing(v, k) ? '' : _wire(_numberOf(v, k)),
    // Typed as decimal hours like the sheet, taken to the whole minute (5.33 -> 5 h 20 min).
    'plannedOperatorShiftHours': () {
      final hours = parseShiftHours(v['plannedOperatorShiftHours']).hours;
      return hours == null ? '' : _wire(hmToWireHours(hours));
    }(),
    // Lunch is optional on the form; the server wants a 0 rather than nothing.
    'lunchMin': _blankOrMissing(v, 'lunchMin') ? 0 : _wire(_numberOf(v, 'lunchMin')),
  };

  if (!nonWorking) return body;
  return <String, dynamic>{
    for (final e in body.entries) e.key: _statusOnlyKeys.contains(e.key) ? e.value : (e.key == 'item' ? null : ''),
  };
}

bool _filled(Object? v) => v != null && v != '';

/// True when any block carries something worth keeping as a draft.
bool mfdHasAnyEntryData(List<Map<String, dynamic>> list) => list.any((v) {
      if (jsTruthy(v['machine'])) return true;
      return [...mfdTextFields, ...mfdTimeFields, ...mfdNumberFields].any((k) => _filled(v[k]));
    });

/// The form's `DATA_KEYS`: every line's fields but Date, MC No., Working Status
/// and the stoppage total.
const List<String> _blockDataKeys = [
  'operator',
  'machineStatus',
  'itemName',
  'vendor',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'settingOnTime',
  'settingOffTime',
  'actualQty',
  'okQty',
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

/// Whether ONE block holds typed work (web `hasData`): a Non Working block always does.
bool mfdEntryHasData(Map<String, dynamic> v) =>
    v['workingMode'] == 'Non Working' ||
    _blockDataKeys.any((k) => v[k] is List ? (v[k] as List).isNotEmpty : _filled(v[k]));

/// Picking a Part copies its Drawing No., Process, No. of Holes, Stroke Required
/// and Total Cycle Time onto the block — the cycle time only a starting value,
/// editable for the day.
Map<String, dynamic> mfdApplyItemSelection(Map<String, dynamic> v, String itemId, List<Map<String, dynamic>> items) {
  if (itemId.isEmpty) {
    return {...v, 'item': '', 'itemName': '', 'drawingNo': '', 'operation': '', 'noOfHoles': '', 'strokeRequired': '', 'totalCycleSec': ''};
  }
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
    'itemName': '${it['itemName'] ?? ''}',
    'drawingNo': jsTruthy(it['drawingNo']) ? '${it['drawingNo']}' : '',
    'operation': jsTruthy(it['mfdOperation']) ? '${it['mfdOperation']}' : '',
    'noOfHoles': entryText(it['noOfHoles']),
    'strokeRequired': entryText(it['strokeRequired']),
    'totalCycleSec': entryText(it['totalCycleSec']),
  };
}

/// A new entry block copies the date of the block above it — nothing else.
Map<String, dynamic> mfdNewBlockAfter(List<Map<String, dynamic>> list, {DateTime? now}) {
  final base = mfdEmptyEntry(now: now);
  final prev = list.isEmpty ? null : list.last['date'];
  if (jsTruthy(prev)) base['date'] = prev;
  return base;
}

/// A draft saved before a field existed lacks it — fill those in as blank.
Map<String, dynamic> mfdMergeDraft(Map<String, dynamic> draft, {DateTime? now}) {
  final out = <String, dynamic>{...mfdEmptyEntry(now: now), ...draft};
  out['machineStatus'] = draft['machineStatus'] is List ? List<dynamic>.from(draft['machineStatus'] as List) : <dynamic>[];
  return out;
}
