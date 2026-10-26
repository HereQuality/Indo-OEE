import 'package:indo/features/production/processes/contact/contact_spec.dart';

import '../twin_web_parity.dart';

void main() => registerTwinWebParity(
  contactSpec,
  itemLabel: 'Part Name',
  webLines: twinWebLines(
    partTitle: 'Part, Total Cycle Time',
    partBoxes: ['Part Name *', 'Total Cycle Time (Sec) *'],
    downtimeTitle: 'Downtime / Stoppage (min)',
    remarksTitle: 'Remarks',
    remarksLabel: 'Remarks',
  ),
);
