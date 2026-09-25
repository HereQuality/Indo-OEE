import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../../../../core/api/api_client.dart';
import '../../../../core/api/endpoints.dart';
import 'dashboard_models.dart';

/// Everything the dashboard reads or writes on the backend (port of
/// client/src/api/processes.api.js + machines.api.js) plus the one
/// device-local setting.
class DashboardRepository {
  const DashboardRepository();

  /// "All machines" has no Process document to keep its KPI / graph selection
  /// on, so a SuperAdmin's Customize picks live on this device instead (same
  /// key and shape as the web's localStorage entry).
  static const allMachinesWidgetsKey = 'allMachinesDashboardWidgets';

  /// The process chip picked last, so the Dashboard tab reopens on it.
  /// Stores a process id, or [allMachinesChoice] for "All machines".
  static const lastProcessKey = 'dashboardSelectedProcess';
  static const allMachinesChoice = '__all__';

  /// Active processes with their active machines (GET /processes).
  Future<List<ProcessInfo>> processes() async {
    final res = await Api.get(Endpoints.processes);
    return asList(res).map(ProcessInfo.fromJson).toList();
  }

  /// Active machines in sheet order (GET /machines).
  Future<List<Map<String, dynamic>>> machines() async => asList(await Api.get(Endpoints.machines));

  /// The entries a dashboard computes from. [processId] null = every machine.
  Future<DashboardEntries> entries({required String from, required String to, String? processId}) async {
    final res = await Api.get(
      Endpoints.processEntries,
      query: {'from': from, 'to': to, 'process': ?processId},
    );
    return DashboardEntries.fromResponse(res);
  }

  /// PUT /processes/:id with the same `{stats, charts}` payload the web sends.
  Future<void> saveProcessWidgets(String processId, {required List<String> stats, required List<String> charts}) async {
    await Api.put(Endpoints.processById(processId), body: {'stats': stats, 'charts': charts});
  }

  Future<WidgetSelection?> loadAllMachinesWidgets() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(allMachinesWidgetsKey);
      if (raw == null || raw.isEmpty) return null;
      final decoded = jsonDecode(raw);
      return decoded is Map ? WidgetSelection.fromJson(Map<String, dynamic>.from(decoded)) : null;
    } catch (_) {
      return null;
    }
  }

  /// Best effort, like the web: when storage is unavailable the picks just
  /// don't stick past this session.
  Future<void> saveAllMachinesWidgets(List<String> stats, List<String> charts) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(allMachinesWidgetsKey, jsonEncode({'stats': stats, 'charts': charts}));
    } catch (_) {}
  }

  Future<String?> loadLastProcess() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final v = prefs.getString(lastProcessKey);
      return (v == null || v.isEmpty) ? null : v;
    } catch (_) {
      return null;
    }
  }

  Future<void> saveLastProcess(String choice) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(lastProcessKey, choice);
    } catch (_) {}
  }
}
