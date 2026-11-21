import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/features/admin/company_management_screen.dart';
import 'package:indo/features/admin/summary_mail_card.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';

Future<void> scrollTo(WidgetTester tester, Finder f) async {
  await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
}

/// The Company page: company settings and the Summary Email card (who gets the
/// daily / weekly Efficiency Report and when).
void main() {
  late FakeApi api;
  late Map<String, Object?> setting;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    api = FakeApi.install();
    api.on('GET', '/api/v1/companies/getCompanyDetails', (_) => {'isOk': true, 'data': {'name': 'Acme Works', 'logo': '', 'favicon': ''}});
    setting = {
      'recipients': ['owner@acme.com'],
      'dailyEnabled': true,
      'weeklyEnabled': true,
      'dailySendAt': '18:00',
      'weeklySendAt': '08:00',
      'weeklyDay': 1,
      'lastDailyFor': '',
      'lastWeeklyFor': '',
      'mailConfigured': true,
    };
    api.on('GET', '/api/v1/summary-mail', (_) => {'isOk': true, 'data': setting});
    api.on('PUT', '/api/v1/summary-mail', (r) {
      setting = {...setting, ...(r.body as Map).cast<String, Object?>()};
      return {'isOk': true, 'data': setting, 'message': 'Summary email settings saved'};
    });
    api.on('POST', '/api/v1/summary-mail/send', (_) => {'isOk': true, 'message': 'Daily summary sent to owner@acme.com'});
  });

  test('recipients are split on new lines, commas and spaces', () {
    expect(parseRecipients('A@x.com, b@x.com\nc@x.com  d@x.com;'), ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
  });

  testWidgets('shows the company name and the schedule in words', (tester) async {
    await pumpScreen(tester, const CompanyManagementScreen());
    expect(find.text('Company Settings'), findsOneWidget);
    expect(find.widgetWithText(TextField, 'Acme Works'), findsOneWidget);
    expect(find.byType(SummaryMailCard), findsOneWidget);
    expect(find.textContaining('daily one goes out at 06:00 PM'), findsOneWidget);
    expect(find.textContaining('weekly one on Monday at 08:00 AM'), findsOneWidget);
    await scrollTo(tester, find.text('1 recipient'));
    expect(find.text('1 recipient'), findsOneWidget);
    expect(api.misses, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('saving sends the recipients, both switches and both send times', (tester) async {
    await pumpScreen(tester, const CompanyManagementScreen());
    final saveSettings = find.widgetWithText(FilledButton, 'Save Settings').last;
    expect(tester.widget<FilledButton>(saveSettings).onPressed, isNull, reason: 'nothing changed yet');

    await tester.enterText(find.widgetWithText(TextField, 'owner@acme.com'), 'owner@acme.com\nplant@acme.com');
    await tester.pump();
    await scrollTo(tester, saveSettings);
    await tester.tap(saveSettings);
    await tester.pumpAndSettle();

    final body = api.called('PUT', '/api/v1/summary-mail').single.body as Map;
    expect(body['recipients'], ['owner@acme.com', 'plant@acme.com']);
    expect(body['dailyEnabled'], isTrue);
    expect(body['weeklyEnabled'], isTrue);
    expect(body['dailySendAt'], '18:00');
    expect(body['weeklySendAt'], '08:00');
    expect(body['weeklyDay'], 1);
    expect(find.text('2 recipients'), findsOneWidget);
  });

  testWidgets('Send daily now posts kind=daily', (tester) async {
    await pumpScreen(tester, const CompanyManagementScreen());
    final btn = find.text('Send daily now');
    await scrollTo(tester, btn);
    await tester.tap(btn);
    await tester.pumpAndSettle();
    expect((api.called('POST', '/api/v1/summary-mail/send').single.body as Map)['kind'], 'daily');
  });

  testWidgets('says when the server has no SMTP set up', (tester) async {
    setting['mailConfigured'] = false;
    await pumpScreen(tester, const CompanyManagementScreen());
    expect(find.textContaining("Email isn't set up on the server yet"), findsOneWidget);
    await scrollTo(tester, find.text('Send daily now'));
    expect(tester.widget<OutlinedButton>(find.widgetWithText(OutlinedButton, 'Send daily now')).onPressed, isNull);
  });

  testWidgets('phone and tablet widths lay out without overflow', (tester) async {
    await pumpScreen(tester, const CompanyManagementScreen(), size: const Size(360, 740), textScale: 1.3);
    expect(tester.takeException(), isNull);
    await pumpScreen(tester, const CompanyManagementScreen(), size: const Size(1024, 768));
    expect(tester.takeException(), isNull);
  });
}
