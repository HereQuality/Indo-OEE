import '../../../app/page_access.dart';
import '../../../app/routes.dart';
import '../../../models/app_user.dart';
import '../../../providers/menu_provider.dart';
import '../dashboard/data/dashboard_models.dart';
import '../process/process_registry.dart';

/// Why a process card can't be opened.
enum HubBlock {
  /// The phone app has no screen for this process's page yet.
  notInApp,

  /// The process has no Data Entry page linked (shown to admins only).
  notLinked,
}

/// One card on the Data Entry hub.
class HubEntry {
  const HubEntry({required this.process, this.menuUrl, this.block});

  final ProcessInfo process;

  /// The menu URL to open (null when [block]ed).
  final String? menuUrl;
  final HubBlock? block;

  bool get enabled => block == null;
  int get machineCount => process.machines.length;

  String get machinesText => machineCount == 1 ? '1 machine' : '$machineCount machines';

  String get subtitle => switch (block) {
        HubBlock.notInApp => 'Not in the app yet',
        HubBlock.notLinked => 'Not linked to a page',
        null => machinesText,
      };
}

/// The processes this person may enter data for — the same rule the dashboards
/// use: an admin sees every process; anyone else sees a process only when
/// Manage Role lets them view that process's data-entry page
/// ([PageAccess.canViewMenuUrl]). A process whose page the phone has no screen
/// for is listed but blocked; one with no page linked is listed (blocked) for
/// admins only.
List<HubEntry> hubEntries(List<ProcessInfo> processes, {required AppUser? user, required MenuProvider menu}) {
  final out = <HubEntry>[];
  for (final p in processes) {
    final url = p.dataEntryMenu.trim();
    if (url.isEmpty) {
      if (menu.isAdmin) out.add(HubEntry(process: p, block: HubBlock.notLinked));
      continue;
    }
    if (!PageAccess.canViewMenuUrl(menu, url)) continue;
    final route = AppRoutes.match(url);
    final supported = route != null && ProcessRegistry.byPath(route.path) != null;
    out.add(supported && PageAccess.canOpen(user, menu, url)
        ? HubEntry(process: p, menuUrl: url)
        : HubEntry(process: p, block: HubBlock.notInApp));
  }
  return out;
}
