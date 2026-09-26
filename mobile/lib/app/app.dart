import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/config.dart';
import '../core/theme/app_theme.dart';
import '../core/utils/alerts.dart';
import '../core/widgets/keyboard_done_bar.dart';
import '../core/widgets/tap_to_dismiss.dart';
import '../core/api/api_client.dart';
import '../features/auth/blocked_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/maintenance/maintenance_gate.dart';
import '../providers/auth_provider.dart';
import '../providers/company_provider.dart';
import '../providers/menu_provider.dart';
import '../providers/theme_provider.dart';
import '../providers/unread_provider.dart';
import 'main_shell.dart';

class IndoApp extends StatelessWidget {
  const IndoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()..bootstrap()),
        ChangeNotifierProvider(create: (_) => CompanyProvider()..load()),
        ChangeNotifierProxyProvider<AuthProvider, ThemeProvider>(
          create: (_) => ThemeProvider(),
          update: (_, auth, theme) => (theme ?? ThemeProvider())..attach(auth),
        ),
        ChangeNotifierProxyProvider<AuthProvider, MenuProvider>(
          create: (_) => MenuProvider(),
          update: (_, auth, menu) => (menu ?? MenuProvider())..attach(auth),
        ),
        ChangeNotifierProxyProvider<AuthProvider, UnreadProvider>(
          create: (_) => UnreadProvider(),
          update: (_, auth, unread) => (unread ?? UnreadProvider())..attach(auth),
        ),
      ],
      child: const _AppRoot(),
    );
  }
}

class _AppRoot extends StatefulWidget {
  const _AppRoot();

  @override
  State<_AppRoot> createState() => _AppRootState();
}

class _AppRootState extends State<_AppRoot> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    // A 403 that is not "blocked" means "you may not do that": tell the person.
    ApiClient.instance.onForbidden = Alerts.error;
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Back from the background: the Super Admin may have changed the logo or
    // company name on the web meanwhile.
    if (state == AppLifecycleState.resumed) context.read<CompanyProvider>().load();
  }

  @override
  Widget build(BuildContext context) {
    final theme = context.watch<ThemeProvider>();
    final company = context.select<CompanyProvider, String>((c) => c.name);
    return MaterialApp(
      title: company.isEmpty ? AppConfig.appName : company,
      debugShowCheckedModeBanner: false,
      navigatorKey: rootNavigatorKey,
      scaffoldMessengerKey: rootMessengerKey,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: theme.mode,
      builder: (context, child) => KeyboardDoneBar(child: TapToDismiss(child: child ?? const SizedBox.shrink())),
      home: const _AuthGate(),
    );
  }
}

/// Login / blocked / the signed-in app, depending on the session.
class _AuthGate extends StatelessWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context) {
    final status = context.select<AuthProvider, AuthStatus>((a) => a.status);

    if (status != AuthStatus.authenticated) {
      // Signed out (or session expired) while deep in the app: drop every page
      // pushed above this gate so the login screen is what the person sees.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        rootNavigatorKey.currentState?.popUntil((r) => r.isFirst);
      });
    }

    switch (status) {
      case AuthStatus.unknown:
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      case AuthStatus.unauthenticated:
        return const LoginScreen();
      case AuthStatus.blocked:
        return const BlockedScreen();
      case AuthStatus.authenticated:
        return const MaintenanceGate(child: MainShell());
    }
  }
}
