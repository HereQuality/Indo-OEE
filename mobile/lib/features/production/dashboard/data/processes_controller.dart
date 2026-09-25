import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../../core/api/api_client.dart';
import '../../../../core/utils/alerts.dart';
import '../dashboard_engine.dart' as eng;
import 'dashboard_models.dart';
import 'dashboard_repository.dart';

/// The Dashboard tab's shared data: the active processes, the machine list and
/// a SuperAdmin's device-local "All machines" widget picks (port of
/// hooks/useProcesses + useMachines). Every process dashboard on the tab reads
/// it, so a saved Customize shows up straight away (the web's
/// `invalidateProcesses`).
class ProcessesController extends ChangeNotifier {
  ProcessesController({this.repo = const DashboardRepository()});

  final DashboardRepository repo;

  List<ProcessInfo> processes = const [];
  List<Map<String, dynamic>> machines = const [];
  bool loading = true;

  /// Set only while nothing has ever loaded (drives the full-page error view).
  String? error;
  bool loaded = false;

  /// Message of the last failed load, whether or not data was already on screen.
  String? lastError;

  /// A SuperAdmin's Customize picks for "All machines" (no Process document
  /// backs it), kept on this device.
  WidgetSelection? allMachinesWidgets;

  int _token = 0;
  bool _disposed = false;

  ProcessInfo? byId(String id) {
    for (final p in processes) {
      if (p.id == id) return p;
    }
    return null;
  }

  int get unassignedMachines => machines.where(machineUnassigned).length;

  /// The processes the selector offers: those with machines.
  List<ProcessInfo> get selectable => [for (final p in processes) if (p.machines.isNotEmpty) p];

  /// Whether the "All machines" chip is offered.
  bool get hasAllMachines => machines.isNotEmpty || selectable.isNotEmpty;

  /// The KPI tiles / graphs a dashboard shows for [processId] (null = All machines).
  List<Map<String, dynamic>> statsFor(String? processId) {
    final p = processId == null ? null : byId(processId);
    return eng.resolveWidgets(p != null ? p.stats : allMachinesWidgets?.stats, eng.statsByKey, eng.defaultStats);
  }

  List<Map<String, dynamic>> chartsFor(String? processId) {
    final p = processId == null ? null : byId(processId);
    return eng.resolveWidgets(p != null ? p.charts : allMachinesWidgets?.charts, eng.chartsByKey, eng.defaultCharts);
  }

  /// Which chip is selected on open: [saved] when it still exists, else the
  /// first process with machines, else All machines. `null` id = All machines;
  /// [none] is true when there is nothing to show at all.
  ({String? id, bool none}) initialChoice(String? saved) {
    if (saved == DashboardRepository.allMachinesChoice && hasAllMachines) return (id: null, none: false);
    if (saved != null) {
      final p = byId(saved);
      if (p != null && p.machines.isNotEmpty) return (id: p.id, none: false);
    }
    final first = selectable;
    if (first.isNotEmpty) return (id: first.first.id, none: false);
    if (machines.isNotEmpty) return (id: null, none: false);
    return (id: null, none: true);
  }

  /// Shows a just-saved Customize right away, before the refetch lands.
  void patchWidgets(String id, List<String> stats, List<String> charts) {
    processes = [
      for (final p in processes)
        p.id == id ? ProcessInfo(id: p.id, name: p.name, description: p.description, machines: p.machines, stats: stats, charts: charts) : p,
    ];
    _notify();
  }

  /// Saves the picked tiles / graphs. Throws on failure so the sheet stays open.
  Future<void> saveWidgets(String? processId, List<String> stats, List<String> charts) async {
    if (processId == null) {
      // No Process document backs "All machines" — save on the device instead.
      await repo.saveAllMachinesWidgets(stats, charts);
      allMachinesWidgets = WidgetSelection(stats: stats, charts: charts);
      _notify();
      Alerts.success('Dashboard updated');
      return;
    }
    await repo.saveProcessWidgets(processId, stats: stats, charts: charts);
    Alerts.success('Dashboard updated');
    patchWidgets(processId, stats, charts);
    unawaited(load(silent: true));
  }

  /// Loads processes + machines. [silent] keeps what is on screen (pull to
  /// refresh, or after a saved Customize). Resolves true on success.
  Future<bool> load({bool silent = false}) async {
    final token = ++_token;
    if (!silent || !loaded) {
      loading = true;
      error = null;
      _notify();
    }
    String? failure;
    try {
      final results = await Future.wait([repo.processes(), repo.machines()]);
      if (token != _token || _disposed) return false;
      processes = results[0] as List<ProcessInfo>;
      machines = results[1] as List<Map<String, dynamic>>;
      allMachinesWidgets ??= await repo.loadAllMachinesWidgets();
      if (token != _token || _disposed) return false;
      loaded = true;
    } on ApiException catch (e) {
      failure = e.message;
    } catch (_) {
      failure = 'Failed to load the dashboard.';
    }
    if (token != _token || _disposed) return false;
    lastError = failure;
    if (failure != null && !loaded) error = failure;
    loading = false;
    _notify();
    return failure == null;
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
