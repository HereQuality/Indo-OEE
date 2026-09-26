import 'package:flutter/material.dart';

import 'dash_card.dart';

/// A pulsing placeholder block. Stands still when the platform asks for
/// reduced motion.
class SkeletonBox extends StatefulWidget {
  const SkeletonBox({super.key, this.width, this.height = 14, this.radius = 8});

  final double? width;
  final double height;
  final double radius;

  @override
  State<SkeletonBox> createState() => _SkeletonBoxState();
}

class _SkeletonBoxState extends State<SkeletonBox> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1000));
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final still = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (still && _started) {
      _c.stop();
      _started = false;
    } else if (!still && !_started) {
      _c.repeat(reverse: true);
      _started = true;
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final onSurface = Theme.of(context).colorScheme.onSurface;
    return AnimatedBuilder(
      animation: _c,
      builder: (_, _) => Container(
        width: widget.width,
        height: widget.height,
        decoration: BoxDecoration(
          color: onSurface.withValues(alpha: 0.06 + 0.06 * _c.value),
          borderRadius: BorderRadius.circular(widget.radius),
        ),
      ),
    );
  }
}

/// Placeholder for a KPI tile.
class KpiTileSkeleton extends StatelessWidget {
  const KpiTileSkeleton({super.key});

  @override
  Widget build(BuildContext context) => const DashCard(
        padding: EdgeInsets.fromLTRB(12, 10, 12, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            SkeletonBox(width: 90, height: 11),
            SizedBox(height: 8),
            SkeletonBox(width: 70, height: 22),
            SizedBox(height: 6),
            SkeletonBox(width: 110, height: 10),
          ],
        ),
      );
}

/// Placeholder for a chart card.
class ChartCardSkeleton extends StatelessWidget {
  const ChartCardSkeleton({super.key, this.height = 200});
  final double height;

  @override
  Widget build(BuildContext context) => DashCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SkeletonBox(width: 180, height: 14),
            const SizedBox(height: 6),
            const SkeletonBox(width: 240, height: 10),
            const SizedBox(height: 12),
            SkeletonBox(height: height, radius: 12),
          ],
        ),
      );
}

/// Placeholder for a process tile on the landing page.
class ProcessTileSkeleton extends StatelessWidget {
  const ProcessTileSkeleton({super.key});

  @override
  Widget build(BuildContext context) => const DashCard(
        child: Row(
          children: [
            SkeletonBox(width: 44, height: 44, radius: 12),
            SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  SkeletonBox(width: 130, height: 14),
                  SizedBox(height: 8),
                  SkeletonBox(width: 80, height: 10),
                ],
              ),
            ),
          ],
        ),
      );
}
