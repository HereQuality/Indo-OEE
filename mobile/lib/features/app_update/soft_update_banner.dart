import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/store_links.dart';
import '../../providers/app_update_provider.dart';

/// Soft update: non-blocking "a newer build is out" card. Stays until the
/// person taps Update or Dismiss (dismiss lasts for this app session).
class SoftUpdateBanner extends StatefulWidget {
  const SoftUpdateBanner({super.key});

  @override
  State<SoftUpdateBanner> createState() => _SoftUpdateBannerState();
}

class _SoftUpdateBannerState extends State<SoftUpdateBanner> {
  bool _opening = false;

  Future<void> _openStore() async {
    final uri = StoreLinks.appStoreUri();
    if (uri == null) return;
    setState(() => _opening = true);
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      // The banner is still there to retry.
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final provider = context.watch<AppUpdateProvider>();
    final status = provider.status;

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      child: Center(
        heightFactor: 1,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: Material(
            color: scheme.surfaceContainerHigh,
            elevation: 3,
            shadowColor: Colors.black.withValues(alpha: 0.18),
            borderRadius: BorderRadius.circular(16),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(7),
                    decoration: BoxDecoration(color: scheme.primary.withValues(alpha: 0.14), shape: BoxShape.circle),
                    child: Icon(Icons.system_update_alt, size: 16, color: scheme.primary),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      status.softMessage.isNotEmpty ? status.softMessage : 'Update available — v${status.latestVersion} is out',
                      style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600, color: scheme.onSurface),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: 4),
                  TextButton(onPressed: provider.dismissSoftUpdate, child: const Text('Dismiss')),
                  if (_opening)
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 16),
                      child: SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                    )
                  else
                    TextButton(onPressed: StoreLinks.hasStoreLink ? _openStore : null, child: const Text('Update')),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
