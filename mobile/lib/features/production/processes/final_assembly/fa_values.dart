// The pure parts of client/src/pages/FinalAssemblyDataEntry.jsx (emptyEntry,
// toFormValues, toPayload, hasAnyEntryData, the item-pick copy) and of
// Components/Production/FinalAssemblyEntryForm.jsx (the per-block "has typed
// work" test). Widget-free so the golden tests can run them on their own.
//
// The worker's id sits in `machine`; the PUT body renames it to `worker`
// (api/finalAssemblySheet.api.js) and carries the process id. The Types of
// Defects live in `rejectBreakdown` (reason -> quantity text).

import '../../entry_form/entry_form_logic.dart' show entryText;
import '../../shared/production_sheet_calc.dart';
import '../../shared/quantity_rules.dart' show hasRejectData, quantityFormValues, rejectPayload;
import '../../shared/shift_hours.dart';
import 'fa_calc.dart';

const List<String> faTextFields = ['workingStatus', 'itemName', 'otherActivity', 'remarks', 'otherMinRemark', 'rejectOtherRemark'];
const List<String> faTimeFields = ['machineOnTime', 'machineOffTime'];
const List<String> faNumberFields = ['totalCycleSec', 'actualQty', 'otherActivityMin', 'plannedOperatorShiftHours', 'lunchMin', 'otherMin'];

const List<String> _statusOnlyKept = ['workingStatus', 'workingMode', 'machineStatus', 'remarks'];
const List<String> _statusOnlyKeys = ['_id', 'date', 'worker', 'process', 'slot', ..._statusOnlyKept];

/// A blank worker block dated today.
Map<String, dynamic> faEmptyEntry({DateTime? now}) => <String, dynamic>{
      'date': isoDay(now ?? DateTime.now()),
      'machine': '',
      'machineStatus': <dynamic>[],
      'workingMode': 'Working',
      'slot': 1,
      'item': '',
      'vendor': '',
      'vendorName': '',
      'rejectBreakdown': <String, dynamic>{},
      for (final k in faTextFields) k: '',
      for (final k in faTimeFields) k: '',
      for (final k in faNumberFields) k: '',
    };

/// A saved record -> form values (typed fields as text).
Map<String, dynamic> faToFormValues(Map<String, dynamic> row, {DateTime? now}) {
  final out = <String, dynamic>{...faEmptyEntry(now: now)};
  for (final e in row.entries) {
    if (e.value != null) out[e.key] = e.value;
  }
  for (final k in [...faNumberFields, ...faTextFields, ...faTimeFields]) {
    final v = out[k];
    out[k] = v is String ? v : entryText(v);
  }
  out['item'] = jsTruthy(row['item']) ? '${row['item']}' : '';
  final vendor = row['vendor'];
  out['vendor'] = vendor is Map ? '${vendor['_id'] ?? ''}' : (jsTruthy(vendor) ? '$vendor' : '');
  out['slot'] = row['slot'];
  // TOTAL QTY (an entry saved without it reads as OK + Rejected) and the defects by reason.
  out.addAll(quantityFormValues(row, faDefectReasons));
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

/// JS reads a list's entries by index (`Object.entries`): a `rejectBreakdown`
/// that arrives as a list is split under "0", "1", … as the web's cleanSplit does.
Map<String, dynamic> _splitAsMap(Map<String, dynamic> v) {
  final rb = v['rejectBreakdown'];
  if (rb is! List) return v;
  return {...v, 'rejectBreakdown': {for (var i = 0; i < rb.length; i++) '$i': rb[i]}};
}

/// Form values -> the exact body of `PUT <api.row>`.
Map<String, dynamic> faToPayload(Map<String, dynamic> v, {required bool isEdit, required Object? processId}) {
  String text(String k) => jsTrim(jsString(v[k] ?? ''));

  final body = <String, dynamic>{
    if (isEdit && jsTruthy(v['_id'])) '_id': v['_id'],
    if (v.containsKey('date')) 'date': v['date'],
    if (v.containsKey('machine')) 'worker': v['machine'],
    'process': processId,
    'vendor': jsTruthy(v['vendor']) ? v['vendor'] : '',
    'machineStatus': v['workingMode'] == 'Non Working'
        ? (jsTruthy(v['machineStatus']) ? v['machineStatus'] : <dynamic>[])
        : <dynamic>[],
    'workingMode': jsTruthy(v['workingMode']) ? v['workingMode'] : 'Working',
    'slot': isEdit ? _wire(_numberOf(v, 'slot')) : 'auto',
    'item': jsTruthy(v['item']) ? v['item'] : null,
    for (final k in faTextFields) k: text(k),
    'otherMinRemark': jsToNumber(v['otherMin']) > 0 ? text('otherMinRemark') : '',
    for (final k in faTimeFields) k: v[k] ?? '',
    for (final k in faNumberFields) k: _blankOrMissing(v, k) ? '' : _wire(_numberOf(v, k)),
    // The defects by reason (blanks dropped), the biggest as rejectReason, the
    // "Other" remark only while Other is in use.
    ...rejectPayload(_splitAsMap(v), _wire),
    'plannedOperatorShiftHours': () {
      final hours = parseShiftHours(v['plannedOperatorShiftHours']).hours;
      return hours == null ? '' : _wire(hmToWireHours(hours));
    }(),
    'lunchMin': _blankOrMissing(v, 'lunchMin') ? 0 : _wire(_numberOf(v, 'lunchMin')),
  };

  if (!isStatusOnly(v) && v['workingMode'] != 'Non Working') return body;
  return <String, dynamic>{
    for (final e in body.entries)
      e.key: _statusOnlyKeys.contains(e.key)
          ? e.value
          : (e.key == 'item' ? null : (e.key == 'rejectBreakdown' ? <String, dynamic>{} : '')),
  };
}

bool _filled(Object? v) => v != null && v != '';

/// True when any block carries something worth keeping as a draft.
bool faHasAnyEntryData(List<Map<String, dynamic>> list) => list.any((v) {
      if (jsTruthy(v['machine'])) return true;
      if (hasRejectData(v)) return true;
      return [...faTextFields, ...faTimeFields, ...faNumberFields].any((k) => _filled(v[k]));
    });

const List<String> _dataKeys = [
  'machineStatus',
  'itemName',
  'vendor',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  'rejectOtherRemark',
  'otherActivity',
  'otherActivityMin',
  'plannedOperatorShiftHours',
  'lunchMin',
  'otherMin',
  'otherMinRemark',
  'remarks',
];

/// The form's per-block "has typed work" test.
bool faEntryHasData(Map<String, dynamic> v) {
  if (v['workingMode'] == 'Non Working') return true;
  if (_dataKeys.any((k) => v[k] is List ? (v[k] as List).isNotEmpty : _filled(v[k]))) return true;
  final rb = v['rejectBreakdown'];
  return rb is Map && rb.values.any(_filled);
}

/// Picking a Part copies its Standard Time per Piece onto the block.
Map<String, dynamic> faApplyItemSelection(Map<String, dynamic> v, String itemId, List<Map<String, dynamic>> items) {
  if (itemId.isEmpty) return {...v, 'item': '', 'itemName': '', 'totalCycleSec': ''};
  Map<String, dynamic>? it;
  for (final candidate in items) {
    if ('${candidate['_id']}' == itemId) {
      it = candidate;
      break;
    }
  }
  if (it == null) return {...v, 'item': ''};
  return {...v, 'item': '${it['_id']}', 'itemName': '${it['itemName'] ?? ''}', 'totalCycleSec': entryText(it['totalCycleSec'])};
}

/// A new block copies the date of the block above it — nothing else.
Map<String, dynamic> faNewBlockAfter(List<Map<String, dynamic>> list, {DateTime? now}) {
  final base = faEmptyEntry(now: now);
  final prev = list.isEmpty ? null : list.last['date'];
  if (jsTruthy(prev)) base['date'] = prev;
  return base;
}

/// A draft saved before a field existed lacks it — fill those in as blank.
Map<String, dynamic> faMergeDraft(Map<String, dynamic> draft, {DateTime? now}) {
  final out = <String, dynamic>{...faEmptyEntry(now: now), ...draft};
  out['machineStatus'] = draft['machineStatus'] is List ? List<dynamic>.from(draft['machineStatus'] as List) : <dynamic>[];
  out['rejectBreakdown'] = draft['rejectBreakdown'] is Map ? Map<String, dynamic>.from(draft['rejectBreakdown'] as Map) : <String, dynamic>{};
  return out;
}
