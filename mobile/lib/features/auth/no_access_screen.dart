import 'package:flutter/material.dart';

import '../../app/navigation.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/form_widgets.dart';

/// Shown when the signed-in role has no "view" permission on the page
/// (mirrors pages/Authentication/NoAccess.jsx).
class NoAccessScreen extends StatelessWidget {
  const NoAccessScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('No access')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 88,
                    height: 88,
                    decoration: BoxDecoration(color: AppColors.warn.withValues(alpha: 0.15), shape: BoxShape.circle),
                    child: const Icon(Icons.lock_outline_rounded, size: 44, color: AppColors.warn),
                  ),
                  const SizedBox(height: 20),
                  const Text('No Access', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  Text(
                    "Your role doesn't have permission to view this page.",
                    textAlign: TextAlign.center,
                    style: TextStyle(color: s.onSurfaceVariant),
                  ),
                  const SizedBox(height: 20),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: [
                          Text(
                            'If you need access, ask your administrator to grant "View" permission for this page under Employee Management › Manage Role.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: s.onSurface),
                          ),
                          const SizedBox(height: 16),
                          PrimaryButton(label: 'Back to my home', onPressed: () => AppNav.goHome(context)),
                        ],
                      ),
                    ),
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
