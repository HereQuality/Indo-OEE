import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';

import '../../app/page_access.dart';
import '../../core/api/api_client.dart' show ApiException;
import '../../core/widgets/page_permissions.dart';
import '../../core/widgets/states.dart';
import '../../models/menu_models.dart';
import '../../providers/auth_provider.dart';
import '../../providers/menu_provider.dart';
import 'audit_models.dart';
import 'audit_repository.dart';
import 'audit_trail_screen.dart';
import 'audit_widgets.dart';

/// The Audit Trail page's path (routes.dart) — for the "Open in Audit Trail"
/// permission check.
const String auditTrailPath = '/production/audit-trail';

/// Opens the history of one saved entry (by id).
Future<void> showEntryHistory(BuildContext context, {required String entityId, String title = 'Entry history'}) =>
    showRecordHistory(context, filters: AuditFilters.forEntity(entityId), title: title);

/// Opens the history of one Not running mark (sheet + day + machine).
Future<void> showMarkHistory(
  BuildContext context, {
  required String sheet,
  required String date,
  required String machine,
  String title = 'Not running history',
}) =>
    showRecordHistory(context, filters: AuditFilters.forMark(sheet: sheet, date: date, machine: machine), title: title);

/// Bottom sheet listing every audit log of one record, newest first, with an
/// "Open in Audit Trail" button (shown when the person may open that page).
Future<void> showRecordHistory(BuildContext context, {required AuditFilters filters, required String title}) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (_) => RecordHistorySheet(filters: filters, title: title),
    );

class RecordHistorySheet extends StatefulWidget {
  const RecordHistorySheet({super.key, required this.filters, required this.title, this.repository = const AuditRepository()});
  final AuditFilters filters;
  final String title;
  final AuditRepository repository;

  @override
  State<RecordHistorySheet> createState() => _RecordHistorySheetState();
}

class _RecordHistorySheetState extends State<RecordHistorySheet> {
  List<AuditLog>? _logs;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _logs = null;
      _error = null;
    });
    try {
      final logs = await widget.repository.history(widget.filters);
      if (mounted) setState(() => _logs = logs);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the history.');
    }
  }

  void _openTrail() {
    final nav = Navigator.of(context, rootNavigator: true);
    Navigator.of(context).pop();
    nav.push(
      MaterialPageRoute<void>(
        settings: const RouteSettings(name: auditTrailPath),
        builder: (_) => PagePermissions(perms: const PagePerms(view: true), child: AuditTrailScreen(initialFilters: widget.filters)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final user = context.watch<AuthProvider>().user;
    final menu = context.watch<MenuProvider>();
    final canOpenTrail = PageAccess.canOpen(user, menu, auditTrailPath);
    final maxH = MediaQuery.sizeOf(context).height * 0.85;
    final logs = _logs;

    Widget body;
    if (_error != null) {
      body = ErrorView(message: _error!, onRetry: _load);
    } else if (logs == null) {
      body = const LoadingView(label: 'Loading history…');
    } else if (logs.isEmpty) {
      body = const EmptyView(icon: LucideIcons.history, message: 'No history recorded for this record yet.');
    } else {
      body = ListView.builder(
        key: const ValueKey('record-history-list'),
        shrinkWrap: true,
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
        itemCount: logs.length,
        itemBuilder: (_, i) => AuditLogTile(key: ValueKey('history-log-${logs[i].id.isEmpty ? i : logs[i].id}'), log: logs[i], expanded: i == 0, dense: true),
      );
    }

    return ConstrainedBox(
      key: const ValueKey('record-history-sheet'),
      constraints: BoxConstraints(maxHeight: maxH),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 8, 4),
            child: Row(children: [
              Icon(LucideIcons.history, size: 20, color: s.onSurfaceVariant),
              const SizedBox(width: 8),
              Expanded(child: Text(widget.title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis)),
              IconButton(tooltip: 'Close', onPressed: () => Navigator.of(context).maybePop(), icon: const Icon(Icons.close)),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text(
              logs == null ? 'Who changed this record and when. Times are IST.' : '${logs.length} ${logs.length == 1 ? 'change' : 'changes'} · newest first · times are IST',
              style: TextStyle(fontSize: 12.5, color: s.onSurfaceVariant),
            ),
          ),
          Flexible(child: logs == null || logs.isEmpty || _error != null ? SizedBox(height: 180, child: body) : body),
          if (canOpenTrail)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
              child: Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  key: const ValueKey('history-open-trail'),
                  onPressed: _openTrail,
                  icon: const Icon(LucideIcons.externalLink, size: 18),
                  label: const Text('Open in Audit Trail'),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
