// What the 9 supported processes need to be filled and checked by the e2e tests.
// Master data names come from mobile/e2e/seed_e2e.js.
class ProcCfg {
  const ProcCfg({
    required this.label,
    required this.sheet,
    required this.machine,
    required this.operator,
    required this.item,
    required this.ok,
    this.rejected,
    this.actual,
    this.cycle,
    this.operatorKey = 'operator',
    this.nonWorking = true,
    this.on = '08:00',
    this.off = '16:00',
    this.hasMachineOperator = true,
    this.tapKeys = const [],
    this.expectField,
  });

  /// Hub card title.
  final String label;

  /// API base ('/production-sheet', '/vmc-sheet' ...).
  final String sheet;

  /// Machine (or worker, for Powder Coating) name picked in the form.
  final String machine;
  final String operator;
  final String item;
  final String ok;
  final String? rejected;

  /// Typed Actual quantity (CNC and Powder Coating only).
  final String? actual;

  /// Typed cycle time (sec) when the part does not carry it (none currently).
  final String? cycle;
  final String operatorKey;
  final bool nonWorking;
  final String on;
  final String off;
  final bool hasMachineOperator;

  /// Choice chips an operator must tap (RIVET: Process = Rivet).
  final List<String> tapKeys;

  /// Saved-row field -> value that must come back (e.g. RIVET processType).
  final Map<String, String>? expectField;

  /// Remarks marker: a row of this test run is found again by it.
  String tag(String n) => 'E2E-${label.split(' ').first}-$n';
}

const procCfgs = <ProcCfg>[
  ProcCfg(
    label: 'CNC',
    sheet: '/production-sheet',
    machine: 'CNC-1',
    operator: 'Ramesh Kumar',
    item: 'CNC Shaft 25',
    actual: '400',
    ok: '400',
  ),
  ProcCfg(
    label: 'VMC',
    sheet: '/vmc-sheet',
    machine: 'VMC-1',
    operator: 'Dinesh Shah',
    item: 'VMC Bracket VB-10',
    ok: '100',
    rejected: '5',
  ),
  ProcCfg(
    label: 'SPM',
    sheet: '/spm-sheet',
    machine: 'SPM-1',
    operator: 'Vijay Singh',
    item: 'SPM Plate SP-5',
    ok: '1000',
    rejected: '20',
  ),
  ProcCfg(
    label: 'RIVET',
    sheet: '/rivet-sheet',
    machine: 'RIV-1',
    operator: 'Prakash Rao',
    item: 'RIVET Hinge RH-3',
    ok: '1500',
    rejected: '10',
    tapKeys: ['entry0/processType/Rivet'],
    expectField: {'processType': 'Rivet'},
  ),
  ProcCfg(
    label: 'PRESS',
    sheet: '/press-sheet',
    machine: 'PRS-1',
    operator: 'Ashok Pawar',
    item: 'PRESS Blank PB-2',
    ok: '800',
    rejected: '5',
  ),
  ProcCfg(
    label: 'CONTACT',
    sheet: '/contact-sheet',
    machine: 'CON-1',
    operator: 'Ganesh Iyer',
    item: 'CONTACT Tip CT-1',
    ok: '2000',
    rejected: '20',
  ),
  ProcCfg(
    label: 'TROBE',
    sheet: '/trobe-sheet',
    machine: 'TRB-1',
    operator: 'Harish Reddy',
    item: 'TROBE Pin TP-1',
    ok: '1000',
    rejected: '10',
  ),
  ProcCfg(
    label: 'SPRING FOR PINS',
    sheet: '/spring-sheet',
    machine: 'SPG-1',
    operator: 'Amit Bhat',
    item: 'SPRING Coil SG-1',
    ok: '3000',
    rejected: '30',
  ),
  ProcCfg(
    label: 'AFTER POWDER COATING',
    sheet: '/powder-coating-sheet',
    machine: 'Sunita Devi',
    operator: '',
    item: 'APC Cover AC-1',
    actual: '400',
    ok: '400',
    on: '09:00',
    off: '13:00',
    hasMachineOperator: false,
  ),
];
