import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/app_colors.dart';
import '../../core/widgets/dynamic_icon.dart';

/// Big tappable card that opens one of the two main workflows.
class LauncherCard extends StatelessWidget {
  const LauncherCard({
    super.key,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.colors,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final List<Color> colors;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Fixed saturated gradients: the text colour is always the light one.
    const fg = Colors.white;
    return Semantics(
      button: true,
      label: title,
      excludeSemantics: true,
      child: Material(
        color: Colors.transparent,
        elevation: 2,
        shadowColor: colors.last.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(16),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: colors),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () {
              HapticFeedback.selectionClick();
              onTap();
            },
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 68),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Container(
                      width: 42,
                      height: 42,
                      decoration: BoxDecoration(color: fg.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(12)),
                      child: Icon(icon, color: fg, size: 22),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(title, style: const TextStyle(color: fg, fontSize: 15, fontWeight: FontWeight.w700)),
                          const SizedBox(height: 1),
                          Text(subtitle, style: TextStyle(color: fg.withValues(alpha: 0.85), fontSize: 12.5)),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    const Icon(Icons.arrow_forward_rounded, color: fg, size: 20),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

const _tones = <Color>[
  AppColors.brand600,
  Color(0xFF0D9488), // teal
  Color(0xFF7C3AED), // violet
  AppColors.warn,
  Color(0xFFDB2777), // pink
  AppColors.ok,
  Color(0xFF0284C7), // sky
  Color(0xFFEA580C), // orange
];

Color toneFor(String label) {
  var h = 0;
  for (final c in label.codeUnits) {
    h = (c + ((h << 5) - h)) & 0x7fffffff;
  }
  return _tones[h % _tones.length];
}

/// One page in the "everything else" grid: tinted icon tile + label.
class PageTile extends StatelessWidget {
  const PageTile({super.key, required this.label, this.icon, required this.onTap});

  final String label;
  final String? icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final tone = toneFor(label);
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            onTap();
          },
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 76),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(6, 10, 6, 8),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(color: tone.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(11)),
                    child: DynamicIcon(icon, size: 19, color: AppColors.readable(context, tone)),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    label,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, height: 1.2, color: s.onSurface),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 16, bottom: 8),
        child: Text(
          text.toUpperCase(),
          style: TextStyle(
            fontSize: 11,
            letterSpacing: 0.4,
            fontWeight: FontWeight.w700,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      );
}

/// Company mark shown in the greeting header.
class CompanyBadge extends StatelessWidget {
  const CompanyBadge({super.key, required this.name, this.logo});
  final String name;
  final String? logo;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final dark = s.brightness == Brightness.dark;
    final fallback = Icon(Icons.business_rounded, size: 16, color: s.onSurfaceVariant);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 24,
          height: 24,
          padding: const EdgeInsets.all(2),
          decoration: BoxDecoration(
            // A light plate keeps dark-on-transparent logos visible in dark mode.
            color: dark ? const Color(0xFFF1F5F9) : s.surface,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: s.outlineVariant),
          ),
          child: (logo == null || logo!.isEmpty)
              ? fallback
              : CachedNetworkImage(
                  imageUrl: logo!,
                  memCacheHeight: (24 * MediaQuery.devicePixelRatioOf(context)).ceil(),
                  fit: BoxFit.contain,
                  placeholder: (_, _) => fallback,
                  errorWidget: (_, _, _) => fallback,
                ),
        ),
        if (name.isNotEmpty) ...[
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: s.onSurfaceVariant),
            ),
          ),
        ],
      ],
    );
  }
}

/// Pulsing placeholder blocks shown while the menus load.
class HomeSkeleton extends StatefulWidget {
  const HomeSkeleton({super.key});

  @override
  State<HomeSkeleton> createState() => _HomeSkeletonState();
}

class _HomeSkeletonState extends State<HomeSkeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    Widget block(double h, {double? w, double r = 16}) => Container(
          height: h,
          width: w,
          decoration: BoxDecoration(color: s.onSurface.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(r)),
        );
    return Semantics(
      label: 'Loading your workspace',
      child: FadeTransition(
        opacity: Tween(begin: 0.55, end: 1.0).animate(CurvedAnimation(parent: _c, curve: Curves.easeInOut)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 16),
            block(68, r: 16),
            const SizedBox(height: 10),
            block(68, r: 16),
            const SizedBox(height: 24),
            block(12, w: 120, r: 6),
            const SizedBox(height: 10),
            Row(children: [
              for (var i = 0; i < 3; i++) ...[
                if (i > 0) const SizedBox(width: 10),
                Expanded(child: block(76, r: 12)),
              ],
            ]),
          ],
        ),
      ),
    );
  }
}
