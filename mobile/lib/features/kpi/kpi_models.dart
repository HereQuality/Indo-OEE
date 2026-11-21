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
  const KpiMonth({required this.month, required this.okQty, required this.cumulative, this.rejectedQty = 0, this.qualityPct, this.pctOfTarget, this.status, this.source});
  final int month;
  final double okQty;
  final double rejectedQty;
  /// OK ÷ (OK + Rejected) from the entries; null when nothing was produced or the month came from Excel.
  final double? qualityPct;
  final double cumulative;
  final double? pctOfTarget;
  final String? status;
  final String? source; // "entries" | "excel" | null

  factory KpiMonth.from(Map j) => KpiMonth(
        month: (_num(j['month']) ?? 0).toInt(),
        okQty: _num(j['okQty']) ?? 0,
        rejectedQty: _num(j['rejectedQty']) ?? 0,
        qualityPct: _num(j['qualityPct']),
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
    this.yearRejectedQty = 0,
    this.yearQualityPct,
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
  final double yearRejectedQty;
  final double? yearQualityPct;
  final double? yearPct;
  final String? yearStatus;

  bool get yearly => targetPeriod == 'Yearly';
  /// A % target is measured on Quality %, a Qty target on OK Qty.
  bool get pctTarget => target.uom == '%';

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
      yearRejectedQty: _num(j['yearRejectedQty']) ?? 0,
      yearQualityPct: _num(j['yearQualityPct']),
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

/// How one department's year stands (the "Departments at a glance" lines).
class DepartmentSummary {
  const DepartmentSummary({required this.id, required this.name, required this.objectives, required this.onTrack, required this.near, required this.behind, required this.okQty, this.avgPct});
  final String id;
  final String name;
  final int objectives;
  final int onTrack;
  final int near;
  final int behind;
  final double okQty;
  final double? avgPct;

  String? get status => avgPct == null ? null : avgPct! >= 100 ? 'On track' : avgPct! >= 80 ? 'Near' : 'Behind';

  factory DepartmentSummary.from(Map j) => DepartmentSummary(
        id: _str(j['_id']),
        name: _str(j['departmentName']),
        objectives: (_num(j['objectives']) ?? 0).toInt(),
        onTrack: (_num(j['onTrack']) ?? 0).toInt(),
        near: (_num(j['near']) ?? 0).toInt(),
        behind: (_num(j['behind']) ?? 0).toInt(),
        okQty: _num(j['okQty']) ?? 0,
        avgPct: _num(j['avgPct']),
      );
}

class KpiPage {
  const KpiPage({required this.objectives, required this.departments, required this.canAddAnyDepartment, this.byDepartment = const []});
  final List<KpiObjective> objectives;
  final List<KpiDepartment> departments;
  final bool canAddAnyDepartment;
  final List<DepartmentSummary> byDepartment;
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

/// A business figure of the Company Level Objective board (server/utils/companyMetrics.js).
/// unit: "₹" money · "%" · "ratio" · "count"; agg: how a year adds up.
class CompanyMetric {
  const CompanyMetric(this.key, this.label, this.unit, this.agg, this.group);
  final String key;
  final String label;
  final String unit;
  final String agg;
  final String group;
}

const companyMetrics = [
  CompanyMetric('sales', 'Sales', '₹', 'sum', 'Sales'),
  CompanyMetric('targetSales', 'Target Sales', '₹', 'sum', 'Sales'),
  CompanyMetric('orderBooking', 'Order Booking', '₹', 'sum', 'Sales'),
  CompanyMetric('salary', 'Total Salary', '₹', 'sum', 'Cost'),
  CompanyMetric('electricityBill', 'Electricity Bill', '₹', 'sum', 'Cost'),
  CompanyMetric('fgValue', 'FG (finished goods)', '₹', 'avg', 'Inventory'),
  CompanyMetric('rmValue', 'RM (raw material)', '₹', 'avg', 'Inventory'),
  CompanyMetric('wipValue', 'WIP (semi finished)', '₹', 'avg', 'Inventory'),
  CompanyMetric('inventoryTurnover', 'Inventory Turnover', 'ratio', 'avg', 'Inventory'),
  CompanyMetric('onTimeDelivery', 'On Time Delivery', '%', 'avg', 'Service'),
  CompanyMetric('customerComplaints', 'Customer Complaints', 'count', 'sum', 'Service'),
];

CompanyMetric? companyMetric(String key) => companyMetrics.where((m) => m.key == key).firstOrNull;

/// One metric's year: its 12 months (null = no figure), the year's figure and last year's.
class MetricYear {
  const MetricYear({required this.months, this.year, this.prevYear, this.monthsWithData = 0});
  final List<double?> months;
  final double? year;
  final double? prevYear;
  final int monthsWithData;

  static const empty = MetricYear(months: [null, null, null, null, null, null, null, null, null, null, null, null]);

  factory MetricYear.from(dynamic j) {
    if (j is! Map) return empty;
    final raw = (j['months'] as List? ?? const []);
    return MetricYear(
      months: [for (var i = 0; i < 12; i++) i < raw.length ? _num(raw[i]) : null],
      year: _num(j['year']),
      prevYear: _num(j['prevYear']),
      monthsWithData: (_num(j['monthsWithData']) ?? 0).toInt(),
    );
  }

  /// The figure in scope: the whole year (month 0) or one month.
  double? at(int month) => month == 0 ? year : months[month - 1];
  /// What it is compared with: last year, or the month before.
  double? before(int month) => month == 0 ? prevYear : (month > 1 ? months[month - 2] : null);
}

/// The stored figures of one month, as typed or uploaded.
class CompanyMonthRow {
  const CompanyMonthRow({required this.month, required this.values, this.updatedByName = ''});
  final int month;
  final Map<String, double?> values;
  final String updatedByName;

  factory CompanyMonthRow.from(Map j) => CompanyMonthRow(
        month: (_num(j['month']) ?? 0).toInt(),
        values: {for (final m in companyMetrics) m.key: _num((j['values'] as Map?)?[m.key])},
        updatedByName: _str(j['updatedByName']),
      );
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
    this.metrics = const {},
    this.monthsWithFigures = const [],
    this.monthly = const [],
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
  /// By metric key, plus "labourProductivity" (Sales ÷ Salary, worked out by the server).
  final Map<String, MetricYear> metrics;
  final List<bool> monthsWithFigures;
  final List<CompanyMonthRow> monthly;

  MetricYear metric(String key) => metrics[key] ?? MetricYear.empty;
  /// OK Qty in scope (month 0 = the year) and what it is compared with.
  double okQtyAt(int month) => month == 0 ? yearOkQty : (byMonth.length >= month ? byMonth[month - 1].okQty : 0);
  double? okQtyBefore(int month) => month == 0 ? byYear.where((y) => y.year == year - 1).firstOrNull?.okQty : (month > 1 && byMonth.length >= month - 1 ? byMonth[month - 2].okQty : null);

  factory CompanySummary.from(Map j) => CompanySummary(
        metrics: {for (final e in ((j['metrics'] as Map?) ?? const {}).entries) '${e.key}': MetricYear.from(e.value)},
        monthsWithFigures: [for (final f in (j['monthsWithFigures'] as List? ?? const [])) f == true],
        monthly: [for (final m in (j['monthly'] as List? ?? const [])) if (m is Map) CompanyMonthRow.from(m)],
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
