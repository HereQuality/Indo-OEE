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

/// Data Entry › Company Level Objective — the company board for the CEO / MD:
/// headline tiles (Sales, Salary, Electricity, Sales vs Target, OK Qty) for
/// the year or one month, the month-wise charts, FG / RM / WIP, on-time
/// delivery, complaints, then the objectives and the monthly figures. Mirrors
/// client/src/pages/CompanyObjective.jsx; Excel upload / download stay on the website.
class CompanyObjectiveScreen extends StatefulWidget {
  const CompanyObjectiveScreen({super.key});
  @override
  State<CompanyObjectiveScreen> createState() => _CompanyObjectiveScreenState();
}

const _help = [
  'Pick the Year, then Whole year or one month — every tile and chart follows. Tap a bar or a month row to jump to that month.',
  'Monthly Figures: type the month\'s Sales, Target Sales, Order Booking, Salary, Electricity Bill, FG / RM / WIP value, Inventory Turnover, On Time Delivery % and Customer Complaints. Leave what you don\'t track blank.',
  'OK Qty is the whole company: every process\'s data entries added up. Nobody types it. Labour Productivity is Sales ÷ Salary.',
  'Money and counts add up over the year; percentages, ratios and stock values are averaged over the months that have a figure.',
  'Add Objective: a company-level objective with its Target (sales) and Baseline. Achieved % compares the year\'s OK Qty with a Target in Qty; On track from 100%, Near from 80%, Behind below.',
  'Old sheets are loaded with Upload Excel on the website.',
];

class _CompanyObjectiveScreenState extends State<CompanyObjectiveScreen> {
  final _repo = const KpiRepository();
  int _year = DateTime.now().year;
  int _month = DateTime.now().month; // 0 = whole year
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

  String get _scope => _month == 0 ? '$_year' : '${kpiMonths[_month - 1]} $_year';
  String? get _prevLabel => _month == 0 ? 'vs ${_year - 1}' : (_month > 1 ? 'vs ${kpiMonths[_month - 2]}' : null);

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

  Future<void> _openFigures([int? month]) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _FiguresForm(repo: _repo, year: _year, month: month ?? (_month == 0 ? DateTime.now().month : _month), summary: _summary!),
    );
    if (saved == true) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final perms = PagePermissions.of(context);
    final sum = _summary;
    final canWrite = perms.create || perms.edit;
    return AppScaffold(
      title: 'Company Level Objective',
      actions: [
        if (canWrite && sum != null) IconButton(tooltip: 'Monthly Figures', onPressed: () => _openFigures(), icon: const Icon(Icons.edit_calendar_outlined)),
        IconButton(tooltip: 'Refresh', onPressed: _loading ? null : _load, icon: const Icon(Icons.refresh)),
      ],
      floatingActionButton: perms.create ? FloatingActionButton.extended(onPressed: () => _openForm(), icon: const Icon(Icons.add), label: const Text('Add Objective')) : null,
      body: _error != null && sum == null
          ? ErrorView(message: _error!, onRetry: _load)
          : sum == null
              ? const LoadingView()
              : RefreshIndicator(onRefresh: _load, child: _body(context, sum, perms, canWrite)),
    );
  }

  Widget _body(BuildContext context, CompanySummary sum, dynamic perms, bool canWrite) {
    final s = Theme.of(context).colorScheme;
    final muted = TextStyle(fontSize: 12, color: s.onSurfaceVariant);
    final m = _month;
    final sales = sum.metric('sales'), target = sum.metric('targetSales');
    final salesNow = sales.at(m), targetNow = target.at(m);
    final salesPct = targetNow != null && targetNow > 0 && salesNow != null ? salesNow / targetNow * 100 : null;
    final salesGap = salesPct == null ? null : salesNow! - targetNow!;
    final lp = sum.metric('labourProductivity');
    final otd = sum.metric('onTimeDelivery');
    final complaints = sum.metric('customerComplaints');
    final avgMonthlySales = sales.monthsWithData > 0 && sales.year != null ? sales.year! / sales.monthsWithData : null;
    final avgComplaints = complaints.monthsWithData > 0 && complaints.year != null ? complaints.year! / complaints.monthsWithData : null;
    final hasFigures = [for (var i = 0; i < 12; i++) (i < sum.monthsWithFigures.length && sum.monthsWithFigures[i]) || (i < sum.byMonth.length && sum.byMonth[i].okQty > 0)];
    final okMonths = [for (var i = 0; i < 12; i++) i < sum.byMonth.length ? sum.byMonth[i].okQty : 0.0];

    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 96),
      children: [
        Text("Sales, costs, inventory, delivery and OK Qty against the year's objectives", style: TextStyle(color: s.onSurfaceVariant, fontSize: 13)),
        const HowItWorks(items: _help),
        Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          const FieldCaption('Year'),
          YearStepper(years: _years, value: _year, onChanged: (y) { setState(() => _year = y); _load(); }),
        ]),
        const SizedBox(height: 12),
        const FieldCaption('Period'),
        MonthChipsWithYear(value: m, onChanged: (v) => setState(() => _month = v), hasData: hasFigures),
        const SizedBox(height: 12),

        // Headline tiles
        StatGrid(tiles: [
          StatTile(label: 'Total Sales · $_scope', value: fmtMoneyShort(salesNow), icon: Icons.payments_outlined, delta: _d(salesNow, sales.before(m)), deltaLabel: _prevLabel, hint: salesNow == null ? 'no figure yet' : fmtMoneyFull(salesNow)),
          StatTile(label: 'Total Salary · $_scope', value: fmtMoneyShort(sum.metric('salary').at(m)), icon: Icons.groups_outlined, tone: Colors.blueGrey, delta: _d(sum.metric('salary').at(m), sum.metric('salary').before(m)), deltaLabel: _prevLabel, hint: lp.at(m) == null ? null : 'productivity ${fmtRatio(lp.at(m))}×'),
          StatTile(label: 'Electricity Bill · $_scope', value: fmtMoneyShort(sum.metric('electricityBill').at(m)), icon: Icons.bolt_outlined, tone: AppColors.warn, delta: _d(sum.metric('electricityBill').at(m), sum.metric('electricityBill').before(m)), deltaLabel: _prevLabel),
          StatTile(label: 'Sales vs Target', value: salesPct == null ? '—' : fmtPct(salesPct), icon: Icons.track_changes, tone: salesPct == null ? Colors.blueGrey : salesPct >= 100 ? AppColors.ok : salesPct >= 85 ? AppColors.warn : AppColors.critical, hint: salesGap == null ? 'set Target Sales in Monthly Figures' : '${salesGap >= 0 ? '+' : '−'}${fmtMoneyShort(salesGap.abs())} vs target ${fmtMoneyShort(targetNow)}'),
          StatTile(label: 'OK Qty · $_scope', value: fmtQty(sum.okQtyAt(m)), icon: Icons.layers_outlined, tone: const Color(0xFF0891B2), delta: _d(sum.okQtyAt(m), sum.okQtyBefore(m)), deltaLabel: _prevLabel, hint: 'all processes, from entries'),
          StatTile(label: 'Avg Monthly Sales · $_year', value: fmtMoneyShort(avgMonthlySales), icon: Icons.account_balance_wallet_outlined, hint: sales.monthsWithData > 0 ? 'over ${sales.monthsWithData} month${sales.monthsWithData == 1 ? '' : 's'}' : 'no sales figure yet'),
        ]),
        const SizedBox(height: 12),

        // Month-wise charts
        _card(context, 'Sales & Target by month · $_year', _bars(context, [('Sales', SeriesColors.sales, sales.months)], line: ('Target Sales', SeriesColors.target, target.months), money: true)),
        const SizedBox(height: 12),
        _card(context, 'Order Booking vs Sales · $_year', _bars(context, [('Order Booking', SeriesColors.orderBooking, sum.metric('orderBooking').months), ('Sales', SeriesColors.sales, sales.months)], money: true)),
        const SizedBox(height: 12),
        _card(context, 'Salary & Electricity by month · $_year', _bars(context, [('Total Salary', SeriesColors.sales, sum.metric('salary').months), ('Electricity Bill', SeriesColors.electricity, sum.metric('electricityBill').months)], money: true)),
        const SizedBox(height: 12),
        _card(context, 'Labour Productivity · $_year  (Sales ÷ Salary)', _lines(context, [('Labour Productivity', SeriesColors.sales, lp.months)], fmt: (v) => fmtRatio(v))),
        const SizedBox(height: 12),
        _card(context, 'Inventory Turnover · $_year', _lines(context, [('Inventory Turnover', SeriesColors.sales, sum.metric('inventoryTurnover').months)], fmt: (v) => fmtRatio(v))),
        const SizedBox(height: 12),
        _card(context, 'OK Qty by month · $_year', _bars(context, [('OK Qty', SeriesColors.sales, okMonths)], money: false)),
        const SizedBox(height: 12),

        // Inventory, delivery, complaints
        _card(context, 'FG · RM · WIP · $_scope', Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          child: InventoryBar(parts: [('FG', SeriesColors.fg, sum.metric('fgValue').at(m)), ('RM', SeriesColors.rm, sum.metric('rmValue').at(m)), ('WIP', SeriesColors.wip, sum.metric('wipValue').at(m))]),
        )),
        const SizedBox(height: 12),
        LayoutBuilder(builder: (context, c) {
          final otdCard = _card(context, 'On Time Delivery · $_scope', Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Column(children: [
              HalfGauge(value: otd.at(m)),
              if (otd.before(m) != null && otd.at(m) != null) Text('$_prevLabel ${fmtPct(otd.before(m))}', style: muted) else if (m == 0) Text('${otd.monthsWithData} month${otd.monthsWithData == 1 ? '' : 's'} averaged', style: muted),
            ]),
          ));
          final compCard = _card(context, m == 0 ? 'Avg Customer Complaints · $_year' : 'Customer Complaints · $_scope', Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(m == 0 ? (avgComplaints == null ? '—' : fmtRatio(avgComplaints)) : fmtQty(complaints.at(m)), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
              Text(m == 0 ? (complaints.monthsWithData > 0 ? '${fmtQty(complaints.year)} in ${complaints.monthsWithData} month${complaints.monthsWithData == 1 ? '' : 's'}' : 'no figure yet') : (complaints.before(m) == null ? '' : '$_prevLabel ${fmtQty(complaints.before(m))}'), style: muted),
            ]),
          ));
          return c.maxWidth >= 560
              ? Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: otdCard), const SizedBox(width: 12), Expanded(child: compCard)])
              : Column(children: [otdCard, const SizedBox(height: 12), compCard]);
        }),
        const SizedBox(height: 12),

        // Objectives
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

        // Monthly figures
        _card(context, 'Monthly figures · $_year', Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              headingRowHeight: 36,
              dataRowMinHeight: 34,
              dataRowMaxHeight: 38,
              columnSpacing: 18,
              headingTextStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
              dataTextStyle: const TextStyle(fontSize: 12),
              columns: [
                const DataColumn(label: Text('Month')),
                const DataColumn(label: Text('OK Qty'), numeric: true),
                for (final x in companyMetrics) DataColumn(label: Text('${x.label.replaceAll(RegExp(r' \(.*\)'), '')}${x.unit == '%' ? ' %' : x.unit == '₹' ? ' ₹' : ''}'), numeric: true),
                const DataColumn(label: Text('Labour prod.'), numeric: true),
                if (canWrite) const DataColumn(label: Text('')),
              ],
              rows: [
                for (var i = 0; i < 12; i++)
                  DataRow(
                    selected: i + 1 == m,
                    onSelectChanged: (_) => setState(() => _month = i + 1),
                    cells: [
                      DataCell(Text('${kpiMonths[i]} $_year', style: const TextStyle(fontWeight: FontWeight.w600))),
                      DataCell(Text(fmtQty(okMonths[i]))),
                      for (final x in companyMetrics) DataCell(Text(fmtMetric(x, sum.metric(x.key).months[i]), style: sum.metric(x.key).months[i] == null ? TextStyle(color: s.outline) : null)),
                      DataCell(Text(lp.months[i] == null ? '—' : '${fmtRatio(lp.months[i])}×')),
                      if (canWrite) DataCell(IconButton(visualDensity: VisualDensity.compact, tooltip: 'Edit figures', onPressed: () => _openFigures(i + 1), icon: const Icon(Icons.edit_outlined, size: 18))),
                    ],
                  ),
                DataRow(color: WidgetStatePropertyAll(s.surfaceContainerHighest.withValues(alpha: .5)), cells: [
                  const DataCell(Text('Year', style: TextStyle(fontWeight: FontWeight.w700))),
                  DataCell(Text(fmtQty(sum.yearOkQty), style: const TextStyle(fontWeight: FontWeight.w700))),
                  for (final x in companyMetrics) DataCell(Text(fmtMetric(x, sum.metric(x.key).year), style: const TextStyle(fontWeight: FontWeight.w700))),
                  DataCell(Text(lp.year == null ? '—' : '${fmtRatio(lp.year)}×', style: const TextStyle(fontWeight: FontWeight.w700))),
                  if (canWrite) const DataCell(Text('')),
                ]),
              ],
            ),
          ),
          Padding(padding: const EdgeInsets.fromLTRB(12, 6, 12, 10), child: Text('Year row: money and counts are totals; %, turnover and stock values are averages of the months with a figure.', style: muted)),
        ])),
        const SizedBox(height: 12),

        // Years
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

  double? _d(double? cur, double? prev) => cur == null ? null : deltaPct(cur, prev);

  static bool _any(List<List<double?>> seriesList) => seriesList.any((l) => l.any((v) => v != null));

  Widget _empty(BuildContext context) => Padding(padding: const EdgeInsets.all(20), child: Center(child: Text('No figures for this year yet — add them with Monthly Figures or Upload Excel on the website.', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant))));

  /// Grouped bars by month, optionally with a dashed target line drawn as a second chart layer.
  Widget _bars(BuildContext context, List<(String, Color, List<double?>)> series, {(String, Color, List<double?>)? line, required bool money}) {
    if (!_any([for (final x in series) x.$3, if (line != null) line.$3])) return _empty(context);
    final s = Theme.of(context).colorScheme;
    final fmt = money ? fmtMoneyShort : fmtQty;
    var maxY = 0.0;
    for (final x in series) { for (final v in x.$3) { if ((v ?? 0) > maxY) maxY = v!; } }
    if (line != null) { for (final v in line.$3) { if ((v ?? 0) > maxY) maxY = v!; } }
    final legend = [for (final x in series) (x.$1, x.$2, false), if (line != null) (line.$1, line.$2, true)];
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 4, 12, 10),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (legend.length > 1) Padding(padding: const EdgeInsets.only(left: 4, bottom: 6), child: ChartLegend(legend)),
        SizedBox(
          height: 200,
          child: Stack(children: [
            BarChart(BarChartData(
              maxY: maxY <= 0 ? 10 : maxY * 1.12,
              minY: 0,
              gridData: FlGridData(show: true, drawVerticalLine: false, getDrawingHorizontalLine: (_) => FlLine(color: s.outlineVariant, strokeWidth: 1, dashArray: [4, 4])),
              borderData: FlBorderData(show: false),
              titlesData: FlTitlesData(
                topTitles: const AxisTitles(),
                rightTitles: const AxisTitles(),
                bottomTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 22, getTitlesWidget: (v, _) => Padding(padding: const EdgeInsets.only(top: 4), child: Text(kpiMonths[v.toInt().clamp(0, 11)], style: const TextStyle(fontSize: 9))))),
                leftTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 46, getTitlesWidget: (v, _) => Text(fmt(v), style: const TextStyle(fontSize: 9)))),
              ),
              barTouchData: BarTouchData(
                touchCallback: (e, r) { final i = r?.spot?.touchedBarGroupIndex; if (e is FlTapUpEvent && i != null) setState(() => _month = i + 1); },
                touchTooltipData: BarTouchTooltipData(getTooltipItem: (g, _, rod, ri) => BarTooltipItem('${series[ri].$1} · ${kpiMonths[g.x]}\n${money ? fmtMoneyFull(rod.toY) : fmtQty(rod.toY)}', const TextStyle(color: Colors.white, fontSize: 11))),
              ),
              barGroups: [
                for (var i = 0; i < 12; i++)
                  BarChartGroupData(x: i, barsSpace: 2, barRods: [
                    for (final x in series)
                      BarChartRodData(toY: x.$3[i] ?? 0, width: series.length > 1 ? 7 : 14, borderRadius: const BorderRadius.vertical(top: Radius.circular(3)), color: _month == 0 || _month == i + 1 ? x.$2 : x.$2.withValues(alpha: .4)),
                  ]),
              ],
            )),
            if (line != null)
              IgnorePointer(
                child: Padding(
                  padding: const EdgeInsets.only(left: 46, bottom: 22),
                  child: LineChart(LineChartData(
                    minX: -0.5, maxX: 11.5, minY: 0, maxY: maxY <= 0 ? 10 : maxY * 1.12,
                    gridData: const FlGridData(show: false),
                    borderData: FlBorderData(show: false),
                    titlesData: const FlTitlesData(show: false),
                    lineTouchData: const LineTouchData(enabled: false),
                    lineBarsData: [LineChartBarData(spots: [for (var i = 0; i < 12; i++) if (line.$3[i] != null) FlSpot(i.toDouble(), line.$3[i]!)], color: line.$2, barWidth: 2, dashArray: [6, 4], dotData: const FlDotData(show: false), isCurved: true, preventCurveOverShooting: true)],
                  )),
                ),
              ),
          ]),
        ),
      ]),
    );
  }

  Widget _lines(BuildContext context, List<(String, Color, List<double?>)> series, {required String Function(num) fmt}) {
    if (!_any([for (final x in series) x.$3])) return _empty(context);
    final s = Theme.of(context).colorScheme;
    var maxY = 0.0;
    for (final x in series) { for (final v in x.$3) { if ((v ?? 0) > maxY) maxY = v!; } }
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 16, 10),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (series.length > 1) Padding(padding: const EdgeInsets.only(left: 4, bottom: 6), child: ChartLegend([for (final x in series) (x.$1, x.$2, false)])),
        SizedBox(
          height: 190,
          child: LineChart(LineChartData(
            minX: 0, maxX: 11, minY: 0, maxY: maxY <= 0 ? 10 : maxY * 1.15,
            gridData: FlGridData(show: true, drawVerticalLine: false, getDrawingHorizontalLine: (_) => FlLine(color: s.outlineVariant, strokeWidth: 1, dashArray: [4, 4])),
            borderData: FlBorderData(show: false),
            titlesData: FlTitlesData(
              topTitles: const AxisTitles(),
              rightTitles: const AxisTitles(),
              bottomTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 22, interval: 1, getTitlesWidget: (v, _) => Padding(padding: const EdgeInsets.only(top: 4), child: Text(kpiMonths[v.toInt().clamp(0, 11)], style: const TextStyle(fontSize: 9))))),
              leftTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 40, getTitlesWidget: (v, _) => Text(fmt(v), style: const TextStyle(fontSize: 9)))),
            ),
            lineTouchData: LineTouchData(touchTooltipData: LineTouchTooltipData(getTooltipItems: (spots) => [for (final p in spots) LineTooltipItem('${series[p.barIndex].$1} · ${kpiMonths[p.x.toInt().clamp(0, 11)]}\n${fmt(p.y)}', const TextStyle(color: Colors.white, fontSize: 11))])),
            lineBarsData: [
              for (final x in series)
                LineChartBarData(
                  spots: [for (var i = 0; i < 12; i++) if (x.$3[i] != null) FlSpot(i.toDouble(), x.$3[i]!)],
                  color: x.$2,
                  barWidth: 2,
                  isCurved: true,
                  preventCurveOverShooting: true,
                  dotData: FlDotData(show: true, getDotPainter: (_, _, _, _) => FlDotCirclePainter(radius: 3.5, color: Colors.white, strokeWidth: 2, strokeColor: x.$2)),
                ),
            ],
          )),
        ),
      ]),
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

/// The month's business figures — one field per metric, grouped.
class _FiguresForm extends StatefulWidget {
  const _FiguresForm({required this.repo, required this.year, required this.month, required this.summary});
  final KpiRepository repo;
  final int year;
  final int month;
  final CompanySummary summary;
  @override
  State<_FiguresForm> createState() => _FiguresFormState();
}

class _FiguresFormState extends State<_FiguresForm> {
  late int _month = widget.month;
  late final Map<String, TextEditingController> _c = {for (final m in companyMetrics) m.key: TextEditingController()};
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _fill();
  }

  @override
  void dispose() {
    for (final c in _c.values) { c.dispose(); }
    super.dispose();
  }

  void _fill() {
    final row = widget.summary.monthly.where((r) => r.month == _month).firstOrNull;
    for (final m in companyMetrics) {
      final v = row?.values[m.key];
      _c[m.key]!.text = v == null ? '' : (v == v.roundToDouble() ? v.toInt().toString() : v.toString());
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await widget.repo.saveCompanyMonthly(widget.year, _month, {for (final m in companyMetrics) m.key: _c[m.key]!.text.trim()});
      Alerts.success('Monthly figures saved');
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      Alerts.error(e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final muted = TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant);
    final groups = companyMetrics.map((m) => m.group).toSet();
    final saved = widget.summary.monthly.where((r) => r.month == _month).firstOrNull;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: .9,
        maxChildSize: .97,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            Text('Monthly Figures · ${widget.year}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            MonthChips(value: _month, onChanged: (m) => setState(() { _month = m; _fill(); }), hasData: widget.summary.monthsWithFigures),
            const SizedBox(height: 6),
            Text('Figures for ${kpiMonths[_month - 1]} ${widget.year}. Leave blank what you don\'t track; a blank clears the stored figure.${saved != null && saved.updatedByName.isNotEmpty ? ' Last saved by ${saved.updatedByName}.' : ''}', style: muted),
            for (final g in groups) ...[
              const SizedBox(height: 14),
              FieldCaption(g),
              LayoutBuilder(builder: (context, c) {
                final cols = c.maxWidth >= 560 ? 3 : c.maxWidth >= 380 ? 2 : 1;
                final w = (c.maxWidth - 10 * (cols - 1)) / cols;
                return Wrap(spacing: 10, runSpacing: 10, children: [
                  for (final m in companyMetrics.where((m) => m.group == g))
                    SizedBox(
                      width: w,
                      child: TextField(
                        controller: _c[m.key],
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: InputDecoration(
                          labelText: m.label,
                          isDense: true,
                          prefixText: m.unit == '₹' ? '₹ ' : null,
                          suffixText: switch (m.unit) { '%' => '%', 'ratio' => 'times', 'count' => 'nos', _ => null },
                          hintText: m.unit == '%' ? '0–100' : null,
                        ),
                      ),
                    ),
                ]);
              }),
            ],
            const SizedBox(height: 10),
            Text('Labour Productivity (Sales ÷ Salary) and OK Qty are worked out — nothing to type.', style: muted),
            const SizedBox(height: 20),
            Row(children: [
              Expanded(child: OutlinedButton(onPressed: _saving ? null : () => Navigator.pop(context, false), child: const Text('Cancel'))),
              const SizedBox(width: 12),
              Expanded(child: FilledButton(onPressed: _saving ? null : _save, child: Text(_saving ? 'Saving…' : 'Save ${kpiMonths[_month - 1]}'))),
            ]),
          ],
        ),
      ),
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
              Expanded(child: YearDropdown(years: yearRange([_year]), value: _year, onChanged: (y) => setState(() => _year = y))),
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
