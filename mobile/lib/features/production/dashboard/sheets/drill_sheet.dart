import 'package:flutter/material.dart';

import '../../shared/production_sheet_calc.dart' show displayDay, jsToNumber, remarkParts;
import '../charts/chart_props.dart';
import '../dashboard_engine.dart' as eng;
import 'sheet_kit.dart';

/// How many entries the Entries tab lists (same cap as DrillModal.jsx).
const int kDrillRecordLimit = 300;

/// The full bifurcation of one figure (port of DrillModal.jsx) as a bottom
/// sheet: the measure for the current filters, then the same measure split by
/// machine, operator, part and date / month - plus the entries behind it.
///
/// [measure] is a `statMeasure` / `causeMeasure` / `reasonMeasure` map from
/// dashboard_engine.dart; [rows] are the filtered entries. Tapping a row of a
/// split closes the sheet and calls [onPick] so the dashboard filters to it.
Future<void> showDrillSheet(
  BuildContext context, {
  required Map<String, dynamic> measure,
  required List<Map<String, dynamic>> rows,
  required DashboardCtx ctx,
  required void Function(String dim, String key) onPick,
}) {
  return showDraggableSheet<void>(
    context,
    minSize: 0.5,
    initialSize: 0.9,
    maxSize: 0.96,
    builder: (sheetContext, scroll, sheet) => DrillSheet(measure: measure, rows: rows, ctx: ctx, onPick: onPick, scroll: scroll, sheet: sheet),
  );
}

const Map<String, String> _dimLabel = {
  'machine': 'Machine',
  'operator': 'Operator',
  'item': 'Part',
  'month': 'Month',
  'date': 'Date',
};

class _SplitItem {
  const _SplitItem(this.key, this.label, this.value);
  final String key;
  final String label;
  final double value;
}

class DrillSheet extends StatefulWidget {
  const DrillSheet({super.key, required this.measure, required this.rows, required this.ctx, required this.onPick, required this.scroll, required this.sheet});

  final Map<String, dynamic> measure;
  final List<Map<String, dynamic>> rows;
  final DashboardCtx ctx;
  final void Function(String dim, String key) onPick;
  final ScrollController scroll;
  final DraggableScrollableController sheet;

  @override
  State<DrillSheet> createState() => _DrillSheetState();
}

class _DrillSheetState extends State<DrillSheet> {
  late final List<String> _tabs = ['machine', 'operator', 'item', widget.ctx.bucket, 'records'];
  late String _tab = 'machine';
  late final double? _total = _safeTotal();
  final Map<String, List<_SplitItem>> _splits = {};
  List<Map<String, dynamic>>? _records;

  String get _format => '${widget.measure['format'] ?? 'qty'}';

  double? _safeTotal() {
    try {
      return eng.measureValue(widget.measure, eng.summarize(widget.rows));
    } catch (_) {
      return null;
    }
  }

  String _formatTotal(double? v) {
    final f = eng.formats[_format];
    return f != null ? f(v) : eng.formatExact(_format, v);
  }

  /// The measure split by [dim]: dates / months in time order, everything else
  /// biggest first (ties keep first-seen order, like the web's stable sort).
  List<_SplitItem> _split(String dim) {
    return _splits.putIfAbsent(dim, () {
      final list = <_SplitItem>[];
      for (final g in eng.summarizeBy(widget.rows, dim, widget.ctx)) {
        final v = eng.measureValue(widget.measure, g['summary'] as Map<String, dynamic>);
        if (v != null && v.isFinite) list.add(_SplitItem('${g['key']}', '${g['label']}', v));
      }
      final indexed = list.asMap().entries.toList();
      if (dim == 'date' || dim == 'month') {
        indexed.sort((a, b) {
          final c = a.value.key.compareTo(b.value.key);
          return c != 0 ? c : a.key.compareTo(b.key);
        });
      } else {
        indexed.sort((a, b) {
          final c = b.value.value.compareTo(a.value.value);
          return c != 0 ? c : a.key.compareTo(b.key);
        });
      }
      return [for (final e in indexed) e.value];
    });
  }

  /// Newest first, capped at [kDrillRecordLimit].
  List<Map<String, dynamic>> get _shownRecords {
    return _records ??= () {
      final indexed = widget.rows.asMap().entries.toList()
        ..sort((a, b) {
          final c = '${b.value['date']}'.compareTo('${a.value['date']}');
          return c != 0 ? c : a.key.compareTo(b.key);
        });
      return [for (final e in indexed.take(kDrillRecordLimit)) e.value];
    }();
  }

  void _pick(String dim, String key) {
    SheetHaptics.light();
    Navigator.of(context).pop();
    widget.onPick(dim, key);
  }

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    final n = widget.rows.length;
    final scaler = MediaQuery.textScalerOf(context);
    final tabsExtent = (16 + scaler.scale(13.5) * 1.2 + 2).clamp(44.0, 200.0) + 16;

    return Column(
      children: [
        SheetGrabArea(
          controller: widget.sheet,
          minSize: 0.5,
          snapSizes: const [0.9, 0.96],
          child: Column(
            children: [
              const SheetHandle(),
              SheetHeader(overline: 'Breakdown', title: '${widget.measure['label'] ?? ''}'),
            ],
          ),
        ),
        Expanded(
          child: CustomScrollView(
            controller: widget.scroll,
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(kSheetGutter, 2, kSheetGutter, 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Semantics(
                        label: 'Total ${_formatTotal(_total)}',
                        excludeSemantics: true,
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          alignment: Alignment.centerLeft,
                          child: Text(
                            _formatTotal(_total),
                            style: TextStyle(fontSize: 34, height: 1.1, fontWeight: FontWeight.w800, color: t.ink),
                          ),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'for the current filters · ${plural(n, 'entry', 'entries')}',
                        style: TextStyle(fontSize: 13, height: 1.3, color: t.muted),
                      ),
                      if (_tab != 'records')
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text('Tap a row to filter the dashboard to it', style: TextStyle(fontSize: 12.5, height: 1.3, color: t.muted)),
                        ),
                    ],
                  ),
                ),
              ),
              SliverPersistentHeader(
                pinned: true,
                delegate: _PinnedDelegate(
                  extent: tabsExtent,
                  child: Align(
                    child: ChipTabs<String>(
                      items: [for (final tab in _tabs) TabItem(tab, tab == 'records' ? 'Entries' : 'By ${_dimLabel[tab]}')],
                      selected: _tab,
                      onSelected: (v) => setState(() => _tab = v),
                    ),
                  ),
                ),
              ),
              if (_tab == 'records') ..._recordSlivers(context) else ..._splitSlivers(context),
              SliverToBoxAdapter(child: SizedBox(height: 16 + MediaQuery.paddingOf(context).bottom)),
            ],
          ),
        ),
      ],
    );
  }

  List<Widget> _splitSlivers(BuildContext context) {
    final data = _split(_tab);
    if (data.isEmpty) {
      return const [SliverToBoxAdapter(child: _Nothing('Nothing to show for this selection.'))];
    }
    final maxAbs = data.fold<double>(0, (m, d) => d.value.abs() > m ? d.value.abs() : m);
    final color = DashboardColors.of(context).ok;
    return [
      SliverList.separated(
        itemCount: data.length,
        separatorBuilder: (_, _) => Divider(height: 1, indent: kSheetGutter, endIndent: kSheetGutter, color: SheetTone.of(context).border),
        itemBuilder: (context, i) {
          final d = data[i];
          return _SplitRow(
            key: ValueKey('$_tab:${d.key}'),
            label: d.label,
            value: eng.formatExact(_format, d.value),
            fraction: maxAbs == 0 ? 0 : d.value.abs() / maxAbs,
            color: color,
            onTap: () => _pick(_tab, d.key),
          );
        },
      ),
    ];
  }

  List<Widget> _recordSlivers(BuildContext context) {
    final shown = _shownRecords;
    if (shown.isEmpty) {
      return const [SliverToBoxAdapter(child: _Nothing('No entries for this selection.'))];
    }
    final more = widget.rows.length > shown.length;
    return [
      SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: kSheetGutter),
        sliver: SliverList.separated(
          itemCount: shown.length,
          separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (context, i) => _EntryCard(row: shown[i], ctx: widget.ctx),
        ),
      ),
      if (more)
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(kSheetGutter, 12, kSheetGutter, 0),
            child: Text(
              'Showing the latest $kDrillRecordLimit of ${widget.rows.length} entries — narrow the filters to see the rest.',
              style: TextStyle(fontSize: 12.5, height: 1.35, color: SheetTone.of(context).muted),
            ),
          ),
        ),
    ];
  }
}

class _PinnedDelegate extends SliverPersistentHeaderDelegate {
  _PinnedDelegate({required this.extent, required this.child});
  final double extent;
  final Widget child;

  @override
  double get minExtent => extent;
  @override
  double get maxExtent => extent;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    final t = SheetTone.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).bottomSheetTheme.backgroundColor ?? t.scheme.surface,
        border: Border(bottom: BorderSide(color: overlapsContent ? t.border : Colors.transparent)),
      ),
      child: child,
    );
  }

  @override
  bool shouldRebuild(_PinnedDelegate old) => old.extent != extent || old.child != child;
}

class _Nothing extends StatelessWidget {
  const _Nothing(this.message);
  final String message;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.inbox_outlined, size: 40, color: SheetTone.of(context).muted.withValues(alpha: 0.7)),
            const SizedBox(height: 10),
            Text(message, textAlign: TextAlign.center, style: TextStyle(fontSize: 14, color: SheetTone.of(context).muted)),
          ],
        ),
      );
}

/// One row of a split: label and figure on top, a proportional bar underneath.
class _SplitRow extends StatelessWidget {
  const _SplitRow({super.key, required this.label, required this.value, required this.fraction, required this.color, required this.onTap});

  final String label;
  final String value;
  final double fraction;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    return Semantics(
      button: true,
      label: '$label, $value. Filter the dashboard to this',
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 56),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: kSheetGutter, vertical: 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(label, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14.5, height: 1.25, fontWeight: FontWeight.w600, color: t.ink)),
                    ),
                    const SizedBox(width: 12),
                    Text(value, style: TextStyle(fontSize: 14.5, height: 1.25, fontWeight: FontWeight.w700, color: t.ink, fontFeatures: const [FontFeature.tabularFigures()])),
                    const SizedBox(width: 2),
                    Icon(Icons.chevron_right_rounded, size: 18, color: t.muted),
                  ],
                ),
                const SizedBox(height: 8),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: SizedBox(
                    height: 8,
                    child: Stack(
                      children: [
                        Positioned.fill(child: ColoredBox(color: t.track)),
                        Positioned.fill(
                          child: TweenAnimationBuilder<double>(
                            tween: Tween(begin: 0, end: fraction.clamp(0.0, 1.0)),
                            duration: const Duration(milliseconds: 380),
                            curve: Curves.easeOutCubic,
                            builder: (context, f, _) => Align(
                              alignment: Alignment.centerLeft,
                              child: FractionallySizedBox(
                                widthFactor: f,
                                heightFactor: 1,
                                child: DecoratedBox(decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(4))),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String _firstText(List<Object?> candidates) {
  for (final c in candidates) {
    final s = c == null ? '' : '$c'.trim();
    if (s.isNotEmpty) return s;
  }
  return '—';
}

/// One entry as a card (the Entries table of the web modal turned into
/// something a phone can read): date and machine, operator and part, the six
/// figures, then every remark with its label.
class _EntryCard extends StatelessWidget {
  const _EntryCard({required this.row, required this.ctx});

  final Map<String, dynamic> row;
  final DashboardCtx ctx;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    final colors = DashboardColors.of(context);
    final calc = eng.calcOf(row);
    String q(Object? v) => eng.formatExact('qty', v is num ? v : null);
    final machine = ctx.machineName['${row['machine']}'] ?? '—';
    final remarks = remarkParts(row);

    return SheetCard(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Text(displayDay('${row['date'] ?? ''}'), style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: t.ink)),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                  decoration: BoxDecoration(color: t.wash, borderRadius: BorderRadius.circular(999)),
                  child: Text(machine, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: t.ink)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          _IconLine(icon: Icons.person_outline_rounded, text: _firstText([row['operator'], row['workingStatus']])),
          const SizedBox(height: 2),
          _IconLine(icon: Icons.category_outlined, text: _firstText([row['itemName']])),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Metric(label: 'Actual', value: q(calc['actualQty'])),
              _Metric(label: 'OK', value: q(jsToNumber(row['okQty'])), dot: colors.ok),
              _Metric(label: 'Rejected', value: q(calc['rejectedQty']), dot: colors.reject),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Metric(label: 'Shift (hr)', value: q(calc['shiftHours'])),
              _Metric(label: 'Effective (hr)', value: q(calc['effectiveHours'])),
              _Metric(label: 'Stoppage (min)', value: q(calc['totalStoppageMin']), dot: colors.downtime),
            ],
          ),
          if (remarks.isNotEmpty) ...[
            const SizedBox(height: 10),
            Divider(height: 1, color: t.border),
            const SizedBox(height: 10),
            for (var i = 0; i < remarks.length; i++) ...[
              if (i > 0) const SizedBox(height: 6),
              _Remark(part: remarks[i]),
            ],
          ],
        ],
      ),
    );
  }
}

class _IconLine extends StatelessWidget {
  const _IconLine({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(padding: const EdgeInsets.only(top: 1.5), child: Icon(icon, size: 16, color: t.muted)),
        const SizedBox(width: 6),
        Expanded(child: Text(text, style: TextStyle(fontSize: 13.5, height: 1.3, color: t.ink))),
      ],
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value, this.dot});
  final String label;
  final String value;
  final Color? dot;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (dot != null) ...[
                Container(width: 7, height: 7, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
                const SizedBox(width: 4),
              ],
              Flexible(child: Text(label, style: TextStyle(fontSize: 11.5, height: 1.2, color: t.muted))),
            ],
          ),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: t.ink)),
          ),
        ],
      ),
    );
  }
}

/// "Reject · Other (12 pcs): scratches" - bold label, then the text; the
/// general remark has no label.
class _Remark extends StatelessWidget {
  const _Remark({required this.part});
  final Map<String, dynamic> part;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    final general = part['key'] == 'general';
    final figure = '${part['figure'] ?? ''}';
    final label = general ? '' : '${part['title']}${figure.isNotEmpty ? ' ($figure)' : ''}: ';
    return Text.rich(
      TextSpan(
        children: [
          if (label.isNotEmpty) TextSpan(text: label, style: TextStyle(fontWeight: FontWeight.w700, color: t.ink)),
          TextSpan(text: '${part['text'] ?? ''}'),
        ],
      ),
      style: TextStyle(fontSize: 13, height: 1.35, color: t.muted),
    );
  }
}
