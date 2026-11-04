import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import 'kpi_models.dart';

/// KPI and Company Level Objective calls (routes/kpi.routes.js).
class KpiRepository {
  const KpiRepository();

  Future<KpiPage> objectives(int year) async {
    final r = await Api.get(Endpoints.kpiObjectives, query: {'year': year});
    return KpiPage(
      objectives: [for (final o in (r['data'] as List? ?? const [])) if (o is Map) KpiObjective.from(o)],
      departments: [
        for (final d in (r['departments'] as List? ?? const []))
          if (d is Map) KpiDepartment('${d['_id']}', '${d['departmentName'] ?? ''}'),
      ],
      canAddAnyDepartment: r['canAddAnyDepartment'] == true,
    );
  }

  Future<void> saveObjective(Map<String, dynamic> body, {String? id}) =>
      id == null ? Api.post(Endpoints.kpiObjectives, body: body) : Api.put(Endpoints.kpiObjectiveById(id), body: body);

  Future<void> deleteObjective(String id) => Api.delete(Endpoints.kpiObjectiveById(id));

  Future<CompanySummary> company(int year) async {
    final r = await Api.get(Endpoints.kpiCompany, query: {'year': year});
    return CompanySummary.from(r['data'] as Map? ?? const {});
  }

  Future<void> saveCompany(Map<String, dynamic> body, {String? id}) =>
      id == null ? Api.post(Endpoints.kpiCompany, body: body) : Api.put(Endpoints.kpiCompanyById(id), body: body);

  Future<void> deleteCompany(String id) => Api.delete(Endpoints.kpiCompanyById(id));

  /// Makes a department (Operator Management › Department) and returns its id.
  Future<String?> addDepartment(String name, String remark) async {
    final r = await Api.post(Endpoints.departments, body: {'departmentName': name, 'remark': remark, 'isActive': true});
    final d = r['data'];
    return d is Map && d['_id'] != null ? '${d['_id']}' : null;
  }

  /// Active processes for the objective form: [{ _id, processName }].
  Future<List<KpiProcessRef>> processes() async {
    final r = await Api.get(Endpoints.processes);
    return [
      for (final p in (r['data'] as List? ?? const []))
        if (p is Map && p['isActive'] != false) KpiProcessRef('${p['_id']}', '${p['processName'] ?? ''}'),
    ];
  }
}
