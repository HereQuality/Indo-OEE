import 'package:flutter/material.dart';

import '../data/processes_controller.dart';
import '../sheets/customize_sheet.dart';

/// Opens the Customize sheet (SuperAdmin) for one dashboard: [processId] null
/// is "All machines", whose picks stay on this device. Shared by the app-bar
/// action (phone), the tablet header button and the "nothing selected" card.
Future<void> openDashboardCustomize(
  BuildContext context, {
  required ProcessesController processes,
  required String? processId,
}) {
  return showCustomizeSheet(
    context,
    stats: [for (final s in processes.statsFor(processId)) s['key'] as String],
    charts: [for (final c in processes.chartsFor(processId)) c['key'] as String],
    onSave: (stats, charts) => processes.saveWidgets(processId, stats, charts),
  );
}
