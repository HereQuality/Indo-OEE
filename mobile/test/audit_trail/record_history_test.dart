import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../production/editor_screen_test.dart' as editor show editorTest, open, savedRow;
import '../production/not_running_test.dart' show mark, setup, tapK;
import '../production/sheet_list_test.dart' as sheet show open, yesterday;
import 'audit_trail_screen_test.dart' show byKey, log;

void main() {
  group('entry editor', () {
    editor.editorTest('History shows only for a saved entry and opens that record\'s history', (tester) async {
      final h = await editor.open(tester, row: editor.savedRow());
      expect(byKey('entry-history'), findsOneWidget);
      expect(find.text('History'), findsOneWidget);

      h.api.on('GET', Endpoints.auditTrail, (_) => {
            'isOk': true,
            'total': 2,
            'data': [
              log('h1', action: 'update', label: 'CNC 2 · Bracket · 20/09/2026', changes: [
                {'field': 'okQty', 'label': 'OK Qty', 'from': 380, 'to': 390},
              ]),
              log('h2', action: 'create', label: 'CNC 2 · Bracket · 20/09/2026'),
            ],
          });
      await tester.tap(byKey('entry-history'));
      await tester.pumpAndSettle();
      expect(byKey('record-history-sheet'), findsOneWidget);
      final req = h.api.called('GET', Endpoints.auditTrail).single;
      expect(req.query['entity'], 'r1');
      expect(req.query.containsKey('from'), isFalse);
      expect(find.text('2 changes · newest first · times are IST'), findsOneWidget);
      expect(find.text('Edited'), findsOneWidget);
      expect(find.text('Created'), findsOneWidget);
      // The newest row is open from the start.
      expect(find.text('OK Qty'), findsOneWidget);
      // The tester is Super Admin: may open the full Audit Trail.
      expect(byKey('history-open-trail'), findsOneWidget);
      await tester.tap(find.descendant(of: byKey('record-history-sheet'), matching: find.byTooltip('Close')));
      await tester.pumpAndSettle();
      expect(byKey('record-history-sheet'), findsNothing);
    });

    editor.editorTest('no History while adding a new entry', (tester) async {
      await editor.open(tester);
      expect(byKey('entry-history'), findsNothing);
    });
  });

  group('Not running', () {
    setUp(() => SharedPreferences.setMockInitialValues({'sheet_view_mode': 'cards'}));

    testWidgets('a marked card has a History button that opens the mark\'s history', (tester) async {
      final api = setup(marks: [mark(sheet.yesterday, 'm1')]);
      api.on('GET', Endpoints.auditTrail, (_) => {
            'isOk': true,
            'total': 1,
            'data': [
              log('n1', action: 'marked', entityType: 'notRunning', module: 'Not running', label: '7A · Breakdown', remark: 'Spindle motor burnt'),
            ],
          });
      await sheet.open(tester);
      expect(byKey('nr-history-${sheet.yesterday}|m1'), findsOneWidget);
      expect(byKey('nr-edit-${sheet.yesterday}|m1'), findsOneWidget); // existing buttons untouched
      expect(byKey('nr-undo-${sheet.yesterday}|m1'), findsOneWidget);
      expect(byKey('nr-history-${sheet.yesterday}|m2'), findsNothing); // no mark, no history

      await tapK(tester, 'nr-history-${sheet.yesterday}|m1');
      expect(byKey('record-history-sheet'), findsOneWidget);
      expect(find.text('Not running · 7A'), findsOneWidget);
      final req = api.called('GET', Endpoints.auditTrail).single;
      expect(req.query['sheet'], 'cnc');
      expect(req.query['date'], sheet.yesterday);
      expect(req.query['machine'], 'm1');
      expect(find.text('Marked Not running'), findsOneWidget);
      expect(find.text('Remark: Spindle motor burnt'), findsOneWidget);
      expect(api.misses, isEmpty);
    });

    testWidgets('the Edit dialog of a saved mark has History too', (tester) async {
      final api = setup(marks: [mark(sheet.yesterday, 'm1')]);
      api.on('GET', Endpoints.auditTrail, (_) => {'isOk': true, 'total': 0, 'data': []});
      await sheet.open(tester);
      await tapK(tester, 'nr-edit-${sheet.yesterday}|m1');
      expect(byKey('not-running-dialog'), findsOneWidget);
      expect(byKey('nr-dialog-history'), findsOneWidget);
      await tester.tap(byKey('nr-dialog-history'));
      await tester.pumpAndSettle();
      expect(byKey('record-history-sheet'), findsOneWidget);
      expect(find.text('No history recorded for this record yet.'), findsOneWidget);
      expect(api.called('GET', Endpoints.auditTrail).single.query['machine'], 'm1');
    });

    testWidgets('a locked mark still offers History next to Locked', (tester) async {
      setup(marks: [
        {...mark(sheet.yesterday, 'm1'), 'locked': true}
      ]);
      await sheet.open(tester);
      // Admin: unlocked → Edit/Undo + History.
      expect(byKey('nr-history-${sheet.yesterday}|m1'), findsOneWidget);
    });
  });
}
