import 'package:flutter/material.dart';

/// STUB — wraps the signed-in app. The real version watches the maintenance /
/// announcement status (REST + `maintenance:update` socket event) and shows
/// [UnderMaintenanceScreen] to non-SuperAdmins while maintenance is on, plus
/// the once-a-day announcement dialog. Keep the class name + `child` parameter:
/// app/app.dart builds `MaintenanceGate(child: …)`.
class MaintenanceGate extends StatelessWidget {
  const MaintenanceGate({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => child;
}
