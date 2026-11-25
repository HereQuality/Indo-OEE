import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';

/// One field that changed in an audited action: `label` from → to.
class AuditChange {
  const AuditChange({required this.field, required this.label, this.from, this.to});

  factory AuditChange.from(Map<dynamic, dynamic> j) => AuditChange(
        field: '${j['field'] ?? ''}',
        label: '${j['label'] ?? j['field'] ?? ''}',
        from: j['from'],
        to: j['to'],
      );

  final String field;
  final String label;
  final Object? from;
  final Object? to;
}

/// Who did it.
class AuditActor {
  const AuditActor({this.id = '', this.model = '', this.name = '', this.role = ''});

  factory AuditActor.from(Object? j) {
    if (j is! Map) return const AuditActor();
    return AuditActor(
      id: '${j['id'] ?? j['_id'] ?? ''}',
      model: '${j['model'] ?? ''}',
      name: '${j['name'] ?? ''}',
      role: '${j['role'] ?? ''}',
    );
  }

  final String id;
  final String model;
  final String name;
  final String role;
}

/// One metric that went over 100% (`flagged` on an entry row).
class AuditFlag {
  const AuditFlag(this.metric, this.value);
  final String metric;
  final Object? value;
}

/// One line of the audit trail (GET /audit-trail → data[]).
class AuditLog {
  const AuditLog({
    required this.id,
    required this.entityType,
    required this.module,
    required this.sheet,
    required this.entity,
    required this.machine,
    required this.machineName,
    required this.date,
    required this.label,
    required this.action,
    required this.changes,
    this.metrics,
    required this.flagged,
    required this.remark,
    required this.actor,
    required this.client,
    required this.ip,
    this.createdAt,
  });

  factory AuditLog.from(Map<dynamic, dynamic> j) {
    final metrics = j['metrics'];
    return AuditLog(
      id: '${j['_id'] ?? j['id'] ?? ''}',
      entityType: '${j['entityType'] ?? ''}',
      module: '${j['module'] ?? ''}',
      sheet: '${j['sheet'] ?? ''}',
      entity: '${j['entity'] ?? ''}',
      machine: '${j['machine'] ?? ''}',
      machineName: '${j['machineName'] ?? ''}',
      date: '${j['date'] ?? ''}',
      label: '${j['label'] ?? ''}',
      action: '${j['action'] ?? ''}',
      changes: [for (final c in (j['changes'] as List? ?? const [])) if (c is Map) AuditChange.from(c)],
      metrics: metrics is Map ? Map<String, dynamic>.from(metrics) : null,
      flagged: [
        for (final f in (j['flagged'] as List? ?? const []))
          if (f is Map) AuditFlag('${f['metric'] ?? ''}', f['value']),
      ],
      remark: '${j['remark'] ?? ''}',
      actor: AuditActor.from(j['actor']),
      client: '${j['client'] ?? ''}',
      ip: '${j['ip'] ?? ''}',
      createdAt: _parseDate(j['createdAt']),
    );
  }

  final String id;
  final String entityType;
  final String module;
  final String sheet;
  final String entity;
  final String machine;
  final String machineName;
  final String date;
  final String label;
  final String action;
  final List<AuditChange> changes;
  final Map<String, dynamic>? metrics;
  final List<AuditFlag> flagged;
  final String remark;
  final AuditActor actor;
  final String client;
  final String ip;
  final DateTime? createdAt;

  /// "Web" / "App" / "" for the sub-line.
  String get clientLabel => switch (client.toLowerCase()) {
        'web' => 'Web',
        'app' || 'mobile' => 'App',
        _ => '',
      };

  /// Whether the detail should show the whole record (create / delete) rather
  /// than a from → to diff.
  bool get isWholeRecord => action == 'create' || action == 'delete' || action == 'import';

  bool get isEntry => entityType == 'entry';

  static DateTime? _parseDate(Object? v) {
    if (v is DateTime) return v;
    if (v is String && v.isNotEmpty) return DateTime.tryParse(v);
    if (v is num) return DateTime.fromMillisecondsSinceEpoch(v.toInt(), isUtc: true);
    return null;
  }
}

/// One page of logs with the total matching the filters.
class AuditPage {
  const AuditPage({required this.logs, required this.total});
  final List<AuditLog> logs;
  final int total;
}

/// A dropdown option with a key and a human label.
class AuditOption {
  const AuditOption(this.key, this.label);
  final String key;
  final String label;
}

/// A user the filters can narrow to.
class AuditActorOption {
  const AuditActorOption({required this.id, required this.name, this.role = ''});
  final String id;
  final String name;
  final String role;
}

/// GET /audit-trail/filters.
class AuditFilterOptions {
  const AuditFilterOptions({this.modules = const [], this.actions = const [], this.actors = const []});

  factory AuditFilterOptions.from(Map<dynamic, dynamic> j) => AuditFilterOptions(
        modules: [
          for (final m in (j['modules'] as List? ?? const []))
            if (m is Map) AuditOption('${m['key'] ?? ''}', '${m['label'] ?? m['key'] ?? ''}'),
        ],
        actions: [
          for (final a in (j['actions'] as List? ?? const []))
            if (a is Map) AuditOption('${a['key'] ?? ''}', '${a['label'] ?? auditActionLabel('${a['key'] ?? ''}')}'),
        ],
        actors: [
          for (final a in (j['actors'] as List? ?? const []))
            if (a is Map) AuditActorOption(id: '${a['id'] ?? a['_id'] ?? ''}', name: '${a['name'] ?? ''}', role: '${a['role'] ?? ''}'),
        ],
      );

  final List<AuditOption> modules;
  final List<AuditOption> actions;
  final List<AuditActorOption> actors;

  String moduleLabel(String key) => modules.where((m) => m.key == key).map((m) => m.label).firstOrNull ?? key;
  String actionLabel(String key) => actions.where((a) => a.key == key).map((a) => a.label).firstOrNull ?? auditActionLabel(key);
  String actorName(String id) => actors.where((a) => a.id == id).map((a) => a.name).firstOrNull ?? id;
}

/// Everything GET /audit-trail can be narrowed by. Dates are `YYYY-MM-DD`.
/// Empty strings / lists mean "not filtered" and are left out of the query.
class AuditFilters {
  const AuditFilters({
    this.from = '',
    this.to = '',
    this.modules = const [],
    this.actions = const [],
    this.actor = '',
    this.q = '',
    this.sheet = '',
    this.entity = '',
    this.machine = '',
    this.date = '',
  });

  /// The page's default: the last 30 days (today included).
  factory AuditFilters.lastDays(int days, {DateTime? now}) {
    final today = _dayOf(now ?? DateTime.now());
    return AuditFilters(from: isoDay(today.subtract(Duration(days: days - 1))), to: isoDay(today));
  }

  /// The month so far.
  factory AuditFilters.thisMonth({DateTime? now}) {
    final today = _dayOf(now ?? DateTime.now());
    return AuditFilters(from: isoDay(DateTime(today.year, today.month, 1)), to: isoDay(today));
  }

  /// One saved record's history (the editor's History button).
  const AuditFilters.forEntity(String entity) : this(entity: entity);

  /// One Not running mark's history: the sheet's day for one machine.
  const AuditFilters.forMark({required String sheet, required String date, required String machine})
      : this(sheet: sheet, date: date, machine: machine);

  final String from;
  final String to;
  final List<String> modules;
  final List<String> actions;
  final String actor;
  final String q;
  final String sheet;
  final String entity;
  final String machine;
  final String date;

  static const int pageSize = 50;

  /// The query string for GET /audit-trail and /export.csv — comma lists for
  /// modules / actions, empty values left out, plus `skip` and `limit`.
  Map<String, dynamic> toQuery({int skip = 0, int limit = pageSize, bool paging = true}) {
    final q = <String, dynamic>{};
    void put(String key, String v) {
      if (v.trim().isNotEmpty) q[key] = v.trim();
    }

    put('from', from);
    put('to', to);
    if (modules.isNotEmpty) q['module'] = modules.join(',');
    if (actions.isNotEmpty) q['action'] = actions.join(',');
    put('actor', actor);
    put('q', this.q);
    put('sheet', sheet);
    put('entity', entity);
    put('machine', machine);
    put('date', date);
    if (paging) {
      q['skip'] = skip;
      q['limit'] = limit;
    }
    return q;
  }

  AuditFilters copyWith({
    String? from,
    String? to,
    List<String>? modules,
    List<String>? actions,
    String? actor,
    String? q,
    String? sheet,
    String? entity,
    String? machine,
    String? date,
  }) =>
      AuditFilters(
        from: from ?? this.from,
        to: to ?? this.to,
        modules: modules ?? this.modules,
        actions: actions ?? this.actions,
        actor: actor ?? this.actor,
        q: q ?? this.q,
        sheet: sheet ?? this.sheet,
        entity: entity ?? this.entity,
        machine: machine ?? this.machine,
        date: date ?? this.date,
      );

  /// Anything narrowing the list beyond the date range.
  bool get hasNarrowing =>
      modules.isNotEmpty || actions.isNotEmpty || actor.isNotEmpty || q.isNotEmpty || sheet.isNotEmpty || entity.isNotEmpty || machine.isNotEmpty || date.isNotEmpty;

  bool get hasDateRange => from.isNotEmpty || to.isNotEmpty;

  @override
  bool operator ==(Object other) =>
      other is AuditFilters &&
      other.from == from &&
      other.to == to &&
      other.modules.join(',') == modules.join(',') &&
      other.actions.join(',') == actions.join(',') &&
      other.actor == actor &&
      other.q == q &&
      other.sheet == sheet &&
      other.entity == entity &&
      other.machine == machine &&
      other.date == date;

  @override
  int get hashCode => Object.hash(from, to, modules.join(','), actions.join(','), actor, q, sheet, entity, machine, date);

  static DateTime _dayOf(DateTime d) => DateTime(d.year, d.month, d.day);
}

/// `YYYY-MM-DD` of a local date.
String isoDay(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// A `YYYY-MM-DD` shown as dd/mm/yyyy ("" stays "").
String displayDay(String iso) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(iso);
  if (m == null) return iso;
  return '${m[3]}/${m[2]}/${m[1]}';
}

/// The file name the CSV export is saved and shared under.
String auditExportFileName(AuditFilters f) {
  String part(String v) => v.isEmpty ? 'all' : v;
  return 'audit-trail-${part(f.from)}_${part(f.to)}.csv';
}

/// IST is fixed at UTC+05:30 (no daylight saving).
const Duration istOffset = Duration(hours: 5, minutes: 30);

/// `dd/mm/yyyy HH:mm` in Indian Standard Time, whatever the phone's zone.
String formatIst(DateTime? t, {bool seconds = false}) {
  if (t == null) return '—';
  final ist = t.toUtc().add(istOffset);
  String two(int n) => n.toString().padLeft(2, '0');
  final base = '${two(ist.day)}/${two(ist.month)}/${ist.year} ${two(ist.hour)}:${two(ist.minute)}';
  return seconds ? '$base:${two(ist.second)}' : base;
}

/// Human label of an audit action key.
String auditActionLabel(String action) => switch (action) {
      'create' => 'Created',
      'update' => 'Edited',
      'delete' => 'Deleted',
      'unlocked' => 'Unlocked',
      'flagged' => 'Over 100%',
      'cleared' => 'Back under 100%',
      'approved' => 'Approved',
      'rejected' => 'Rejected',
      'setting' => 'Setting changed',
      'marked' => 'Marked Not running',
      'unmarked' => 'Not running undone',
      'login' => 'Signed in',
      'loginFailed' => 'Sign-in failed',
      'logout' => 'Signed out',
      'passwordChange' => 'Password changed',
      'passwordReset' => 'Password reset',
      'impersonate' => 'Signed in as another user',
      'blocked' => 'Blocked',
      'unblocked' => 'Unblocked',
      'sent' => 'Sent',
      'import' => 'Imported',
      _ => action.isEmpty ? 'Changed' : action,
    };

/// Badge colour of an audit action: create/login/approved green, update/setting
/// blue, delete/blocked/loginFailed/rejected red, unlocked/marked amber,
/// impersonate purple, everything else grey.
Color auditActionColor(String action) => switch (action) {
      'create' || 'login' || 'approved' => AppColors.ok,
      'update' || 'setting' => AppColors.brand600,
      'delete' || 'blocked' || 'loginFailed' || 'rejected' => AppColors.critical,
      'unlocked' || 'marked' => AppColors.warn,
      'impersonate' => const Color(0xFF7C3AED),
      _ => AppColors.slate500,
    };

/// A change value as text: null / "" → "—", lists joined, maps as key: value.
String auditValueText(Object? v) {
  if (v == null) return '—';
  if (v is String) return v.isEmpty ? '—' : v;
  if (v is bool) return v ? 'Yes' : 'No';
  if (v is num) {
    if (v is double && v == v.roundToDouble()) return v.toInt().toString();
    return v.toString();
  }
  if (v is List) return v.isEmpty ? '—' : v.map(auditValueText).join(', ');
  if (v is Map) return v.isEmpty ? '—' : v.entries.map((e) => '${e.key}: ${auditValueText(e.value)}').join(', ');
  return '$v';
}

/// "A 92.3% · P 88% · Q 99.1%" from an entry row's metrics (null when none).
String? auditMetricsLine(Map<String, dynamic>? metrics) {
  if (metrics == null) return null;
  String? pct(Object? v) {
    if (v is! num) return null;
    final r = (v * 10).round() / 10;
    return '${r == r.roundToDouble() ? r.toInt() : r}%';
  }

  final parts = <String>[
    if (pct(metrics['availability']) != null) 'A ${pct(metrics['availability'])}',
    if (pct(metrics['performance']) != null) 'P ${pct(metrics['performance'])}',
    if (pct(metrics['quality']) != null) 'Q ${pct(metrics['quality'])}',
    if (pct(metrics['oee']) != null) 'OEE ${pct(metrics['oee'])}',
  ];
  return parts.isEmpty ? null : parts.join(' · ');
}
