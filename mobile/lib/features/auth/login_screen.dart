import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/widgets/form_widgets.dart';
import '../../providers/auth_provider.dart';
import '../../providers/company_provider.dart';

/// Sign in (mirrors pages/Login.jsx): username + password, "Remember me",
/// server error messages (locked / blocked / attempts left).
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  bool _show = false;
  bool _remember = false;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    if (_username.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Enter your username and password to continue.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    final result = await context.read<AuthProvider>().login(_username.text, _password.text, remember: _remember);
    if (!mounted) return;
    // On success the auth gate swaps this screen out; only failures land here.
    setState(() {
      _submitting = false;
      _error = result.ok ? null : result.message;
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final company = context.watch<CompanyProvider>();

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(child: _Brand(logo: company.logo, name: company.name)),
                  const SizedBox(height: 36),
                  Text(
                    'WELCOME BACK',
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 1.8, color: s.primary),
                  ),
                  const SizedBox(height: 8),
                  const Text('Sign in to your workspace', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, height: 1.2)),
                  const SizedBox(height: 8),
                  Text('Enter your credentials to access the OEE platform.', style: TextStyle(color: s.onSurfaceVariant)),
                  const SizedBox(height: 28),
                  AutofillGroup(
                    child: Column(
                      children: [
                        AppTextField(
                          label: 'Username',
                          controller: _username,
                          hint: 'your.username',
                          prefix: const Icon(Icons.person_outline),
                          textInputAction: TextInputAction.next,
                          autofillHints: const [AutofillHints.username],
                          onChanged: (_) => setState(() {}),
                        ),
                        const SizedBox(height: 18),
                        AppTextField(
                          label: 'Password',
                          controller: _password,
                          hint: 'Enter your password',
                          obscureText: !_show,
                          prefix: const Icon(Icons.lock_outline),
                          textInputAction: TextInputAction.done,
                          autofillHints: const [AutofillHints.password],
                          onSubmitted: (_) => _submit(),
                          onChanged: (_) => setState(() {}),
                          suffix: IconButton(
                            tooltip: _show ? 'Hide password' : 'Show password',
                            icon: Icon(_show ? Icons.visibility_off_outlined : Icons.visibility_outlined),
                            onPressed: () => setState(() => _show = !_show),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  InkWell(
                    borderRadius: BorderRadius.circular(8),
                    onTap: () => setState(() => _remember = !_remember),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        children: [
                          Checkbox(value: _remember, onChanged: (v) => setState(() => _remember = v ?? false)),
                          const Text('Remember me'),
                        ],
                      ),
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.critical.withValues(alpha: isDark ? 0.18 : 0.08),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.critical.withValues(alpha: 0.3)),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(Icons.error_outline, size: 18, color: AppColors.readable(context, AppColors.critical)),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              _error!,
                              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: AppColors.readable(context, AppColors.critical)),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 18),
                  PrimaryButton(
                    label: 'Sign in',
                    icon: Icons.arrow_forward_rounded,
                    loading: _submitting,
                    onPressed: (_username.text.isEmpty || _password.text.isEmpty) ? null : _submit,
                  ),
                  const SizedBox(height: 26),
                  Center(
                    child: Text(
                      '${AppConfig.apiHost}',
                      style: TextStyle(fontSize: 11, color: s.onSurfaceVariant),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Brand extends StatelessWidget {
  const _Brand({this.logo, this.name = ''});
  final String? logo;
  final String name;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    if (logo != null && logo!.isNotEmpty) {
      return CachedNetworkImage(
        imageUrl: logo!,
        height: 52,
        fit: BoxFit.contain,
        errorWidget: (_, __, ___) => _mark(isDark),
      );
    }
    return _mark(isDark);
  }

  Widget _mark(bool isDark) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: isDark ? Colors.white : AppColors.navy950,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text('IN', style: TextStyle(fontWeight: FontWeight.w800, color: isDark ? AppColors.navy950 : Colors.white)),
          ),
          const SizedBox(width: 12),
          Text(name.isEmpty ? 'Indo' : name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
        ],
      );
}
