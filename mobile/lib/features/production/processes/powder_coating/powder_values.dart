// The pure parts of client/src/pages/PowderCoatingDataEntry.jsx (emptyEntry,
// toFormValues, toPayload, hasAnyEntryData, the item-pick copy) and of
// Components/Production/PowderCoatingEntryForm.jsx (the per-block "has typed
// work" test). Widget-free so the golden tests can run them on their own.
//
// A block is a `Map<String, dynamic>` with the web's exact keys; typed fields
// are Strings ('' = blank). The worker's id sits in `machine` — the sheet's row
// key, kept where every sheet keeps it. The PUT body renames it to `worker`
// (api/powderCoatingSheet.api.js savePowderRow) and carries the process id.

import '../../entry_form/entry_form_logic.dart' show entryText;
import '../../shared/production_sheet_calc.dart';
import '../../shared/shift_hours.dart';
import 'powder_calc.dart';

const List<String> powderTextFields = ['workingStatus', 'itemName', 'otherActivity', 'remarks', 'otherMinRemark'];
const List<String> powderTimeFields = ['machineOnTime', 'machineOffTime'];
final List<String> powderNumberFields = [
  'totalCycleSec',
  'actualQty',
  ...powderDefectKeys,
  'otherActivityMin',
  'plannedOperatorShiftHours',
  'lunchMin',
  'otherMin',
];

/// What the form clears or keeps for a status-only day (ABSENT, SUNDAY, … or
/// Non Working): just the key fields, the status and Remarks.
const List<String> _statusOnlyKept = ['workingStatus', 'workingMode', 'machineStatus', 'remarks'];
const List<String> _statusOnlyKeys = ['_id', 'date', 'worker', 'process', 'slot', ..._statusOnlyKept];

/// A blank worker block dated today.
Map<String, dynamic> powderEmptyEntry({DateTime? now}) => <String, dynamic>{
      'date': isoDay(now ?? DateTime.now()),
      // The worker's id — this sheet's row key, kept where every sheet keeps it.
      'machine': '',
      // Reasons For Not Working — any of the shared list, on a Non Working day.
      'machineStatus': <dynamic>[],
      // Working (default) or Non Working.
      'workingMode': 'Working',
      // Assigned on save from the worker's free slots for that date; kept in the
      // values only because an edited record has to save back to its own slot.
      'slot': 1,
      'item': '',
      'vendor': '',
      'vendorName': '',
      for (final k in powderTextFields) k: '',
      for (final k in powderTimeFields) k: '',
      for (final k in powderNumberFields) k: '',
    };

/// A stored number as the text a form box shows.
String _text(Object? v) => entryText(v);

/// A saved record -> form values ('' for anything unset, so inputs stay
/// controlled). Typed fields come out as Strings.
Map<String, dynamic> powderToFormValues(Map<String, dynamic> row, {DateTime? now}) {
  final out = <String, dynamic>{...powderEmptyEntry(now: now)};
  for (final e in row.entries) {
    if (e.value != null) out[e.key] = e.value;
  }
  for (final k in [...powderNumberFields, ...powderTextFields, ...powderTimeFields]) {
    final v = out[k];
    out[k] = v is String ? v : _text(v);
  }
  out['item'] = jsTruthy(row['item']) ? '${row['item']}' : '';
  // The vendor id (a populated vendor keeps its _id).
  final vendor = row['vendor'];
  out['vendor'] = vendor is Map ? '${vendor['_id'] ?? ''}' : (jsTruthy(vendor) ? '$vendor' : '');
  out['slot'] = row['slot'];
  // A stored shift is decimal hours; the box shows it as H.MM (7.5 -> "7.30").
  out['plannedOperatorShiftHours'] = hoursToHmInput(row['plannedOperatorShiftHours']);
  out['machineStatus'] = row['machineStatus'] is List ? List<dynamic>.from(row['machineStatus'] as List) : <dynamic>[];
  return out;
}

/// Whole numbers go out as ints (60, not 60.0), exactly like JSON.stringify;
/// NaN / Infinity go out as null (what JSON.stringify makes of them).
Object? _wire(double n) {
  if (!n.isFinite) return null;
  return n == n.truncateToDouble() && n.abs() < 1e15 ? n.toInt() : n;
}

/// JS `Number(v[key])` — a key that is absent is `undefined` (NaN), a present
/// null is 0.
double _numberOf(Map<String, dynamic> v, String key) => v.containsKey(key) ? jsToNumber(v[key]) : double.nan;

bool _blankOrMissing(Map<String, dynamic> v, String key) => !v.containsKey(key) || v[key] == '';

/// Form values -> the exact body of `PUT <api.row>`. '' tells the server to
/// unset that field. [processId] is the process this page is linked to (a new
/// entry belongs to it; an edit keeps its own server-side).
Map<String, dynamic> powderToPayload(Map<String, dynamic> v, {required bool isEdit, required Object? processId}) {
  String text(String k) => jsTrim(jsString(v[k] ?? ''));

  final body = <String, dynamic>{
    // Tells the server which exact document this edit belongs to — absent on a new entry.
    if (isEdit && jsTruthy(v['_id'])) '_id': v['_id'],
    // (An absent key is `undefined` on the web and never reaches the wire.)
    if (v.containsKey('date')) 'date': v['date'],
    // The worker, as the API names it.
    if (v.containsKey('machine')) 'worker': v['machine'],
    'process': processId,
    'vendor': jsTruthy(v['vendor']) ? v['vendor'] : '',
    // Reasons belong to a Non Working day only; a Working entry carries none.
    'machineStatus': v['workingMode'] == 'Non Working'
        ? (jsTruthy(v['machineStatus']) ? v['machineStatus'] : <dynamic>[])
        : <dynamic>[],
    'workingMode': jsTruthy(v['workingMode']) ? v['workingMode'] : 'Working',
    // An edited record saves back to its own slot; a new one asks the server
    // for the worker's next free slot on that date.
    'slot': isEdit ? _wire(_numberOf(v, 'slot')) : 'auto',
    'item': jsTruthy(v['item']) ? v['item'] : null,
    for (final k in powderTextFields) k: text(k),
    // A remark only belongs to an "Other" idle time still in use.
    'otherMinRemark': jsToNumber(v['otherMin']) > 0 ? text('otherMinRemark') : '',
    for (final k in powderTimeFields) k: v[k] ?? '',
    for (final k in powderNumberFields) k: _blankOrMissing(v, k) ? '' : _wire(_numberOf(v, k)),
    // Typed as H.MM, saved as decimal hours (3.30 -> 3.5).
    'plannedOperatorShiftHours': () {
      final hours = parseHm(v['plannedOperatorShiftHours']).hours;
      return hours == null ? '' : _wire(hmToWireHours(hours));
    }(),
    // Lunch is optional on the form; the server wants a 0 rather than nothing.
    'lunchMin': _blankOrMissing(v, 'lunchMin') ? 0 : _wire(_numberOf(v, 'lunchMin')),
  };

  if (!isStatusOnly(v) && v['workingMode'] != 'Non Working') return body;
  // A status-only day keeps just its status and Remarks — anything typed in the
  // hidden inspection boxes before the status was picked is sent blank.
  return <String, dynamic>{
    for (final e in body.entries)
      e.key: _statusOnlyKeys.contains(e.key) ? e.value : (e.key == 'item' ? null : ''),
  };
}

bool _filled(Object? v) => v != null && v != '';

/// True when any block carries something worth keeping as a draft.
bool powderHasAnyEntryData(List<Map<String, dynamic>> list) => list.any((v) {
      if (jsTruthy(v['machine'])) return true;
      return [...powderTextFields, ...powderTimeFields, ...powderNumberFields].any((k) => _filled(v[k]));
    });

/// The keys that tell a collapsed block holding typing from an untouched one.
final List<String> _dataKeys = [
  'machineStatus',
  'itemName',
  'vendor',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  ...powderDefectKeys,
  'otherActivity',
  'otherActivityMin',
  'plannedOperatorShiftHours',
  'lunchMin',
  'otherMin',
  'otherMinRemark',
  'remarks',
];

/// The form's per-block "has typed work" test (a collapsed block's tint, the
/// remove confirmation).
bool powderEntryHasData(Map<String, dynamic> v) =>
    v['workingMode'] == 'Non Working' ||
    _dataKeys.any((k) => v[k] is List ? (v[k] as List).isNotEmpty : _filled(v[k]));

/// Picking a Part copies its Standard Inspection Time onto the block — still
/// editable, so a later change to the master never rewrites saved records.
Map<String, dynamic> powderApplyItemSelection(Map<String, dynamic> v, String itemId, List<Map<String, dynamic>> items) {
  if (itemId.isEmpty) return {...v, 'item': '', 'itemName': '', 'totalCycleSec': ''};
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
    'totalCycleSec': _text(it['totalCycleSec']),
  };
}

/// A new worker block copies the date of the block above it — nothing else.
Map<String, dynamic> powderNewBlockAfter(List<Map<String, dynamic>> list, {DateTime? now}) {
  final base = powderEmptyEntry(now: now);
  final prev = list.isEmpty ? null : list.last['date'];
  if (jsTruthy(prev)) base['date'] = prev;
  return base;
}

/// A draft saved before a field existed lacks it — fill those in as blank.
Map<String, dynamic> powderMergeDraft(Map<String, dynamic> draft, {DateTime? now}) {
  final out = <String, dynamic>{...powderEmptyEntry(now: now), ...draft};
  out['machineStatus'] = draft['machineStatus'] is List ? List<dynamic>.from(draft['machineStatus'] as List) : <dynamic>[];
  return out;
}
