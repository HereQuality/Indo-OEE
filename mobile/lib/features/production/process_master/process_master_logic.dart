import '../dashboard/dashboard_engine.dart' as eng;
import '../dashboard/data/dashboard_models.dart' show machineProcessId;
import '../shared/planned_shift.dart' show lockedShiftHours;
import '../shared/production_sheet_calc.dart' show jsNumStr, jsToNumber;

// Pure rules of the Process Master form: a port of the helpers inside
// client/src/pages/ProcessMaster.jsx (initialState, openEdit's mapping,
// validate, payload, machineOptions and the table's cell texts).

typedef Json = Map<String, dynamic>;

/// Web `initialState`. `plannedShiftHours` is the box text.
Json initialProcessValues() => {
  'processName': '',
  'description': '',
  'machineIds': <String>[],
  'stats': List<String>.of(eng.defaultStats),
  'charts': List<String>.of(eng.defaultCharts),
  // The sidebar page this process's data entry happens on (its menuUrl), and its
  // label — kept so a non-admin can still see what it is linked to.
  'dataEntryMenu': '',
  'dataEntryMenuLabel': '',
  'plannedShiftLocked': true,
  'plannedShiftHours': jsNumStr(lockedShiftHours),
  'isActive': true,
};

/// Web `openEdit`: the form values of a saved process (`GET /processes/:id`).
Json valuesFromProcess(Json p) {
  final machines = p['machines'];
  final hours = p['plannedShiftHours'];
  return {
    'processName': '${p['processName'] ?? ''}',
    'description': '${p['description'] ?? ''}',
    'machineIds': [
      if (machines is List)
        for (final m in machines)
          if (m is Map) '${m['_id']}',
    ],
    'stats': [for (final w in eng.resolveWidgets(p['stats'], eng.statsByKey, eng.defaultStats)) w['key'] as String],
    'charts': [for (final w in eng.resolveWidgets(p['charts'], eng.chartsByKey, eng.defaultCharts)) w['key'] as String],
    'dataEntryMenu': '${p['dataEntryMenu'] ?? ''}',
    'dataEntryMenuLabel': '${p['dataEntryMenuLabel'] ?? ''}',
    'plannedShiftLocked': p['plannedShiftLocked'] != false,
    'plannedShiftHours': hours == null ? jsNumStr(lockedShiftHours) : (hours is num ? jsNumStr(hours) : '$hours'),
    'isActive': p['isActive'] != false,
  };
}

/// Web `validate` (same messages). Keys: processName, description, plannedShiftHours.
Map<String, String> validateProcess(Json v) {
  final errors = <String, String>{};
  final name = '${v['processName'] ?? ''}';
  if (name.trim().isEmpty) {
    errors['processName'] = 'Process name is required!';
  } else if (name.length > 40) {
    errors['processName'] = 'Process name must not exceed 40 characters';
  }
  final description = '${v['description'] ?? ''}';
  if (description.isNotEmpty && description.length > 200) {
    errors['description'] = 'Description must not exceed 200 characters';
  }
  if (v['plannedShiftLocked'] == true) {
    final raw = '${v['plannedShiftHours'] ?? ''}';
    final h = jsToNumber(raw);
    if (raw == '' || !h.isFinite || h <= 0 || h > 24) {
      errors['plannedShiftHours'] = 'Shift hours must be more than 0 and at most 24';
    }
  }
  return errors;
}

/// Web `payload()`: the body of POST /processes and PUT /processes/:id.
Json processPayload(Json v) {
  final raw = '${v['plannedShiftHours'] ?? ''}';
  final hours = raw == '' ? lockedShiftHours : jsToNumber(raw);
  return {
    ...v,
    'processName': '${v['processName'] ?? ''}'.trim(),
    'plannedShiftLocked': v['plannedShiftLocked'] != false,
    'plannedShiftHours': hours == hours.truncateToDouble() && hours.isFinite ? hours.toInt() : hours,
  };
}

/// The machines the picker offers (web `machineOptions`): free ones, those
/// already in THIS process, and those whose process has since been deactivated
/// (no dashboard shows it). [editingId] is '' while adding.
List<Json> machineChoices(List<Json> machines, List<Json> activeProcesses, String editingId) {
  final activeIds = {for (final p in activeProcesses) '${p['_id']}'};
  return [
    for (final m in machines)
      if (machineProcessId(m).isEmpty || machineProcessId(m) == editingId || !activeIds.contains(machineProcessId(m))) m,
  ];
}

/// "9 KPI tiles · 6 graphs" (table column "Dashboard").
String dashboardSummary(Json row) {
  final s = eng.resolveWidgets(row['stats'], eng.statsByKey, eng.defaultStats).length;
  final c = eng.resolveWidgets(row['charts'], eng.chartsByKey, eng.defaultCharts).length;
  return '$s KPI tiles · $c graphs';
}

/// Table column "Planned Shift".
String plannedShiftText(Json row) {
  if (row['plannedShiftLocked'] == false) return 'Unlocked · manual';
  final h = row['plannedShiftHours'] ?? lockedShiftHours;
  return 'Locked · ${h is num ? jsNumStr(h) : h} hr';
}

/// A saved process's machine names for the table ("None assigned" when empty).
List<String> machineNamesOf(Json row) {
  final m = row['machines'];
  return [
    if (m is List)
      for (final x in m)
        if (x is Map) '${x['machineName'] ?? ''}',
  ];
}
