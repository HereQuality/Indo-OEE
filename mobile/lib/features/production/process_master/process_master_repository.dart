import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';
import '../shared/review_access.dart';
import 'process_master_logic.dart' show Json;


/// One page of the Process Master table (`POST /processes/search`).
class ProcessPage {
  const ProcessPage({required this.rows, required this.total});
  final List<Json> rows;
  final int total;
}

/// A page the "Data Entry Page" picker can link to (a menu or a link-type menu group).
class MenuChoice {
  const MenuChoice(this.url, this.label);
  final String url;
  final String label;
}

/// Everything Process Master reads or writes (port of client/src/api/processes.api.js
/// plus the machine / menu lists the form needs).
class ProcessMasterRepository {
  const ProcessMasterRepository();

  Future<ProcessPage> search({
    int skip = 0,
    int perPage = 100,
    String? sortOn,
    String? sortDir,
    String match = '',
    bool activeOnly = true,
  }) async {
    final res = await Api.post(
      Endpoints.processSearch,
      body: {
        'skip': skip,
        'per_page': perPage,
        'sorton': ?sortOn,
        'sortdir': ?sortDir,
        'match': match,
        'isActive': activeOnly,
      },
    );
    final data = res['data'];
    final first = data is List && data.isNotEmpty && data.first is Map ? Map<String, dynamic>.from(data.first as Map) : <String, dynamic>{};
    final rows = first['data'];
    final count = first['count'];
    return ProcessPage(
      rows: rows is List ? [for (final r in rows) if (r is Map) Map<String, dynamic>.from(r)] : const [],
      total: count is num ? count.toInt() : 0,
    );
  }

  Future<Json> byId(String id) async => asMap(await Api.get(Endpoints.processById(id)));

  /// The message the server answers with, if any.
  Future<String?> create(Json body) async => _message(await Api.post(Endpoints.processes, body: body));

  Future<String?> update(String id, Json body) async => _message(await Api.put(Endpoints.processById(id), body: body));

  /// The first delete deactivates, the second (an inactive process) removes it.
  Future<String?> delete(String id) async => _message(await Api.delete(Endpoints.processById(id)));

  /// Every active machine (`GET /machines`).
  Future<List<Json>> machines() async => asList(await Api.get(Endpoints.machines));

  /// Every active process (`GET /processes`) — to tell whether a machine's process still exists.
  Future<List<Json>> activeProcesses() async => asList(await Api.get(Endpoints.processes));

  /// Super Admin only server-side: sidebar pages (menu groups that are links first,
  /// then menus), the way the web builds `menuOptions`.
  Future<List<MenuChoice>> menuChoices() async {
    var groups = <Json>[];
    var menus = <Json>[];
    try {
      groups = asList(await Api.get(Endpoints.menuGroups));
    } catch (_) {}
    try {
      menus = asList(await Api.get(Endpoints.menus));
    } catch (_) {}
    return [
      for (final g in groups)
        if (g['isActive'] == true && g['isLink'] == true && '${g['menuUrl'] ?? ''}'.isNotEmpty)
          MenuChoice('${g['menuUrl']}', '${g['menuGroupName'] ?? ''}'),
      for (final m in menus)
        if (m['isActive'] == true && '${m['menuUrl'] ?? ''}'.isNotEmpty) MenuChoice('${m['menuUrl']}', '${m['menuName'] ?? ''}'),
    ];
  }

  /// Admin / Super Admin (may change the Operator Planned Shift).
  Future<bool> canSetShift() => const ReviewAccessRepository().canReview();

  String? _message(Json res) {
    final m = res['message'];
    return m is String && m.isNotEmpty ? m : null;
  }
}
