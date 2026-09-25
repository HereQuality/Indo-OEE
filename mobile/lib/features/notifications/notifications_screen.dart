import 'package:flutter/material.dart';

import '../../app/app_scaffold.dart';
import '../../core/widgets/states.dart';

/// STUB — replaced by the real port of the web page. Keep the class name and
/// the `const NotificationsScreen({super.key})` constructor: app/routes.dart builds it.
class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) => const AppScaffold(
        title: 'Notifications',
        body: EmptyView(message: 'This screen is being built.', icon: Icons.construction_rounded),
      );
}
