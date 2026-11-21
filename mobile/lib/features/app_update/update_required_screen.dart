import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/store_links.dart';
import '../../providers/app_update_provider.dart';

/// Hard update: full-screen, unavoidable block shown in place of the whole app
/// (app/app.dart `_AuthGate`) while [AppUpdateProvider.isForceUpdateRequired].
class UpdateRequiredScreen extends StatefulWidget {
  const UpdateRequiredScreen({super.key});

  @override
  State<UpdateRequiredScreen> createState() => _UpdateRequiredScreenState();
}

class _UpdateRequiredScreenState extends State<UpdateRequiredScreen> {
  bool _checking = false;
  bool _opening = false;

  Future<void> _checkAgain() async {
    setState(() => _checking = true);
    await context.read<AppUpdateProvider>().refreshNow();
    if (mounted) setState(() => _checking = false);
  }

  Future<void> _openStore() async {
    final uri = StoreLinks.appStoreUri();
    if (uri == null) return;
    setState(() => _opening = true);
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      // Nothing better to do: the person is still safely on this screen.
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
    final installed = provider.installedVersion;

    return PopScope(
      canPop: false,
      child: Scaffold(
        body: DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [scheme.primary.withValues(alpha: 0.12), scheme.surface],
              stops: const [0.0, 0.45],
            ),
          ),
          child: SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(
                        child: Container(
                          padding: const EdgeInsets.all(18),
                          decoration: BoxDecoration(color: scheme.primary.withValues(alpha: 0.14), shape: BoxShape.circle),
                          child: Icon(Icons.system_update_alt, size: 44, color: scheme.primary),
                        ),
                      ),
                      const SizedBox(height: 24),
                      Text(
                        'Update Required',
                        style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        status.message.isNotEmpty
                            ? status.message
                            : 'A required update is available. Please update to keep using the app.',
                        style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
                        textAlign: TextAlign.center,
                      ),
                      if (installed != null && status.minVersion.isNotEmpty) ...[
                        const SizedBox(height: 18),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          decoration: BoxDecoration(
                            color: scheme.surfaceContainerLow,
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.6)),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                            children: [
                              _VersionColumn(label: 'YOUR VERSION', value: installed, color: scheme.onSurfaceVariant),
                              Icon(Icons.arrow_forward, size: 18, color: scheme.outline),
                              _VersionColumn(label: 'REQUIRED', value: '${status.minVersion}+', color: scheme.primary),
                            ],
                          ),
                        ),
                      ],
                      const SizedBox(height: 24),
                      if (StoreLinks.hasStoreLink)
                        FilledButton.icon(
                          onPressed: _opening ? null : _openStore,
                          style: FilledButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                          ),
                          icon: _opening
                              ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                              : const Icon(Icons.system_update, size: 20),
                          label: const Text('Update Now'),
                        )
                      else
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          decoration: BoxDecoration(color: scheme.surfaceContainerLow, borderRadius: BorderRadius.circular(14)),
                          child: Text(
                            'Please update via your usual app source (Play Store / App Store / the link your admin shared).',
                            style: theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      const SizedBox(height: 12),
                      TextButton.icon(
                        onPressed: _checking ? null : _checkAgain,
                        icon: _checking
                            ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.refresh, size: 18),
                        label: Text(_checking ? 'Checking...' : "I've already updated — check again"),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _VersionColumn extends StatelessWidget {
  const _VersionColumn({required this.label, required this.value, required this.color});

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label, style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant, letterSpacing: 0.6)),
        const SizedBox(height: 2),
        Text(value, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800, color: color)),
      ],
    );
  }
}
