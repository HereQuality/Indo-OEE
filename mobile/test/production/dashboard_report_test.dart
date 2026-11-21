import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/production/dashboard/data/dashboard_report.dart';
import 'package:indo/features/production/dashboard/widgets/control_bar.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';
import 'dashboard_page_test.dart' show pumpDashboard;
import 'dashboard_shell_fixtures.dart';

/// The dashboard's Efficiency Report (OEE): the web header's PDF and Email
/// buttons, for the period, process and machines on screen.
void main() {
  final pdfBytes = Uint8List.fromList('%PDF-1.4 fake'.codeUnits);
  final shared = <(String, int)>[];

  setUp(() {
    pinDashboardClock();
    SharedPreferences.setMockInitialValues({});
    shared.clear();
    sharePdf = (bytes, filename, {origin}) async => shared.add((filename, bytes.length));
  });
  tearDown(() {
    unpinDashboardClock();
    sharePdf = shareWithSystem;
  });

  test('params follow the dashboard: period, process, ticked machines', () {
    expect(DashboardReport.params(range: ['2026-09-01', '2026-09-30']), {'from': '2026-09-01', 'to': '2026-09-30'});
    expect(
      DashboardReport.params(range: ['2026-09-01', '2026-09-30'], processId: processVmc, machineIds: ['m1', 'm2']),
      {'from': '2026-09-01', 'to': '2026-09-30', 'process': processVmc, 'machine': 'm1,m2'},
    );
  });

  testWidgets('phone: the report menu downloads the PDF for this period and process and hands it to the share sheet', (tester) async {
    final api = FakeApi.install();
    installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: []));
    api.on('GET', '/api/v1/processes/entries/report.pdf', (_) => FakeBytes(pdfBytes, filename: 'OEE-report-VMC-2026-09-01_to_2026-09-30.pdf'));
    await pumpDashboard(tester);

    await tester.tap(find.byType(ReportMenuButton));
    await tester.pumpAndSettle();
    expect(find.text('Download PDF report'), findsOneWidget);
    expect(find.text('Email report'), findsOneWidget);
    await tester.tap(find.text('Download PDF report'));
    await tester.pumpAndSettle();

    expect(api.called('GET', '/api/v1/processes/entries/report.pdf').single.query, {'from': '2026-09-01', 'to': '2026-09-30', 'process': processVmc});
    expect(shared, [('OEE-report-VMC-2026-09-01_to_2026-09-30.pdf', pdfBytes.length)]);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a ticked machine narrows the report to that machine', (tester) async {
    final api = FakeApi.install();
    installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: ['machineSummary']));
    api.on('GET', '/api/v1/processes/entries/report.pdf', (_) => FakeBytes(pdfBytes, filename: 'r.pdf'));
    await pumpDashboard(tester);
    await tester.tap(find.text('toggle 7A'));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(ReportMenuButton));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Download PDF report'));
    await tester.pumpAndSettle();
    expect(api.called('GET', '/api/v1/processes/entries/report.pdf').single.query['machine'], 'm1');
  });

  testWidgets('Email asks for addresses and posts them; blank means the saved recipients', (tester) async {
    final api = FakeApi.install();
    installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: []));
    api.on('POST', '/api/v1/processes/entries/report/email', (_) => {'isOk': true, 'message': 'Report sent to a@b.com'});
    await pumpDashboard(tester);

    await tester.tap(find.byType(ReportMenuButton));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Email report'));
    await tester.pumpAndSettle();
    expect(find.text('Email the report'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'a@b.com');
    await tester.tap(find.widgetWithText(FilledButton, 'Send'));
    await tester.pumpAndSettle();

    final body = api.called('POST', '/api/v1/processes/entries/report/email').single.body as Map;
    expect(body, {'from': '2026-09-01', 'to': '2026-09-30', 'process': processVmc, 'recipients': 'a@b.com'});

    // Blank → no `to`, the Company page's recipients.
    await tester.tap(find.byType(ReportMenuButton));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Email report'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '');
    await tester.tap(find.widgetWithText(FilledButton, 'Send'));
    await tester.pumpAndSettle();
    final calls = api.called('POST', '/api/v1/processes/entries/report/email').toList();
    expect(calls, hasLength(2));
    expect((calls.last.body as Map).containsKey('recipients'), isFalse);
    expect((calls.last.body as Map)['to'], '2026-09-30', reason: 'the period end is untouched');
  });

  testWidgets('a refused report shows the server\'s reason', (tester) async {
    final api = FakeApi.install();
    installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: []));
    api.on('GET', '/api/v1/processes/entries/report.pdf', (_) => FakeResponse({'isOk': false, 'message': "You don't have access to this process's dashboard"}, status: 403));
    await pumpDashboard(tester);
    await tester.tap(find.byType(ReportMenuButton));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Download PDF report'));
    await tester.pumpAndSettle();
    expect(shared, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tablet: PDF and Email are buttons on the header row', (tester) async {
    final api = FakeApi.install();
    installDashboardApi(api, processes: processesFixture(vmcStats: ['totalQty'], vmcCharts: []));
    api.on('GET', '/api/v1/processes/entries/report.pdf', (_) => FakeBytes(pdfBytes, filename: 'r.pdf'));
    await pumpDashboard(tester, size: const Size(1024, 768));
    expect(find.byType(ReportButtons), findsOneWidget);
    await tester.tap(find.text('PDF'));
    await tester.pumpAndSettle();
    expect(shared.single.$1, 'r.pdf');
    expect(find.text('Email'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
