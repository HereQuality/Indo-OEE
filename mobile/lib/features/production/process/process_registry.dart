import '../processes/bpc/bpc_spec.dart';
import '../processes/cnc/cnc_spec.dart';
import '../processes/contact/contact_spec.dart';
import '../processes/embossing/embossing_spec.dart';
import '../processes/final_assembly/final_assembly_spec.dart';
import '../processes/injection/injection_spec.dart';
import '../processes/mfd/mfd_spec.dart';
import '../processes/powder_coating/powder_spec.dart';
import '../processes/press/press_spec.dart';
import '../processes/printing/printing_spec.dart';
import '../processes/rivet/rivet_spec.dart';
import '../processes/rubber/rubber_spec.dart';
import '../processes/spm/spm_spec.dart';
import '../processes/spring/spring_spec.dart';
import '../processes/trobe/trobe_spec.dart';
import '../processes/vmc/vmc_spec.dart';
import 'process_spec.dart';

/// Every process whose Data Entry page the app has. Adding a process is one
/// line here (and its folder under `processes/<key>/`): the route table, the
/// list screen, the editor and the "which process owns this page" match all
/// read this list.
class ProcessRegistry {
  ProcessRegistry._();

  static const List<ProcessSpec> all = [
    cncSpec,
    vmcSpec,
    spmSpec,
    rivetSpec,
    pressSpec,
    contactSpec,
    trobeSpec,
    springSpec,
    powderCoatingSpec,
    rubberSpec,
    printingSpec,
    injectionSpec,
    bpcSpec,
    mfdSpec,
    embossingSpec,
    finalAssemblySpec,
  ];

  static ProcessSpec? byKey(String key) {
    for (final s in all) {
      if (s.key == key) return s;
    }
    return null;
  }

  /// The spec whose page [path] (a menu URL without the role slug) is.
  static ProcessSpec? byPath(String path) {
    for (final s in all) {
      if (s.routePath == path || s.routeAliases.contains(path)) return s;
    }
    return null;
  }
}
