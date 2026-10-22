import 'production_sheet_calc.dart' show jsToNumber;
import 'shift_hours.dart' show hoursToHmInput;

/// The Operator Planned Shift a machine's entries must use, from its process
/// (Process Master) — a port of client/src/utils/plannedShift.js (and the rule
/// in server/utils/plannedShift.js, which enforces it on Save).
///
/// Locked — the default, and what a process saved before the setting existed
/// reads as — is the hours set on the process (12 unless an Admin changed
/// them); unlocked (or a machine in no process) is `null`: the hours are typed
/// by hand on each entry.
const double lockedShiftHours = 12;

/// What a form block's Planned Operator Shift box does under a setting.
class ShiftSetting {
  const ShiftSetting({required this.locked, required this.hours, this.fromEntry = false});

  /// Always true for a setting [shiftSettingOf] returns (unlocked = no setting).
  final bool locked;

  /// Decimal hours the box is fixed at.
  final double hours;

  /// An edited entry keeps the shift it was SAVED with (a later change to the
  /// setting never rewrites it): the box is read-only but holds the entry's own
  /// hours.
  final bool fromEntry;

  /// The box text ("7.30" for 7.5 hr) a new entry is filled with.
  String get boxText => hoursToHmInput(hours);

  ShiftSetting copyWith({bool? fromEntry}) =>
      ShiftSetting(locked: locked, hours: hours, fromEntry: fromEntry ?? this.fromEntry);

  @override
  bool operator ==(Object other) =>
      other is ShiftSetting && other.locked == locked && other.hours == hours && other.fromEntry == fromEntry;

  @override
  int get hashCode => Object.hash(locked, hours, fromEntry);

  @override
  String toString() => 'ShiftSetting(locked: $locked, hours: $hours, fromEntry: $fromEntry)';
}

/// Web `lockedHours`: the process's hours when 0 < h <= 24, else 12.
double lockedHoursOf(Map<String, dynamic>? process) {
  final h = jsToNumber(process?['plannedShiftHours']);
  return h.isFinite && h > 0 && h <= 24 ? h : lockedShiftHours;
}

/// Web `shiftSettingOf`: null when the process leaves the hours to the entry.
ShiftSetting? shiftSettingOf(Map<String, dynamic>? process) {
  if (process == null) return null;
  if (process['plannedShiftLocked'] == false) return null;
  return ShiftSetting(locked: true, hours: lockedHoursOf(process));
}

/// Web `shiftSettingForMachine`: the setting for one machine id, given the
/// machine and process lists the entry pages already load.
ShiftSetting? shiftSettingForMachine(
  Object? machineId,
  List<Map<String, dynamic>> machines,
  List<Map<String, dynamic>> processes,
) {
  Map<String, dynamic>? machine;
  for (final m in machines) {
    if ('${m['_id']}' == '${machineId ?? ''}') {
      machine = m;
      break;
    }
  }
  final owner = machine?['process'];
  if (owner == null || owner == '' || owner == false || owner == 0) return null;
  final id = owner is Map ? '${owner['_id']}' : '$owner';
  for (final p in processes) {
    if ('${p['_id']}' == id) return shiftSettingOf(p);
  }
  return shiftSettingOf(null);
}

/// The setting a form block uses: [shiftSettingForMachine], with `fromEntry`
/// set while EDITING an entry that already carries a saved shift (the web's
/// `editing.savedPlanned`) — then the box keeps the saved hours.
ShiftSetting? plannedShiftFor({
  required Object? machineId,
  required List<Map<String, dynamic>> machines,
  required List<Map<String, dynamic>> processes,
  bool isEdit = false,
  Object? savedPlanned,
}) {
  final s = shiftSettingForMachine(machineId, machines, processes);
  if (s == null) return null;
  final kept = isEdit && savedPlanned != null && savedPlanned != '';
  return s.copyWith(fromEntry: kept);
}

/// The box text a block should hold under [setting], or null when it should be
/// left alone (no setting, or the entry keeps its own saved hours). The editor
/// writes this into `plannedOperatorShiftHours` when it differs.
String? plannedShiftDefault(ShiftSetting? setting) => (setting == null || setting.fromEntry) ? null : setting.boxText;

/// The note under a locked Planned Operator Shift box (web ProductionEntryForm).
/// [hm] is `hoursToHm(setting.hours)` ("12:00").
String plannedShiftReason(ShiftSetting setting, String hm) => setting.fromEntry
    ? 'Kept as this entry was saved — set by Process Master'
    : setting.locked
        ? 'Fixed at $hm hr — locked in Process Master'
        : 'Set to $hm hr in Process Master';

/// Server rule `shiftChangeError` (controllers/process.controller.js): only an
/// Admin / Super Admin may change a process's Operator Planned Shift — the lock
/// or the hours, even the hours kept behind a lock. Anyone else may still save
/// the rest of the process as long as what they send matches what is there.
/// The phone's Process Master screen hides the lock/hours for anyone else; this is the same rule.
bool shiftChangeAllowed({
  required Map<String, dynamic>? current,
  required Map<String, dynamic> next,
  required bool isAdmin,
}) {
  final beforeLocked = current?['plannedShiftLocked'] != false;
  final beforeHours = current?['plannedShiftHours'] ?? 12;
  final afterLocked = next.containsKey('plannedShiftLocked') ? next['plannedShiftLocked'] != false && next['plannedShiftLocked'] != 'false' : beforeLocked;
  final afterHours = next.containsKey('plannedShiftHours') && next['plannedShiftHours'] != '' && next['plannedShiftHours'] != null ? next['plannedShiftHours'] : beforeHours;
  final changed = beforeLocked != afterLocked || jsToNumber(beforeHours) != jsToNumber(afterHours);
  return !changed || isAdmin;
}
