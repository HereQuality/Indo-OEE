import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';

/// The sheet key the machine-day-status API uses for a process spec key
/// (the same keys the web's bulk actions use).
String dayStatusSheetKey(String specKey) => switch (specKey) {
      'final-assembly' => 'finalAssembly',
      'powder-coating' => 'powder',
      'raw-casting' => 'rawCasting',
      _ => specKey,
    };

/// One "Not running" reason the server offers.
class DayStatusReason {
  const DayStatusReason({required this.value, required this.label, required this.kind});

  factory DayStatusReason.fromJson(Map<String, dynamic> j) => DayStatusReason(
        value: '${j['value'] ?? ''}',
        label: '${j['label'] ?? j['value'] ?? ''}',
        kind: '${j['kind'] ?? ''}',
      );

  final String value;
  final String label;

  /// "planned" | "unplanned".
  final String kind;

  bool get needsRemarks => value == 'other';

  /// Used until the server answers (or when it cannot be reached).
  static const List<DayStatusReason> fallback = [
    DayStatusReason(value: 'holiday', label: 'Holiday', kind: 'planned'),
    DayStatusReason(value: 'noOrder', label: 'No order', kind: 'planned'),
    DayStatusReason(value: 'maintenance', label: 'Planned maintenance', kind: 'planned'),
    DayStatusReason(value: 'breakdown', label: 'Breakdown', kind: 'unplanned'),
    DayStatusReason(value: 'noOperator', label: 'No operator', kind: 'unplanned'),
    DayStatusReason(value: 'noMaterial', label: 'No material', kind: 'unplanned'),
    DayStatusReason(value: 'power', label: 'Power cut', kind: 'unplanned'),
    DayStatusReason(value: 'other', label: 'Other', kind: 'unplanned'),
  ];
}

/// A saved "Not running" mark for one machine (or worker sheet day) on a date.
class DayMark {
  const DayMark({
    required this.date,
    required this.machine,
    required this.reason,
    this.reasons = const [],
    required this.reasonLabel,
    required this.kind,
    required this.remarks,
    required this.markedBy,
    this.locked = false,
  });

  factory DayMark.fromJson(Map<String, dynamic> j) {
    final by = j['markedBy'];
    final byName = by is Map ? '${by['name'] ?? by['username'] ?? by['userName'] ?? ''}' : '${by ?? ''}';
    final date = '${j['date'] ?? ''}';
    return DayMark(
      date: date.length >= 10 ? date.substring(0, 10) : date,
      machine: '${j['machine'] ?? ''}',
      reason: '${j['reason'] ?? ''}',
      reasons: j['reasons'] is List
          ? [for (final r in j['reasons'] as List) if (r != null && '$r'.isNotEmpty) '$r']
          : [if ('${j['reason'] ?? ''}'.isNotEmpty) '${j['reason']}'],
      reasonLabel: '${j['reasonLabel'] ?? j['reason'] ?? ''}',
      kind: '${j['kind'] ?? ''}',
      remarks: '${j['remarks'] ?? ''}',
      markedBy: byName,
      locked: j['locked'] == true,
    );
  }

  final String date;
  final String machine;
  final String reason;

  /// Every reason picked (multi-select); old marks carry just [reason].
  final List<String> reasons;
  final String reasonLabel;
  final String kind;
  final String remarks;
  final String markedBy;

  /// Past the day it was saved on: only an Admin may edit or undo it.
  final bool locked;

  String get key => markKey(date, machine);
}

String markKey(String date, String machine) => '$date|$machine';

/// The four calls of /machine-day-status.
class DayStatusRepository {
  const DayStatusRepository(this.sheet);

  /// The API's sheet key (see [dayStatusSheetKey]).
  final String sheet;

  Future<List<DayStatusReason>> reasons() async {
    final res = await Api.get(Endpoints.machineDayStatusReasons);
    return [for (final r in asList(res)) DayStatusReason.fromJson(r)].where((r) => r.value.isNotEmpty).toList();
  }

  Future<List<DayMark>> marks(String from, String to) async {
    final res = await Api.get(Endpoints.machineDayStatus, query: {'sheet': sheet, 'from': from, 'to': to});
    return [for (final r in asList(res)) DayMark.fromJson(r)];
  }

  /// Marks [machines] (one, or several at once) not running on [date].
  Future<String?> save({required String date, required List<String> machines, required List<String> reasons, required String remarks}) async {
    final res = await Api.put(Endpoints.machineDayStatus, body: {
      'sheet': sheet,
      'date': date,
      if (machines.length == 1) 'machine': machines.first else 'machines': machines,
      'reasons': reasons,
      'remarks': remarks,
    });
    final msg = res['message'];
    return msg is String && msg.isNotEmpty ? msg : null;
  }

  Future<void> remove({required String date, required String machine}) =>
      Api.delete(Endpoints.machineDayStatus, body: {'sheet': sheet, 'date': date, 'machine': machine});
}


/// The Remarks text after the reason pick changes from [prev] to [next]
/// labels: the auto prefix (labels joined ", ") is swapped in place, or put
/// in front of what was typed with " — ".
String autoRemarks(String remarks, List<String> prev, List<String> next) {
  final prevAuto = prev.join(', ');
  final nextAuto = next.join(', ');
  if (prevAuto.isNotEmpty && remarks.startsWith(prevAuto)) {
    final rest = remarks.substring(prevAuto.length);
    if (nextAuto.isEmpty) return rest.startsWith(' — ') ? rest.substring(3) : rest.trimLeft();
    return nextAuto + rest;
  }
  if (nextAuto.isEmpty) return remarks;
  return nextAuto + (remarks.isNotEmpty ? ' — $remarks' : '');
}
