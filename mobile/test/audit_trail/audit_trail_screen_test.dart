import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/endpoints.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/features/audit_trail/audit_repository.dart';
import 'package:indo/features/audit_trail/audit_trail_screen.dart';
import 'package:indo/features/audit_trail/audit_widgets.dart';

import '../support/fake_api.dart';

Finder byKey(String k) => find.byKey(ValueKey(k));

Map<String, dynamic> log(
  String id, {
  String action = 'update',
  String entityType = 'entry',
  String module = 'CNC data entry',
  String label = '7A · Bracket · 20/11/2026',
  String name = 'Mann',
  String role = 'Admin',
  String client = 'app',
  List<Map<String, dynamic>> changes = const [],
  Map<String, dynamic>? metrics,
  String remark = '',
}) =>
    {
      '_id': id,
      'entityType': entityType,
      'module': module,
      'sheet': 'cnc',
      'entity': 'r1',
      'machine': 'm1',
      'machineName': '7A',
      'date': '2026-11-20',
      'label': label,
      'action': action,
      'changes': changes,
      'metrics': metrics,
      'flagged': const [],
      'remark': remark,
      'actor': {'id': 'u1', 'model': 'Operator', 'name': name, 'role': role},
      'client': client,
      'ip': '10.0.0.5',
      'createdAt': '2026-11-20T09:15:00.000Z',
    };

const filters = {
  'modules': [
    {'key': 'entry', 'label': 'Data entry'},
    {'key': 'notRunning', 'label': 'Not running'},
    {'key': 'auth', 'label': 'Sign-in'},
  ],
  'actions': [
    {'key': 'update', 'label': 'Edited'},
    {'key': 'marked', 'label': 'Marked Not running'},
    {'key': 'login', 'label': 'Signed in'},
  ],
  'actors': [
    {'id': 'u1', 'name': 'Mann', 'role': 'Admin'},
    {'id': 'u2', 'name': 'Ravi', 'role': 'Operator'},
  ],
};

/// The four contract rows the screen must render.
final sample = <Map<String, dynamic>>[
  log('l1', action: 'marked', entityType: 'notRunning', module: 'Not running', label: '7A · 20/11/2026 · Breakdown', remark: 'Spindle motor burnt', changes: [
    {'field': 'reasons', 'label': 'Reasons', 'from': null, 'to': 'Breakdown'},
  ]),
  log('l2', action: 'unmarked', entityType: 'notRunning', module: 'Not running', label: '7A · 20/11/2026', name: 'Ravi', role: 'Operator', client: 'web'),
  log('l3', action: 'login', entityType: 'auth', module: 'Sign-in', label: 'mann signed in', changes: []),
  log('l4', action: 'loginFailed', entityType: 'auth', module: 'Sign-in', label: 'Sign-in failed for "mann"', name: '', role: '', client: ''),
  log('l5', action: 'update', metrics: {'availability': 92.3, 'performance': 88, 'quality': 99.1}, changes: [
    {'field': 'okQty', 'label': 'OK Qty', 'from': 390, 'to': 395},
  ]),
];

FakeApi install({List<Map<String, dynamic>>? logs, int? total, FakeHandler? onLogs}) {
  final api = FakeApi.install();
  api.on('GET', Endpoints.auditTrailFilters, (_) => {'isOk': true, 'data': filters});
  api.on('GET', Endpoints.auditTrail, onLogs ?? (_) => {'isOk': true, 'data': logs ?? sample, 'total': total ?? (logs ?? sample).length});
  return api;
}

Future<void> open(WidgetTester tester, {Size size = const Size(375, 812)}) async {
  await pumpScreen(
    tester,
    ScaffoldMessenger(key: rootMessengerKey, child: const AuditTrailScreen()),
    size: size,
  );
}

void main() {
  testWidgets('renders marked / unmarked / login / loginFailed rows with who, module and IST time', (tester) async {
    final api = install();
    await open(tester);
    final first = api.called('GET', Endpoints.auditTrail).first;
    expect(first.query['skip'], '0');
    expect(first.query['limit'], '50');
    expect(first.query['from'], isNotEmpty);
    expect(first.query['to'], isNotEmpty);
    expect(first.query.containsKey('module'), isFalse);

    expect(find.text('Every change made in the software — who did it, what changed and when. Times are IST.'), findsOneWidget);
    expect(find.text('5 records'), findsOneWidget);
    expect(find.text('Marked Not running'), findsOneWidget);
    expect(find.text('Not running undone'), findsOneWidget);
    expect(find.text('Signed in'), findsOneWidget);
    expect(find.text('Sign-in failed'), findsOneWidget);
    expect(find.text('7A · 20/11/2026 · Breakdown'), findsOneWidget);
    expect(find.text('by Mann · Admin · App'), findsAtLeastNWidgets(2)); // the 5th row is below the fold
    expect(find.text('by Ravi · Operator · Web'), findsOneWidget);
    expect(find.text('by —'), findsOneWidget);
    expect(find.text('20/11/2026 14:45 IST'), findsAtLeastNWidgets(4));

    // Tap the first row: its detail opens with the remark and the change.
    await tester.tap(byKey('audit-log-l1'));
    await tester.pumpAndSettle();
    expect(find.text('Remark: Spindle motor burnt'), findsOneWidget);
    expect(find.text('Reasons'), findsOneWidget);

    // An entry row shows its A / P / Q line once opened.
    await tester.drag(byKey('audit-list'), const Offset(0, -600));
    await tester.pumpAndSettle();
    await tester.tap(byKey('audit-log-l5'));
    await tester.pumpAndSettle();
    expect(find.text('A 92.3% · P 88% · Q 99.1%'), findsOneWidget);
    expect(find.text('OK Qty'), findsOneWidget);
    await tester.drag(byKey('audit-list'), const Offset(0, -800));
    await tester.pumpAndSettle();
    expect(find.text('That is every record.'), findsOneWidget);
    expect(api.misses, isEmpty);
  });

  testWidgets('a whole record folds after 8 fields with "Show all N fields"', (tester) async {
    install(logs: [
      log('c1', action: 'create', changes: [for (var i = 0; i < 12; i++) {'field': 'f$i', 'label': 'Field $i', 'from': null, 'to': 'v$i'}]),
    ]);
    await open(tester);
    await tester.tap(byKey('audit-log-c1'));
    await tester.pumpAndSettle();
    expect(find.text('Field 7'), findsOneWidget);
    expect(find.text('Field 8'), findsNothing);
    await tester.tap(byKey('audit-show-all-fields'));
    await tester.pumpAndSettle();
    expect(find.text('Field 11'), findsOneWidget);
    expect(find.text('Show all 12 fields'), findsNothing);
  });

  testWidgets('infinite scroll asks for the next page with skip=50', (tester) async {
    final api = install(onLogs: (r) {
      final skip = int.parse('${r.query['skip']}');
      return {'isOk': true, 'data': [for (var i = skip; i < skip + 50 && i < 120; i++) log('p$i', label: 'Row $i')], 'total': 120};
    });
    await open(tester);
    expect(find.text('120 records'), findsOneWidget);
    expect(find.text('Row 0'), findsOneWidget);

    for (var i = 0; i < 30 && api.called('GET', Endpoints.auditTrail).length < 2; i++) {
      await tester.drag(byKey('audit-list'), const Offset(0, -1500));
      await tester.pump();
    }
    await tester.pumpAndSettle();
    final calls = api.called('GET', Endpoints.auditTrail).toList();
    expect(calls.length, greaterThanOrEqualTo(2));
    expect(calls[1].query['skip'], '50');
    expect(calls[1].query['limit'], '50');
    // Rows of the second page are in the list.
    for (var i = 0; i < 20 && find.text('Row 60').evaluate().isEmpty; i++) {
      await tester.drag(byKey('audit-list'), const Offset(0, -1500));
      await tester.pumpAndSettle();
    }
    expect(find.text('Row 60'), findsOneWidget);
  });

  testWidgets('filter sheet applies a module + action; removing a chip refetches without it', (tester) async {
    final api = install();
    await open(tester);
    await tester.tap(byKey('audit-filter-button'));
    await tester.pumpAndSettle();
    expect(byKey('audit-filters-sheet'), findsOneWidget);

    await tester.tap(byKey('audit-filter-module'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Not running').last);
    await tester.pumpAndSettle();
    await tester.tap(byKey('audit-filter-action'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Marked Not running').last);
    await tester.pumpAndSettle();
    await tester.enterText(byKey('audit-filter-q'), 'spindle');
    await tester.tap(byKey('audit-filter-apply'));
    await tester.pumpAndSettle();

    var last = api.called('GET', Endpoints.auditTrail).last;
    expect(last.query['module'], 'notRunning');
    expect(last.query['action'], 'marked');
    expect(last.query['q'], 'spindle');
    expect(byKey('audit-chip-module-notRunning'), findsOneWidget);
    expect(byKey('audit-chip-action-marked'), findsOneWidget);
    expect(byKey('audit-chip-q'), findsOneWidget);
    expect(byKey('audit-chip-dates'), findsOneWidget);

    // Remove the module chip: a new request goes without `module`.
    final before = api.called('GET', Endpoints.auditTrail).length;
    await tester.tap(find.descendant(of: byKey('audit-chip-module-notRunning'), matching: find.byTooltip('Remove')));
    await tester.pumpAndSettle();
    expect(api.called('GET', Endpoints.auditTrail).length, before + 1);
    last = api.called('GET', Endpoints.auditTrail).last;
    expect(last.query.containsKey('module'), isFalse);
    expect(last.query['action'], 'marked');
    expect(byKey('audit-chip-module-notRunning'), findsNothing);

    // Remove the dates: no from / to at all.
    await tester.tap(find.descendant(of: byKey('audit-chip-dates'), matching: find.byTooltip('Remove')));
    await tester.pumpAndSettle();
    last = api.called('GET', Endpoints.auditTrail).last;
    expect(last.query.containsKey('from'), isFalse);
    expect(last.query.containsKey('to'), isFalse);
  });

  testWidgets('quick pick "Today" sets from = to = today; Reset goes back to 30 days', (tester) async {
    final api = install();
    await open(tester);
    await tester.tap(byKey('audit-filter-button'));
    await tester.pumpAndSettle();
    await tester.tap(byKey('audit-quick-today'));
    await tester.pumpAndSettle();
    await tester.tap(byKey('audit-filter-apply'));
    await tester.pumpAndSettle();
    var last = api.called('GET', Endpoints.auditTrail).last;
    expect(last.query['from'], last.query['to']);

    await tester.tap(byKey('audit-filter-button'));
    await tester.pumpAndSettle();
    await tester.tap(byKey('audit-filter-reset'));
    await tester.pumpAndSettle();
    last = api.called('GET', Endpoints.auditTrail).last;
    expect(last.query['from'], isNot(last.query['to']));
  });

  testWidgets('Export CSV downloads with the same filters and shares audit-trail-<from>_<to>.csv', (tester) async {
    final api = install();
    api.on('GET', Endpoints.auditTrailExportCsv, (_) => FakeBytes('a,b\n1,2\n'.codeUnits, contentType: 'text/csv'));
    String? sharedName;
    Uint8List? sharedBytes;
    final prev = shareCsv;
    shareCsv = (bytes, name, {origin}) async {
      sharedName = name;
      sharedBytes = bytes;
    };
    addTearDown(() => shareCsv = prev);

    await open(tester);
    await tester.tap(byKey('audit-more'));
    await tester.pumpAndSettle();
    await tester.tap(byKey('audit-export-csv'));
    await tester.pumpAndSettle();

    final req = api.called('GET', Endpoints.auditTrailExportCsv).single;
    expect(req.query['from'], isNotEmpty);
    expect(req.query.containsKey('skip'), isFalse);
    expect(sharedName, 'audit-trail-${req.query['from']}_${req.query['to']}.csv');
    expect(String.fromCharCodes(sharedBytes!), 'a,b\n1,2\n');
  });

  testWidgets('a failed export shows a snackbar, not a crash', (tester) async {
    final api = install();
    api.on('GET', Endpoints.auditTrailExportCsv, (_) => FakeResponse({'isOk': false, 'message': 'Export is off'}, status: 500));
    final prev = shareCsv;
    var shared = false;
    shareCsv = (bytes, name, {origin}) async => shared = true;
    addTearDown(() => shareCsv = prev);
    await open(tester);
    await tester.tap(byKey('audit-more'));
    await tester.pumpAndSettle();
    await tester.tap(byKey('audit-export-csv'));
    await tester.pumpAndSettle();
    expect(shared, isFalse);
    expect(find.text('Export is off'), findsOneWidget);
  });

  testWidgets('loading, error (Retry) and empty states', (tester) async {
    var fail = true;
    final api = install(onLogs: (_) => fail ? throw StateError('down') : {'isOk': true, 'data': [], 'total': 0});
    await open(tester);
    expect(find.text('Try again'), findsOneWidget);
    fail = false;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('No change recorded in this period. Widen the dates to see earlier ones.'), findsOneWidget);
    expect(find.text('0 records'), findsOneWidget);
    expect(api.called('GET', Endpoints.auditTrail).length, 2);
  });

  testWidgets('tablet (1024x768): filters in a left panel, no Filter button; Apply refetches', (tester) async {
    final api = install();
    await open(tester, size: const Size(1024, 768));
    expect(byKey('audit-filters-panel'), findsOneWidget);
    expect(byKey('audit-filter-button'), findsNothing);
    expect(find.byType(AuditLogTile), findsWidgets);
    await tester.tap(byKey('audit-filter-actor'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ravi · Operator').last);
    await tester.pumpAndSettle();
    await tester.tap(byKey('audit-filter-apply'));
    await tester.pumpAndSettle();
    expect(api.called('GET', Endpoints.auditTrail).last.query['actor'], 'u2');
    expect(find.text('User: Ravi'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('phone (375x812) and tablet (1024x768) lay out without overflow, light and dark, 1.3x text', (tester) async {
    for (final size in const [Size(375, 812), Size(1024, 768)]) {
      for (final dark in const [false, true]) {
        install(logs: [
          ...sample,
          log('long', label: 'A very long label that has to wrap over several lines on a small phone without any overflow at all · 20/11/2026', name: 'A Person With A Rather Long Name', role: 'Production Supervisor', changes: [
            {'field': 'x', 'label': 'A long field label that wraps', 'from': 'An old value that is also rather long', 'to': 'A new value that is also rather long'},
          ]),
        ]);
        await pumpScreen(tester, const AuditTrailScreen(), size: size, dark: dark, textScale: 1.3);
        for (var i = 0; i < 10 && byKey('audit-log-long').evaluate().isEmpty; i++) {
          await tester.drag(byKey('audit-list'), const Offset(0, -400));
          await tester.pumpAndSettle();
        }
        await tester.ensureVisible(byKey('audit-log-long'));
        await tester.pumpAndSettle();
        await tester.tap(byKey('audit-log-long'));
        await tester.pumpAndSettle();
        if (size.width < 700) {
          await tester.tap(byKey('audit-filter-button'));
          await tester.pumpAndSettle();
          expect(byKey('audit-filters-sheet'), findsOneWidget);
          await tester.tap(find.byTooltip('Close'));
          await tester.pumpAndSettle();
        }
        expect(tester.takeException(), isNull, reason: '$size dark=$dark');
      }
    }
  });
}
