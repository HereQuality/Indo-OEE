import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/app_scaffold.dart';
import '../../../app/navigation.dart';
import '../../../core/api/api_client.dart';
import '../../../core/utils/alerts.dart';
import '../../../core/widgets/states.dart';
import '../../../models/app_user.dart';
import '../../../providers/auth_provider.dart';
import '../../../providers/menu_provider.dart';
import '../dashboard/data/dashboard_models.dart';
import '../dashboard/data/dashboard_repository.dart';
import '../dashboard/widgets/skeleton.dart';
import 'data_entry_hub_card.dart';
import 'data_entry_hub_model.dart';

/// The "Data entry" tab: every process the person may enter data for, as cards.
/// Tapping one opens that process's entry screen (list + add/edit) on top of
/// this hub, so Back returns here. Which processes show follows the same rule
/// as the dashboards ([hubEntries]).
class DataEntryHubScreen extends StatefulWidget {
  const DataEntryHubScreen({super.key});

  @override
  State<DataEntryHubScreen> createState() => _DataEntryHubScreenState();
}

class _DataEntryHubScreenState extends State<DataEntryHubScreen> with AutomaticKeepAliveClientMixin {
  final DashboardRepository _repo = const DashboardRepository();
  List<ProcessInfo>? _processes;
  String? _error;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  /// Resolves true on success. [silent] keeps what is on screen (pull to refresh).
  Future<bool> _load({bool silent = false}) async {
    if (_error != null && _processes == null) setState(() => _error = null);
    String? failure;
    try {
      final list = await _repo.processes();
      if (!mounted) return false;
      _processes = list;
    } on ApiException catch (e) {
      failure = e.message;
    } catch (_) {
      failure = 'Failed to load the processes.';
    }
    if (!mounted) return false;
    setState(() => _error = _processes == null ? failure : null);
    if (failure != null && _processes != null) Alerts.error(failure);
    return failure == null;
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final user = context.select<AuthProvider, AppUser?>((a) => a.user);
    final menu = context.watch<MenuProvider>();
    return AppScaffold(title: 'Data entry', body: _body(user, menu));
  }

  Widget _body(AppUser? user, MenuProvider menu) {
    final menuPending = menu.loading && menu.groups.isEmpty && !menu.isAdmin;
    if (_error != null && _processes == null) return ErrorView(message: _error!, onRetry: _load);
    if (_processes == null || menuPending) return const _HubSkeleton();

    final entries = hubEntries(_processes!, user: user, menu: menu);
    if (entries.isEmpty) {
      return RefreshIndicator(
        onRefresh: () => _load(silent: true),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            const SizedBox(height: 48),
            EmptyView(
              message: menu.isAdmin
                  ? 'No processes yet. Add them in Production › Processes.'
                  : 'No data entry access yet — ask your administrator.',
              icon: Icons.edit_note_outlined,
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: () => _load(silent: true),
      child: LayoutBuilder(
        builder: (context, box) {
          final cols = _columns(box.maxWidth);
          final gutter = box.maxWidth >= 600 ? 20.0 : 12.0;
          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: EdgeInsets.fromLTRB(gutter, 12, gutter, 24),
            children: [
              for (var i = 0; i < entries.length; i += cols) ...[
                if (i > 0) const SizedBox(height: 10),
                IntrinsicHeight(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (var c = 0; c < cols; c++) ...[
                        if (c > 0) const SizedBox(width: 10),
                        Expanded(
                          child: i + c < entries.length
                              ? HubCard(
                                  key: ValueKey('hub-${entries[i + c].process.id}'),
                                  entry: entries[i + c],
                                  onTap: () => AppNav.go(context, entries[i + c].menuUrl),
                                )
                              : const SizedBox.shrink(),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ],
          );
        },
      ),
    );
  }

  static int _columns(double width) => width >= 900 ? 3 : (width >= 600 ? 2 : 1);
}

class _HubSkeleton extends StatelessWidget {
  const _HubSkeleton();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Loading processes',
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
        children: [
          for (var i = 0; i < 6; i++) ...[
            if (i > 0) const SizedBox(height: 10),
            const SkeletonBox(height: 72, radius: 16),
          ],
        ],
      ),
    );
  }
}
