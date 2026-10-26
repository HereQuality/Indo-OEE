// The pure parts of client/src/pages/PrintingDataEntry.jsx (emptyEntry,
// toFormValues, toPayload, hasAnyEntryData, the item-pick copy) and of
// Components/Production/PrintingEntryForm.jsx (the per-block "has typed work"
// test). Widget-free so the golden tests can run them on their own.
//
// A block is a `Map<String, dynamic>` with the web's exact keys; typed fields
// are Strings ('' = blank). The operator's id sits in `machine` — the sheet's
// row key, kept where every sheet keeps it. The PUT body renames it to `worker`
// (api/printingSheet.api.js savePrintingRow) and carries the process id. The
// optional MC No. travels as `mcMachine`.

import '../../entry_form/entry_form_logic.dart' show entryText;
import '../../shared/production_sheet_calc.dart';
import '../../shared/quantity_rules.dart' show quantityFormValues;
import '../../shared/shift_hours.dart';
import 'printing_calc.dart';

const List<String> printingTextFields = ['workingStatus', 'itemName', 'remarks', 'otherMinRemark'];
const List<String> printingTimeFields = ['machineOnTime', 'machineOffTime'];

/// Every field sent as a number — every downtime box may stay blank.
final List<String> printingNumberFields = [
  'totalCycleSec',
  'actualQty',
  'okQty',
  'plannedOperatorShiftHours',
  ...printingStoppageKeys,
];

/// What a Non Working (or older status-only) day keeps: just its status and Remarks.
const List<String> _statusOnlyKept = ['workingStatus', 'workingMode', 'machineStatus', 'remarks'];
const List<String> _statusOnlyKeys = ['_id', 'date', 'worker', 'process', 'slot', ..._statusOnlyKept];

/// A blank operator block dated today.
Map<String, dynamic> printingEmptyEntry({DateTime? now}) => <String, dynamic>{
      'date': isoDay(now ?? DateTime.now()),
      // The operator's id — this sheet's row key, kept where every sheet keeps it.
      'machine': '',
      // MC No. — optional, one of this process's machines.
      'mcMachine': '',
      // Reasons For Not Working — any of the shared list, on a Non Working day.
      'machineStatus': <dynamic>[],
      // Working (default) or Non Working.
      'workingMode': 'Working',
      // Assigned on save from the operator's free slots for that date; kept in the
      // values only because an edited record has to save back to its own slot.
      'slot': 1,
      'item': '',
      'vendor': '',
      'vendorName': '',
      for (final k in printingTextFields) k: '',
      for (final k in printingTimeFields) k: '',
      for (final k in printingNumberFields) k: '',
    };

/// A saved record -> form values ('' for anything unset, so inputs stay
/// controlled). Typed fields come out as Strings.
Map<String, dynamic> printingToFormValues(Map<String, dynamic> row, {DateTime? now}) {
  final out = <String, dynamic>{...printingEmptyEntry(now: now)};
  for (final e in row.entries) {
    if (e.value != null) out[e.key] = e.value;
  }
  for (final k in [...printingNumberFields, ...printingTextFields, ...printingTimeFields]) {
    final v = out[k];
    out[k] = v is String ? v : entryText(v);
  }
  out['item'] = jsTruthy(row['item']) ? '${row['item']}' : '';
  // The vendor id (a populated vendor keeps its _id).
  final vendor = row['vendor'];
  out['vendor'] = vendor is Map ? '${vendor['_id'] ?? ''}' : (jsTruthy(vendor) ? '$vendor' : '');
  out['mcMachine'] = jsTruthy(row['mcMachine']) ? '${row['mcMachine']}' : '';
  out['slot'] = row['slot'];
  // TOTAL QTY (an entry saved without it reads as OK + Rejected).
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

/// JS `Number(v[key])` — a key that is absent is `undefined` (NaN), a present
/// null is 0.
double _numberOf(Map<String, dynamic> v, String key) => v.containsKey(key) ? jsToNumber(v[key]) : double.nan;

bool _blankOrMissing(Map<String, dynamic> v, String key) => !v.containsKey(key) || v[key] == '';

/// Form values -> the exact body of `PUT <api.row>`. '' tells the server to
/// unset that field. [processId] is the process this page is linked to (a new
/// entry belongs to it; an edit keeps its own server-side).
Map<String, dynamic> printingToPayload(Map<String, dynamic> v, {required bool isEdit, required Object? processId}) {
  String text(String k) => jsTrim(jsString(v[k] ?? ''));

  final body = <String, dynamic>{
    // Tells the server which exact document this edit belongs to — absent on a new entry.
    if (isEdit && jsTruthy(v['_id'])) '_id': v['_id'],
    // (An absent key is `undefined` on the web and never reaches the wire.)
    if (v.containsKey('date')) 'date': v['date'],
    // The operator, as the API names it.
    if (v.containsKey('machine')) 'worker': v['machine'],
    'process': processId,
    'mcMachine': jsTruthy(v['mcMachine']) ? v['mcMachine'] : '',
    'vendor': jsTruthy(v['vendor']) ? v['vendor'] : '',
    // Reasons belong to a Non Working day only; a Working entry carries none.
    'machineStatus': v['workingMode'] == 'Non Working'
        ? (jsTruthy(v['machineStatus']) ? v['machineStatus'] : <dynamic>[])
        : <dynamic>[],
    'workingMode': jsTruthy(v['workingMode']) ? v['workingMode'] : 'Working',
    // An edited record saves back to its own slot; a new one asks the server
    // for the operator's next free slot on that date.
    'slot': isEdit ? _wire(_numberOf(v, 'slot')) : 'auto',
    'item': jsTruthy(v['item']) ? v['item'] : null,
    for (final k in printingTextFields) k: text(k),
    // A remark only belongs to an "Other" downtime still in use.
    'otherMinRemark': jsToNumber(v['otherMin']) > 0 ? text('otherMinRemark') : '',
    for (final k in printingTimeFields) k: v[k] ?? '',
    for (final k in printingNumberFields) k: _blankOrMissing(v, k) ? '' : _wire(_numberOf(v, k)),
    // Typed as decimal hours like the sheet, taken to the whole minute (5.33 -> 5 h 20 min).
    'plannedOperatorShiftHours': () {
      final hours = parseShiftHours(v['plannedOperatorShiftHours']).hours;
      return hours == null ? '' : _wire(hmToWireHours(hours));
    }(),
    // Lunch is optional on the form; the server wants a 0 rather than nothing.
    'lunchMin': _blankOrMissing(v, 'lunchMin') ? 0 : _wire(_numberOf(v, 'lunchMin')),
  };

  if (!isStatusOnly(v) && v['workingMode'] != 'Non Working') return body;
  // A Non Working (or status-only) day keeps just its status and Remarks —
  // anything typed in the hidden work boxes before is sent blank.
  return <String, dynamic>{
    for (final e in body.entries)
      e.key: _statusOnlyKeys.contains(e.key) ? e.value : (e.key == 'item' ? null : ''),
  };
}

bool _filled(Object? v) => v != null && v != '';

/// True when any block carries something worth keeping as a draft.
bool printingHasAnyEntryData(List<Map<String, dynamic>> list) => list.any((v) {
      if (jsTruthy(v['machine']) || jsTruthy(v['mcMachine'])) return true;
      return [...printingTextFields, ...printingTimeFields, ...printingNumberFields].any((k) => _filled(v[k]));
    });

/// The keys that tell a collapsed block holding typing from an untouched one
/// (every field of the form's lines but Date, Operator and the running total).
final List<String> _dataKeys = [
  'machineStatus',
  'mcMachine',
  'itemName',
  'vendor',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'actualQty',
  'okQty',
  'plannedOperatorShiftHours',
  ...printingStoppageKeys,
  'otherMinRemark',
  'remarks',
];

/// The form's per-block "has typed work" test (a collapsed block's tint, the
/// remove confirmation).
bool printingEntryHasData(Map<String, dynamic> v) =>
    v['workingMode'] == 'Non Working' ||
    _dataKeys.any((k) => v[k] is List ? (v[k] as List).isNotEmpty : _filled(v[k]));

/// Picking a Part copies its Standard Time per Piece onto the block — still
/// editable, so a later change to the master never rewrites saved records.
Map<String, dynamic> printingApplyItemSelection(Map<String, dynamic> v, String itemId, List<Map<String, dynamic>> items) {
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

/// A new block copies the date of the block above it — nothing else.
Map<String, dynamic> printingNewBlockAfter(List<Map<String, dynamic>> list, {DateTime? now}) {
  final base = printingEmptyEntry(now: now);
  final prev = list.isEmpty ? null : list.last['date'];
  if (jsTruthy(prev)) base['date'] = prev;
  return base;
}

/// A draft saved before a field existed lacks it — fill those in as blank.
Map<String, dynamic> printingMergeDraft(Map<String, dynamic> draft, {DateTime? now}) {
  final out = <String, dynamic>{...printingEmptyEntry(now: now), ...draft};
  out['machineStatus'] = draft['machineStatus'] is List ? List<dynamic>.from(draft['machineStatus'] as List) : <dynamic>[];
  return out;
}
