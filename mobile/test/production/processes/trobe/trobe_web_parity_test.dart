import 'package:indo/features/production/processes/trobe/trobe_spec.dart';

import '../twin_web_parity.dart';

void main() => registerTwinWebParity(
  trobeSpec,
  itemLabel: 'Part Name',
  webLines: twinWebLines(
    partTitle: 'Part, Total Cycle Time',
    partBoxes: ['Part Name *', 'Total Cycle Time (Sec) *'],
    downtimeTitle: 'Downtime / Stoppage (min)',
    remarksTitle: 'Remarks',
    remarksLabel: 'Remarks',
  ),
);
