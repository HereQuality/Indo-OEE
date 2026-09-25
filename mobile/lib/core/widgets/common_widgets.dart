import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../utils/formatters.dart';

/// A padded card with an optional title — the web app's white panels.
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, this.title, this.trailing, required this.child, this.padding = const EdgeInsets.all(16)});
  final String? title;
  final Widget? trailing;
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (title != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(
                  children: [
                    Expanded(child: Text(title!, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700))),
                    if (trailing != null) trailing!,
                  ],
                ),
              ),
            child,
          ],
        ),
      ),
    );
  }
}

/// Small coloured pill ("Active", "Blocked", "Pending"…). Text colour is
/// lightened in dark mode so it stays readable on the tinted background.
class StatusChip extends StatelessWidget {
  const StatusChip(this.label, {super.key, this.color = AppColors.slate500, this.icon});
  final String label;
  final Color color;
  final IconData? icon;

  factory StatusChip.active(bool active) =>
      StatusChip(active ? 'Active' : 'Inactive', color: active ? AppColors.ok : AppColors.slate500);

  @override
  Widget build(BuildContext context) {
    final fg = AppColors.readable(context, color);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 13, color: fg), const SizedBox(width: 4)],
          Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg)),
        ],
      ),
    );
  }
}

/// Round avatar: profile picture when there is one, else initials.
class UserAvatar extends StatelessWidget {
  const UserAvatar({super.key, this.imageUrl, this.name, this.radius = 20});
  final String? imageUrl;
  final String? name;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final fallback = CircleAvatar(
      radius: radius,
      backgroundColor: s.primary.withValues(alpha: 0.15),
      child: Text(
        Fmt.initials(name),
        style: TextStyle(color: AppColors.readable(context, s.primary), fontWeight: FontWeight.w700, fontSize: radius * 0.75),
      ),
    );
    if (imageUrl == null || imageUrl!.isEmpty) return fallback;
    return CachedNetworkImage(
      imageUrl: imageUrl!,
      imageBuilder: (_, provider) => CircleAvatar(radius: radius, backgroundImage: provider),
      placeholder: (_, __) => fallback,
      errorWidget: (_, __, ___) => fallback,
    );
  }
}

/// Label / value row for detail sheets.
class InfoRow extends StatelessWidget {
  const InfoRow(this.label, this.value, {super.key});
  final String label;
  final String? value;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 120, child: Text(label, style: TextStyle(color: s.onSurfaceVariant, fontSize: 13))),
          Expanded(child: Text((value == null || value!.isEmpty) ? '—' : value!, style: const TextStyle(fontWeight: FontWeight.w500))),
        ],
      ),
    );
  }
}
