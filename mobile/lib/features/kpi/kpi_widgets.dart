import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_colors.dart';
import 'kpi_models.dart';

/// Pieces the KPI and Company Level Objective screens share — the same look as
/// the web pages (client/src/Components/Kpi/kpiBits.jsx): big figures, a year
/// stepper, month chips, status pills.

final _qty = NumberFormat('#,##,##0.##', 'en_IN');
String fmtQty(num? n) => n == null ? '—' : _qty.format(n);
String fmtPct(num? n) => n == null ? '—' : '${n.toStringAsFixed(1)}%';
String measureText(Measure m) => m.value == null ? '—' : (m.uom == '%' ? fmtPct(m.value) : fmtQty(m.value));

/// ₹ in the board's short form: 208.98M, 629.46K, 950.
String fmtMoneyShort(num? n) {
  if (n == null) return '—';
  final a = n.abs();
  if (a >= 1e9) return '${(n / 1e9).toStringAsFixed(2)}B';
  if (a >= 1e6) return '${(n / 1e6).toStringAsFixed(2)}M';
  if (a >= 1e3) return '${(n / 1e3).toStringAsFixed(2)}K';
  return fmtQty((n * 100).round() / 100);
}
String fmtMoneyFull(num? n) => n == null ? '—' : '₹ ${fmtQty(n.round())}';
String fmtRatio(num? n) => n == null ? '—' : n.toStringAsFixed(2);

/// A figure in its metric's unit, short (tiles) or full (tables).
String fmtMetric(CompanyMetric? m, num? n, {bool full = false}) {
  if (n == null) return '—';
  return switch (m?.unit) {
    '₹' => full ? fmtMoneyFull(n) : fmtMoneyShort(n),
    '%' => fmtPct(n),
    'ratio' => fmtRatio(n),
    _ => fmtQty(n),
  };
}

/// Series colours, one per entity (the same as the website's).
class SeriesColors {
  SeriesColors._();
  static const sales = Color(0xFF2563EB);
  static const orderBooking = Color(0xFFD97706);
  static const target = Color(0xFF64748B);
  static const electricity = Color(0xFF0891B2);
  static const fg = Color(0xFF2563EB);
  static const rm = Color(0xFFD97706);
  static const wip = Color(0xFF0891B2);
}

/// Jan … Dec with a first "Whole year" chip (value 0).
class MonthChipsWithYear extends StatelessWidget {
  const MonthChipsWithYear({super.key, required this.value, required this.onChanged, this.hasData = const []});
  final int value;
  final ValueChanged<int> onChanged;
  final List<bool> hasData;
  @override
  Widget build(BuildContext context) => SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          Padding(
            padding: const EdgeInsets.only(right: 10),
            child: ChoiceChip(label: const Text('Whole year'), selected: value == 0, onSelected: (_) => onChanged(0), showCheckmark: false, visualDensity: VisualDensity.compact),
          ),
          for (var i = 0; i < 12; i++)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: ChoiceChip(
                label: Text(kpiMonths[i]),
                selected: value == i + 1,
                onSelected: (_) => onChanged(i + 1),
                avatar: i < hasData.length && hasData[i] && value != i + 1 ? const Icon(Icons.circle, size: 6, color: AppColors.brand600) : null,
                showCheckmark: false,
                visualDensity: VisualDensity.compact,
              ),
            ),
        ]),
      );
}

/// A legend line under a chart with two or more series.
class ChartLegend extends StatelessWidget {
  const ChartLegend(this.items, {super.key});
  final List<(String, Color, bool)> items; // label, colour, dashed
  @override
  Widget build(BuildContext context) => Wrap(
        spacing: 14,
        runSpacing: 4,
        children: [
          for (final (label, c, dashed) in items)
            Row(mainAxisSize: MainAxisSize.min, children: [
              Container(width: 10, height: dashed ? 2 : 10, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(3))),
              const SizedBox(width: 5),
              Text(label, style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
            ]),
        ],
      );
}

/// A half gauge for a 0–100 % figure.
class HalfGauge extends StatelessWidget {
  const HalfGauge({super.key, required this.value});
  final double? value;
  @override
  Widget build(BuildContext context) {
    final v = value?.clamp(0, 100).toDouble();
    final c = v == null ? AppColors.slate300 : v >= 95 ? AppColors.ok : v >= 85 ? AppColors.warn : AppColors.critical;
    return Column(children: [
      SizedBox(
        height: 96,
        width: 180,
        child: Stack(alignment: Alignment.bottomCenter, children: [
          CustomPaint(size: const Size(180, 96), painter: _GaugePainter(fraction: (v ?? 0) / 100, color: c, track: Theme.of(context).colorScheme.surfaceContainerHighest)),
          Padding(padding: const EdgeInsets.only(bottom: 2), child: Text(v == null ? '—' : fmtPct(v), style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: v == null ? AppColors.slate400 : null))),
        ]),
      ),
      SizedBox(width: 180, child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('0%', style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onSurfaceVariant)), Text('100%', style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onSurfaceVariant))])),
    ]);
  }
}

class _GaugePainter extends CustomPainter {
  const _GaugePainter({required this.fraction, required this.color, required this.track});
  final double fraction;
  final Color color;
  final Color track;
  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 16.0;
    final rect = Rect.fromCircle(center: Offset(size.width / 2, size.height - 4), radius: size.width / 2 - stroke / 2 - 2);
    final p = Paint()..style = PaintingStyle.stroke..strokeWidth = stroke..strokeCap = StrokeCap.round;
    canvas.drawArc(rect, 3.14159, 3.14159, false, p..color = track);
    if (fraction > 0) canvas.drawArc(rect, 3.14159, 3.14159 * fraction, false, p..color = color);
  }
  @override
  bool shouldRepaint(_GaugePainter o) => o.fraction != fraction || o.color != color || o.track != track;
}

/// FG / RM / WIP as one segmented bar.
class InventoryBar extends StatelessWidget {
  const InventoryBar({super.key, required this.parts});
  final List<(String, Color, double?)> parts; // label, colour, value
  @override
  Widget build(BuildContext context) {
    final have = parts.where((p) => (p.$3 ?? 0) > 0).toList();
    final total = have.fold<double>(0, (a, p) => a + p.$3!);
    final muted = TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant);
    if (total <= 0) return Padding(padding: const EdgeInsets.all(16), child: Center(child: Text('No FG / RM / WIP figures yet.', style: muted)));
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: SizedBox(
          height: 84,
          child: Row(children: [
            for (final (label, c, v) in have)
              Expanded(
                flex: ((v! / total).clamp(0.12, 1) * 1000).round(),
                child: Container(
                  color: c,
                  margin: const EdgeInsets.only(right: 2),
                  padding: const EdgeInsets.all(8),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    Text(label, style: const TextStyle(color: Colors.white, fontSize: 11), overflow: TextOverflow.ellipsis),
                    FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(fmtMoneyShort(v), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700))),
                  ]),
                ),
              ),
          ]),
        ),
      ),
      const SizedBox(height: 6),
      Wrap(spacing: 12, runSpacing: 4, children: [
        for (final (label, c, v) in have) ChartLegend([('$label · ${fmtPct(v! / total * 100)}', c, false)]),
        Text('Total ${fmtMoneyShort(total)}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
      ]),
    ]);
  }
}

Color statusColor(String? s) => switch (s) { 'On track' => AppColors.ok, 'Near' => AppColors.warn, 'Behind' => AppColors.critical, _ => Colors.grey };

class StatusPill extends StatelessWidget {
  const StatusPill(this.status, {super.key});
  final String? status;
  @override
  Widget build(BuildContext context) {
    if (status == null) return Text('—', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant));
    final c = statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: c.withValues(alpha: .12), borderRadius: BorderRadius.circular(999)),
      child: Text(status!, style: TextStyle(color: c, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}

class AchievementBar extends StatelessWidget {
  const AchievementBar({super.key, required this.pct, required this.status});
  final double? pct;
  final String? status;
  @override
  Widget build(BuildContext context) {
    if (pct == null) return const SizedBox.shrink();
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: LinearProgressIndicator(value: (pct! / 100).clamp(0, 1), minHeight: 6, color: statusColor(status), backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest),
    );
  }
}

/// A headline figure tile; `delta` is a % change against the previous period.
class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.label, required this.value, this.hint, this.icon, this.tone = AppColors.brand600, this.delta, this.deltaLabel});
  final String label;
  final String value;
  final String? hint;
  final IconData? icon;
  final Color tone;
  final double? delta;
  final String? deltaLabel;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final up = (delta ?? 0) >= 0;
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      color: s.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: s.outlineVariant)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Expanded(child: Text(label.toUpperCase(), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, letterSpacing: .5, color: s.onSurfaceVariant))),
                if (icon != null) CircleAvatar(radius: 14, backgroundColor: tone.withValues(alpha: .12), child: Icon(icon, size: 16, color: tone)),
              ],
            ),
            const SizedBox(height: 4),
            FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800))),
            if (delta != null || hint != null)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Wrap(
                  spacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (delta != null)
                      Row(mainAxisSize: MainAxisSize.min, children: [
                        Icon(up ? Icons.trending_up : Icons.trending_down, size: 14, color: up ? AppColors.ok : AppColors.critical),
                        const SizedBox(width: 2),
                        Text('${up ? '+' : ''}${fmtPct(delta)}${deltaLabel == null ? '' : ' $deltaLabel'}', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: up ? AppColors.ok : AppColors.critical)),
                      ]),
                    if (hint != null) Text(hint!, style: TextStyle(fontSize: 12, color: s.onSurfaceVariant)),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Two tiles a row on a phone, four on a tablet.
class StatGrid extends StatelessWidget {
  const StatGrid({super.key, required this.tiles});
  final List<Widget> tiles;
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, c) {
        final cols = c.maxWidth >= 720 ? 4 : 2;
        final w = (c.maxWidth - 8 * (cols - 1)) / cols;
        return Wrap(spacing: 8, runSpacing: 8, children: [for (final t in tiles) SizedBox(width: w, child: t)]);
      });
}

/// The years a form's Year box offers: ten back, five ahead, plus [extra]
/// (the record's own year, so an old objective still shows its year).
List<int> yearRange([Iterable<int> extra = const []]) {
  final y = DateTime.now().year;
  return {...extra, for (var i = y - 10; i <= y + 5; i++) i}.toList()..sort((a, b) => b.compareTo(a));
}

/// The forms' Year box: a dropdown over [years].
class YearDropdown extends StatelessWidget {
  const YearDropdown({super.key, required this.years, required this.value, required this.onChanged, this.label = 'Year'});
  final List<int> years;
  final int value;
  final ValueChanged<int> onChanged;
  final String label;
  @override
  Widget build(BuildContext context) => DropdownButtonFormField<int>(
        initialValue: value,
        decoration: InputDecoration(labelText: label),
        items: [for (final y in years) DropdownMenuItem(value: y, child: Text('$y'))],
        onChanged: (y) => y == null ? null : onChanged(y),
      );
}

/// ‹ 2026 › through the given years.
class YearStepper extends StatelessWidget {
  const YearStepper({super.key, required this.years, required this.value, required this.onChanged});
  final List<int> years;
  final int value;
  final ValueChanged<int> onChanged;
  @override
  Widget build(BuildContext context) {
    final list = years.toSet().toList()..sort();
    final i = list.indexOf(value);
    final prev = i > 0 ? list[i - 1] : null;
    final next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
    final s = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(border: Border.all(color: s.outlineVariant), borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        IconButton(tooltip: 'Previous year', visualDensity: VisualDensity.compact, onPressed: prev == null ? null : () => onChanged(prev), icon: const Icon(Icons.chevron_left)),
        SizedBox(width: 56, child: Text('$value', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
        IconButton(tooltip: 'Next year', visualDensity: VisualDensity.compact, onPressed: next == null ? null : () => onChanged(next), icon: const Icon(Icons.chevron_right)),
      ]),
    );
  }
}

/// Jan … Dec as a scrolling row of chips; a dot marks months with a figure.
class MonthChips extends StatelessWidget {
  const MonthChips({super.key, required this.value, required this.onChanged, this.hasData = const []});
  final int value;
  final ValueChanged<int> onChanged;
  final List<bool> hasData;
  @override
  Widget build(BuildContext context) => SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (var i = 0; i < 12; i++)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: ChoiceChip(
                label: Text(kpiMonths[i]),
                selected: value == i + 1,
                onSelected: (_) => onChanged(i + 1),
                avatar: i < hasData.length && hasData[i] && value != i + 1 ? const Icon(Icons.circle, size: 6, color: AppColors.brand600) : null,
                showCheckmark: false,
                visualDensity: VisualDensity.compact,
              ),
            ),
        ]),
      );
}

/// Small uppercase caption over a control.
class FieldCaption extends StatelessWidget {
  const FieldCaption(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Text(text.toUpperCase(), style: TextStyle(fontSize: 11, letterSpacing: .6, color: Theme.of(context).colorScheme.onSurfaceVariant)),
      );
}

/// A value with its own unit (Qty / %).
class MeasureField extends StatelessWidget {
  const MeasureField({super.key, required this.label, required this.controller, required this.uom, required this.onUom, this.hint, this.required = false});
  final String label;
  final TextEditingController controller;
  final String uom;
  final ValueChanged<String> onUom;
  final String? hint;
  final bool required;
  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(
              child: TextField(
                controller: controller,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(labelText: required ? '$label *' : label, isDense: true),
              ),
            ),
            const SizedBox(width: 8),
            SegmentedButton<String>(
              segments: [for (final u in kpiUoms) ButtonSegment(value: u, label: Text(u))],
              selected: {uom},
              onSelectionChanged: (v) => onUom(v.first),
              showSelectedIcon: false,
              style: const ButtonStyle(visualDensity: VisualDensity.compact),
            ),
          ]),
          if (hint != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(hint!, style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant))),
        ],
      );
}

/// A "how this works" line the person can open.
class HowItWorks extends StatelessWidget {
  const HowItWorks({super.key, required this.items});
  final List<String> items;
  @override
  Widget build(BuildContext context) => Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: EdgeInsets.zero,
          dense: true,
          leading: const Icon(Icons.info_outline, size: 18),
          title: const Text('How this page works', style: TextStyle(fontSize: 13)),
          children: [
            for (var i = 0; i < items.length; i++)
              ListTile(dense: true, visualDensity: VisualDensity.compact, leading: Text('${i + 1}.'), title: Text(items[i], style: const TextStyle(fontSize: 13))),
          ],
        ),
      );
}
