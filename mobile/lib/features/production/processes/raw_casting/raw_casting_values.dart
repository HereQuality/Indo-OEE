// The pure parts of client/src/pages/RawCastingDataEntry.jsx
// (emptyEntry, toFormValues, toPayload, hasAnyEntryData, the item-pick copy)
// and of Components/Production/RawCastingEntryForm.jsx (the per-block "has typed work"
// test). Widget-free so the golden tests can run them on their own.
//
// A block is a `Map<String, dynamic>` with the web's exact keys; typed fields
// are Strings ('' = blank). The worker's id sits in `machine` — the sheet's
// row key, kept where every sheet keeps it. The PUT body renames it to `worker`
// (api/rawCastingSheet.api.js saveRawCastingRow) and carries the process id.

import '../../entry_form/entry_form_logic.dart' show entryText;
import '../../shared/production_sheet_calc.dart';
import '../../shared/production_entry_validation.dart' show cleanSplit;
import '../../shared/shift_hours.dart';
import 'raw_casting_calc.dart';

const List<String> rawCastingTextFields = ['workingStatus', 'itemName', 'challanNo', 'otherActivity', 'remarks', 'otherMinRemark'];
const List<String> rawCastingTimeFields = ['machineOnTime', 'machineOffTime'];

const List<String> rawCastingNumberFields = ['totalCycleSec', 'actualQty', 'otherActivityMin', 'plannedOperatorShiftHours', 'lunchMin', 'otherMin'];

/// What a status-only day (ABSENT, SUNDAY, … or Non Working) keeps: the key
/// fields, its status and Remarks.
const List<String> _statusOnlyKept = ['workingStatus', 'workingMode', 'machineStatus', 'remarks'];
const List<String> _statusOnlyKeys = ['_id', 'date', 'worker', 'process', 'slot', ..._statusOnlyKept];

/// A blank worker block dated today.
Map<String, dynamic> rawCastingEmptyEntry({DateTime? now}) => <String, dynamic>{
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
      // Types of Defects: {defect: qty} over this sheet's own three.
      'rejectBreakdown': <String, dynamic>{},
      for (final k in rawCastingTextFields) k: '',
      for (final k in rawCastingTimeFields) k: '',
      for (final k in rawCastingNumberFields) k: '',
    };

/// A saved record -> form values ('' for anything unset, so inputs stay
/// controlled). Typed fields come out as Strings.
Map<String, dynamic> rawCastingToFormValues(Map<String, dynamic> row, {DateTime? now}) {
  final out = <String, dynamic>{...rawCastingEmptyEntry(now: now)};
  for (final e in row.entries) {
    if (e.value != null) out[e.key] = e.value;
  }
  for (final k in [...rawCastingNumberFields, ...rawCastingTextFields, ...rawCastingTimeFields]) {
    final v = out[k];
    out[k] = v is String ? v : entryText(v);
  }
  out['item'] = jsTruthy(row['item']) ? '${row['item']}' : '';
  // The vendor id (a populated vendor keeps its _id).
  final vendor = row['vendor'];
  out['vendor'] = vendor is Map ? '${vendor['_id'] ?? ''}' : (jsTruthy(vendor) ? '$vendor' : '');
  out['slot'] = row['slot'];
  // Only this sheet's own defect names, as the boxes show them.
  final split = row['rejectBreakdown'];
  out['rejectBreakdown'] = <String, dynamic>{
    for (final d in rawCastingDefects)
      if (split is Map && split[d] != null) d: jsString(split[d]),
  };
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

/// JS `Number(v[key])` — a key that is absent is `undefined` (NaN), a present
/// null is 0.
double _numberOf(Map<String, dynamic> v, String key) => v.containsKey(key) ? jsToNumber(v[key]) : double.nan;

bool _blankOrMissing(Map<String, dynamic> v, String key) => !v.containsKey(key) || v[key] == '';

/// Form values -> the exact body of `PUT <api.row>`. '' tells the server to
/// unset that field. [processId] is the process this page is linked to (a new
/// entry belongs to it; an edit keeps its own server-side).
Map<String, dynamic> rawCastingToPayload(Map<String, dynamic> v, {required bool isEdit, required Object? processId}) {
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
    for (final k in rawCastingTextFields) k: text(k),
    // A remark only belongs to an "Other" idle time still in use.
    'otherMinRemark': jsToNumber(v['otherMin']) > 0 ? text('otherMinRemark') : '',
    for (final k in rawCastingTimeFields) k: v[k] ?? '',
    for (final k in rawCastingNumberFields) k: _blankOrMissing(v, k) ? '' : _wire(_numberOf(v, k)),
    // Types of Defects, blanks and zeros dropped. OK QTY and Total Defects are
    // never sent — the server works them out from TOTAL QTY and these.
    'rejectBreakdown': {for (final e in cleanSplit(v['rejectBreakdown']).entries) e.key: _wire(e.value)},
    // Typed as decimal hours like the sheet, taken to the whole minute (5.33 -> 5 h 20 min).
    'plannedOperatorShiftHours': () {
      final hours = parseShiftHours(v['plannedOperatorShiftHours']).hours;
      return hours == null ? '' : _wire(hmToWireHours(hours));
    }(),
    // Lunch is optional on the form; the server wants a 0 rather than nothing.
    'lunchMin': _blankOrMissing(v, 'lunchMin') ? 0 : _wire(_numberOf(v, 'lunchMin')),
  };

  if (!rawCastingIsStatusOnly(v) && v['workingMode'] != 'Non Working') return body;
  // A status-only day keeps just its status and Remarks — anything typed in the
  // hidden work boxes before the status was picked is sent blank.
  return <String, dynamic>{
    for (final e in body.entries)
      e.key: _statusOnlyKeys.contains(e.key)
          ? e.value
          : e.key == 'item'
              ? null
              : e.key == 'rejectBreakdown'
                  ? <String, dynamic>{}
                  : '',
  };
}

bool _filled(Object? v) => v != null && v != '';

/// True when any block carries something worth keeping as a draft.
bool rawCastingHasAnyEntryData(List<Map<String, dynamic>> list) => list.any((v) {
      if (jsTruthy(v['machine'])) return true;
      final split = v['rejectBreakdown'];
      if (split is Map && split.values.any(_filled)) return true;
      return [...rawCastingTextFields, ...rawCastingTimeFields, ...rawCastingNumberFields].any((k) => _filled(v[k]));
    });

/// The keys that tell a collapsed block holding typing from an untouched one
/// (the form's LINES fields, less Date, Operator, the running total and the split).
const List<String> _dataKeys = [
  'machineStatus',
  'itemName',
  'vendor',
  'challanNo',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
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
bool rawCastingEntryHasData(Map<String, dynamic> v) {
  if (v['workingMode'] == 'Non Working') return true;
  if (_dataKeys.any((k) => v[k] is List ? (v[k] as List).isNotEmpty : _filled(v[k]))) return true;
  final split = v['rejectBreakdown'];
  return split is Map && split.values.any(_filled);
}

/// Picking a Part copies its Standard Inspection Time onto the block — still
/// editable, so a later change to the master never rewrites saved records.
Map<String, dynamic> rawCastingApplyItemSelection(Map<String, dynamic> v, String itemId, List<Map<String, dynamic>> items) {
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

/// A new block copies the date of the block above it — the whole form is
/// normally one day's work — but nothing else.
Map<String, dynamic> rawCastingNewBlockAfter(List<Map<String, dynamic>> list, {DateTime? now}) {
  final base = rawCastingEmptyEntry(now: now);
  final prev = list.isEmpty ? null : list.last['date'];
  if (jsTruthy(prev)) base['date'] = prev;
  return base;
}

/// A draft saved before a field existed lacks it — fill those in as blank.
Map<String, dynamic> rawCastingMergeDraft(Map<String, dynamic> draft, {DateTime? now}) {
  final out = <String, dynamic>{...rawCastingEmptyEntry(now: now), ...draft};
  out['machineStatus'] = draft['machineStatus'] is List ? List<dynamic>.from(draft['machineStatus'] as List) : <dynamic>[];
  final split = draft['rejectBreakdown'];
  out['rejectBreakdown'] = split is Map ? Map<String, dynamic>.from(split) : <String, dynamic>{};
  return out;
}
