import '../../shared/production_sheet_calc.dart';
import '../../shared/shift_hours.dart';
import '../../sheet/editor/entry_editor_logic.dart' show numText;
import '../../sheet/sheet_model.dart';
import 'press_validation.dart';

/// The pure parts of client/src/pages/PressDataEntry.jsx: emptyEntry,
/// toFormValues, toPayload, hasAnyEntryData, withPart. A block is a map with the
/// web's exact keys; typed fields are Strings ('' = blank).

const List<String> pressTextFields = ['operator', 'itemName', 'operation', 'drawingNo', 'setupNo', 'remarks', 'otherMinRemark'];
const List<String> pressTimeFields = ['machineOnTime', 'machineOffTime'];

/// The ten stoppage keys (`STOPPAGE_FIELDS`).
final List<String> pressStoppageKeys = [for (final f in stoppageFields) f['key'] as String];

/// Every field sent as a number (blank stays '' so the server unsets it).
final List<String> pressNumberFields = [
  'standardTimeMin',
  'pcsPerStandardTime',
  'okQty',
  'rejectedQty',
  'plannedOperatorShiftHours',
  ...pressStoppageKeys,
];

/// A blank machine block dated today.
Json pressEmptyEntry({DateTime? now}) => <String, dynamic>{
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
      // Which of Standard Time Taken / No. Piece in Standard Time this entry shows
      // unticked — a per-entry note only, never changes the calculation.
      'excludedOps': <dynamic>[],
      for (final k in pressTextFields) k: '',
      for (final k in pressTimeFields) k: '',
      for (final k in pressNumberFields) k: '',
    };

/// A saved record -> form values ('' for anything unset, so inputs stay controlled).
Json pressToFormValues(Json row, {DateTime? now}) {
  final out = <String, dynamic>{...pressEmptyEntry(now: now)};
  for (final e in row.entries) {
    if (e.value != null) out[e.key] = e.value;
  }
  // Typed fields are Strings for the form widgets (a stored number becomes its text).
  for (final k in [...pressNumberFields, ...pressTextFields, ...pressTimeFields]) {
    final v = out[k];
    out[k] = v is String ? v : numText(v);
  }
  out['item'] = jsTruthy(row['item']) ? '${row['item']}' : '';
  out['slot'] = row['slot'];
  // A stored shift is decimal hours; the box shows it as H.MM (7.5 -> "7.30").
  out['plannedOperatorShiftHours'] = (row['plannedOperatorShiftHours'] == null || row['plannedOperatorShiftHours'] == '')
      ? ''
      : hoursToHmInput(jsToNumber(row['plannedOperatorShiftHours']));
  out['excludedOps'] = row['excludedOps'] is List ? List<dynamic>.from(row['excludedOps'] as List) : <dynamic>[];
  out['machineStatus'] = row['machineStatus'] is List ? List<dynamic>.from(row['machineStatus'] as List) : <dynamic>[];
  return out;
}

bool _blankNum(Object? v) => v == null || v == '';

/// Whole numbers go out as ints (60, not 60.0), exactly like JSON.stringify.
num _wire(double n) => n.isFinite && n == n.truncateToDouble() && n.abs() < 1e15 ? n.toInt() : n;

Object _numberOut(Object? v) {
  if (_blankNum(v)) return '';
  final n = jsToNumber(v);
  return n.isFinite ? _wire(n) : '';
}

// The server only accepts HH:mm; the form's own rules also accept "9:30" or
// "930", so a loosely typed time is normalised on the way out.
String _timeOut(Object? raw) {
  final s = jsString(raw ?? '');
  return normalizeTime(s) ?? s;
}

/// Form values -> the exact body of `PUT /press-sheet/row`. '' tells the server
/// to unset that field.
Json pressToPayload(Json v, {required bool isEdit}) {
  String text(String k) => jsTrim(jsString(v[k] ?? ''));
  List<dynamic> list(Object? x) => x is List ? List<dynamic>.from(x) : <dynamic>[];
  return <String, dynamic>{
    // Tells the server which exact document this edit belongs to, so changing
    // Date or Machine No. moves that document instead of creating a second one.
    if (isEdit && jsTruthy(v['_id'])) '_id': v['_id'],
    'date': v['date'],
    'machine': v['machine'],
    // Status belongs to a Non Working day only; a Working entry carries none.
    'machineStatus': v['workingMode'] == 'Non Working' ? list(v['machineStatus']) : <dynamic>[],
    'workingMode': jsTruthy(v['workingMode']) ? v['workingMode'] : 'Working',
    // An edited record saves back to its own slot; a new one asks the server for
    // the machine's next free slot on that date.
    'slot': isEdit ? _wire(jsToNumber(v['slot'])) : 'auto',
    'item': jsTruthy(v['item']) ? v['item'] : null,
    'vendor': jsTruthy(v['vendor']) ? v['vendor'] : null,
    'excludedOps': list(v['excludedOps']),
    for (final k in pressTextFields) k: text(k),
    // A remark only belongs to an "Others" that is still in use.
    'otherMinRemark': jsToNumber(v['otherMin']) > 0 ? text('otherMinRemark') : '',
    for (final k in pressTimeFields) k: _timeOut(v[k]),
    for (final k in pressNumberFields) k: _numberOut(v[k]),
    // Typed as H.MM, saved as decimal hours (3.30 -> 3.5).
    'plannedOperatorShiftHours': () {
      final hours = parseHm(v['plannedOperatorShiftHours']).hours;
      return hours == null ? '' : _wire(hmToWireHours(hours));
    }(),
    // Lunch is optional on the form; the server wants a 0 rather than nothing.
    'lunchMin': _blankNum(v['lunchMin']) ? 0 : _numberOut(v['lunchMin']),
  };
}

bool _filled(Object? v) => v != null && v != '';

/// True when any block carries something worth keeping as a draft.
bool pressHasAnyEntryData(List<Json> list) => list.any((v) {
      if (jsTruthy(v['machine'])) return true;
      return [...pressTextFields, ...pressTimeFields, ...pressNumberFields].any((k) => _filled(v[k]));
    });

/// The keys that count as "typed something" for a collapsed block's tint
/// (every card's fields except Date, Machine and the stoppage total).
const List<String> _dataKeys = [
  'operator',
  'machineStatus',
  'itemName',
  'operation',
  'setupNo',
  'machineOnTime',
  'machineOffTime',
  'okQty',
  'rejectedQty',
  'plannedOperatorShiftHours',
  'lunchMin',
  ...pressDowntimeKeys,
  'otherMinRemark',
  'remarks',
];

/// `hasData` of PressEntryForm.jsx: one block holds typed work.
bool pressEntryHasData(Json v) {
  if (v['workingMode'] == 'Non Working') return true;
  return _dataKeys.any((k) {
    final x = v[k];
    return x is List ? x.isNotEmpty : _filled(x);
  });
}

/// `withPart`: the Part's Drawing No. and standard time as an entry carries them
/// — still editable, so a later change to the master never rewrites saved
/// records. Operation and Setup No. are this entry's own.
Json pressApplyItemSelection(Json v, String itemId, List<Json> items) {
  if (itemId.isEmpty) return {...v, 'item': '', 'itemName': '', 'drawingNo': ''};
  Json? it;
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
    'standardTimeMin': numText(it['standardTimeMin']),
    'pcsPerStandardTime': numText(it['pcsPerStandardTime']),
    // A freshly (re)picked part starts with both ticked.
    'excludedOps': <dynamic>[],
  };
}

/// A new machine block copies the date of the block above it (the whole form is
/// normally one day's shift) — nothing else.
Json pressNewBlockAfter(List<Json> list, {DateTime? now}) {
  final base = pressEmptyEntry(now: now);
  final prev = list.isEmpty ? null : list.last['date'];
  if (jsTruthy(prev)) base['date'] = prev;
  return base;
}

/// A draft saved before a field existed lacks it — fill those in as blank (draft
/// values win) and keep the list fields list-shaped.
Json pressMergeDraftEntry(Json draft, {DateTime? now}) {
  final out = <String, dynamic>{...pressEmptyEntry(now: now), ...draft};
  out['excludedOps'] = draft['excludedOps'] is List ? List<dynamic>.from(draft['excludedOps'] as List) : <dynamic>[];
  out['machineStatus'] = draft['machineStatus'] is List ? List<dynamic>.from(draft['machineStatus'] as List) : <dynamic>[];
  return out;
}
