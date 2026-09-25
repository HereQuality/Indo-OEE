// Plain data holders for the dashboard shell. Every field is parsed
// defensively: the server can send null / number-or-string / missing.

String _str(dynamic v) => v == null ? '' : v.toString();

/// The calc engine works in doubles (its JS twin has only one number type), but
/// JSON hands back ints for whole numbers — widen them once, on the way in.
dynamic _widen(dynamic v) {
  if (v is int) return v.toDouble();
  if (v is List) return [for (final e in v) _widen(e)];
  if (v is Map) return {for (final e in v.entries) e.key.toString(): _widen(e.value)};
  return v;
}

List<String>? _keys(dynamic v) {
  // null = "never configured" (dashboard falls back to the catalog defaults);
  // [] = deliberately empty. Same distinction the web draws.
  if (v is! List) return null;
  return v.whereType<String>().toList();
}

/// One active process from `GET /processes`, with its active machines in
/// sheet order (the API already sorts them; `sequence` is SuperAdmin-only).
class ProcessInfo {
  const ProcessInfo({
    required this.id,
    required this.name,
    this.description = '',
    this.machines = const [],
    this.stats,
    this.charts,
  });

  final String id;
  final String name;
  final String description;
  final List<Map<String, dynamic>> machines;

  /// Saved KPI tile keys, or null when this process was never customised.
  final List<String>? stats;

  /// Saved graph keys, or null when this process was never customised.
  final List<String>? charts;

  factory ProcessInfo.fromJson(Map<String, dynamic> j) {
    final rawMachines = j['machines'];
    return ProcessInfo(
      id: _str(j['_id']),
      name: _str(j['processName']),
      description: _str(j['description']),
      machines: rawMachines is List
          ? rawMachines.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList()
          : const [],
      stats: _keys(j['stats']),
      charts: _keys(j['charts']),
    );
  }

  /// The document as the engine / widgets expect it (`_id`, `processName`, ...).
  Map<String, dynamic> toJson() => {
        '_id': id,
        'processName': name,
        'description': description,
        'machines': machines,
        if (stats != null) 'stats': stats,
        if (charts != null) 'charts': charts,
      };
}

/// A machine as the dashboard needs it: id + display name, list order = sheet order.
String machineId(Map<String, dynamic> m) => _str(m['_id']);
String machineName(Map<String, dynamic> m) => _str(m['machineName']);

/// True when a machine belongs to no process (`process` is null / missing).
bool machineUnassigned(Map<String, dynamic> m) {
  final p = m['process'];
  return p == null || (p is String && p.isEmpty);
}

/// `GET /processes/entries` -> the rows a dashboard computes from, the first /
/// last date the process has any entry on, and names for the machines used.
class DashboardEntries {
  const DashboardEntries({this.rows = const [], this.extent, this.machineNames = const {}});

  final List<Map<String, dynamic>> rows;

  /// `{from, to}` ('YYYY-MM-DD') or null when the process has no entries at all.
  final Map<String, dynamic>? extent;

  /// machine id -> name, including machines deactivated since they made entries.
  final Map<String, String> machineNames;

  factory DashboardEntries.fromResponse(Map<String, dynamic> res) {
    final data = res['data'];
    final ext = res['extent'];
    final names = res['machineNames'];
    return DashboardEntries(
      rows: data is List ? data.whereType<Map>().map((e) => _widen(e) as Map<String, dynamic>).toList() : const [],
      extent: ext is Map ? Map<String, dynamic>.from(ext) : null,
      machineNames: names is Map ? {for (final e in names.entries) e.key.toString(): _str(e.value)} : const {},
    );
  }
}

/// A saved KPI / graph selection ({stats, charts} — same shape a process stores).
class WidgetSelection {
  const WidgetSelection({this.stats, this.charts});

  /// null = never configured -> defaults.
  final List<String>? stats;
  final List<String>? charts;

  Map<String, dynamic> toJson() => {'stats': stats, 'charts': charts};

  factory WidgetSelection.fromJson(Map<String, dynamic> j) =>
      WidgetSelection(stats: _keys(j['stats']), charts: _keys(j['charts']));
}
