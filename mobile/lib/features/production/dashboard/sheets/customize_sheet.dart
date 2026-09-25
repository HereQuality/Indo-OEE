import 'package:flutter/foundation.dart' show listEquals;
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

import '../../../../core/api/api_client.dart' show ApiException;
import '../../../../core/utils/alerts.dart';
import '../dashboard_engine.dart' as eng;
import 'sheet_kit.dart';
import 'widget_previews.dart';

/// Picks which KPI tiles and graphs the dashboard shows, and in what order
/// (port of WidgetPicker.jsx, as the dashboard's Customize button opens it).
///
/// [stats] / [charts] are the ordered catalog keys currently shown. Each list
/// has the shown items first - drag the handle to reorder, switch off to remove
/// - and the remaining catalog entries below, where switching on appends them.
/// Every row carries a sketch of how it looks, its name and what it means.
///
/// Save awaits [onSave]: while it runs the sheet shows progress, on success it
/// closes, and if [onSave] throws it stays open, shows the message inline and
/// as an error toast so nothing is lost. Closing with unsaved changes asks
/// first (the web modal is `backdrop="static"` for the same reason).
Future<void> showCustomizeSheet(
  BuildContext context, {
  required List<String> stats,
  required List<String> charts,
  required Future<void> Function(List<String> stats, List<String> charts) onSave,
}) {
  return showSheet<void>(
    context,
    isDismissible: false,
    // Dragging a row's handle must never fight the sheet's own swipe-to-close.
    enableDrag: false,
    builder: (ctx) => FullHeightSheet(child: CustomizeSheet(stats: stats, charts: charts, onSave: onSave)),
  );
}

enum _Kind { stat, chart }

class CustomizeSheet extends StatefulWidget {
  const CustomizeSheet({super.key, required this.stats, required this.charts, required this.onSave});

  final List<String> stats;
  final List<String> charts;
  final Future<void> Function(List<String> stats, List<String> charts) onSave;

  @override
  State<CustomizeSheet> createState() => _CustomizeSheetState();
}

/// Keys that exist in [catalog], once each, in the given order.
List<String> _sanitize(List<String> keys, Map<String, Map<String, dynamic>> lookup) {
  final seen = <String>{};
  return [
    for (final k in keys)
      if (lookup.containsKey(k) && seen.add(k)) k,
  ];
}

class _CustomizeSheetState extends State<CustomizeSheet> {
  late final List<String> _initialStats = _sanitize(widget.stats, eng.statsByKey);
  late final List<String> _initialCharts = _sanitize(widget.charts, eng.chartsByKey);
  late List<String> _stats = List.of(_initialStats);
  late List<String> _charts = List.of(_initialCharts);
  bool _saving = false;
  String? _error;

  bool get _dirty => !listEquals(_stats, _initialStats) || !listEquals(_charts, _initialCharts);

  List<Map<String, dynamic>> _catalog(_Kind k) => k == _Kind.chart ? eng.chartCatalog : eng.statCatalog;
  List<String> _selected(_Kind k) => k == _Kind.chart ? _charts : _stats;
  void _set(_Kind k, List<String> v) => k == _Kind.chart ? _charts = v : _stats = v;

  void _toggle(_Kind kind, String key, bool on) {
    SheetHaptics.selection();
    setState(() {
      final list = List<String>.of(_selected(kind))..remove(key);
      if (on) list.add(key);
      _set(kind, list);
    });
  }

  /// Moves the item at [oldIndex] so it ends up at [newIndex] (already adjusted
  /// for the removal, as onReorderItem hands it over).
  void _reorder(_Kind kind, int oldIndex, int newIndex) {
    if (oldIndex == newIndex) return;
    setState(() {
      final list = List<String>.of(_selected(kind));
      list.insert(newIndex, list.removeAt(oldIndex));
      _set(kind, list);
    });
  }

  void _showAll(_Kind kind) {
    SheetHaptics.selection();
    setState(() {
      final have = _selected(kind);
      _set(kind, [...have, for (final w in _catalog(kind)) if (!have.contains(w['key'])) w['key'] as String]);
    });
  }

  void _hideAll(_Kind kind) {
    SheetHaptics.selection();
    setState(() => _set(kind, []));
  }

  void _reset() {
    SheetHaptics.medium();
    setState(() {
      _stats = List.of(eng.defaultStats);
      _charts = List.of(eng.defaultCharts);
      _error = null;
    });
  }

  Future<void> _save() async {
    if (_saving) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.onSave(List.of(_stats), List.of(_charts));
      if (!mounted) return;
      SheetHaptics.light();
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      final message = e is ApiException ? e.message : '$e'.replaceFirst(RegExp(r'^(Exception|Error): '), '');
      final shown = message.trim().isEmpty ? 'Failed to save the dashboard' : message;
      Alerts.error(shown);
      setState(() {
        _saving = false;
        _error = shown;
      });
    }
  }

  Future<void> _confirmDiscard() async {
    if (_saving) return;
    final discard = await Alerts.confirm(
      context,
      'Your changes to the dashboard have not been saved.',
      title: 'Discard changes?',
      confirmText: 'Discard',
    );
    if (!mounted) return;
    if (discard) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    final wide = MediaQuery.sizeOf(context).width >= 560;
    final thumb = wide ? const Size(120, 50) : const Size(72, 32);

    return PopScope(
      canPop: !_dirty && !_saving,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _confirmDiscard();
      },
      child: Column(
        children: [
          const SheetHandle(),
          SheetHeader(
            overline: 'Dashboard',
            title: 'Customize',
            subtitle: '${plural(_stats.length, 'tile')} · ${plural(_charts.length, 'graph')}',
            closeEnabled: !_saving,
            actions: [TextButton(onPressed: _saving ? null : _reset, child: const Text('Reset'))],
          ),
          Divider(height: 1, color: t.border),
          Expanded(
            child: IgnorePointer(
              ignoring: _saving,
              child: AnimatedOpacity(
                duration: const Duration(milliseconds: 150),
                opacity: _saving ? 0.55 : 1,
                child: CustomScrollView(
                  slivers: [
                    if (_error != null)
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(kSheetGutter, 12, kSheetGutter, 0),
                          child: SheetBanner(_error!),
                        ),
                      ),
                    ..._section(
                      _Kind.stat,
                      title: 'KPI tiles',
                      note: 'The headline figures across the top of the dashboard. The number on each card is only an example.',
                      thumb: thumb,
                    ),
                    ..._section(
                      _Kind.chart,
                      title: 'Graphs',
                      note: 'Each picture is a sketch of how the graph looks. On the dashboard every graph can be tapped to filter, maximized, shown as a table and broken down.',
                      thumb: thumb,
                    ),
                    const SliverToBoxAdapter(child: SizedBox(height: 20)),
                  ],
                ),
              ),
            ),
          ),
          SheetFooter(
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _saving ? null : () => Navigator.of(context).maybePop(),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    onPressed: _saving ? null : _save,
                    child: _saving
                        ? Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.4, color: t.onAccent)),
                              const SizedBox(width: 10),
                              const Flexible(child: Text('Saving…')),
                            ],
                          )
                        : const Text('Save'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _section(_Kind kind, {required String title, required String note, required Size thumb}) {
    final t = SheetTone.of(context);
    final catalog = _catalog(kind);
    final selected = _selected(kind);
    final lookup = kind == _Kind.chart ? eng.chartsByKey : eng.statsByKey;
    final off = [for (final w in catalog) if (!selected.contains(w['key'])) w];

    return [
      SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(kSheetGutter, 18, kSheetGutter, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // A Wrap, not a Row: at large text the buttons drop under the
              // title instead of squeezing it.
              Wrap(
                alignment: WrapAlignment.spaceBetween,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Semantics(
                    header: true,
                    child: Text.rich(
                      TextSpan(
                        text: title,
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: t.ink),
                        children: [
                          TextSpan(
                            text: '  ${selected.length} of ${catalog.length} shown',
                            style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w500, color: t.muted),
                          ),
                        ],
                      ),
                    ),
                  ),
                  Wrap(
                    children: [
                      TextButton(
                        onPressed: selected.length == catalog.length ? null : () => _showAll(kind),
                        child: const Text('Show all'),
                      ),
                      TextButton(
                        onPressed: selected.isEmpty ? null : () => _hideAll(kind),
                        child: const Text('Hide all'),
                      ),
                    ],
                  ),
                ],
              ),
              Text(note, style: TextStyle(fontSize: 12.5, height: 1.35, color: t.muted)),
            ],
          ),
        ),
      ),
      if (selected.isEmpty)
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(kSheetGutter, 4, kSheetGutter, 8),
            child: _EmptyHint(kind == _Kind.chart ? 'No graphs are shown. Switch some on below.' : 'No KPI tiles are shown. Switch some on below.'),
          ),
        )
      else
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: kSheetGutter),
          sliver: SliverReorderableList(
            itemCount: selected.length,
            onReorderStart: (_) => SheetHaptics.light(),
            onReorderItem: (a, b) => _reorder(kind, a, b),
            proxyDecorator: (child, index, animation) => AnimatedBuilder(
              animation: animation,
              builder: (context, child) => Material(
                elevation: Curves.easeOut.transform(animation.value) * 10,
                color: Colors.transparent,
                shadowColor: Colors.black.withValues(alpha: 0.35),
                borderRadius: BorderRadius.circular(14),
                child: child,
              ),
              child: child,
            ),
            itemBuilder: (context, i) {
              final key = selected[i];
              final item = lookup[key]!;
              return Padding(
                key: ValueKey('${kind.name}:$key'),
                padding: const EdgeInsets.only(bottom: 8),
                child: _OptionRow(
                  item: item,
                  chart: kind == _Kind.chart,
                  on: true,
                  position: i + 1,
                  count: selected.length,
                  index: i,
                  thumb: thumb,
                  onToggle: (v) => _toggle(kind, key, v),
                  onMove: (by) => _reorder(kind, i, i + by),
                ),
              );
            },
          ),
        ),
      if (off.isNotEmpty) ...[
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(kSheetGutter, 10, kSheetGutter, 0),
            child: const SheetLabel('Not shown'),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: kSheetGutter),
          sliver: SliverList.builder(
            itemCount: off.length,
            itemBuilder: (context, i) {
              final item = off[i];
              final key = item['key'] as String;
              return Padding(
                key: ValueKey('${kind.name}:$key'),
                padding: const EdgeInsets.only(bottom: 8),
                child: _OptionRow(
                  item: item,
                  chart: kind == _Kind.chart,
                  on: false,
                  thumb: thumb,
                  onToggle: (v) => _toggle(kind, key, v),
                ),
              );
            },
          ),
        ),
      ],
    ];
  }
}

class _EmptyHint extends StatelessWidget {
  const _EmptyHint(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: t.border),
      ),
      child: Row(
        children: [
          Icon(Icons.visibility_off_outlined, size: 18, color: t.muted),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: TextStyle(fontSize: 13, color: t.muted))),
        ],
      ),
    );
  }
}

/// One catalog entry: [drag handle] [sketch] [name + what it means] [switch].
class _OptionRow extends StatelessWidget {
  const _OptionRow({
    required this.item,
    required this.chart,
    required this.on,
    required this.thumb,
    required this.onToggle,
    this.position,
    this.count,
    this.index,
    this.onMove,
  });

  final Map<String, dynamic> item;
  final bool chart;
  final bool on;
  final int? position;
  final int? count;
  final int? index;
  final Size thumb;
  final ValueChanged<bool> onToggle;

  /// Moves a shown row one place earlier (-1) or later (+1).
  final ValueChanged<int>? onMove;

  @override
  Widget build(BuildContext context) {
    final t = SheetTone.of(context);
    final label = '${item['label'] ?? item['key']}';
    final hint = '${item['hint'] ?? ''}';
    final preview = chart
        ? ChartPreview(chart: item, width: thumb.width, height: thumb.height)
        : StatPreview(stat: item, width: thumb.width, height: thumb.height);

    final actions = <CustomSemanticsAction, VoidCallback>{
      if (on && onMove != null && position != null && position! > 1) const CustomSemanticsAction(label: 'Move earlier'): () => onMove!(-1),
      if (on && onMove != null && position != null && count != null && position! < count!) const CustomSemanticsAction(label: 'Move later'): () => onMove!(1),
    };

    return Semantics(
      container: true,
      label: on && position != null ? '$label, position $position of $count' : '$label, not shown',
      customSemanticsActions: actions,
      child: SheetCard(
        selected: on,
        padding: const EdgeInsets.fromLTRB(4, 8, 8, 8),
        onTap: () => onToggle(!on),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            if (on && index != null)
              ReorderableDragStartListener(
                index: index!,
                child: Tooltip(
                  message: 'Drag to reorder',
                  child: SizedBox(
                    width: 36,
                    height: 44,
                    child: Icon(Icons.drag_indicator_rounded, color: t.muted),
                  ),
                ),
              )
            else
              const SizedBox(width: 10),
            Stack(
              clipBehavior: Clip.none,
              children: [
                preview,
                if (on && position != null)
                  Positioned(
                    left: -5,
                    top: -6,
                    child: ExcludeSemantics(
                      child: Container(
                        constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(color: t.accent, borderRadius: BorderRadius.circular(9)),
                        child: Text('$position', style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: t.onAccent)),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: TextStyle(fontSize: 14, height: 1.25, fontWeight: FontWeight.w700, color: t.ink)),
                  if (hint.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(hint, style: TextStyle(fontSize: 12, height: 1.3, color: t.muted)),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 4),
            Semantics(
              label: 'Show $label',
              container: true,
              child: Switch(value: on, onChanged: onToggle),
            ),
          ],
        ),
      ),
    );
  }
}
