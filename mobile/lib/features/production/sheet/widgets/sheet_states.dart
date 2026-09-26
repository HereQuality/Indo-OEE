import 'package:flutter/material.dart';

/// Placeholder cards shown while the first page loads — the same rhythm as the
/// real list (a date header, then machine cards with a couple of entry lines),
/// gently pulsing.
class SheetSkeleton extends StatefulWidget {
  const SheetSkeleton({super.key});

  @override
  State<SheetSkeleton> createState() => _SheetSkeletonState();
}

class _SheetSkeletonState extends State<SheetSkeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100));

  @override
  void initState() {
    super.initState();
    _pulse.repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final bone = s.surfaceContainerHigh;
    Widget b(double w, double h, {double r = 8}) => Container(
          width: w,
          height: h,
          decoration: BoxDecoration(color: bone, borderRadius: BorderRadius.circular(r)),
        );
    Widget entry() => Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
          child: Row(
            children: [
              b(26, 26),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [b(120, 14), const SizedBox(height: 8), b(180, 11), const SizedBox(height: 8), b(96, 16, r: 99)],
                ),
              ),
              const SizedBox(width: 10),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [b(64, 16), const SizedBox(height: 8), b(48, 11)]),
            ],
          ),
        );
    Widget card() => Container(
          margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
          decoration: BoxDecoration(
            color: Theme.of(context).cardTheme.color ?? s.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: s.outlineVariant),
          ),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 12, 8),
                child: Row(children: [b(70, 18), const Spacer(), b(86, 26, r: 99)]),
              ),
              Divider(height: 1, color: s.outlineVariant),
              entry(),
              Divider(height: 1, color: s.outlineVariant),
              entry(),
            ],
          ),
        );
    Widget section() => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 6),
              child: Row(children: [b(140, 14), const Spacer(), b(90, 12)]),
            ),
            card(),
            card(),
          ],
        );
    return Semantics(
      label: 'Loading entries',
      child: ExcludeSemantics(
        child: FadeTransition(
          opacity: Tween<double>(begin: 0.45, end: 1).animate(CurvedAnimation(parent: _pulse, curve: Curves.easeInOut)),
          child: ListView(
            key: const ValueKey('sheet-skeleton'),
            physics: const NeverScrollableScrollPhysics(),
            children: [section(), section()],
          ),
        ),
      ),
    );
  }
}

/// Bottom of the list: loading-more spinner, a retry, the load-more fallback,
/// or the "that's everything" note — plus room for the floating button.
class SheetListFooter extends StatelessWidget {
  const SheetListFooter({
    super.key,
    required this.loadingMore,
    required this.moreError,
    required this.hasMore,
    required this.loadedDays,
    required this.totalDays,
    required this.searching,
    required this.onLoadMore,
    this.bottomPad = 104,
  });

  final double bottomPad;
  final bool loadingMore;
  final String? moreError;
  final bool hasMore;
  final int loadedDays;
  final int totalDays;
  final bool searching;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    Widget body;
    if (loadingMore) {
      body = Row(
        key: const ValueKey('footer-loading'),
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.4)),
          const SizedBox(width: 12),
          Text('Loading more days…', style: TextStyle(fontSize: 13, color: s.onSurfaceVariant)),
        ],
      );
    } else if (moreError != null) {
      body = Column(
        key: const ValueKey('footer-error'),
        children: [
          Text(moreError!, textAlign: TextAlign.center, style: TextStyle(fontSize: 13, color: s.error)),
          const SizedBox(height: 8),
          OutlinedButton.icon(onPressed: onLoadMore, icon: const Icon(Icons.refresh), label: const Text('Try again')),
        ],
      );
    } else if (hasMore) {
      body = Column(
        key: const ValueKey('footer-more'),
        children: [
          if (searching)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                'Searching the $loadedDays days loaded so far.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: s.onSurfaceVariant),
              ),
            ),
          OutlinedButton.icon(
            key: const ValueKey('footer-load-more'),
            onPressed: onLoadMore,
            icon: const Icon(Icons.expand_more_rounded),
            label: const Text('Load more days'),
          ),
        ],
      );
    } else {
      final n = totalDays > loadedDays ? totalDays : loadedDays;
      body = Text(
        key: const ValueKey('footer-end'),
        n == 1 ? "That's the only day in this period" : "That's all $n days in this period",
        textAlign: TextAlign.center,
        style: TextStyle(fontSize: 13, color: s.onSurfaceVariant),
      );
    }
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 10, 16, bottomPad),
      child: Center(child: body),
    );
  }
}
