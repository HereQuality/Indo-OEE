import '../entry_form/entry_form_logic.dart' show entryText, isBlankValue;
import '../shared/production_sheet_calc.dart';
import '../shared/shift_hours.dart';
import 'cnc_twin_calc.dart';

/// The pure parts of the Contact / Trobe / Spring pages' handlers (emptyEntry,
/// toFormValues, toPayload, hasAnyEntryData, the Part-pick copy) — the three
/// pages are identical in these. A block is a Map with the web's exact keys;
/// typed fields are Strings ('' = blank).

final List<String> twinStoppageKeys = [
  for (final f in stoppageFields) f['key'] as String,
];

const List<String> twinTextFields = [
  'operator',
  'workingStatus',
  'itemName',
  'drawingNo',
  'remarks',
  'otherMinRemark',
];
const List<String> twinTimeFields = [
  'machineOnTime',
  'machineOffTime',
  'settingOnTime',
  'settingOffTime',
];
final List<String> twinNumberFields = [
  'totalCycleSec',
  'okQty',
  'rejectedQty',
  'plannedOperatorShiftHours',
  ...twinStoppageKeys,
];

/// A status-only / Non Working day keeps just these (the rest is sent blank).
const List<String> _statusOnlyKept = [
  '_id',
  'date',
  'machine',
  'slot',
  'operator',
  'workingStatus',
  'workingMode',
  'machineStatus',
  'remarks',
];

/// Machine Working Status choices (web `WORKING_MODES` / `MACHINE_STATUSES`).
const List<String> twinWorkingModes = ['Working', 'Non Working'];
const List<String> twinMachineStatuses = [
  'Machine Breakdown',
  'No Manpower',
  'No Planning',
];

Map<String, dynamic> twinEmptyEntry({DateTime? now}) => <String, dynamic>{
  'date': isoDay(now ?? DateTime.now()),
  'machine': '',
  // Any of Machine Breakdown / No Manpower / No Planning (Non Working only).
  'machineStatus': <dynamic>[],
  'workingMode': 'Working',
  // Assigned on save from the machine's free slots for that date; kept only
  // because an edited record has to save back to its own slot.
  'slot': 1,
  'item': '',
  'vendor': '',
  'vendorName': '',
  for (final k in twinTextFields) k: '',
  for (final k in twinTimeFields) k: '',
  for (final k in twinNumberFields) k: '',
};

String _numText(Object? v) {
  if (v == null) return '';
  if (v is num) return v.isFinite ? jsNumStr(v) : '';
  return v.toString();
}

/// A saved record -> form values ('' for anything unset).
Map<String, dynamic> twinToFormValues(
  Map<String, dynamic> row, {
  DateTime? now,
}) {
  final out = <String, dynamic>{...twinEmptyEntry(now: now)};
  for (final e in row.entries) {
    if (e.value != null) out[e.key] = e.value;
  }
  for (final k in [
    ...twinNumberFields,
    ...twinTextFields,
    ...twinTimeFields,
    'vendor',
    'vendorName',
  ]) {
    final v = out[k];
    out[k] = v is String ? v : _numText(v);
  }
  out['plannedOperatorShiftHours'] =
      isBlankValue(row['plannedOperatorShiftHours'])
      ? ''
      : hoursToHmInput(jsToNumber(row['plannedOperatorShiftHours']));
  out['item'] = jsTruthy(row['item']) ? '${row['item']}' : '';
  out['slot'] = row['slot'];
  out['machineStatus'] = row['machineStatus'] is List
      ? List<dynamic>.from(row['machineStatus'] as List)
      : <dynamic>[];
  out['workingMode'] = row['workingMode'] == 'Non Working'
      ? 'Non Working'
      : 'Working';
  return out;
}

/// Whole numbers go out as ints (60, not 60.0), exactly like JSON.stringify.
num _wire(double n) =>
    n.isFinite && n == n.truncateToDouble() && n.abs() < 1e15 ? n.toInt() : n;

Object _numberOut(Object? v) {
  if (isBlankValue(v)) return '';
  final n = jsToNumber(v);
  return n.isFinite ? _wire(n) : '';
}

/// Form values -> the exact body of `PUT <sheet>/row`. '' tells the server to
/// unset a field.
Map<String, dynamic> twinToPayload(
  Map<String, dynamic> v, {
  required bool isEdit,
}) {
  String text(String k) => jsTrim(jsString(v[k] ?? ''));
  final nonWorking = twinIsNonWorking(v);
  final body = <String, dynamic>{
    if (isEdit && jsTruthy(v['_id'])) '_id': v['_id'],
    'date': v['date'],
    'machine': v['machine'],
    // Status belongs to a Non Working day only; a Working entry carries none.
    'machineStatus': nonWorking
        ? (v['machineStatus'] is List
              ? List<dynamic>.from(v['machineStatus'] as List)
              : <dynamic>[])
        : <dynamic>[],
    'workingMode': jsTruthy(v['workingMode']) ? v['workingMode'] : 'Working',
    // An edited record saves back to its own slot; a new one asks the server for
    // the machine's next free slot on that date.
    'slot': isEdit ? _wire(jsToNumber(v['slot'])) : 'auto',
    'item': jsTruthy(v['item']) ? v['item'] : null,
    'vendor': jsTruthy(v['vendor']) ? v['vendor'] : null,
    for (final k in twinTextFields) k: text(k),
    // A remark only belongs to an "Others" that is still in use.
    'otherMinRemark': jsToNumber(v['otherMin']) > 0
        ? text('otherMinRemark')
        : '',
    for (final k in twinTimeFields) k: _timeOut(v[k]),
    for (final k in twinNumberFields) k: _numberOut(v[k]),
    // Typed as H.MM, saved as decimal hours (3.30 -> 3.5).
    'plannedOperatorShiftHours': () {
      final hours = parseHm(v['plannedOperatorShiftHours']).hours;
      return hours == null ? '' : _wire(hmToWireHours(hours));
    }(),
    // Lunch is optional on the form; the server wants a 0 rather than nothing.
    'lunchMin': isBlankValue(v['lunchMin']) ? 0 : _numberOut(v['lunchMin']),
  };
  if (!twinIsStatusOnly(v) && !nonWorking) return body;
  return {
    for (final e in body.entries)
      e.key: _statusOnlyKept.contains(e.key)
          ? e.value
          : (e.key == 'item' ? null : ''),
  };
}

// The server only accepts HH:mm; a loosely typed time is normalised on the way out.
String _timeOut(Object? raw) {
  final s = jsString(raw ?? '');
  return normalizeTime(s) ?? s;
}

bool _filled(Object? v) => v != null && v != '';

/// True when any block carries something worth keeping as a draft.
bool twinHasAnyEntryData(List<Map<String, dynamic>> list) => list.any(
  (v) =>
      jsTruthy(v['machine']) ||
      [
        ...twinTextFields,
        ...twinTimeFields,
        ...twinNumberFields,
      ].any((k) => _filled(v[k])),
);

const List<String> _blockDataKeys = [
  'operator',
  'machineStatus',
  'itemName',
  'totalCycleSec',
  'machineOnTime',
  'machineOffTime',
  'okQty',
  'rejectedQty',
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
bool twinEntryHasData(Map<String, dynamic> v) =>
    twinIsNonWorking(v) ||
    _blockDataKeys.any(
      (k) => v[k] is List ? (v[k] as List).isNotEmpty : _filled(v[k]),
    );

/// Picking a Part copies its Drawing No. and Total Cycle Time onto the block —
/// the cycle only a starting value, editable for the day.
Map<String, dynamic> twinApplyItemSelection(
  Map<String, dynamic> v,
  String itemId,
  List<Map<String, dynamic>> items,
) {
  if (itemId.isEmpty) {
    return {
      ...v,
      'item': '',
      'itemName': '',
      'drawingNo': '',
      'totalCycleSec': '',
    };
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
    'totalCycleSec': _numText(it['totalCycleSec']),
  };
}

/// A new machine block copies the date of the block above it — nothing else.
Map<String, dynamic> twinNewBlockAfter(
  List<Map<String, dynamic>> list, {
  DateTime? now,
}) {
  final base = twinEmptyEntry(now: now);
  final prev = list.isEmpty ? null : list.last['date'];
  if (jsTruthy(prev)) base['date'] = prev;
  return base;
}

/// A draft saved before a field existed lacks it — fill those in as blank.
Map<String, dynamic> twinMergeDraftEntry(
  Map<String, dynamic> draft, {
  DateTime? now,
}) {
  final out = <String, dynamic>{...twinEmptyEntry(now: now), ...draft};
  out['machineStatus'] = draft['machineStatus'] is List
      ? List<dynamic>.from(draft['machineStatus'] as List)
      : <dynamic>[];
  return out;
}

String twinText(Object? v) => entryText(v);
