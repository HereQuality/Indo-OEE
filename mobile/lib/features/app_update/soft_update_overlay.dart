import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../providers/app_update_provider.dart';
import 'soft_update_banner.dart';

/// Pins [SoftUpdateBanner] near the bottom of [child] while
/// [AppUpdateProvider.isSoftUpdateAvailable]. Wrapped around both the login
/// screen and the signed-in app (app/app.dart): someone who sits on the login
/// screen for days is exactly who should see it.
class SoftUpdateOverlay extends StatelessWidget {
  const SoftUpdateOverlay({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final show = context.select<AppUpdateProvider, bool>((p) => p.isSoftUpdateAvailable);
    final keyboardOpen = MediaQuery.viewInsetsOf(context).bottom > 0;

    return Stack(
      children: [
        Positioned.fill(child: child),
        // Out of the way while typing (login form, data entry).
        if (show && !keyboardOpen)
          const Positioned(
            left: 0,
            right: 0,
            // Clears MainShell's bottom NavigationBar (56 px in app_theme.dart);
            // the card adds its own 10 px gap below.
            bottom: 58,
            child: SafeArea(top: false, child: SoftUpdateBanner()),
          ),
      ],
    );
  }
}
