import 'package:flutter/foundation.dart';

import '../../../../core/api/api_client.dart';
import 'dashboard_models.dart';
import 'dashboard_repository.dart';

/// The landing page's data: the active processes and the machine list
/// (port of hooks/useProcesses + useMachines). Shared with the dashboards it
/// opens, so a saved Customize shows up straight away (the web's
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

  int _token = 0;
  bool _disposed = false;

  ProcessInfo? byId(String id) {
    for (final p in processes) {
      if (p.id == id) return p;
    }
    return null;
  }

  int get unassignedMachines => machines.where(machineUnassigned).length;

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
