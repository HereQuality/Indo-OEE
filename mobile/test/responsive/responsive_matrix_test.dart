import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/app/main_shell.dart';
import 'package:indo/core/utils/alerts.dart';
import 'package:indo/core/widgets/form_widgets.dart';
import 'package:indo/features/admin/company_management_screen.dart';
import 'package:indo/features/admin/menu_group_screen.dart';
import 'package:indo/features/admin/menu_master_screen.dart';
import 'package:indo/features/auth/blocked_screen.dart';
import 'package:indo/features/auth/login_screen.dart';
import 'package:indo/features/auth/no_access_screen.dart';
import 'package:indo/features/employee_management/company_holidays_screen.dart';
import 'package:indo/features/employee_management/department_screen.dart';
import 'package:indo/features/employee_management/employee_screen.dart';
import 'package:indo/features/employee_management/manage_role_screen.dart';
import 'package:indo/features/employee_management/role_master_screen.dart';
import 'package:indo/features/employee_management/team_members_screen.dart';
import 'package:indo/features/home/home_screen.dart';
import 'package:indo/features/maintenance/under_maintenance_screen.dart';
import 'package:indo/features/notifications/notifications_screen.dart';
import 'package:indo/features/production/item_master_screen.dart';
import 'package:indo/features/production/machine_master_screen.dart';
import 'package:indo/features/production/operator_master_screen.dart';
import 'package:indo/features/production/process_master_screen.dart';
import 'package:indo/features/production/production_dashboard_screen.dart';
import 'package:indo/features/profile/profile_screen.dart';
import 'package:indo/features/settings/settings_screen.dart';
import 'package:indo/features/shortcuts/shortcuts_screen.dart';
import 'package:indo/features/support/support_screen.dart';
import 'package:indo/features/teams/teams_board_screen.dart';
import 'package:indo/models/menu_models.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../production/dashboard_shell_fixtures.dart';
import '../support/fake_api.dart';

/// Every screen of the phone app, at every size class the app runs on, in both
/// themes and at 1.0x / 1.3x text. Any layout exception (RenderFlex overflow,
/// unbounded constraints, ...) fails the test, so a regression can't ship quietly.
const _sizes = <String, Size>{
  'small 320x568': Size(320, 568),
  'phone 360x640': Size(360, 640),
  'phone 390x844': Size(390, 844),
  'large 430x932': Size(430, 932),
  'phone landscape 844x390': Size(844, 390),
  'tablet 600x960': Size(600, 960),
  'tablet portrait 800x1280': Size(800, 1280),
  'tablet landscape 1280x800': Size(1280, 800),
};

final _menus = [
  MenuGroup(groupId: 'g1', groupName: 'Production', menus: [
    MenuItem(id: 'm-dash', name: 'Dashboard', url: '/hqepl/production/dashboard'),
    MenuItem(id: 'm-entry', name: 'Data entry', url: '/hqepl/production/cnc-data-entry'),
    MenuItem(id: 'm-mach', name: 'Machines', url: '/hqepl/production/machines', icon: 'Factory'),
    MenuItem(id: 'm-items', name: 'Parts', url: '/hqepl/production/items'),
  ]),
  MenuGroup(groupId: 'g2', groupName: 'Employee management', menus: [
    MenuItem(id: 'm-emp', name: 'Employees', url: '/hqepl/employee-management/employee'),
    MenuItem(id: 'm-role', name: 'Roles', url: '/hqepl/employee-management/role'),
  ]),
  MenuGroup(groupId: 'g3', groupName: 'Support', isLink: true, url: '/hqepl/support'),
];

String _ago(int minutes) => DateTime.now().subtract(Duration(minutes: minutes)).toUtc().toIso8601String();

/// Plausible data for the screens that load some, so rows/cards really lay out.
void _backend() {
  final api = FakeApi.install();
  api.list('/api/v1/notifications', [
    for (var i = 0; i < 6; i++)
      {
        '_id': 'n$i',
        'title': 'Ticket ${12 + i} has a new reply from the support team about the printer',
        'message': 'Something happened on a very long line that has to wrap on a small phone.',
        'type': 'ticket_reply',
        'isRead': i.isOdd,
        'createdAt': _ago(5 + i * 400),
      },
  ]);
  api.list('/api/v1/tickets', [
    for (var i = 0; i < 5; i++)
      {
        '_id': 't$i',
        'ticketId': 'TKT-100$i',
        'subject': 'A very long ticket subject that will wrap over several lines on a tiny phone $i',
        'description': 'It keeps jamming on tray 2',
        'status': i.isEven ? 'Pending' : 'Resolved',
        'priority': 'Medium',
        'platform': 'App',
        'tier': 'agent',
        'raisedById': 'u1',
        'raisedByName': 'Test User',
        'attachments': <String>[],
        'hasUnread': i == 0,
        'createdAt': _ago(120),
        'updatedAt': _ago(10),
      },
  ]);
  api.on('GET', '/api/v1/auth/me', (_) => {
        'isOk': true,
        'data': {
          '_id': 'u1',
          'roleType': 'Operator',
          'name': 'Test User With A Rather Long Name',
          'employeeName': 'Test User With A Rather Long Name',
          'username': 'tester',
          'mobileNumber': '9876543210',
          'emailOffice': 'a.very.long.email.address@example-company.com',
          'address': '12 Main Road, A Very Long Locality Name, Some City, Some State 123456',
          'departmentIds': [
            {'_id': 'd1', 'departmentName': 'Assembly'},
            {'_id': 'd2', 'departmentName': 'Quality Assurance and Inspection'},
          ],
          'skills': [
            {'label': 'CNC'},
            'Welding',
            'Programming of machines',
          ],
          'joiningDate': '2024-03-05T00:00:00.000Z',
          'remark': 'Night shift lead',
        },
      });
  installDashboardApi(api);
}

Widget _screenFor(String name) => switch (name) {
      'login' => const LoginScreen(),
      'home' => const HomeScreen(),
      'profile' => const ProfileScreen(),
      'settings' => const SettingsScreen(),
      'support' => const SupportScreen(),
      'notifications' => const NotificationsScreen(),
      'shortcuts' => const ShortcutsScreen(),
      'teams' => const TeamsBoardScreen(),
      'no access' => const NoAccessScreen(),
      'blocked' => const BlockedScreen(),
      'under maintenance' => const UnderMaintenanceScreen(),
      'main shell' => const MainShell(),
      'dashboard' => const ProductionDashboardScreen(),
      'machines' => const MachineMasterScreen(),
      'items' => const ItemMasterScreen(),
      'operators' => const OperatorMasterScreen(),
      'processes' => const ProcessMasterScreen(),
      'departments' => const DepartmentScreen(),
      'employees' => const EmployeeScreen(),
      'roles' => const RoleMasterScreen(),
      'manage role' => const ManageRoleScreen(),
      'team members' => const TeamMembersScreen(),
      'company holidays' => const CompanyHolidaysScreen(),
      'menu groups' => const MenuGroupScreen(),
      'menus' => const MenuMasterScreen(),
      'company' => const CompanyManagementScreen(),
      _ => throw ArgumentError(name),
    };

const _screens = [
  'login',
  'home',
  'profile',
  'settings',
  'support',
  'notifications',
  'shortcuts',
  'teams',
  'no access',
  'blocked',
  'under maintenance',
  'main shell',
  'dashboard',
  'machines',
  'items',
  'operators',
  'processes',
  'departments',
  'employees',
  'roles',
  'manage role',
  'team members',
  'company holidays',
  'menu groups',
  'menus',
  'company',
];

/// Tears the previous screen (and any sheet/dialog open on it) down, so each
/// size starts from a clean tree.
Future<void> _reset(WidgetTester t) => t.pumpWidget(const SizedBox());

/// Layout errors caught since the last check, each with the widget that caused it
/// (`Row:file:///…/login_screen.dart:149`) so a failure points straight at the code.
final List<String> _caught = [];
FlutterExceptionHandler? _original;

String _first(FlutterErrorDetails d) {
  final lines = d.toString(minLevel: DiagnosticLevel.debug).split('\n');
  final head = lines.where((l) => l.contains('overflowed') || l.contains('RenderBox') || l.contains('constraints')).take(1);
  final at = lines.where((l) => l.contains('lib/')).take(1);
  return [...head, ...at].join(' | ').replaceAll(RegExp(r'file:///\S*?/mobile/|file:///\S*?/mcopy/'), '');
}

void _startCapture() {
  _original = FlutterError.onError;
  _caught.clear();
  FlutterError.onError = (d) => _caught.add(_first(d));
}

void _stopCapture() => FlutterError.onError = _original;

/// testWidgets that records layout errors with their widget (flutter_test installs its
/// own error handler per test, so ours goes in at the top of the body).
void _layoutTest(String name, Future<void> Function(WidgetTester) body) {
  testWidgets(name, (tester) async {
    _startCapture();
    try {
      await body(tester);
    } finally {
      _stopCapture(); // flutter_test insists the handler is back before the test ends
    }
  });
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    pinDashboardClock();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
      (_) async => null,
    );
  });
  tearDown(unpinDashboardClock);

  for (final screen in _screens) {
    _layoutTest('$screen lays out at every size, theme and text scale', (tester) async {
      for (final e in _sizes.entries) {
        for (final dark in [false, true]) {
          for (final scale in [1.0, 1.3, 2.0]) {
            _backend();
            await _reset(tester);
            await pumpScreen(
              tester,
              _screenFor(screen),
              size: e.value,
              dark: dark,
              textScale: scale,
              menus: _menus,
              settle: false,
            );
            // Data screens load and animate: step time rather than pumpAndSettle.
            for (var i = 0; i < 8; i++) {
              await tester.pump(const Duration(milliseconds: 100));
            }
            final problem = [..._caught, if (tester.takeException() != null) 'exception'];
            _caught.clear();
            expect(problem, isEmpty, reason: '$screen @ ${e.key} ${dark ? 'dark' : 'light'} x$scale\n${problem.join('\n')}');
          }
        }
      }
    });
  }

  group('overlays', _overlays);
}

/// Sheets, dialogs and the on-screen keyboard — the places a layout that is fine
/// full-screen still breaks (a bottom sheet in landscape, a form with the keyboard up).
void _overlays() {
  Future<void> settle(WidgetTester t) async {
    for (var i = 0; i < 8; i++) {
      await t.pump(const Duration(milliseconds: 100));
    }
  }

  void noProblem(WidgetTester t, String what) {
    final problem = [..._caught, if (t.takeException() != null) 'exception'];
    _caught.clear();
    expect(problem, isEmpty, reason: '$what\n${problem.join('\n')}');
  }

  const scales = [1.0, 1.3, 2.0];

  _layoutTest('account menu (sheet on phones, popover on tablets)', (tester) async {
    for (final e in _sizes.entries) {
      for (final scale in scales) {
        _backend();
        await _reset(tester);
        await pumpScreen(tester, const HomeScreen(), size: e.value, textScale: scale, menus: _menus, settle: false);
        await settle(tester);
        await tester.tap(find.byTooltip('Account'));
        await settle(tester);
        expect(find.text('My profile'), findsWidgets, reason: 'account menu opened @ ${e.key}');
        noProblem(tester, 'account menu @ ${e.key} x$scale');
      }
    }
  });

  _layoutTest('searchable picker sheet with a long list', (tester) async {
    for (final e in _sizes.entries) {
      for (final scale in scales) {
        for (final kb in [0.0, 0.45]) {
          final keyboard = kb * e.value.height; // a real keyboard takes ~45% of the screen
          _backend();
          await _reset(tester);
          tester.view.viewInsets = FakeViewPadding(bottom: keyboard);
          addTearDown(tester.view.resetViewInsets);
          await pumpScreen(
            tester,
            Builder(
              builder: (context) => Scaffold(
                body: Center(
                  child: TextButton(
                    onPressed: () => showPicker<int>(
                      context,
                      title: 'Pick a machine with a very long title that has to wrap on small phones',
                      options: [for (var i = 0; i < 40; i++) PickOption(i, 'Machine number $i with a long descriptive name', subtitle: 'Process $i')],
                      selected: 3,
                      allowClear: true,
                    ),
                    child: const Text('open'),
                  ),
                ),
              ),
            ),
            size: e.value,
            textScale: scale,
            settle: false,
          );
          await tester.tap(find.text('open'));
          await settle(tester);
          noProblem(tester, 'picker @ ${e.key} x$scale keyboard ${keyboard.round()}px');
        }
      }
    }
  });

  _layoutTest('confirm dialog', (tester) async {
    for (final e in _sizes.entries) {
      for (final scale in scales) {
        _backend();
        await _reset(tester);
        await pumpScreen(
          tester,
          Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: TextButton(
                  onPressed: () => Alerts.confirm(context, 'Delete this entry? This cannot be undone and every figure on that date will be recalculated.'),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
          size: e.value,
          textScale: scale,
          settle: false,
        );
        await tester.tap(find.text('open'));
        await settle(tester);
        expect(find.text('Cancel'), findsOneWidget);
        noProblem(tester, 'confirm @ ${e.key} x$scale');
      }
    }
  });

  _layoutTest('new-ticket form, with and without the keyboard', (tester) async {
    for (final e in _sizes.entries) {
      for (final scale in scales) {
        for (final kb in [0.0, 0.45]) {
          final keyboard = kb * e.value.height; // a real keyboard takes ~45% of the screen
          _backend();
          await _reset(tester);
          tester.view.viewInsets = FakeViewPadding(bottom: keyboard);
          addTearDown(tester.view.resetViewInsets);
          await pumpScreen(
            tester,
            const SupportScreen(),
            user: testUser(superAdmin: false, extra: {'_id': 'u1'}),
            size: e.value,
            textScale: scale,
            settle: false,
          );
          await settle(tester);
          final newTicket = find.text('New ticket');
          if (newTicket.evaluate().isEmpty) continue; // keyboard up hides the button
          await tester.tap(newTicket.first);
          await settle(tester);
          noProblem(tester, 'new ticket @ ${e.key} x$scale keyboard ${keyboard.round()}px');
        }
      }
    }
  });

  _layoutTest('sign-in form with the keyboard up', (tester) async {
    for (final e in _sizes.entries) {
      for (final scale in scales) {
        _backend();
        await _reset(tester);
        tester.view.viewInsets = FakeViewPadding(bottom: 0.45 * e.value.height);
        addTearDown(tester.view.resetViewInsets);
        await pumpScreen(tester, const LoginScreen(), size: e.value, textScale: scale, settle: false);
        await settle(tester);
        await tester.tap(find.text('Sign in'));
        await settle(tester); // shows the two "required" errors, which grow the form
        noProblem(tester, 'login @ ${e.key} x$scale keyboard up');
      }
    }
  });
}
