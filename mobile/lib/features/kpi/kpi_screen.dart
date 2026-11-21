import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../../app/app_scaffold.dart';
import '../../core/api/api_client.dart' show ApiException;
import '../../core/theme/app_colors.dart';
import '../../core/utils/alerts.dart';
import '../../core/widgets/page_permissions.dart';
import '../../core/widgets/states.dart';
import 'kpi_models.dart';
import 'kpi_repository.dart';
import 'kpi_widgets.dart';

/// Data Entry › KPI — a department's objectives for a year: each one's month
/// table (Baseline, Target, OK Qty from the entries, Achievement, Status) or
/// a line graph, one line per objective. Mirrors client/src/pages/Kpi.jsx.
/// Excel upload / download stay on the website.
class KpiScreen extends StatefulWidget {
  const KpiScreen({super.key});
  @override
  State<KpiScreen> createState() => _KpiScreenState();
}

const _help = [
  'Pick a department. Each department\'s own people add its objectives; Super Admin and Full access users can add for any department.',
  'Add Objective: name it, tick the processes it covers, and type the Baseline and the Target — each with its own unit, Qty or %.',
  'Choose whether the Target is Monthly (each month is compared with it) or Yearly (the year so far is compared with it).',
  'OK Qty is never typed: every month is the sum of those processes\' data entries. A Target in Qty is compared with the OK Qty; a Target in % with the month\'s Quality % = OK ÷ (OK + Rejected). On track from 100%, Near from 80%, Behind below.',
  'Departments at a glance: one line per department — objectives, on track / near / behind, average achievement. Tap a line to see that department.',
  'Switch to Graph for a line per objective. Old sheets are loaded with Upload Excel on the website.',
];

const _lineColors = [Color(0xFF2563EB), Color(0xFF16A34A), Color(0xFFDC2626), Color(0xFFD97706), Color(0xFF7C3AED), Color(0xFF0891B2), Color(0xFFBE185D), Color(0xFF4D7C0F)];

class _KpiScreenState extends State<KpiScreen> {
  final _repo = const KpiRepository();
  int _year = DateTime.now().year;
  String _departmentId = '';
  bool _graph = false;
  KpiPage? _page;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final page = await _repo.objectives(_year);
      if (!mounted) return;
      setState(() {
        _page = page;
        _error = null;
        if (_departmentId.isEmpty && page.departments.length == 1) _departmentId = page.departments.first.id;
        if (_departmentId.isNotEmpty && !page.departments.any((d) => d.id == _departmentId)) _departmentId = '';
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load KPI objectives');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<int> get _years {
    final y = DateTime.now().year;
    return {..._page?.objectives.map((o) => o.year) ?? const <int>[], y + 1, y, y - 1, y - 2, y - 3}.toList()..sort();
  }

  List<KpiObjective> get _objectives =>
      (_page?.objectives ?? const []).where((o) => _departmentId.isEmpty || o.departmentId == _departmentId).toList();

  KpiDepartment? get _department => _page?.departments.where((d) => d.id == _departmentId).firstOrNull;

  Future<void> _delete(KpiObjective o) async {
    if (!await Alerts.confirm(context, 'Delete "${o.objective}"? Its uploaded figures go with it.', confirmText: 'Delete')) return;
    try {
      await _repo.deleteObjective(o.id);
      Alerts.success('Objective deleted');
      await _load();
    } on ApiException catch (e) {
      Alerts.error(e.message);
    }
  }

  Future<void> _addDepartment() async {
    final name = TextEditingController();
    final remark = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add Department'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, autofocus: true, decoration: const InputDecoration(labelText: 'Department name *', hintText: 'e.g. Production, Quality, Sales')),
          const SizedBox(height: 8),
          TextField(controller: remark, decoration: const InputDecoration(labelText: 'Remark')),
          const SizedBox(height: 8),
          Text('Saved in Operator Management › Department and selected here at once.', style: TextStyle(fontSize: 12, color: Theme.of(ctx).colorScheme.onSurfaceVariant)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Add Department')),
        ],
      ),
    );
    if (ok != true) return;
    if (name.text.trim().isEmpty) return Alerts.error('Type the department name');
    try {
      final id = await _repo.addDepartment(name.text.trim(), remark.text.trim());
      Alerts.success('Department "${name.text.trim()}" added');
      await _load();
      if (id != null && mounted) setState(() => _departmentId = id);
    } on ApiException catch (e) {
      Alerts.error(e.message);
    }
  }

  Future<void> _openForm([KpiObjective? existing]) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _ObjectiveForm(repo: _repo, page: _page!, year: _year, departmentId: _departmentId, existing: existing),
    );
    if (saved == true) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final perms = PagePermissions.of(context);
    final page = _page;
    return AppScaffold(
      title: 'KPI',
      actions: [
        if (page?.canAddAnyDepartment == true) IconButton(tooltip: 'Add Department', onPressed: _addDepartment, icon: const Icon(Icons.domain_add_outlined)),
        IconButton(tooltip: 'Refresh', onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh)),
      ],
      floatingActionButton: perms.create && page != null && (page.departments.isNotEmpty || page.canAddAnyDepartment)
          ? FloatingActionButton.extended(onPressed: () => _openForm(), icon: const Icon(Icons.add), label: const Text('Add Objective'))
          : null,
      body: _error != null && page == null
          ? ErrorView(message: _error!, onRetry: _load)
          : page == null
              ? const LoadingView()
              : RefreshIndicator(onRefresh: _load, child: _body(context, page, perms)),
    );
  }

  Widget _body(BuildContext context, KpiPage page, dynamic perms) {
    final objectives = _objectives;
    final pcts = objectives.map((o) => o.yearPct).whereType<double>().toList();
    final avg = pcts.isEmpty ? null : pcts.reduce((a, b) => a + b) / pcts.length;
    final onTrack = objectives.where((o) => o.yearStatus == 'On track').length;
    final behind = objectives.where((o) => o.yearStatus == 'Behind').length;
    final okQty = objectives.fold<double>(0, (a, o) => a + o.yearOkQty);
    final dept = _department;
    final s = Theme.of(context).colorScheme;

    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 96),
      children: [
        Text('Department objectives against the OK Qty from the data entries', style: TextStyle(color: s.onSurfaceVariant, fontSize: 13)),
        const HowItWorks(items: _help),
        Wrap(
          spacing: 16,
          runSpacing: 12,
          crossAxisAlignment: WrapCrossAlignment.end,
          children: [
            Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              const FieldCaption('Year'),
              YearStepper(years: _years, value: _year, onChanged: (y) { setState(() => _year = y); _load(); }),
            ]),
            SizedBox(
              width: 260,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                const FieldCaption('Department'),
                if (page.departments.isEmpty)
                  Text(page.canAddAnyDepartment ? 'No department yet — tap the Add Department icon.' : 'No department on your Employee record yet — ask the Super Admin.', style: TextStyle(fontSize: 13, color: s.onSurfaceVariant))
                else
                  DropdownButtonFormField<String>(
                    initialValue: _departmentId,
                    isExpanded: true,
                    decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
                    items: [
                      if (page.departments.length > 1) DropdownMenuItem(value: '', child: Text('All departments (${page.objectives.length})')),
                      for (final d in page.departments)
                        DropdownMenuItem(value: d.id, child: Text('${d.name} (${page.objectives.where((o) => o.departmentId == d.id).length})', overflow: TextOverflow.ellipsis)),
                    ],
                    onChanged: (v) => setState(() => _departmentId = v ?? ''),
                  ),
              ]),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (page.departments.isNotEmpty) ...[
          StatGrid(tiles: [
            StatTile(label: 'Objectives', value: '${objectives.length}', icon: Icons.track_changes, hint: '${dept?.name ?? 'all departments'} · $_year'),
            StatTile(label: 'OK Qty · $_year', value: fmtQty(okQty), icon: Icons.layers_outlined, tone: const Color(0xFF0891B2), hint: 'from the data entries'),
            StatTile(label: 'Avg achievement', value: fmtPct(avg), icon: Icons.check_circle_outline, tone: AppColors.ok, hint: 'of the objectives with data'),
            StatTile(label: 'On track / Behind', value: '$onTrack / $behind', icon: Icons.show_chart, tone: AppColors.warn, hint: 'objectives this year'),
          ]),
          if (page.byDepartment.length > 1) ...[
            const SizedBox(height: 12),
            _DepartmentsCard(page: page, year: _year, selected: _departmentId, onPick: (id) => setState(() => _departmentId = id)),
          ],
          const SizedBox(height: 12),
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, icon: Icon(Icons.table_chart_outlined), label: Text('Table')),
              ButtonSegment(value: true, icon: Icon(Icons.show_chart), label: Text('Graph')),
            ],
            selected: {_graph},
            onSelectionChanged: (v) => setState(() => _graph = v.first),
            showSelectedIcon: false,
          ),
          const SizedBox(height: 12),
          if (objectives.isEmpty)
            EmptyView(message: _loading ? 'Loading…' : 'No objective ${dept == null ? '' : 'for ${dept.name} '}in $_year yet. Tap Add Objective to start.', icon: Icons.track_changes)
          else if (_graph)
            _GraphCard(year: _year, objectives: objectives)
          else
            for (final o in objectives) _ObjectiveCard(objective: o, showDepartment: dept == null, canEdit: perms.edit, canDelete: perms.delete, onEdit: () => _openForm(o), onDelete: () => _delete(o)),
        ],
      ],
    );
  }
}

/// One line per department: objectives, on track / near / behind, average achievement.
class _DepartmentsCard extends StatelessWidget {
  const _DepartmentsCard({required this.page, required this.year, required this.selected, required this.onPick});
  final KpiPage page;
  final int year;
  final String selected;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final pcts = page.objectives.map((o) => o.yearPct).whereType<double>().toList();
    final all = DepartmentSummary(
      id: '',
      name: 'All departments',
      objectives: page.objectives.length,
      onTrack: page.byDepartment.fold(0, (a, d) => a + d.onTrack),
      near: page.byDepartment.fold(0, (a, d) => a + d.near),
      behind: page.byDepartment.fold(0, (a, d) => a + d.behind),
      okQty: page.byDepartment.fold(0.0, (a, d) => a + d.okQty),
      avgPct: pcts.isEmpty ? null : pcts.reduce((a, b) => a + b) / pcts.length,
    );
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: s.outlineVariant)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
          child: Row(children: [
            Expanded(child: Text('Departments at a glance · $year', style: const TextStyle(fontWeight: FontWeight.w700))),
            Text('tap a line', style: TextStyle(fontSize: 12, color: s.onSurfaceVariant)),
          ]),
        ),
        for (final d in [all, ...page.byDepartment])
          InkWell(
            onTap: () => onPick(d.id),
            child: Container(
              color: d.id == selected ? AppColors.brand600.withValues(alpha: .08) : null,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text(d.name, style: TextStyle(fontWeight: d.id.isEmpty ? FontWeight.w800 : FontWeight.w600))),
                  Text(fmtPct(d.avgPct), style: const TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(width: 8),
                  StatusPill(d.status),
                ]),
                const SizedBox(height: 4),
                AchievementBar(pct: d.avgPct, status: d.status),
                const SizedBox(height: 4),
                Wrap(spacing: 10, children: [
                  Text('${d.objectives} objective${d.objectives == 1 ? '' : 's'}', style: TextStyle(fontSize: 12, color: s.onSurfaceVariant)),
                  Text('OK Qty ${fmtQty(d.okQty)}', style: TextStyle(fontSize: 12, color: s.onSurfaceVariant)),
                  Text('${d.onTrack} on track', style: const TextStyle(fontSize: 12, color: AppColors.ok)),
                  Text('${d.near} near', style: const TextStyle(fontSize: 12, color: AppColors.warn)),
                  Text('${d.behind} behind', style: const TextStyle(fontSize: 12, color: AppColors.critical)),
                ]),
              ]),
            ),
          ),
        const SizedBox(height: 4),
      ]),
    );
  }
}

class _ObjectiveCard extends StatelessWidget {
  const _ObjectiveCard({required this.objective, required this.showDepartment, required this.canEdit, required this.canDelete, required this.onEdit, required this.onDelete});
  final KpiObjective objective;
  final bool showDepartment;
  final bool canEdit;
  final bool canDelete;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final o = objective;
    final s = Theme.of(context).colorScheme;
    final muted = TextStyle(fontSize: 12, color: s.onSurfaceVariant);
    final yearly = o.yearly;
    // A % target is measured on Quality %; show it unless the OK Qty column already does.
    final qualityCol = o.pctTarget && o.okQtyUom != '%';
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: s.outlineVariant)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 4, 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                      Text(o.objective, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      StatusPill(o.yearStatus),
                      if (showDepartment) Text(o.departmentName, style: muted),
                    ]),
                    if (o.processes.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Wrap(spacing: 4, runSpacing: 4, children: [
                          for (final p in o.processes)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                              decoration: BoxDecoration(color: AppColors.brand600.withValues(alpha: .1), borderRadius: BorderRadius.circular(6)),
                              child: Text(p.name.isEmpty ? 'Process' : p.name, style: const TextStyle(fontSize: 11, color: AppColors.brand600, fontWeight: FontWeight.w600)),
                            ),
                        ]),
                      ),
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        'Baseline ${measureText(o.baseline)} · Target ${measureText(o.target)} (${o.targetPeriod}) · Achievement ${fmtPct(o.yearPct)}${o.owner.isEmpty ? '' : ' · Owner ${o.owner}'}',
                        style: muted,
                      ),
                    ),
                    if (o.remarks.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text(o.remarks, style: const TextStyle(fontSize: 13))),
                    Padding(padding: const EdgeInsets.only(top: 8), child: AchievementBar(pct: o.yearPct, status: o.yearStatus)),
                  ]),
                ),
                if (canEdit) IconButton(tooltip: 'Edit', onPressed: onEdit, icon: const Icon(Icons.edit_outlined, size: 20)),
                if (canDelete) IconButton(tooltip: 'Delete', onPressed: onDelete, icon: const Icon(Icons.delete_outline, size: 20, color: AppColors.critical)),
              ],
            ),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              headingRowHeight: 36,
              dataRowMinHeight: 34,
              dataRowMaxHeight: 40,
              columnSpacing: 18,
              headingTextStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
              columns: [
                const DataColumn(label: Text('Month')),
                DataColumn(label: Text('Baseline (${o.baseline.uom})'), numeric: true),
                DataColumn(label: Text('Target (${o.target.uom})'), numeric: true),
                DataColumn(label: Text(o.okQtyUom == '%' ? 'Quality %' : 'OK Qty'), numeric: true, tooltip: o.okQtyUom == '%' ? 'OK ÷ (OK + Rejected), from the entries' : 'From the entries'),
                if (qualityCol) const DataColumn(label: Text('Quality %'), numeric: true, tooltip: 'OK ÷ (OK + Rejected), from the entries'),
                if (yearly) const DataColumn(label: Text('OK Qty so far'), numeric: true),
                const DataColumn(label: Text('Achievement'), numeric: true),
                const DataColumn(label: Text('Status')),
              ],
              rows: [
                for (final m in o.months)
                  DataRow(cells: [
                    DataCell(Text('${kpiMonths[m.month - 1]} ${o.year}')),
                    DataCell(Text(measureText(o.baseline))),
                    DataCell(Text(measureText(o.target))),
                    DataCell(Tooltip(
                      message: '${fmtQty(m.okQty)} OK · ${fmtQty(m.rejectedQty)} rejected',
                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                        Text(o.okQtyUom == '%' ? fmtPct(m.qualityPct) : fmtQty(m.okQty), style: const TextStyle(fontWeight: FontWeight.w600)),
                        if (m.source == 'excel') Padding(padding: const EdgeInsets.only(left: 4), child: Text('Excel', style: TextStyle(fontSize: 10, color: s.onSurfaceVariant))),
                      ]),
                    )),
                    if (qualityCol) DataCell(Text(fmtPct(m.qualityPct))),
                    if (yearly) DataCell(Text(fmtQty(m.cumulative))),
                    DataCell(Text(fmtPct(m.pctOfTarget))),
                    DataCell(StatusPill(m.status)),
                  ]),
                DataRow(color: WidgetStatePropertyAll(s.surfaceContainerHighest.withValues(alpha: .5)), cells: [
                  const DataCell(Text('Year', style: TextStyle(fontWeight: FontWeight.w700))),
                  const DataCell(Text('')),
                  const DataCell(Text('')),
                  DataCell(Text(o.okQtyUom == '%' ? fmtPct(o.yearQualityPct) : fmtQty(o.yearOkQty), style: const TextStyle(fontWeight: FontWeight.w700))),
                  if (qualityCol) DataCell(Text(fmtPct(o.yearQualityPct), style: const TextStyle(fontWeight: FontWeight.w700))),
                  if (yearly) DataCell(Text(fmtQty(o.yearOkQty), style: const TextStyle(fontWeight: FontWeight.w700))),
                  DataCell(Text(fmtPct(o.yearPct), style: const TextStyle(fontWeight: FontWeight.w700))),
                  DataCell(StatusPill(o.yearStatus)),
                ]),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 10),
            child: Text(
              o.pctTarget
                  ? 'Target in %: each month\'s Quality % — OK ÷ (OK + Rejected) from the entries — is compared with it${yearly ? ', on the year so far' : ''}. A month loaded from Excel has no rejected figure, so no Quality %.'
                  : 'Target in Qty: each month\'s OK Qty is compared with it${yearly ? ', on the year so far' : ''}.',
              style: muted,
            ),
          ),
        ],
      ),
    );
  }
}

class _GraphCard extends StatelessWidget {
  const _GraphCard({required this.year, required this.objectives});
  final int year;
  final List<KpiObjective> objectives;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final maxY = objectives.fold<double>(0, (a, o) => o.months.fold(a, (b, m) => m.okQty > b ? m.okQty : b));
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: s.outlineVariant)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 12, 12, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(padding: const EdgeInsets.only(left: 8, bottom: 8), child: Text('OK Qty by month · $year', style: const TextStyle(fontWeight: FontWeight.w700))),
          SizedBox(
            height: 260,
            child: LineChart(
              LineChartData(
                minX: 1,
                maxX: 12,
                minY: 0,
                maxY: maxY <= 0 ? 10 : maxY * 1.1,
                gridData: FlGridData(show: true, drawVerticalLine: false, getDrawingHorizontalLine: (_) => FlLine(color: s.outlineVariant, strokeWidth: 1, dashArray: [4, 4])),
                borderData: FlBorderData(show: false),
                titlesData: FlTitlesData(
                  topTitles: const AxisTitles(),
                  rightTitles: const AxisTitles(),
                  bottomTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, interval: 1, reservedSize: 24, getTitlesWidget: (v, _) => Padding(padding: const EdgeInsets.only(top: 4), child: Text(kpiMonths[(v.toInt() - 1).clamp(0, 11)], style: const TextStyle(fontSize: 10))))),
                  leftTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 44, getTitlesWidget: (v, _) => Text(fmtQty(v), style: const TextStyle(fontSize: 10)))),
                ),
                lineTouchData: LineTouchData(touchTooltipData: LineTouchTooltipData(getTooltipItems: (spots) => [
                  for (final sp in spots) LineTooltipItem('${objectives[sp.barIndex].objective}\n${kpiMonths[sp.x.toInt() - 1]}: ${fmtQty(sp.y)}', TextStyle(color: _lineColors[sp.barIndex % _lineColors.length], fontSize: 11, fontWeight: FontWeight.w600)),
                ])),
                lineBarsData: [
                  for (var i = 0; i < objectives.length; i++)
                    LineChartBarData(
                      spots: [for (final m in objectives[i].months) FlSpot(m.month.toDouble(), m.okQty)],
                      color: _lineColors[i % _lineColors.length],
                      barWidth: 2.5,
                      isCurved: true,
                      curveSmoothness: .25,
                      preventCurveOverShooting: true,
                      dotData: const FlDotData(show: true),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Wrap(spacing: 12, runSpacing: 4, children: [
            for (var i = 0; i < objectives.length; i++)
              Row(mainAxisSize: MainAxisSize.min, children: [
                Container(width: 10, height: 10, decoration: BoxDecoration(color: _lineColors[i % _lineColors.length], shape: BoxShape.circle)),
                const SizedBox(width: 4),
                Text('${objectives[i].departmentName} · ${objectives[i].objective}', style: const TextStyle(fontSize: 12)),
              ]),
          ]),
          const SizedBox(height: 12),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              headingRowHeight: 36,
              dataRowMinHeight: 32,
              dataRowMaxHeight: 36,
              columnSpacing: 18,
              headingTextStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
              columns: [const DataColumn(label: Text('Month')), for (final o in objectives) DataColumn(label: Text(o.objective), numeric: true)],
              rows: [
                for (var m = 0; m < 12; m++)
                  DataRow(cells: [DataCell(Text('${kpiMonths[m]} $year')), for (final o in objectives) DataCell(Text(fmtQty(o.months.length > m ? o.months[m].okQty : 0)))]),
                DataRow(color: WidgetStatePropertyAll(s.surfaceContainerHighest.withValues(alpha: .5)), cells: [
                  const DataCell(Text('Year total', style: TextStyle(fontWeight: FontWeight.w700))),
                  for (final o in objectives) DataCell(Text(fmtQty(o.yearOkQty), style: const TextStyle(fontWeight: FontWeight.w700))),
                ]),
              ],
            ),
          ),
        ]),
      ),
    );
  }
}

/// Add / Update Objective, as a bottom sheet.
class _ObjectiveForm extends StatefulWidget {
  const _ObjectiveForm({required this.repo, required this.page, required this.year, required this.departmentId, this.existing});
  final KpiRepository repo;
  final KpiPage page;
  final int year;
  final String departmentId;
  final KpiObjective? existing;
  @override
  State<_ObjectiveForm> createState() => _ObjectiveFormState();
}

class _ObjectiveFormState extends State<_ObjectiveForm> {
  late final _objective = TextEditingController(text: widget.existing?.objective ?? '');
  late final _owner = TextEditingController(text: widget.existing?.owner ?? '');
  late final _remarks = TextEditingController(text: widget.existing?.remarks ?? '');
  late final _baseline = TextEditingController(text: _v(widget.existing?.baseline.value));
  late final _target = TextEditingController(text: _v(widget.existing?.target.value));
  late String _department = widget.existing?.departmentId ?? widget.departmentId;
  late int _year = widget.existing?.year ?? widget.year;
  late String _baselineUom = widget.existing?.baseline.uom ?? 'Qty';
  late String _targetUom = widget.existing?.target.uom ?? 'Qty';
  late String _period = widget.existing?.targetPeriod ?? 'Monthly';
  late String _okUom = widget.existing?.okQtyUom ?? 'Qty';
  late final Set<String> _processes = {for (final p in widget.existing?.processes ?? const <KpiProcessRef>[]) p.id};
  List<KpiProcessRef> _allProcesses = const [];
  bool _saving = false;

  static String _v(double? n) => n == null ? '' : (n == n.roundToDouble() ? n.toInt().toString() : n.toString());

  @override
  void initState() {
    super.initState();
    widget.repo.processes().then((p) { if (mounted) setState(() => _allProcesses = p); }).catchError((_) {});
  }

  Future<void> _save() async {
    if (_objective.text.trim().isEmpty) return Alerts.error('Type the objective');
    if (_department.isEmpty) return Alerts.error('Select a department');
    if (_processes.isEmpty && (widget.existing?.months.any((m) => m.source == 'excel') != true)) return Alerts.error('Select at least one process');
    if (_target.text.trim().isEmpty) return Alerts.error('Type the Target — Achievement is measured against it');
    setState(() => _saving = true);
    try {
      await widget.repo.saveObjective({
        'objective': _objective.text.trim(),
        'department': _department,
        'year': _year,
        'processes': _processes.toList(),
        'baseline': {'value': _baseline.text.trim(), 'uom': _baselineUom},
        'target': {'value': _target.text.trim(), 'uom': _targetUom},
        'targetPeriod': _period,
        'okQtyUom': _okUom,
        'owner': _owner.text.trim(),
        'remarks': _remarks.text.trim(),
      }, id: widget.existing?.id);
      Alerts.success(widget.existing == null ? 'Objective added' : 'Objective updated');
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      Alerts.error(e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: .92,
        maxChildSize: .97,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            Text(widget.existing == null ? 'Add Objective' : 'Update Objective', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            TextField(controller: _objective, decoration: const InputDecoration(labelText: 'Objective *', hintText: 'e.g. Increase OK output of CNC')),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _department.isEmpty ? null : _department,
              decoration: const InputDecoration(labelText: 'Department *'),
              items: [for (final d in widget.page.departments) DropdownMenuItem(value: d.id, child: Text(d.name))],
              onChanged: (!widget.page.canAddAnyDepartment && widget.page.departments.length == 1) ? null : (v) => setState(() => _department = v ?? ''),
            ),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: YearDropdown(years: yearRange([_year]), value: _year, onChanged: (y) => setState(() => _year = y))),
              const SizedBox(width: 12),
              Expanded(child: TextField(controller: _owner, decoration: const InputDecoration(labelText: 'Owner', hintText: 'Who is responsible'))),
            ]),
            const SizedBox(height: 12),
            const FieldCaption('Processes *'),
            if (_allProcesses.isEmpty)
              Text('Loading processes…', style: TextStyle(fontSize: 12, color: s.onSurfaceVariant))
            else
              Wrap(spacing: 6, runSpacing: 6, children: [
                for (final p in _allProcesses)
                  FilterChip(label: Text(p.name), selected: _processes.contains(p.id), onSelected: (on) => setState(() => on ? _processes.add(p.id) : _processes.remove(p.id))),
              ]),
            Padding(padding: const EdgeInsets.only(top: 4), child: Text("OK Qty for each month is the sum of these processes' entries — nobody types it.", style: TextStyle(fontSize: 12, color: s.onSurfaceVariant))),
            const SizedBox(height: 12),
            MeasureField(label: 'Baseline', controller: _baseline, uom: _baselineUom, onUom: (u) => setState(() => _baselineUom = u), hint: 'Where you stand today — for reference on every row.'),
            const SizedBox(height: 12),
            MeasureField(label: 'Target', controller: _target, uom: _targetUom, onUom: (u) => setState(() => _targetUom = u), required: true, hint: _targetUom == '%' ? 'In %: the month\'s Quality % — OK ÷ (OK + Rejected) — is compared with it.' : 'In Qty: the month\'s OK Qty is compared with it.'),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _period,
              decoration: const InputDecoration(labelText: 'Target is'),
              items: const [
                DropdownMenuItem(value: 'Monthly', child: Text('Monthly — each month is compared with it')),
                DropdownMenuItem(value: 'Yearly', child: Text('Yearly — the year so far is compared with it')),
              ],
              onChanged: (v) => setState(() => _period = v ?? 'Monthly'),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _okUom,
              decoration: const InputDecoration(labelText: 'OK Qty shown as'),
              items: const [DropdownMenuItem(value: 'Qty', child: Text('Qty — the count')), DropdownMenuItem(value: '%', child: Text('% — Quality %, OK ÷ (OK + Rejected)'))],
              onChanged: (v) => setState(() => _okUom = v ?? 'Qty'),
            ),
            const SizedBox(height: 12),
            TextField(controller: _remarks, maxLines: 2, decoration: const InputDecoration(labelText: 'Remarks', hintText: 'How it will be achieved, review dates, anything the team should know')),
            const SizedBox(height: 20),
            Row(children: [
              Expanded(child: OutlinedButton(onPressed: _saving ? null : () => Navigator.pop(context, false), child: const Text('Cancel'))),
              const SizedBox(width: 12),
              Expanded(child: FilledButton(onPressed: _saving ? null : _save, child: Text(_saving ? 'Saving…' : widget.existing == null ? 'Save' : 'Update'))),
            ]),
          ],
        ),
      ),
    );
  }
}
