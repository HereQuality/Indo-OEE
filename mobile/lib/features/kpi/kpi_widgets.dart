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
