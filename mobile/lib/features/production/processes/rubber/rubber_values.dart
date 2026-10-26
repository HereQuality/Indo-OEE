// The pure parts of client/src/pages/RubberDataEntry.jsx (emptyEntry,
// toFormValues, toPayload, hasAnyEntryData, the part-pick copy, drafts) and of
// Components/Production/RubberEntryForm.jsx (the per-block "has typed work"
// test). Widget-free so the golden tests can run them on their own.
//
// A block is a `Map<String, dynamic>` with the web's exact keys; typed fields
// are Strings ('' = blank). The worker's id sits in `machine` — the sheet's row
// key, kept where every sheet keeps it. The PUT body renames it to `worker`
// (api/rubberSheet.api.js saveRubberRow) and carries the process id.

import '../../entry_form/entry_form_logic.dart' show entryText;
import '../../shared/production_sheet_calc.dart';
import '../../shared/quantity_rules.dart';
import '../../shared/shift_hours.dart';
import 'rubber_calc.dart';

const List<String> rubberTextFields = ['workingStatus', 'itemName', 'remarks', 'otherMinRemark', 'rejectOtherRemark'];
const List<String> rubberTimeFields = ['machineOnTime', 'machineOffTime'];

/// Rejected Quantity and every stoppage box may stay blank.
final List<String> rubberNumberFields = [
  'totalCycleSec',
  'actualQty',
  'okQty',
  'plannedOperatorShiftHours',
  ...rubberMinuteKeys,
];

/// What the form clears or keeps for a status-only day (ABSENT, SUNDAY, … or
/// Non Working): just the key fields, the status and Remarks.
const List<String> _statusOnlyKept = ['workingStatus', 'workingMode', 'machineStatus', 'remarks'];
const List<String> _statusOnlyKeys = ['_id', 'date', 'worker', 'process', 'slot', ..._statusOnlyKept];

/// A blank worker block dated today.
Map<String, dynamic> rubberEmptyEntry({DateTime? now}) => <String, dynamic>{
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
      // Rejection Master: {reason: qty} — the rejected pieces split across the reject reasons.
      'rejectBreakdown': <String, dynamic>{},
      for (final k in rubberTextFields) k: '',
      for (final k in rubberTimeFields) k: '',
      for (final k in rubberNumberFields) k: '',
    };

/// A saved record -> form values ('' for anything unset, so inputs stay
/// controlled). Typed fields come out as Strings.
Map<String, dynamic> rubberToFormValues(Map<String, dynamic> row, {DateTime? now}) {
  final out = <String, dynamic>{...rubberEmptyEntry(now: now)};
  for (final e in row.entries) {
    if (e.value != null) out[e.key] = e.value;
  }
  for (final k in [...rubberNumberFields, ...rubberTextFields, ...rubberTimeFields]) {
    final v = out[k];
    out[k] = v is String ? v : entryText(v);
  }
  out['item'] = jsTruthy(row['item']) ? '${row['item']}' : '';
  // The vendor id (a populated vendor keeps its _id).
  final vendor = row['vendor'];
  out['vendor'] = vendor is Map ? '${vendor['_id'] ?? ''}' : (jsTruthy(vendor) ? '$vendor' : '');
  out['slot'] = row['slot'];
  // Actual Quantity and the Rejection Master split (an entry saved before they
  // existed reads as OK + Rejected).
  out.addAll(quantityFormValues(row));
  // A stored shift is decimal hours; the box shows it as typed (5 h 20 min -> "5.33").
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

/// JS `Number(v[key])` — a key that is absent is `undefined` (NaN), a present
/// null is 0.
double _numberOf(Map<String, dynamic> v, String key) => v.containsKey(key) ? jsToNumber(v[key]) : double.nan;

bool _blankOrMissing(Map<String, dynamic> v, String key) => !v.containsKey(key) || v[key] == '';

/// Form values -> the exact body of `PUT <api.row>`. '' tells the server to
/// unset that field. [processId] is the process this page is linked to (a new
/// entry belongs to it; an edit keeps its own server-side).
Map<String, dynamic> rubberToPayload(Map<String, dynamic> v, {required bool isEdit, required Object? processId}) {
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
    for (final k in rubberTextFields) k: text(k),
    // A remark only belongs to an "Others" stoppage still in use.
    'otherMinRemark': jsToNumber(v['otherMin']) > 0 ? text('otherMinRemark') : '',
    for (final k in rubberTimeFields) k: v[k] ?? '',
    for (final k in rubberNumberFields) k: _blankOrMissing(v, k) ? '' : _wire(_numberOf(v, k)),
    // Rejection Master split + its "Other" remark. rejectedQty is never sent —
    // the server works it out (Actual − OK).
    ...rejectPayload(v, _wire),
    // Typed as decimal hours like the sheet, taken to the whole minute (5.33 -> 5 h 20 min).
    'plannedOperatorShiftHours': () {
      final hours = parseShiftHours(v['plannedOperatorShiftHours']).hours;
      return hours == null ? '' : _wire(hmToWireHours(hours));
    }(),
    // Lunch is optional on the form; the server wants a 0 rather than nothing.
    'lunchMin': _blankOrMissing(v, 'lunchMin') ? 0 : _wire(_numberOf(v, 'lunchMin')),
  };

  if (!rubberIsStatusOnly(v) && v['workingMode'] != 'Non Working') return body;
  // A status-only day keeps just its status and Remarks — anything typed in the
  // hidden work boxes before the status was picked is sent blank.
  return <String, dynamic>{
    for (final e in body.entries)
      e.key: _statusOnlyKeys.contains(e.key)
          ? e.value
          : (e.key == 'item' ? null : (e.key == 'rejectBreakdown' ? <String, dynamic>{} : '')),
  };
}

bool _filled(Object? v) => v != null && v != '';

/// True when any block carries something worth keeping as a draft.
bool rubberHasAnyEntryData(List<Map<String, dynamic>> list) => list.any((v) {
      if (jsTruthy(v['machine'])) return true;
      if (hasRejectData(v)) return true;
      return [...rubberTextFields, ...rubberTimeFields, ...rubberNumberFields].any((k) => _filled(v[k]));
    });

/// The keys that tell a collapsed block holding typing from an untouched one
/// (RubberEntryForm.jsx DATA_KEYS: every line's fields but date, worker, the
/// stoppage total and the split, which is looked at on its own).
final List<String> _dataKeys = [
  'machineStatus',
  'itemName',
  'vendor',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  'okQty',
  'plannedOperatorShiftHours',
  'lunchMin',
  for (final k in rubberMinuteKeys)
    if (k != 'lunchMin') k,
  'otherMinRemark',
  'remarks',
  'rejectOtherRemark',
];

/// The form's per-block "has typed work" test (a collapsed block's tint, the
/// remove confirmation). Any Rejection Master box with something in it counts,
/// a 0 included.
bool rubberEntryHasData(Map<String, dynamic> v) {
  if (v['workingMode'] == 'Non Working') return true;
  if (_dataKeys.any((k) => v[k] is List ? (v[k] as List).isNotEmpty : _filled(v[k]))) return true;
  final split = v['rejectBreakdown'];
  return split is Map && split.values.any(_filled);
}

/// Picking a Part copies its Total Cycle Time onto the block — still editable,
/// so a later change to the master never rewrites saved records.
Map<String, dynamic> rubberApplyItemSelection(Map<String, dynamic> v, String itemId, List<Map<String, dynamic>> items) {
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
    'totalCycleSec': entryText(it['totalCycleSec']),
  };
}

/// A new worker block copies the date of the block above it — nothing else.
Map<String, dynamic> rubberNewBlockAfter(List<Map<String, dynamic>> list, {DateTime? now}) {
  final base = rubberEmptyEntry(now: now);
  final prev = list.isEmpty ? null : list.last['date'];
  if (jsTruthy(prev)) base['date'] = prev;
  return base;
}

/// A draft saved before a field existed lacks it — fill those in as blank.
Map<String, dynamic> rubberMergeDraft(Map<String, dynamic> draft, {DateTime? now}) {
  final out = <String, dynamic>{...rubberEmptyEntry(now: now), ...draft};
  out['machineStatus'] = draft['machineStatus'] is List ? List<dynamic>.from(draft['machineStatus'] as List) : <dynamic>[];
  final split = draft['rejectBreakdown'];
  out['rejectBreakdown'] = split is Map ? Map<String, dynamic>.from(split) : <String, dynamic>{};
  return out;
}
