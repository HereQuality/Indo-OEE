import '../../shared/production_entry_validation.dart';
import '../../shared/production_sheet_calc.dart';

/// State helpers of the Production Data Entry form — a port of the pure
/// parts of client/src/pages/ProductionSheet.jsx (emptyEntry, toFormValues,
/// toPayload, hasAnyEntryData, the item-pick copy). Kept free of widgets so
/// they can be tested on their own.
///
/// An "entry" is one machine block of the form: a `Map<String, dynamic>` with
/// the exact JS keys. Typed fields are Strings ('' = blank); [rejectBreakdown]
/// is a `Map<String, dynamic>` of reason -> quantity text; [excludedOps] a list
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

/// A number as the text a form box shows: 90 -> '90', 12.5 -> '12.5', null -> ''.
String numText(dynamic v) {
  if (v == null) return '';
  if (v is num) {
    if (v is double && !v.isFinite) return '';
    return v == v.truncateToDouble() ? v.toInt().toString() : v.toString();
  }
  return v.toString();
}

/// JS `Number(v)` for form text: '' -> 0, blanks -> 0, junk -> NaN.
double jsNumber(dynamic v) {
  if (v == null) return 0;
  if (v is num) return v.toDouble();
  final s = v.toString().trim();
  if (s.isEmpty) return 0;
  return double.tryParse(s) ?? double.nan;
}

bool _isBlankValue(dynamic v) => v == null || v == '';

/// Whole numbers go out as ints (60, not 60.0), exactly like JSON.stringify.
num _wire(num n) => n is double && n.isFinite && n == n.truncateToDouble() && n.abs() < 1e15 ? n.toInt() : n;

/// A saved record -> form values ('' for anything unset, so inputs stay
/// controlled). A record saved before the split existed has only a single
/// rejectReason: its rejected pieces are put against that reason.
Map<String, dynamic> toFormValues(Map<String, dynamic> row, {DateTime? now}) {
  final base = emptyEntry(now: now);
  final out = <String, dynamic>{...base};
  for (final e in row.entries) {
    if (e.value == null) continue;
    out[e.key] = e.value;
  }
  // Typed fields are Strings for the form widgets.
  for (final k in numberFields) {
    out[k] = numText(out[k]);
  }
  for (final k in [...textFields, ...timeFields]) {
    out[k] = out[k] is String ? out[k] : numText(out[k]);
  }
  out['item'] = (row['item'] ?? '').toString();
  out['slot'] = row['slot'];
  out['excludedOps'] = row['excludedOps'] is List ? List<dynamic>.from(row['excludedOps'] as List) : <dynamic>[];

  final stored = row['rejectBreakdown'];
  final split = <String, dynamic>{};
  if (stored is Map && stored.isNotEmpty) {
    for (final e in stored.entries) {
      if (rejectReasons.contains(e.key)) split[e.key.toString()] = numText(e.value);
    }
  } else {
    final rejected = jsNumber(row['rejectedQty']);
    final reason = row['rejectReason'];
    if (reason is String && reason.isNotEmpty && rejectReasons.contains(reason) && rejected.isFinite && rejected > 0) {
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
  final split = cleanSplit(v['rejectBreakdown'] as Map?);
  // The entries table and older records still carry one reason per entry, so the
  // biggest contributor in the split is saved there too (first wins a tie).
  String topReason = '';
  num best = double.negativeInfinity;
  for (final e in split.entries) {
    final n = e.value as num;
    if (n > best) {
      best = n;
      topReason = e.key;
    }
  }

  String text(String k) => (v[k] ?? '').toString().trim();
  final otherRejected = (split['Other'] as num?) ?? 0;

  return <String, dynamic>{
    'date': v['date'],
    'machine': v['machine'],
    // An edited record saves back to its own slot; a new one asks the server for
    // the machine's next free slot on that date.
    'slot': isEdit ? _wire(jsNumber(v['slot'])) : 'auto',
    'item': _isBlankValue(v['item']) ? null : v['item'],
    'excludedOps': v['excludedOps'] is List ? List<dynamic>.from(v['excludedOps'] as List) : <dynamic>[],
    'rejectBreakdown': {for (final e in split.entries) e.key: _wire(e.value as num)},
    'rejectReason': topReason,
    for (final k in textFields) k: text(k),
    // A remark only belongs to an "Other" that is still in use.
    'rejectOtherRemark': otherRejected > 0 ? text('rejectOtherRemark') : '',
    'otherMinRemark': jsNumber(v['otherMin']) > 0 ? text('otherMinRemark') : '',
    for (final k in timeFields) k: _timeOut(v[k]),
    for (final k in numberFields) k: _numberOut(v[k]),
  };
}

// The server only accepts HH:mm; the form's own rules accept "9:30" or "930",
// so a loosely typed time is normalised on the way out.
String _timeOut(dynamic raw) {
  final s = (raw ?? '').toString();
  return normalizeTime(s) ?? s;
}

dynamic _numberOut(dynamic v) {
  if (_isBlankValue(v)) return '';
  final n = jsNumber(v);
  return n.isFinite ? _wire(n) : '';
}

bool _filled(dynamic v) => v != null && v != '';

/// True when any block carries something worth keeping as a draft.
bool hasAnyEntryData(List<Map<String, dynamic>> list) {
  bool truthy(dynamic x) => x != null && x.toString().isNotEmpty;
  return list.any((v) {
    if (truthy(v['machine']) || truthy(v['operator']) || truthy(v['itemName']) || truthy(v['drawingNo']) || truthy(v['remarks'])) {
      return true;
    }
    if (truthy(v['machineOnTime']) || truthy(v['machineOffTime']) || _filled(v['plannedOperatorShiftHours'])) return true;
    if (_filled(v['actualQty']) || _filled(v['okQty'])) return true;
    final split = v['rejectBreakdown'];
    if (split is Map && split.values.any((n) => _filled(n) && jsNumber(n) != 0)) return true;
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
    'itemName': (it['itemName'] ?? '').toString(),
    'drawingNo': (it['drawingNo'] ?? '').toString(),
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
  if (prev is String && prev.isNotEmpty) base['date'] = prev;
  return base;
}
