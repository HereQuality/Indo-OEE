import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/theme/app_colors.dart';
import '../../core/widgets/form_widgets.dart';
import '../../providers/auth_provider.dart';

/// Shown when the server says the account is blocked / inactive
/// (mirrors pages/Authentication/Blocked.jsx).
class BlockedScreen extends StatelessWidget {
  const BlockedScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Scaffold(
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
                    width: 96,
                    height: 96,
                    decoration: BoxDecoration(color: AppColors.critical.withValues(alpha: 0.14), shape: BoxShape.circle),
                    child: const Icon(Icons.block_rounded, size: 48, color: AppColors.critical),
                  ),
                  const SizedBox(height: 20),
                  const Text('Account Blocked', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  Text(
                    'Your account has been blocked by an administrator. You can no longer access this app.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: s.onSurfaceVariant),
                  ),
                  const SizedBox(height: 20),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: [
                          const Text(
                            'If you believe this is a mistake, please contact your system administrator to restore access to your account.',
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 16),
                          PrimaryButton(
                            label: 'Return to login',
                            onPressed: () => context.read<AuthProvider>().acknowledgeBlocked(),
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
      ),
    );
  }
}
