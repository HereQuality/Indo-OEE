import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/entry_form/entry_block.dart';
import 'package:indo/features/production/entry_form/entry_form_toast.dart';
import 'package:indo/features/production/entry_form/production_entry_form.dart';
import 'package:indo/features/production/shared/production_entry_validation.dart';
import 'package:indo/features/production/shared/production_sheet_calc.dart';

import '../support/fake_api.dart';

/// Master data the form is given.
final List<Map<String, dynamic>> testMachines = [
  {'_id': 'm1', 'machineName': 'CNC-7A'},
  {'_id': 'm2', 'machineName': 'CNC-7B'},
];

final List<Map<String, dynamic>> testItems = [
  {
    '_id': 'i1',
    'itemName': 'Flange 40',
    'drawingNo': 'D-40',
    'totalCycleSec': 60,
    'drillingSec': 20,
    'boringSec': 15,
    'threadingSec': 25,
  },
  {'_id': 'i2', 'itemName': 'Bush 12', 'drawingNo': 'D-12', 'totalCycleSec': 30, 'tappingSec': 30},
];

final List<Map<String, dynamic>> testOperators = [
  {'_id': 'o1', 'name': 'Asha Kumar'},
  {'_id': 'o2', 'name': 'Ravi Patel'},
];

/// A blank machine block dated 2026-09-25 (the page's emptyEntry()).
Map<String, dynamic> blankEntry({String machine = ''}) => <String, dynamic>{
      'date': '2026-09-25',
      'machine': machine,
      'slot': 1,
      'item': '',
      'rejectBreakdown': <String, dynamic>{},
      'excludedOps': <dynamic>[],
      for (final k in ['operator', 'itemName', 'drawingNo', 'remarks', 'rejectOtherRemark', 'otherMinRemark']) k: '',
      for (final k in ['machineOnTime', 'machineOffTime']) k: '',
      for (final k in ['actualQty', 'okQty', 'plannedOperatorShiftHours', 'totalCycleSec']) k: '',
      for (final f in stoppageFields) f['key'] as String: '',
      for (final f in cycleOpFields) f['key'] as String: '',
    };

/// A complete, valid block: 08:00-16:00 on Flange 40 (60 s) so Ideal = 480,
/// 9 h planned so 60 min of stoppage is allowed.
Map<String, dynamic> validEntry({Map<String, dynamic> overrides = const {}}) => <String, dynamic>{
      ...blankEntry(machine: 'm1'),
      'operator': 'Asha Kumar',
      'item': 'i1',
      'itemName': 'Flange 40',
      'drawingNo': 'D-40',
      'totalCycleSec': '60',
      'drillingSec': '20',
      'boringSec': '15',
      'threadingSec': '25',
      'machineOnTime': '08:00',
      'machineOffTime': '16:00',
      'actualQty': '400',
      'okQty': '400',
      'plannedOperatorShiftHours': '9',
      'lunchMin': '30',
      ...overrides,
    };

const _cycleKeys = ['drillingSec', 'boringSec', 'threadingSec', 'tappingSec', 'chamferingSec', 'otherOp1Sec', 'otherOp2Sec', 'clampDeclampSec'];

/// The parent the form is built for: it owns the entries, applies every edit
/// the way ProductionSheet.jsx's handlers do, runs validateEntry over each
/// block and hands the form isSubmit / focusTarget.
class FormHarness extends StatefulWidget {
  const FormHarness({super.key, required this.initial, this.isEdit = false});

  final List<Map<String, dynamic>> initial;
  final bool isEdit;

  @override
  State<FormHarness> createState() => FormHarnessState();
}

class FormHarnessState extends State<FormHarness> {
  late List<Map<String, dynamic>> entries = [for (final e in widget.initial) Map<String, dynamic>.from(e)];
  bool isSubmit = false;
  Map<String, dynamic>? focusTarget;
  final List<String> log = [];
  int _nonce = 0;

  List<Map<String, String>> get errors => [for (final e in entries) validateEntry(e)];

  /// Save pressed: show errors and steer to the first incomplete field.
  void submit() {
    setState(() {
      isSubmit = true;
      final first = firstError(errors);
      focusTarget = first == null ? null : {...first, 'nonce': ++_nonce};
    });
  }

  void set(int index, String name, dynamic value) {
    setState(() {
      entries = [
        for (var i = 0; i < entries.length; i++)
          if (i == index) {...entries[i], name: value} else entries[i],
      ];
    });
  }

  @override
  Widget build(BuildContext context) => ProductionEntryForm(
        entries: entries,
        errors: errors,
        isSubmit: isSubmit,
        focusTarget: focusTarget,
        machines: testMachines,
        items: testItems,
        operators: testOperators,
        isEdit: widget.isEdit,
        onChange: (i, name, value) {
          log.add('change $i $name=$value');
          set(i, name, value);
        },
        onItemSelect: (i, itemId) {
          log.add('item $i "$itemId"');
          final it = itemId.isEmpty ? null : testItems.firstWhere((x) => x['_id'] == itemId);
          setState(() {
            entries = [
              for (var n = 0; n < entries.length; n++)
                if (n != i)
                  entries[n]
                else if (it == null)
                  {...entries[n], 'item': '', 'itemName': '', 'excludedOps': <dynamic>[]}
                else
                  {
                    ...entries[n],
                    'item': it['_id'],
                    'itemName': it['itemName'],
                    'drawingNo': it['drawingNo'] ?? '',
                    'totalCycleSec': '${it['totalCycleSec'] ?? ''}',
                    'excludedOps': <dynamic>[],
                    for (final k in _cycleKeys) k: '${it[k] ?? ''}',
                  },
            ];
          });
        },
        onRejectChange: (i, reason, value) {
          log.add('reject $i $reason=$value');
          setState(() {
            entries = [
              for (var n = 0; n < entries.length; n++)
                if (n == i)
                  {
                    ...entries[n],
                    'rejectBreakdown': {...(entries[n]['rejectBreakdown'] as Map<String, dynamic>), reason: value},
                  }
                else
                  entries[n],
            ];
          });
        },
        onAdd: () {
          log.add('add');
          setState(() => entries = [...entries, {...blankEntry(), 'date': entries.last['date']}]);
        },
        onRemove: (i) {
          log.add('remove $i');
          setState(() => entries = [for (var n = 0; n < entries.length; n++) if (n != i) entries[n]]);
        },
      );
}

/// Records the form's warning toasts (the app shows them as snack bars).
List<String> captureToasts() {
  final toasts = <String>[];
  EntryFormToast.reset();
  EntryFormToast.sink = toasts.add;
  addTearDown(EntryFormToast.reset);
  return toasts;
}

/// Pumps the harness inside a scrolling page like the entry editor's.
Future<GlobalKey<FormHarnessState>> pumpForm(
  WidgetTester tester,
  List<Map<String, dynamic>> entries, {
  bool isEdit = false,
  Size size = const Size(390, 844),
  bool dark = false,
  double textScale = 1.0,
}) async {
  FakeApi.install();
  EntryBlock.contentBuilds.clear();
  final key = GlobalKey<FormHarnessState>();
  await pumpScreen(
    tester,
    Scaffold(
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: FormHarness(key: key, initial: entries, isEdit: isEdit),
      ),
    ),
    size: size,
    dark: dark,
    textScale: textScale,
  );
  return key;
}

Finder field(int block, String name) => find.byKey(ValueKey('entry$block/$name'));

/// The TextField inside a form box.
Finder textIn(int block, String name) => find.descendant(of: field(block, name), matching: find.byType(TextField));

Future<void> typeIn(WidgetTester tester, int block, String name, String text) async {
  final f = textIn(block, name);
  await tester.ensureVisible(f);
  await tester.enterText(f, text);
  await tester.pump();
}

String textOf(WidgetTester tester, int block, String name) => tester.widget<TextField>(textIn(block, name)).controller!.text;

/// Opens block [i] (its "+") and lets the animation finish.
Future<void> openBlock(WidgetTester tester, int i) async {
  // A block whose machine is already chosen starts open (ProductionEntryForm),
  // so there is no "+" to press; only a closed block has one.
  if (find.byKey(ValueKey('entry$i/expand')).evaluate().isEmpty) {
    await tester.pumpAndSettle();
    return;
  }
  await tester.tap(find.byKey(ValueKey('entry$i/expand')));
  await tester.pumpAndSettle();
}
