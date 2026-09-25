import 'package:flutter/material.dart';

import '../charts/chart_props.dart';
import 'dash_card.dart';
import 'widget_card.dart';

/// Full-screen view of one visual (the web's Maximize pop-up): the same chart
/// re-built at the larger size (`expanded: true`), not a scaled picture, with
/// its own chart <-> table switch. It always opens on the chart, whatever the
/// card underneath is showing.
class ChartMaximizePage extends StatefulWidget {
  const ChartMaximizePage({
    super.key,
    required this.title,
    this.hint,
    this.tableOnly = false,
    this.onDrill,
    required this.builder,
    this.refresh,
  });

  final String title;
  final String? hint;
  final bool tableOnly;
  final VoidCallback? onDrill;
  final ChartBodyBuilder builder;

  /// Rebuilds the chart when the dashboard's filters change underneath
  /// (a bar tapped here cross-filters the whole dashboard).
  final Listenable? refresh;

  /// Pushes the page as a full-screen dialog route.
  static Future<void> open(
    BuildContext context, {
    required String title,
    String? hint,
    bool tableOnly = false,
    VoidCallback? onDrill,
    required ChartBodyBuilder builder,
    Listenable? refresh,
  }) =>
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          fullscreenDialog: true,
          builder: (_) => ChartMaximizePage(
            title: title,
            hint: hint,
            tableOnly: tableOnly,
            onDrill: onDrill,
            builder: builder,
            refresh: refresh,
          ),
        ),
      );

  @override
  State<ChartMaximizePage> createState() => _ChartMaximizePageState();
}

class _ChartMaximizePageState extends State<ChartMaximizePage> {
  ChartView _view = ChartView.chart;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final effective = widget.tableOnly ? ChartView.table : _view;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: 'Close',
          icon: const Icon(Icons.close_rounded),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        titleSpacing: 0,
        title: Text(widget.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        actions: [
          if (!widget.tableOnly) ViewToggleButton(view: _view, onChanged: (v) => setState(() => _view = v)),
          if (widget.onDrill != null) DrillButton(onPressed: widget.onDrill!),
          const SizedBox(width: 4),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1100),
            child: LayoutBuilder(
              builder: (context, box) {
                final hintText = widget.hint;
                final stage = ListenableBuilder(
                  listenable: widget.refresh ?? const _Never(),
                  builder: (context, _) => widget.builder(context, effective, true),
                );
                // Landscape phones are short: keep a usable stage and scroll the rest.
                const minStage = 260.0;
                final header = (hintText == null || hintText.isEmpty)
                    ? const SizedBox.shrink()
                    : Padding(
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: Text(hintText, style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant)),
                        ),
                      );
                final card = Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                  child: DashCard(padding: const EdgeInsets.all(12), child: stage),
                );
                return Column(
                  children: [
                    header,
                    Expanded(
                      child: LayoutBuilder(
                        builder: (context, inner) => inner.maxHeight >= minStage + 20
                            ? card
                            : SingleChildScrollView(child: SizedBox(height: minStage + 20, child: card)),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

/// A [Listenable] that never fires (used when there is nothing to listen to).
class _Never implements Listenable {
  const _Never();
  @override
  void addListener(VoidCallback listener) {}
  @override
  void removeListener(VoidCallback listener) {}
}
