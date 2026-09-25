import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';

import '../../app/app_scaffold.dart';
import '../../app/navigation.dart';
import '../../core/config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/alerts.dart';
import '../../core/widgets/common_widgets.dart';
import '../../providers/auth_provider.dart';
import '../../providers/company_provider.dart';
import '../../providers/theme_provider.dart';
import 'local_data.dart';

/// Port of client/src/pages/Settings.jsx. The web page only has two account
/// preferences (theme mode, dashboard clock) — both saved through
/// PUT /auth/me/preferences. The rest (account shortcut, device info, local
/// data, sign out) are the phone-side extras.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  PackageInfo? _info;
  bool? _clockPending; // optimistic value while the preference request is in flight
  bool _clearing = false;
  bool _signingOut = false;

  @override
  void initState() {
    super.initState();
    _loadInfo();
  }

  Future<void> _loadInfo() async {
    try {
      final info = await PackageInfo.fromPlatform();
      if (!mounted) return;
      setState(() => _info = info);
    } catch (_) {/* version row shows a dash */}
  }

  Future<void> _setDark(bool dark) async {
    HapticFeedback.selectionClick();
    await context.read<ThemeProvider>().setDark(dark);
  }

  Future<void> _setClock(bool value) async {
    HapticFeedback.selectionClick();
    final auth = context.read<AuthProvider>();
    setState(() => _clockPending = value);
    final ok = await auth.updatePreferences({'showDashboardClock': value});
    if (!mounted) return;
    setState(() => _clockPending = null);
    if (!ok) Alerts.error("Couldn't save your preference. Check your connection and try again.");
  }

  Future<void> _clearLocal() async {
    final ok = await Alerts.confirm(
      context,
      'This removes an unsent data-entry draft and your saved dashboard widget picks from this device. '
      'Nothing on the server changes and you stay signed in.',
      title: 'Clear local data?',
      confirmText: 'Clear',
      danger: false,
    );
    if (!ok || !mounted) return;
    setState(() => _clearing = true);
    try {
      final n = await LocalData.clear();
      if (!mounted) return;
      Alerts.success(n == 0 ? 'Nothing to clear.' : 'Local data cleared.');
    } catch (_) {
      if (mounted) Alerts.error("Couldn't clear local data.");
    } finally {
      if (mounted) setState(() => _clearing = false);
    }
  }

  Future<void> _signOut() async {
    final auth = context.read<AuthProvider>();
    final ok = await Alerts.confirm(
      context,
      'You will need to sign in again on this device.',
      title: 'Sign out?',
      confirmText: 'Sign out',
    );
    if (!ok || !mounted) return;
    setState(() => _signingOut = true);
    HapticFeedback.mediumImpact();
    await auth.logout();
    if (mounted) setState(() => _signingOut = false);
  }

  String get _versionText {
    final i = _info;
    if (i == null) return '—';
    return i.buildNumber.isEmpty ? i.version : '${i.version} (${i.buildNumber})';
  }

  String get _platformText {
    if (Platform.isIOS) return 'iOS';
    if (Platform.isAndroid) return 'Android';
    return Platform.operatingSystem;
  }

  Future<void> _copyDiagnostics() async {
    final user = context.read<AuthProvider>().user;
    final text = [
      '${AppConfig.appName} $_versionText',
      'Platform: $_platformText',
      'Server: ${AppConfig.apiHost}',
      if (user != null) 'User: ${user.username} (${user.roleName ?? user.roleType})',
    ].join('\n');
    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) Alerts.success('Copied to clipboard.');
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final theme = context.watch<ThemeProvider>();
    final company = context.watch<CompanyProvider>();
    final user = auth.user;
    final clock = _clockPending ?? user?.preferences.showDashboardClock ?? true;
    final scheme = Theme.of(context).colorScheme;

    return AppScaffold(
      title: 'Settings',
      body: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              if (user != null) ...[
                Card(
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    onTap: () => AppNav.go(context, '/profile'),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          UserAvatar(imageUrl: user.profilePic, name: user.name, radius: 26),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(user.name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                                const SizedBox(height: 2),
                                Text(
                                  [user.roleName, if (user.username.isNotEmpty) '@${user.username}'].whereType<String>().join(' · '),
                                  style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
                                ),
                              ],
                            ),
                          ),
                          Icon(Icons.chevron_right_rounded, color: scheme.onSurfaceVariant),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],
              SectionCard(
                title: 'Appearance',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Theme mode', style: TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text('Toggle between Light and Dark mode.', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13)),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: SegmentedButton<bool>(
                        showSelectedIcon: false,
                        segments: const [
                          ButtonSegment(value: false, icon: Icon(Icons.light_mode_outlined), label: Text('Light')),
                          ButtonSegment(value: true, icon: Icon(Icons.dark_mode_outlined), label: Text('Dark')),
                        ],
                        selected: {theme.isDark},
                        onSelectionChanged: (s) => _setDark(s.first),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              SectionCard(
                title: 'Dashboard preferences',
                padding: const EdgeInsets.fromLTRB(16, 16, 8, 8),
                child: SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  secondary: Icon(Icons.schedule_rounded, color: scheme.primary),
                  title: const Text('Real-time clock', style: TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: const Text('Show or hide the real-time clock on your dashboard.'),
                  value: clock,
                  onChanged: user == null ? null : _setClock,
                ),
              ),
              const SizedBox(height: 16),
              SectionCard(
                title: 'About this device',
                trailing: IconButton(
                  tooltip: 'Copy details',
                  onPressed: _copyDiagnostics,
                  icon: const Icon(Icons.copy_rounded, size: 20),
                ),
                child: Column(
                  children: [
                    _KeyValue('App', AppConfig.appName),
                    _KeyValue('Version', _versionText),
                    if (company.name.isNotEmpty) _KeyValue('Company', company.name),
                    _KeyValue('Platform', _platformText),
                    _KeyValue('Server', AppConfig.apiHost),
                    if (user != null) _KeyValue('Signed in as', user.username.isEmpty ? user.name : user.username),
                    if (user != null && user.roleName != null) _KeyValue('Role', user.roleName!),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              SectionCard(
                title: 'Data on this device',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Clears an unsent data-entry draft and saved dashboard widget picks stored on this phone. '
                      'Your account, theme and sign-in are not affected.',
                      style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
                    ),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: _clearing ? null : _clearLocal,
                      icon: _clearing
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.cleaning_services_outlined, size: 20),
                      label: const Text('Clear local data'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.readable(context, AppColors.critical),
                  side: BorderSide(color: AppColors.critical.withValues(alpha: 0.5)),
                ),
                onPressed: _signingOut ? null : _signOut,
                icon: _signingOut
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.logout_rounded, size: 20),
                label: const Text('Sign out'),
              ),
              const SizedBox(height: 16),
              Center(
                child: Text(
                  _info == null ? AppConfig.appName : '${AppConfig.appName} · v$_versionText',
                  style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Label on the left, value on the right; wraps instead of overflowing.
class _KeyValue extends StatelessWidget {
  const _KeyValue(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Flexible(flex: 2, child: Text(label, style: TextStyle(color: s.onSurfaceVariant, fontSize: 13))),
          const SizedBox(width: 12),
          Flexible(
            flex: 3,
            child: Text(value, textAlign: TextAlign.end, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 14)),
          ),
        ],
      ),
    );
  }
}
