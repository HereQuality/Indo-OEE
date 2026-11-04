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

/// Data Entry › Company Level Objective — the company's objectives for a year
/// over the company-wide OK Qty: by month, the year, and all time, plus the
/// average achievement of the year's department KPIs. Mirrors
/// client/src/pages/CompanyObjective.jsx; Excel upload / download stay on the website.
class CompanyObjectiveScreen extends StatefulWidget {
  const CompanyObjectiveScreen({super.key});
  @override
  State<CompanyObjectiveScreen> createState() => _CompanyObjectiveScreenState();
}

const _help = [
  'Add Objective: the company-level objective, its Target (sales) and Baseline, each with its own unit — Qty or %. Add an Owner and Remarks so everyone knows who drives it and how.',
  'OK Qty here is the whole company: every process\'s data entries added up — for the chosen month, the year, and all time. Nobody types it.',
  'Achieved % compares the year\'s OK Qty with a Target in Qty; On track from 100%, Near from 80%, Behind below.',
  'Avg achievement % is the average of the department KPIs\' own achievement for the year (KPI page).',
  'Old sheets are loaded with Upload Excel on the website.',
];

class _CompanyObjectiveScreenState extends State<CompanyObjectiveScreen> {
  final _repo = const KpiRepository();
  int _year = DateTime.now().year;
  int _month = DateTime.now().month;
  CompanySummary? _summary;
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
      final s = await _repo.company(_year);
      if (mounted) setState(() { _summary = s; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load the company objectives');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<int> get _years {
    final y = DateTime.now().year;
    return {..._summary?.byYear.map((e) => e.year) ?? const <int>[], y + 1, y, y - 1, y - 2, y - 3}.toList()..sort();
  }

  Future<void> _delete(CompanyObjective o) async {
    if (!await Alerts.confirm(context, 'Delete "${o.objective}"?', confirmText: 'Delete')) return;
    try {
      await _repo.deleteCompany(o.id);
      Alerts.success('Objective deleted');
      await _load();
    } on ApiException catch (e) {
      Alerts.error(e.message);
    }
  }

  Future<void> _openForm([CompanyObjective? existing]) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _CompanyForm(repo: _repo, year: _year, existing: existing),
    );
    if (saved == true) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final perms = PagePermissions.of(context);
    final sum = _summary;
    return AppScaffold(
      title: 'Company Level Objective',
      actions: [IconButton(tooltip: 'Refresh', onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh))],
      floatingActionButton: perms.create ? FloatingActionButton.extended(onPressed: () => _openForm(), icon: const Icon(Icons.add), label: const Text('Add Objective')) : null,
      body: _error != null && sum == null
          ? ErrorView(message: _error!, onRetry: _load)
          : sum == null
              ? const LoadingView()
              : RefreshIndicator(onRefresh: _load, child: _body(context, sum, perms)),
    );
  }

  Widget _body(BuildContext context, CompanySummary sum, dynamic perms) {
    final s = Theme.of(context).colorScheme;
    final muted = TextStyle(fontSize: 12, color: s.onSurfaceVariant);
    final monthOk = sum.byMonth.length >= _month ? sum.byMonth[_month - 1].okQty : 0.0;
    final prevMonthOk = _month > 1 && sum.byMonth.length >= _month - 1 ? sum.byMonth[_month - 2].okQty : null;
    final prevYearOk = sum.byYear.where((y) => y.year == _year - 1).firstOrNull?.okQty;
    final maxMonth = sum.byMonth.fold<double>(0, (a, m) => m.okQty > a ? m.okQty : a);

    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 96),
      children: [
        Text("Company-wide OK Qty against the year's objectives", style: TextStyle(color: s.onSurfaceVariant, fontSize: 13)),
        const HowItWorks(items: _help),
        Wrap(spacing: 16, runSpacing: 12, crossAxisAlignment: WrapCrossAlignment.end, children: [
          Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            const FieldCaption('Year'),
            YearStepper(years: _years, value: _year, onChanged: (y) { setState(() => _year = y); _load(); }),
          ]),
        ]),
        const SizedBox(height: 12),
        const FieldCaption('Month'),
        MonthChips(value: _month, onChanged: (m) => setState(() => _month = m), hasData: [for (final m in sum.byMonth) m.okQty > 0]),
        const SizedBox(height: 12),
        StatGrid(tiles: [
          StatTile(label: 'Avg achievement', value: fmtPct(sum.avgAchievementPct), icon: Icons.track_changes, tone: AppColors.ok, hint: '${sum.kpiObjectiveCount} department KPI${sum.kpiObjectiveCount == 1 ? '' : 's'} · ${sum.kpiOnTrack} on track · ${sum.kpiBehind} behind'),
          StatTile(label: 'OK Qty · ${kpiMonths[_month - 1]} $_year', value: fmtQty(monthOk), icon: Icons.calendar_month_outlined, delta: deltaPct(monthOk, prevMonthOk), deltaLabel: _month > 1 ? 'vs ${kpiMonths[_month - 2]}' : null, hint: 'all processes'),
          StatTile(label: 'OK Qty · $_year', value: fmtQty(sum.yearOkQty), icon: Icons.business_outlined, tone: const Color(0xFF0891B2), delta: deltaPct(sum.yearOkQty, prevYearOk), deltaLabel: 'vs ${_year - 1}', hint: 'sum of the year'),
          StatTile(label: 'OK Qty · all time', value: fmtQty(sum.totalOkQty), icon: Icons.layers_outlined, tone: Colors.blueGrey, hint: '${sum.byYear.length} year${sum.byYear.length == 1 ? '' : 's'} of entries'),
        ]),
        const SizedBox(height: 16),
        _card(context, 'Objectives · $_year', sum.objectives.isEmpty
            ? Padding(padding: const EdgeInsets.all(12), child: Text(_loading ? 'Loading…' : 'No company objective for this year yet. Tap Add Objective to set the first one.', style: muted))
            : Column(children: [
                for (final o in sum.objectives)
                  ListTile(
                    title: Text(o.objective, style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('Baseline ${measureText(o.baseline)} · Target (sales) ${measureText(o.target)} · OK Qty $_year ${fmtQty(sum.yearOkQty)}${o.owner.isEmpty ? '' : ' · Owner ${o.owner}'}', style: muted),
                      if (o.remarks.isNotEmpty) Text(o.remarks, style: const TextStyle(fontSize: 13)),
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Row(children: [
                          Text(o.achievedPct == null ? '—' : fmtPct(o.achievedPct), style: const TextStyle(fontWeight: FontWeight.w800)),
                          const SizedBox(width: 8),
                          StatusPill(o.status),
                        ]),
                      ),
                      Padding(padding: const EdgeInsets.only(top: 6), child: AchievementBar(pct: o.achievedPct, status: o.status)),
                      if (o.achievedPct == null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('Needs a Target in Qty for Achieved %.', style: muted)),
                    ]),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      if (perms.edit) IconButton(tooltip: 'Edit', onPressed: () => _openForm(o), icon: const Icon(Icons.edit_outlined, size: 20)),
                      if (perms.delete) IconButton(tooltip: 'Delete', onPressed: () => _delete(o), icon: const Icon(Icons.delete_outline, size: 20, color: AppColors.critical)),
                    ]),
                  ),
              ])),
        const SizedBox(height: 12),
        _card(context, 'Month trend · $_year', Padding(
          padding: const EdgeInsets.fromLTRB(4, 12, 12, 8),
          child: SizedBox(
            height: 200,
            child: BarChart(BarChartData(
              maxY: maxMonth <= 0 ? 10 : maxMonth * 1.1,
              gridData: FlGridData(show: true, drawVerticalLine: false, getDrawingHorizontalLine: (_) => FlLine(color: s.outlineVariant, strokeWidth: 1, dashArray: [4, 4])),
              borderData: FlBorderData(show: false),
              titlesData: FlTitlesData(
                topTitles: const AxisTitles(),
                rightTitles: const AxisTitles(),
                bottomTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 22, getTitlesWidget: (v, _) => Padding(padding: const EdgeInsets.only(top: 4), child: Text(kpiMonths[v.toInt().clamp(0, 11)], style: const TextStyle(fontSize: 9))))),
                leftTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 44, getTitlesWidget: (v, _) => Text(fmtQty(v), style: const TextStyle(fontSize: 9)))),
              ),
              barTouchData: BarTouchData(
                touchCallback: (e, r) { final i = r?.spot?.touchedBarGroupIndex; if (e is FlTapUpEvent && i != null) setState(() => _month = i + 1); },
                touchTooltipData: BarTouchTooltipData(getTooltipItem: (g, _, rod, _) => BarTooltipItem('${kpiMonths[g.x]}: ${fmtQty(rod.toY)}', const TextStyle(color: Colors.white, fontSize: 11))),
              ),
              barGroups: [
                for (var i = 0; i < sum.byMonth.length; i++)
                  BarChartGroupData(x: i, barRods: [BarChartRodData(toY: sum.byMonth[i].okQty, width: 14, borderRadius: const BorderRadius.vertical(top: Radius.circular(3)), color: i + 1 == _month ? AppColors.brand600 : const Color(0xFF93C5FD))]),
              ],
            )),
          ),
        )),
        const SizedBox(height: 12),
        _card(context, 'OK Qty by month · $_year', SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            headingRowHeight: 36,
            dataRowMinHeight: 32,
            dataRowMaxHeight: 36,
            columnSpacing: 20,
            headingTextStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
            columns: const [DataColumn(label: Text('Month')), DataColumn(label: Text('OK Qty'), numeric: true), DataColumn(label: Text('vs previous'), numeric: true), DataColumn(label: Text('Share of year'), numeric: true)],
            rows: [
              for (var i = 0; i < sum.byMonth.length; i++)
                _monthRow(context, sum, i),
              DataRow(color: WidgetStatePropertyAll(s.surfaceContainerHighest.withValues(alpha: .5)), cells: [
                const DataCell(Text('Year', style: TextStyle(fontWeight: FontWeight.w700))),
                DataCell(Text(fmtQty(sum.yearOkQty), style: const TextStyle(fontWeight: FontWeight.w700))),
                const DataCell(Text('')),
                const DataCell(Text('100%')),
              ]),
            ],
          ),
        )),
        const SizedBox(height: 12),
        _card(context, 'OK Qty by year · all time', Column(children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              headingRowHeight: 36,
              dataRowMinHeight: 32,
              dataRowMaxHeight: 36,
              columnSpacing: 20,
              headingTextStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
              columns: const [DataColumn(label: Text('Year')), DataColumn(label: Text('OK Qty'), numeric: true), DataColumn(label: Text('vs previous'), numeric: true)],
              rows: [
                for (var i = 0; i < sum.byYear.length; i++)
                  DataRow(
                    selected: sum.byYear[i].year == _year,
                    onSelectChanged: (_) { setState(() => _year = sum.byYear[i].year); _load(); },
                    cells: [
                      DataCell(Text('${sum.byYear[i].year}', style: const TextStyle(fontWeight: FontWeight.w600))),
                      DataCell(Text(fmtQty(sum.byYear[i].okQty))),
                      DataCell(_delta(i > 0 ? deltaPct(sum.byYear[i].okQty, sum.byYear[i - 1].okQty) : null)),
                    ],
                  ),
                if (sum.byYear.isEmpty) const DataRow(cells: [DataCell(Text('No entries yet.')), DataCell(Text('')), DataCell(Text(''))]),
                DataRow(color: WidgetStatePropertyAll(s.surfaceContainerHighest.withValues(alpha: .5)), cells: [
                  const DataCell(Text('All', style: TextStyle(fontWeight: FontWeight.w700))),
                  DataCell(Text(fmtQty(sum.totalOkQty), style: const TextStyle(fontWeight: FontWeight.w700))),
                  const DataCell(Text('')),
                ]),
              ],
            ),
          ),
          if (sum.byYear.length == 1) Padding(padding: const EdgeInsets.all(12), child: Text('One year of entries so far — old years are loaded with Upload Excel on the website.', style: muted)),
        ])),
      ],
    );
  }

  DataRow _monthRow(BuildContext context, CompanySummary sum, int i) {
    final m = sum.byMonth[i];
    final d = i > 0 ? deltaPct(m.okQty, sum.byMonth[i - 1].okQty) : null;
    final s = Theme.of(context).colorScheme;
    return DataRow(
      selected: m.month == _month,
      onSelectChanged: (_) => setState(() => _month = m.month),
      cells: [
        DataCell(Text('${kpiMonths[m.month - 1]} $_year')),
        DataCell(Row(mainAxisSize: MainAxisSize.min, children: [
          Text(fmtQty(m.okQty), style: const TextStyle(fontWeight: FontWeight.w600)),
          if (m.source == 'excel') Padding(padding: const EdgeInsets.only(left: 4), child: Text('Excel', style: TextStyle(fontSize: 10, color: s.onSurfaceVariant))),
        ])),
        DataCell(_delta(d)),
        DataCell(Text(sum.yearOkQty > 0 ? fmtPct(m.okQty / sum.yearOkQty * 100) : '—')),
      ],
    );
  }

  Widget _delta(double? d) => d == null
      ? const Text('—')
      : Text('${d >= 0 ? '+' : ''}${fmtPct(d)}', style: TextStyle(color: d >= 0 ? AppColors.ok : AppColors.critical, fontWeight: FontWeight.w600));

  Widget _card(BuildContext context, String title, Widget child) {
    final s = Theme.of(context).colorScheme;
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: s.outlineVariant)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(padding: const EdgeInsets.fromLTRB(12, 10, 12, 6), child: Text(title, style: const TextStyle(fontWeight: FontWeight.w700))),
        child,
      ]),
    );
  }
}

class _CompanyForm extends StatefulWidget {
  const _CompanyForm({required this.repo, required this.year, this.existing});
  final KpiRepository repo;
  final int year;
  final CompanyObjective? existing;
  @override
  State<_CompanyForm> createState() => _CompanyFormState();
}

class _CompanyFormState extends State<_CompanyForm> {
  late final _objective = TextEditingController(text: widget.existing?.objective ?? '');
  late final _owner = TextEditingController(text: widget.existing?.owner ?? '');
  late final _remarks = TextEditingController(text: widget.existing?.remarks ?? '');
  late final _target = TextEditingController(text: _v(widget.existing?.target.value));
  late final _baseline = TextEditingController(text: _v(widget.existing?.baseline.value));
  late int _year = widget.existing?.year ?? widget.year;
  late String _targetUom = widget.existing?.target.uom ?? 'Qty';
  late String _baselineUom = widget.existing?.baseline.uom ?? 'Qty';
  bool _saving = false;

  static String _v(double? n) => n == null ? '' : (n == n.roundToDouble() ? n.toInt().toString() : n.toString());

  Future<void> _save() async {
    if (_objective.text.trim().isEmpty) return Alerts.error('Type the objective');
    if (_target.text.trim().isEmpty) return Alerts.error('Type the Target — Achieved % is measured against it');
    setState(() => _saving = true);
    try {
      await widget.repo.saveCompany({
        'objective': _objective.text.trim(),
        'year': _year,
        'target': {'value': _target.text.trim(), 'uom': _targetUom},
        'baseline': {'value': _baseline.text.trim(), 'uom': _baselineUom},
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
    final years = {widget.year + 1, widget.year, widget.year - 1, widget.year - 2, _year}.toList()..sort();
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: .8,
        maxChildSize: .97,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            Text(widget.existing == null ? 'Add Objective' : 'Update Objective', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            TextField(controller: _objective, decoration: const InputDecoration(labelText: 'Objective *', hintText: 'e.g. Grow sales by 20%')),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const FieldCaption('Year'), YearStepper(years: years, value: _year, onChanged: (y) => setState(() => _year = y))])),
              const SizedBox(width: 12),
              Expanded(child: TextField(controller: _owner, decoration: const InputDecoration(labelText: 'Owner', hintText: 'Who is responsible'))),
            ]),
            const SizedBox(height: 12),
            MeasureField(label: 'Target (sales)', controller: _target, uom: _targetUom, onUom: (u) => setState(() => _targetUom = u), required: true, hint: 'In Qty to get Achieved % and Status.'),
            const SizedBox(height: 12),
            MeasureField(label: 'Baseline', controller: _baseline, uom: _baselineUom, onUom: (u) => setState(() => _baselineUom = u), hint: 'Where the company stands today.'),
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
