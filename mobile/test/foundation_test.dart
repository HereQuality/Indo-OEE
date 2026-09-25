import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/app/routes.dart';
import 'package:indo/core/api/api_client.dart';
import 'package:indo/core/config.dart';
import 'package:indo/core/utils/formatters.dart';
import 'package:indo/core/utils/role_slug.dart';
import 'package:indo/core/widgets/dynamic_icon.dart';
import 'package:indo/models/app_user.dart';
import 'package:indo/models/menu_models.dart';
import 'package:indo/providers/menu_provider.dart';

import 'support/fake_api.dart';

void main() {
  test('menu URLs are matched without the role slug', () {
    expect(normalizeMenuPath('/hqepl/production/machines'), '/production/machines');
    expect(normalizeMenuPath('/manager/production/machines/?a=1'), '/production/machines');
    expect(normalizeMenuPath('#'), '');
    expect(AppRoutes.match('/hqepl/production/machines')?.title, 'Machines');
    expect(AppRoutes.match('/x/production/data-entry')?.path, '/production/cnc-data-entry');
    expect(AppRoutes.match('/x/unknown/page'), isNull);
  });

  test('every route path is unique', () {
    final all = AppRoutes.all.expand((r) => [r.path, ...r.aliases]).toList();
    expect(all.toSet().length, all.length);
  });

  test('upload URLs are upgraded to the backend scheme; relative ones resolved', () {
    expect(AppConfig.toBackendUrl('uploads/a.png'), '${AppConfig.apiBaseUrl}/uploads/a.png');
    expect(AppConfig.toBackendUrl('a.png'), '${AppConfig.apiBaseUrl}/uploads/a.png');
    expect(AppConfig.toBackendUrl('https://cdn.example.com/a.png'), 'https://cdn.example.com/a.png');
    expect(AppConfig.toBackendUrl('data:image/png;base64,xx'), 'data:image/png;base64,xx');
  });

  test('AppUser reads both plain and populated role ids', () {
    expect(AppUser({'_id': '1', 'roleType': 'Operator', 'roleId': 'r1'}).roleId, 'r1');
    expect(AppUser({'_id': '1', 'roleType': 'Operator', 'roleId': {'_id': 'r2', 'roleName': 'Mgr'}}).roleId, 'r2');
    expect(AppUser({'_id': '1', 'roleType': 'Operator', 'employeeName': 'Asha K'}).name, 'Asha K');
  });

  test('Operator permissions come from Manage Role; SuperAdmin has all', () {
    final groups = [
      MenuGroup(groupId: 'g1', groupName: 'Prod', menus: [
        MenuItem(id: 'm1', name: 'Machines', url: '/hqepl/production/machines'),
        MenuItem(id: 'm2', name: 'Parent', children: [MenuItem(id: 'm3', name: 'Items', url: '/hqepl/production/items')]),
      ]),
      MenuGroup(groupId: 'g2', groupName: 'Support', isLink: true, url: '/hqepl/support'),
    ];
    final m = MenuProvider()
      ..setForTest(isAdmin: false, groups: groups, roles: [
        {'menuId': 'm1', 'view': true, 'create': true, 'edit': false, 'delete': false},
        {'menuGroupId': 'g2', 'view': true},
      ]);
    expect(m.menuIdForPath('/production/machines'), 'm1');
    expect(m.menuIdForPath('/production/items'), 'm3');
    expect(m.menuIdForPath('/support'), 'g2');
    final p = m.permissionsForPath('/production/machines');
    expect([p.view, p.create, p.edit, p.delete], [true, true, false, false]);
    expect(m.permissionsForPath('/production/items').view, isFalse);
    expect(m.permissionsForPath('/nope').view, isFalse);

    final admin = MenuProvider()..setForTest(isAdmin: true);
    expect(admin.permissionsForPath('/anything').delete, isTrue);
  });

  test('formatters', () {
    expect(Fmt.minutes(95), '1h 35m');
    expect(Fmt.minutes(40), '40m');
    expect(Fmt.hm12('13:05'), '01:05 PM');
    expect(Fmt.hm12('00:30'), '12:30 AM');
    expect(Fmt.initials('sameep kumar'), 'SK');
    expect(Fmt.ymd(DateTime(2026, 9, 5)), '2026-09-05');
  });

  test('lucide icon names resolve (PascalCase, legacy bootstrap, fallback)', () {
    expect(DynamicIcon.resolve('Factory'), isNot(DynamicIcon.resolve('definitely-not-an-icon')));
    expect(DynamicIcon.resolve('bi bi-people'), DynamicIcon.resolve('Users'));
    expect(DynamicIcon.resolve(null), DynamicIcon.resolve(''));
  });

  test('Api turns server and network errors into readable ApiException messages', () async {
    final api = FakeApi.install();
    api.on('GET', '/ok', (_) => {'isOk': true, 'data': [1]});
    api.on('GET', '/bad', (_) => {'isOk': false, 'message': 'Machine name already exists'});
    api.on('GET', '/403', (_) => FakeResponse({'message': 'Nope'}, status: 403));
    expect((await Api.get('/ok'))['data'], [1]);
    await expectLater(Api.get('/bad'), throwsA(isA<ApiException>().having((e) => e.message, 'message', 'Machine name already exists')));
    await expectLater(Api.get('/403'), throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 403)));
    await expectLater(Api.get('/missing'), throwsA(isA<ApiException>()));
    expect(api.misses.single.path, '/missing');
  });

  testWidgets('pumpScreen shows a page with the real providers', (tester) async {
    FakeApi.install();
    await pumpScreen(tester, const Scaffold(body: Text('hello')));
    expect(find.text('hello'), findsOneWidget);
  });
}
