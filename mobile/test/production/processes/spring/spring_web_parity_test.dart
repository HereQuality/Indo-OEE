import 'package:indo/features/production/processes/spring/spring_spec.dart';

import '../twin_web_parity.dart';

void main() => registerTwinWebParity(
  springSpec,
  itemLabel: 'Item Name',
  webLines: twinWebLines(
    partTitle: 'Item Name, Standard Time per Piece',
    partBoxes: ['Item Name *', 'Standard Time per Piece (Sec) *'],
    downtimeTitle: 'Idle Time (min)',
    // Spring words its Remarks line (title and label) for rejection / rework.
    remarksTitle: 'Reason / Remarks for Rejection / Rework',
    remarksLabel: 'Reason / Remarks for Rejection / Rework',
  ),
);
