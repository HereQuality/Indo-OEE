import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/production/process/process_spec.dart';
import 'package:indo/features/production/sheet/editor/entry_editor_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../support/fake_api.dart';

/// A saved entry the Contact / Trobe / Spring editor can open: 08:00-16:00 on a
/// 60 s part (Ideal 480), 400 OK + 20 Rejected, 9 h planned, 30 min lunch.
Map<String, dynamic> twinRow() => {
  '_id': 'r1',
  'date': '2026-09-20',
  'machine': 'm1',
  'slot': 2,
  'item': 'i1',
  'operator': 'Ravi',
  'itemName': 'Bracket',
  'drawingNo': 'D-1',
  'totalCycleSec': 60,
  'machineOnTime': '08:00',
  'machineOffTime': '16:00',
  'okQty': 400,
  'rejectedQty': 20,
  'plannedOperatorShiftHours': 9,
  'lunchMin': 30,
  'setupMin': 10,
  'remarks': 'first shift',
};

/// Opens the editor of [spec] (add when [row] is null) and returns the fake API.
Future<FakeApi> openTwinEditor(
  WidgetTester tester,
  ProcessSpec spec, {
  Map<String, dynamic>? row,
  List<bool?>? popped,
}) async {
  SharedPreferences.setMockInitialValues({});
  final api = FakeApi.install();
  final seg = spec.api.base;
  api.on(
    'PUT',
    spec.api.row,
    (r) => {'isOk': true, 'data': r.body, 'message': 'Row saved'},
  );
  api.on(
    'GET',
    spec.api.occupied,
    (_) => {'isOk': true, 'data': <Map<String, dynamic>>[]},
  );
  expect(seg, isNot(Endpoints.productionSheet));
  await pumpScreen(
    tester,
    ScaffoldMessenger(
      key: rootMessengerKey,
      child: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: FilledButton(
              onPressed: () async {
                final r = await Navigator.of(context).push<bool>(
                  MaterialPageRoute<bool>(
                    builder: (_) => EntryEditorScreen(
                      spec: spec,
                      row: row,
                      initialMachineId: row == null ? 'm1' : null,
                      machines: const [
                        {'_id': 'm1', 'machineName': '7A'},
                      ],
                      items: const [
                        {
                          '_id': 'i1',
                          'itemName': 'Bracket',
                          'totalCycleSec': 60,
                          'drawingNo': 'D-1',
                        },
                      ],
                      operators: const [],
                    ),
                  ),
                );
                popped?.add(r);
              },
              child: const Text('Open editor'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open editor'));
  await tester.pumpAndSettle();
  return api;
}
