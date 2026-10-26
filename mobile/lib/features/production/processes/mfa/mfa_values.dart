// The pure parts of client/src/pages/ModularFrameAssemblyDataEntry.jsx
// (emptyEntry, toFormValues, toPayload, hasAnyEntryData, the part-pick copy,
// drafts) and of Components/Production/MfaEntryForm.jsx (the per-block "has
// typed work" test). Widget-free so the golden tests can run them on their own.
//
// The worker's id sits in `machine`; the PUT body renames it to `worker`
// (api/mfaSheet.api.js saveMfaRow) and carries the process id. No Vendor, no
// reason split: TOTAL and OK are typed, Rejected is the server's TOTAL − OK.

import '../../entry_form/entry_form_logic.dart' show entryText;
import '../../shared/production_sheet_calc.dart';
import '../../shared/quantity_rules.dart' show quantityFormValues;
import '../../shared/shift_hours.dart';
import 'mfa_calc.dart';

const List<String> mfaTextFields = ['workingStatus', 'itemName', 'otherActivity', 'remarks', 'otherMinRemark'];
const List<String> mfaTimeFields = ['machineOnTime', 'machineOffTime'];
const List<String> mfaNumberFields = ['totalCycleSec', 'actualQty', 'okQty', 'otherActivityMin', 'plannedOperatorShiftHours', 'lunchMin', 'otherMin'];

const List<String> _statusOnlyKept = ['workingStatus', 'workingMode', 'machineStatus', 'remarks'];
const List<String> _statusOnlyKeys = ['_id', 'date', 'worker', 'process', 'slot', ..._statusOnlyKept];

/// A blank worker block dated today.
Map<String, dynamic> mfaEmptyEntry({DateTime? now}) => <String, dynamic>{
      'date': isoDay(now ?? DateTime.now()),
      'machine': '',
      'machineStatus': <dynamic>[],
      'workingMode': 'Working',
      'slot': 1,
      'item': '',
      for (final k in mfaTextFields) k: '',
      for (final k in mfaTimeFields) k: '',
      for (final k in mfaNumberFields) k: '',
    };

/// A saved record -> form values (typed fields as Strings).
Map<String, dynamic> mfaToFormValues(Map<String, dynamic> row, {DateTime? now}) {
  final out = <String, dynamic>{...mfaEmptyEntry(now: now)};
  for (final e in row.entries) {
    if (e.value != null) out[e.key] = e.value;
  }
  for (final k in [...mfaNumberFields, ...mfaTextFields, ...mfaTimeFields]) {
    final v = out[k];
    out[k] = v is String ? v : entryText(v);
  }
  out['item'] = jsTruthy(row['item']) ? '${row['item']}' : '';
  out['slot'] = row['slot'];
  // TOTAL QTY (an entry saved without it reads as OK + Rejected).
  out['actualQty'] = quantityFormValues(row)['actualQty'];
  out['plannedOperatorShiftHours'] = hoursToShiftInput(row['plannedOperatorShiftHours']);
  out['machineStatus'] = row['machineStatus'] is List ? List<dynamic>.from(row['machineStatus'] as List) : <dynamic>[];
  return out;
}

Object? _wire(double n) {
  if (!n.isFinite) return null;
  return n == n.truncateToDouble() && n.abs() < 1e15 ? n.toInt() : n;
}

double _numberOf(Map<String, dynamic> v, String key) => v.containsKey(key) ? jsToNumber(v[key]) : double.nan;
bool _blankOrMissing(Map<String, dynamic> v, String key) => !v.containsKey(key) || v[key] == '';

/// Form values -> the exact body of `PUT <api.row>`.
Map<String, dynamic> mfaToPayload(Map<String, dynamic> v, {required bool isEdit, required Object? processId}) {
  String text(String k) => jsTrim(jsString(v[k] ?? ''));
  final body = <String, dynamic>{
    if (isEdit && jsTruthy(v['_id'])) '_id': v['_id'],
    if (v.containsKey('date')) 'date': v['date'],
    if (v.containsKey('machine')) 'worker': v['machine'],
    'process': processId,
    'machineStatus': v['workingMode'] == 'Non Working'
        ? (jsTruthy(v['machineStatus']) ? v['machineStatus'] : <dynamic>[])
        : <dynamic>[],
    'workingMode': jsTruthy(v['workingMode']) ? v['workingMode'] : 'Working',
    'slot': isEdit ? _wire(_numberOf(v, 'slot')) : 'auto',
    'item': jsTruthy(v['item']) ? v['item'] : null,
    for (final k in mfaTextFields) k: text(k),
    // A remark only belongs to an "Other" idle time still in use.
    'otherMinRemark': jsToNumber(v['otherMin']) > 0 ? text('otherMinRemark') : '',
    for (final k in mfaTimeFields) k: v[k] ?? '',
    for (final k in mfaNumberFields) k: _blankOrMissing(v, k) ? '' : _wire(_numberOf(v, k)),
    'plannedOperatorShiftHours': () {
      final hours = parseShiftHours(v['plannedOperatorShiftHours']).hours;
      return hours == null ? '' : _wire(hmToWireHours(hours));
    }(),
    'lunchMin': _blankOrMissing(v, 'lunchMin') ? 0 : _wire(_numberOf(v, 'lunchMin')),
  };
  if (!mfaIsStatusOnly(v) && v['workingMode'] != 'Non Working') return body;
  return <String, dynamic>{
    for (final e in body.entries) e.key: _statusOnlyKeys.contains(e.key) ? e.value : (e.key == 'item' ? null : ''),
  };
}

bool _filled(Object? v) => v != null && v != '';

bool mfaHasAnyEntryData(List<Map<String, dynamic>> list) => list.any((v) {
      if (jsTruthy(v['machine'])) return true;
      return [...mfaTextFields, ...mfaTimeFields, ...mfaNumberFields].any((k) => _filled(v[k]));
    });

const List<String> _dataKeys = [
  'machineStatus',
  'itemName',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  'okQty',
  'otherActivity',
  'otherActivityMin',
  'plannedOperatorShiftHours',
  'lunchMin',
  'otherMin',
  'otherMinRemark',
  'remarks',
];

/// MfaEntryForm.jsx `hasData`.
bool mfaEntryHasData(Map<String, dynamic> v) =>
    v['workingMode'] == 'Non Working' || _dataKeys.any((k) => v[k] is List ? (v[k] as List).isNotEmpty : _filled(v[k]));

/// Picking a Part copies its Standard Assembly Time onto the block.
Map<String, dynamic> mfaApplyItemSelection(Map<String, dynamic> v, String itemId, List<Map<String, dynamic>> items) {
  if (itemId.isEmpty) return {...v, 'item': '', 'itemName': '', 'totalCycleSec': ''};
  Map<String, dynamic>? it;
  for (final c in items) {
    if ('${c['_id']}' == itemId) {
      it = c;
      break;
    }
  }
  if (it == null) return {...v, 'item': ''};
  return {...v, 'item': '${it['_id']}', 'itemName': '${it['itemName'] ?? ''}', 'totalCycleSec': entryText(it['totalCycleSec'])};
}

Map<String, dynamic> mfaNewBlockAfter(List<Map<String, dynamic>> list, {DateTime? now}) {
  final base = mfaEmptyEntry(now: now);
  final prev = list.isEmpty ? null : list.last['date'];
  if (jsTruthy(prev)) base['date'] = prev;
  return base;
}

Map<String, dynamic> mfaMergeDraft(Map<String, dynamic> draft, {DateTime? now}) {
  final out = <String, dynamic>{...mfaEmptyEntry(now: now), ...draft};
  out['machineStatus'] = draft['machineStatus'] is List ? List<dynamic>.from(draft['machineStatus'] as List) : <dynamic>[];
  return out;
}
