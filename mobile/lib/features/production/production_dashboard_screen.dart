import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/app_scaffold.dart';
import '../../core/utils/alerts.dart';
import '../../core/widgets/states.dart';
import '../../providers/menu_provider.dart';
import 'dashboard/data/dashboard_repository.dart';
import 'dashboard/data/processes_controller.dart';
import 'dashboard/shell/dashboard_controller.dart';
import 'dashboard/shell/dashboard_customize.dart';
import 'dashboard/shell/dashboard_layout.dart';
import 'dashboard/shell/process_dashboard_page.dart';
import 'dashboard/widgets/process_selector.dart';
import 'dashboard/widgets/skeleton.dart';

/// Production dashboard tab (port of ProductionDashboardPage.jsx).
///
/// Opens straight on a dashboard — there is no "pick a process" step: a chip
/// row at the top switches between the processes that have machines and "All
/// machines" (the last choice is remembered on this device). Every process
/// keeps its own loaded data while another chip is open, so flipping between
/// chips is instant. On a phone it is one compact column; on an iPad it is the
/// web portal's full-width layout (see [ProcessDashboardPage]).
class ProductionDashboardScreen extends StatefulWidget {
  const ProductionDashboardScreen({super.key});

  @override
  State<ProductionDashboardScreen> createState() => _ProductionDashboardScreenState();
}

class _ProductionDashboardScreenState extends State<ProductionDashboardScreen> with AutomaticKeepAliveClientMixin {
  /// A cached dashboard older than this is reloaded when its chip is picked again.
  static const _staleAfter = Duration(minutes: 5);

  final DashboardRepository _repo = const DashboardRepository();
  late final ProcessesController _processes = ProcessesController(repo: _repo);
  final Map<String?, DashboardController> _ctls = {};

  /// The chip on show; null = "All machines". Only meaningful once [_chosen].
  String? _selected;
  bool _chosen = false;

  /// Nothing to show at all: no process with machines and no machines.
  bool _none = false;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _processes.addListener(_onProcesses);
    unawaited(_boot());
  }

  @override
  void dispose() {
    _processes.removeListener(_onProcesses);
    for (final c in _ctls.values) {
      c.dispose();
    }
    _processes.dispose();
    super.dispose();
  }

  Future<void> _boot() async {
    final ok = await _processes.load();
    if (!mounted || !ok) return;
    final saved = await _repo.loadLastProcess();
    if (!mounted) return;
    _apply(_processes.initialChoice(saved));
  }

  void _apply(({String? id, bool none}) choice) {
    if (choice.none) {
      setState(() {
        _none = true;
        _chosen = false;
      });
      return;
    }
    _ctlFor(choice.id);
    setState(() {
      _none = false;
      _selected = choice.id;
      _chosen = true;
    });
  }

  DashboardController _ctlFor(String? id) => _ctls.putIfAbsent(
        id,
        () => DashboardController(repo: _repo, processId: id, machines: _processes.machines)..load(),
      );

  /// Keeps every cached dashboard's machine order current, and moves off a
  /// chip whose process was removed or emptied.
  void _onProcesses() {
    if (!_processes.loaded) return;
    for (final c in _ctls.values) {
      c.setMachines(_processes.machines);
    }
    if (!_chosen && !_none) return;
    final stillThere = _selected == null ? _processes.hasAllMachines : _processes.byId(_selected!) != null;
    if (!stillThere && mounted) _apply(_processes.initialChoice(null));
  }

  void _select(String? id) {
    if (_chosen && id == _selected) return;
    final ctl = _ctlFor(id);
    final at = ctl.loadedAt;
    if (at != null && !ctl.loading && DateTime.now().difference(at) > _staleAfter) unawaited(ctl.load());
    setState(() {
      _selected = id;
      _chosen = true;
    });
    unawaited(_repo.saveLastProcess(id ?? DashboardRepository.allMachinesChoice));
  }

  Future<void> _refreshEmpty() async {
    final ok = await _processes.load(silent: true);
    if (!ok && mounted) Alerts.error(_processes.lastError ?? 'Failed to refresh.');
    if (mounted && ok) _apply(_processes.initialChoice(null));
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final isAdmin = context.select<MenuProvider, bool>((m) => m.isAdmin);
    final tablet = isTabletWidth(MediaQuery.sizeOf(context).width);
    return ListenableBuilder(
      listenable: _processes,
      builder: (context, _) {
        return AppScaffold(
          title: 'Dashboard',
          actions: [
            // On a tablet Customize sits in the header bar, like the web.
            if (isAdmin && !tablet && _chosen)
              IconButton(
                tooltip: 'Customize',
                icon: const Icon(Icons.dashboard_customize_outlined),
                onPressed: () => openDashboardCustomize(context, processes: _processes, processId: _selected),
              ),
          ],
          body: _body(context),
        );
      },
    );
  }

  Widget _body(BuildContext context) {
    if (_processes.error != null && !_processes.loaded) {
      return ErrorView(message: _processes.error!, onRetry: _boot);
    }
    if (!_processes.loaded || (!_chosen && !_none)) return const _TabSkeleton();
    if (_none) {
      return RefreshIndicator(
        onRefresh: _refreshEmpty,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: const [
            SizedBox(height: 48),
            EmptyView(
              message: 'No processes yet. Add them in Production › Processes — name each one, assign its machines and choose its graphs.',
              icon: Icons.layers_outlined,
            ),
          ],
        ),
      );
    }

    final choices = [
      for (final p in _processes.selectable) ProcessChoice(id: p.id, label: p.name),
      if (_processes.hasAllMachines) const ProcessChoice(id: null, label: 'All machines'),
    ];
    return ProcessDashboardPage(
      key: ValueKey(_selected ?? '__all__'),
      processId: _selected,
      processes: _processes,
      controller: _ctlFor(_selected),
      repo: _repo,
      selector: (tabs) => ProcessSelector(choices: choices, selectedId: _selected, onSelect: _select, tabs: tabs),
    );
  }
}

/// While the process list loads: pill placeholders and the dashboard skeleton.
class _TabSkeleton extends StatelessWidget {
  const _TabSkeleton();

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final tablet = isTabletWidth(width);
    final gutter = tablet ? 20.0 : 12.0;
    return SingleChildScrollView(
      physics: const NeverScrollableScrollPhysics(),
      padding: EdgeInsets.fromLTRB(gutter, 8, gutter, 12),
      child: Semantics(
        label: 'Loading dashboard',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                SkeletonBox(width: 76, height: 34, radius: 17),
                SizedBox(width: 6),
                SkeletonBox(width: 76, height: 34, radius: 17),
                SizedBox(width: 6),
                SkeletonBox(width: 100, height: 34, radius: 17),
              ],
            ),
            const SizedBox(height: 10),
            DashboardSkeleton(tablet: tablet, density: densityFor(width - 2 * gutter)),
          ],
        ),
      ),
    );
  }
}
