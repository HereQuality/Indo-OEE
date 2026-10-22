import 'cnc_twin_validation.dart';

/// Everything the Contact / Trobe / Spring pages word or lay out differently
/// from one another (the rest is shared code). Contact and Trobe differ only in
/// the Working Status column; Spring has its own wording and table.
class TwinStyle {
  const TwinStyle({
    required this.itemLabel,
    required this.cycleLabel,
    required this.partCardTitle,
    required this.downtimeCardTitle,
    required this.remarksCardTitle,
    required this.remarksLabel,
    required this.machineColumnLabel,
    required this.wording,
    this.spring = false,
    this.workingStatusColumn = false,
  });

  /// The part box / column ("Part Name", "Item Name").
  final String itemLabel;

  /// The cycle box ("Total Cycle Time (Sec)", "Standard Time per Piece (Sec)").
  final String cycleLabel;

  final String partCardTitle;
  final String downtimeCardTitle;
  final String remarksCardTitle;
  final String remarksLabel;
  final String machineColumnLabel;
  final TwinWording wording;

  /// Spring's own table (no Drawing No., Unutilized or Setup Efficiency; "Idle
  /// Time"; Total Qty beside OK / Rejected) and its Effective Run Time basis.
  final bool spring;

  /// Contact's table has a Working Status column; Trobe's and Spring's do not.
  final bool workingStatusColumn;

  /// Contact.
  static const TwinStyle contact = TwinStyle(
    itemLabel: 'Part Name',
    cycleLabel: 'Total Cycle Time (Sec)',
    partCardTitle: 'Part, Total Cycle Time',
    downtimeCardTitle: 'Downtime / Stoppage (min)',
    remarksCardTitle: 'Remarks',
    remarksLabel: 'Remarks',
    machineColumnLabel: 'Machine',
    wording: TwinWording.part,
    workingStatusColumn: true,
  );

  /// Trobe: Contact's, without the Working Status column.
  static const TwinStyle trobe = TwinStyle(
    itemLabel: 'Part Name',
    cycleLabel: 'Total Cycle Time (Sec)',
    partCardTitle: 'Part, Total Cycle Time',
    downtimeCardTitle: 'Downtime / Stoppage (min)',
    remarksCardTitle: 'Remarks',
    remarksLabel: 'Remarks',
    machineColumnLabel: 'Machine',
    wording: TwinWording.part,
  );

  /// Spring (SPRING FOR PINS).
  static const TwinStyle springStyle = TwinStyle(
    itemLabel: 'Item Name',
    cycleLabel: 'Standard Time per Piece (Sec)',
    partCardTitle: 'Item Name, Standard Time per Piece',
    downtimeCardTitle: 'Idle Time (min)',
    remarksCardTitle: 'Reason / Remarks for Rejection / Rework',
    remarksLabel: 'Reason / Remarks for Rejection / Rework',
    machineColumnLabel: 'MC No.',
    wording: TwinWording.item,
    spring: true,
  );
}
