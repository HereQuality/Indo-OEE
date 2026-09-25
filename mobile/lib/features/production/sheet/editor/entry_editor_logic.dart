import '../../shared/production_entry_validation.dart';
import '../../shared/production_sheet_calc.dart';

/// State helpers of the Production Data Entry form — a port of the pure parts
/// of client/src/pages/ProductionSheet.jsx (emptyEntry, toFormValues,
/// toPayload, hasAnyEntryData, the item-pick copy). Kept free of widgets so they
/// can be tested on their own.
///
/// An "entry" is one machine block of the form: a `Map<String, dynamic>` with
/// the exact JS keys. Typed fields are Strings ('' = blank); `rejectBreakdown`
/// is a `Map<String, dynamic>` of reason -> quantity text; `excludedOps` a list
/// of operation keys.

final List<String> stoppageKeys = [for (final f in stoppageFields) f['key'] as String];
final List<String> cycleOpKeys = [for (final f in cycleOpFields) f['key'] as String];

const List<String> textFields = ['operator', 'itemName', 'drawingNo', 'remarks', 'rejectOtherRemark', 'otherMinRemark'];
const List<String> timeFields = ['machineOnTime', 'machineOffTime'];

/// Every field sent as a number (blank stays '' so the server unsets it).
final List<String> numberFields = [
  'actualQty',
  'okQty',
  'plannedOperatorShiftHours',
  'totalCycleSec',
  ...stoppageKeys,
  ...cycleOpKeys,
];

/// A blank machine block dated today.
Map<String, dynamic> emptyEntry({DateTime? now}) => <String, dynamic>{
      'date': isoDay(now ?? DateTime.now()),
      'machine': '',
      // Assigned on save from the machine's free slots for that date; kept in
      // the values only because an edited record has to save back to its own slot.
      'slot': 1,
      'item': '',
      'rejectBreakdown': <String, dynamic>{},
      // Operations this entry has unticked out of what its Part carries.
      'excludedOps': <dynamic>[],
      for (final k in textFields) k: '',
      for (final k in timeFields) k: '',
      for (final k in numberFields) k: '',
    };

/// A stored number as the text a form box shows: 90 -> '90', 12.5 -> '12.5',
/// null -> ''.
String numText(Object? v) {
  if (v == null) return '';
  if (v is num) return v.isFinite ? jsNumStr(v) : '';
  return v.toString();
}

bool _isBlankValue(Object? v) => v == null || v == '';

/// Whole numbers go out as ints (60, not 60.0), exactly like JSON.stringify.
num _wire(double n) => n.isFinite && n == n.truncateToDouble() && n.abs() < 1e15 ? n.toInt() : n;

/// A saved record -> form values ('' for anything unset, so inputs stay
/// controlled). A record saved before the split existed has only a single
/// rejectReason: its rejected pieces are put against that reason so editing it
/// does not look like the reason was lost.
Map<String, dynamic> toFormValues(Map<String, dynamic> row, {DateTime? now}) {
  final out = <String, dynamic>{...emptyEntry(now: now)};
  for (final e in row.entries) {
    if (e.value != null) out[e.key] = e.value;
  }
  // Typed fields are Strings for the form widgets (a stored number becomes its text).
  for (final k in [...numberFields, ...textFields, ...timeFields]) {
    final v = out[k];
    out[k] = v is String ? v : numText(v);
  }
  out['item'] = jsTruthy(row['item']) ? '${row['item']}' : '';
  out['slot'] = row['slot'];
  out['excludedOps'] = row['excludedOps'] is List ? List<dynamic>.from(row['excludedOps'] as List) : <dynamic>[];

  final stored = row['rejectBreakdown'];
  final split = <String, dynamic>{};
  if (stored is Map && stored.isNotEmpty) {
    for (final e in stored.entries) {
      if (rejectReasons.contains(e.key)) split['${e.key}'] = numText(e.value);
    }
  } else {
    final rejected = jsToNumber(row['rejectedQty']);
    final reason = row['rejectReason'];
    if (reason is String && rejectReasons.contains(reason) && rejected.isFinite && rejected > 0) {
      split[reason] = numText(rejected);
    }
  }
  out['rejectBreakdown'] = split;
  return out;
}

/// Form values -> the exact body of PUT /production-sheet/row. '' tells the
/// server to unset that field. rejectedQty is deliberately absent: the server
/// derives it from Actual − OK.
Map<String, dynamic> toPayload(Map<String, dynamic> v, {required bool isEdit}) {
  final split = cleanSplit(v['rejectBreakdown']);
  // The entries table and older records still carry one reason per entry, so the
  // biggest contributor in the split is saved there too (the first wins a tie,
  // like JS's stable sort).
  var topReason = '';
  var best = double.negativeInfinity;
  for (final e in split.entries) {
    if (e.value > best) {
      best = e.value;
      topReason = e.key;
    }
  }

  String text(String k) => jsString(v[k] ?? '').trim();

  return <String, dynamic>{
    'date': v['date'],
    'machine': v['machine'],
    // An edited record saves back to its own slot; a new one asks the server for
    // the machine's next free slot on that date, since only the server can see
    // every entry.
    'slot': isEdit ? _wire(jsToNumber(v['slot'])) : 'auto',
    'item': jsTruthy(v['item']) ? v['item'] : null,
    'excludedOps': v['excludedOps'] is List ? List<dynamic>.from(v['excludedOps'] as List) : <dynamic>[],
    'rejectBreakdown': {for (final e in split.entries) e.key: _wire(e.value)},
    'rejectReason': topReason,
    for (final k in textFields) k: text(k),
    // A remark only belongs to an "Other" that is still in use — once that
    // figure goes back to zero the remark is cleared with it.
    'rejectOtherRemark': (split['Other'] ?? 0) > 0 ? text('rejectOtherRemark') : '',
    'otherMinRemark': jsToNumber(v['otherMin']) > 0 ? text('otherMinRemark') : '',
    for (final k in timeFields) k: _timeOut(v[k]),
    for (final k in numberFields) k: _numberOut(v[k]),
  };
}

// The server only accepts HH:mm; the form's own rules also accept "9:30" or
// "930", so a loosely typed time is normalised on the way out.
String _timeOut(Object? raw) {
  final s = jsString(raw ?? '');
  return normalizeTime(s) ?? s;
}

Object _numberOut(Object? v) {
  if (_isBlankValue(v)) return '';
  final n = jsToNumber(v);
  return n.isFinite ? _wire(n) : '';
}

bool _filled(Object? v) => v != null && v != '';

/// True when any block carries something worth keeping as a draft.
bool hasAnyEntryData(List<Map<String, dynamic>> list) {
  return list.any((v) {
    if (jsTruthy(v['machine']) ||
        jsTruthy(v['operator']) ||
        jsTruthy(v['itemName']) ||
        jsTruthy(v['drawingNo']) ||
        jsTruthy(v['remarks'])) {
      return true;
    }
    if (jsTruthy(v['machineOnTime']) || jsTruthy(v['machineOffTime']) || _filled(v['plannedOperatorShiftHours'])) return true;
    if (_filled(v['actualQty']) || _filled(v['okQty'])) return true;
    final split = v['rejectBreakdown'];
    if (split is Map && split.values.any((n) => _filled(n) && jsToNumber(n) != 0)) return true;
    return [...stoppageKeys, ...cycleOpKeys].any((k) => _filled(v[k]));
  });
}

/// Picking an item copies its master values onto the block — still editable,
/// so a later change to the master never rewrites saved records. A freshly
/// picked part starts with every operation ticked (excludedOps cleared).
Map<String, dynamic> applyItemSelection(Map<String, dynamic> v, String itemId, List<Map<String, dynamic>> items) {
  if (itemId.isEmpty) return {...v, 'item': '', 'itemName': '', 'excludedOps': <dynamic>[]};
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
    'drawingNo': '${it['drawingNo'] ?? ''}',
    // The item's own Total Cycle Time and operation times: locked to the item,
    // picked up again next time the part is (re)selected.
    'totalCycleSec': numText(it['totalCycleSec']),
    'excludedOps': <dynamic>[],
    for (final k in cycleOpKeys) k: numText(it[k]),
  };
}

/// A new machine block copies the date of the block above it (the whole form
/// is normally one day's shift) — nothing else.
Map<String, dynamic> newBlockAfter(List<Map<String, dynamic>> list, {DateTime? now}) {
  final base = emptyEntry(now: now);
  final prev = list.isEmpty ? null : list.last['date'];
  if (jsTruthy(prev)) base['date'] = prev;
  return base;
}

/// A draft saved before a field existed lacks it — fill those in as blank
/// (draft values win), and make sure the two structured fields keep their shape.
Map<String, dynamic> mergeDraftEntry(Map<String, dynamic> draft, {DateTime? now}) {
  final out = <String, dynamic>{...emptyEntry(now: now), ...draft};
  final split = draft['rejectBreakdown'];
  out['rejectBreakdown'] = split is Map ? Map<String, dynamic>.from(split) : <String, dynamic>{};
  final ops = draft['excludedOps'];
  out['excludedOps'] = ops is List ? List<dynamic>.from(ops) : <dynamic>[];
  return out;
}
