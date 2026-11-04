/// KPI and Company Level Objective — what the server sends (controllers/kpi.controller.js).
library;

const kpiMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const kpiUoms = ['Qty', '%'];
const kpiTargetPeriods = ['Monthly', 'Yearly'];

double? _num(dynamic v) {
  if (v == null || v == '') return null;
  final n = v is num ? v.toDouble() : double.tryParse('$v');
  return n;
}

String _str(dynamic v) => v == null ? '' : '$v';

/// A value with its own unit: "Qty" (a count) or "%".
class Measure {
  const Measure({this.value, this.uom = 'Qty'});
  final double? value;
  final String uom;

  factory Measure.from(dynamic j) {
    if (j is! Map) return const Measure();
    return Measure(value: _num(j['value']), uom: kpiUoms.contains(j['uom']) ? '${j['uom']}' : 'Qty');
  }
  Map<String, dynamic> toJson() => {'value': value ?? '', 'uom': uom};
}

class KpiMonth {
  const KpiMonth({required this.month, required this.okQty, required this.cumulative, this.pctOfTarget, this.status, this.source});
  final int month;
  final double okQty;
  final double cumulative;
  final double? pctOfTarget;
  final String? status;
  final String? source; // "entries" | "excel" | null

  factory KpiMonth.from(Map j) => KpiMonth(
        month: (_num(j['month']) ?? 0).toInt(),
        okQty: _num(j['okQty']) ?? 0,
        cumulative: _num(j['cumulative']) ?? 0,
        pctOfTarget: _num(j['pctOfTarget']),
        status: j['status'] == null ? null : '${j['status']}',
        source: j['source'] == null ? null : '${j['source']}',
      );
}

class KpiProcessRef {
  const KpiProcessRef(this.id, this.name);
  final String id;
  final String name;
}

class KpiObjective {
  const KpiObjective({
    required this.id,
    required this.objective,
    required this.departmentId,
    required this.departmentName,
    required this.year,
    required this.processes,
    required this.baseline,
    required this.target,
    required this.targetPeriod,
    required this.okQtyUom,
    required this.owner,
    required this.remarks,
    required this.createdByName,
    required this.months,
    required this.yearOkQty,
    required this.yearPct,
    required this.yearStatus,
  });

  final String id;
  final String objective;
  final String departmentId;
  final String departmentName;
  final int year;
  final List<KpiProcessRef> processes;
  final Measure baseline;
  final Measure target;
  final String targetPeriod;
  final String okQtyUom;
  final String owner;
  final String remarks;
  final String createdByName;
  final List<KpiMonth> months;
  final double yearOkQty;
  final double? yearPct;
  final String? yearStatus;

  bool get yearly => targetPeriod == 'Yearly';

  factory KpiObjective.from(Map j) {
    final dept = j['department'];
    final procs = (j['processes'] as List? ?? const []);
    return KpiObjective(
      id: _str(j['_id']),
      objective: _str(j['objective']),
      departmentId: dept is Map ? _str(dept['_id']) : _str(dept),
      departmentName: dept is Map ? _str(dept['departmentName']) : '',
      year: (_num(j['year']) ?? 0).toInt(),
      processes: [for (final p in procs) if (p is Map) KpiProcessRef(_str(p['_id']), _str(p['processName'])) else KpiProcessRef(_str(p), '')],
      baseline: Measure.from(j['baseline']),
      target: Measure.from(j['target']),
      targetPeriod: kpiTargetPeriods.contains(j['targetPeriod']) ? '${j['targetPeriod']}' : 'Monthly',
      okQtyUom: kpiUoms.contains(j['okQtyUom']) ? '${j['okQtyUom']}' : 'Qty',
      owner: _str(j['owner']),
      remarks: _str(j['remarks']),
      createdByName: _str(j['createdByName']),
      months: [for (final m in (j['months'] as List? ?? const [])) if (m is Map) KpiMonth.from(m)],
      yearOkQty: _num(j['yearOkQty']) ?? 0,
      yearPct: _num(j['yearPct']),
      yearStatus: j['yearStatus'] == null ? null : '${j['yearStatus']}',
    );
  }
}

class KpiDepartment {
  const KpiDepartment(this.id, this.name);
  final String id;
  final String name;
}

class KpiPage {
  const KpiPage({required this.objectives, required this.departments, required this.canAddAnyDepartment});
  final List<KpiObjective> objectives;
  final List<KpiDepartment> departments;
  final bool canAddAnyDepartment;
}

class CompanyObjective {
  const CompanyObjective({
    required this.id,
    required this.objective,
    required this.year,
    required this.target,
    required this.baseline,
    required this.owner,
    required this.remarks,
    required this.createdByName,
    this.achievedPct,
    this.status,
  });
  final String id;
  final String objective;
  final int year;
  final Measure target;
  final Measure baseline;
  final String owner;
  final String remarks;
  final String createdByName;
  final double? achievedPct;
  final String? status;

  factory CompanyObjective.from(Map j) => CompanyObjective(
        id: _str(j['_id']),
        objective: _str(j['objective']),
        year: (_num(j['year']) ?? 0).toInt(),
        target: Measure.from(j['target']),
        baseline: Measure.from(j['baseline']),
        owner: _str(j['owner']),
        remarks: _str(j['remarks']),
        createdByName: _str(j['createdByName']),
        achievedPct: _num(j['achievedPct']),
        status: j['status'] == null ? null : '${j['status']}',
      );
}

class MonthTotal {
  const MonthTotal(this.month, this.okQty, this.source);
  final int month;
  final double okQty;
  final String? source;
}

class YearTotal {
  const YearTotal(this.year, this.okQty);
  final int year;
  final double okQty;
}

class CompanySummary {
  const CompanySummary({
    required this.year,
    required this.objectives,
    required this.byMonth,
    required this.byYear,
    required this.yearOkQty,
    required this.totalOkQty,
    required this.avgAchievementPct,
    required this.kpiObjectiveCount,
    required this.kpiOnTrack,
    required this.kpiBehind,
  });
  final int year;
  final List<CompanyObjective> objectives;
  final List<MonthTotal> byMonth;
  final List<YearTotal> byYear;
  final double yearOkQty;
  final double totalOkQty;
  final double? avgAchievementPct;
  final int kpiObjectiveCount;
  final int kpiOnTrack;
  final int kpiBehind;

  factory CompanySummary.from(Map j) => CompanySummary(
        year: (_num(j['year']) ?? 0).toInt(),
        objectives: [for (final o in (j['objectives'] as List? ?? const [])) if (o is Map) CompanyObjective.from(o)],
        byMonth: [
          for (final m in (j['byMonth'] as List? ?? const []))
            if (m is Map) MonthTotal((_num(m['month']) ?? 0).toInt(), _num(m['okQty']) ?? 0, m['source'] == null ? null : '${m['source']}'),
        ],
        byYear: [for (final y in (j['byYear'] as List? ?? const [])) if (y is Map) YearTotal((_num(y['year']) ?? 0).toInt(), _num(y['okQty']) ?? 0)],
        yearOkQty: _num(j['yearOkQty']) ?? 0,
        totalOkQty: _num(j['totalOkQty']) ?? 0,
        avgAchievementPct: _num(j['avgAchievementPct']),
        kpiObjectiveCount: (_num(j['kpiObjectiveCount']) ?? 0).toInt(),
        kpiOnTrack: (_num(j['kpiOnTrack']) ?? 0).toInt(),
        kpiBehind: (_num(j['kpiBehind']) ?? 0).toInt(),
      );
}

/// % change from [prev] to [cur]; null when there is nothing to compare with.
double? deltaPct(double cur, double? prev) => (prev ?? 0) > 0 ? (cur - prev!) / prev * 100 : null;
