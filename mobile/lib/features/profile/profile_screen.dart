import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../app/app_scaffold.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../core/utils/alerts.dart';
import '../../core/utils/validators.dart';
import '../../core/widgets/form_widgets.dart';
import '../../core/widgets/states.dart';
import '../../models/app_user.dart';
import '../../providers/auth_provider.dart';
import '../../core/theme/app_colors.dart';
import 'compact_field.dart';
import 'profile_rules.dart';
import 'profile_widgets.dart';

/// Lets tests replace the camera / gallery (image_picker has no platform in tests).
@visibleForTesting
Future<XFile?> Function(ImageSource source)? debugProfileImagePicker;

class _Photo {
  _Photo(this.bytes, this.name, this.mime);
  final Uint8List bytes;
  final String name;
  final String? mime;
}

/// Port of client/src/pages/Profile.jsx: edit own details + photo, change password.
/// SuperAdmin edits {name, username}; Operators edit {employeeName, mobileNumber,
/// emailOffice, address, username} — the same payloads the web sends to PUT /auth/me.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _scroll = ScrollController();

  final _name = TextEditingController();
  final _username = TextEditingController();
  final _mobile = TextEditingController();
  final _email = TextEditingController();
  final _address = TextEditingController();

  final _currentPw = TextEditingController();
  final _newPw = TextEditingController();
  final _confirmPw = TextEditingController();

  _Photo? _photo;
  bool _saving = false;
  bool _removing = false;
  bool _savingPw = false;
  PasswordField? _pwErrorField;
  String? _pwError;

  UsernameStatus _uStatus = UsernameStatus.idle;
  Timer? _uTimer;
  int _uSeq = 0;
  String _lastUsername = '';

  AppUser? get _user => context.read<AuthProvider>().user;
  bool get _isSuper => _user?.isSuperAdmin ?? false;

  @override
  void initState() {
    super.initState();
    _syncControllers();
    for (final c in [_name, _mobile, _email, _address, _currentPw, _newPw, _confirmPw]) {
      c.addListener(_rebuild);
    }
    _username.addListener(_onUsernameChanged);
  }

  @override
  void dispose() {
    _uTimer?.cancel();
    _scroll.dispose();
    for (final c in [_name, _username, _mobile, _email, _address, _currentPw, _newPw, _confirmPw]) {
      c.dispose();
    }
    super.dispose();
  }

  String _sig = '';

  /// Controller listener. Skips pure caret moves (same text) and never calls
  /// setState in the middle of a build (a controller can notify from one).
  void _rebuild() {
    if (!mounted) return;
    final sig = [_name.text, _mobile.text, _email.text, _address.text, _currentPw.text, _newPw.text, _confirmPw.text].join('\u0001');
    if (sig == _sig) return;
    _sig = sig;
    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.persistentCallbacks) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() {});
      });
      return;
    }
    setState(() {});
  }

  // ── baseline (what the server has) ─────────────────────────────────────
  Map<String, String> _baseline(AppUser? u) {
    final r = u?.raw ?? const <String, dynamic>{};
    String s(String k) => (r[k] ?? '').toString();
    final emp = s('employeeName').isNotEmpty ? s('employeeName') : s('name');
    return {
      'name': (u?.isSuperAdmin ?? false) ? s('name') : emp,
      'username': s('username'),
      'mobileNumber': s('mobileNumber'),
      'emailOffice': s('emailOffice'),
      'address': s('address'),
    };
  }

  void _syncControllers() {
    final b = _baseline(_user);
    _name.text = b['name']!;
    _lastUsername = b['username']!;
    _username.text = b['username']!;
    _mobile.text = b['mobileNumber']!;
    _email.text = b['emailOffice']!;
    _address.text = b['address']!;
    _photo = null;
    _uStatus = UsernameStatus.idle;
  }

  bool get _profileDirty {
    final b = _baseline(_user);
    if (_photo != null) return true;
    if (_name.text != b['name'] || _username.text != b['username']) return true;
    if (!_isSuper && (_mobile.text != b['mobileNumber'] || _email.text != b['emailOffice'] || _address.text != b['address'])) {
      return true;
    }
    return false;
  }

  bool get _passwordTouched => _currentPw.text.isNotEmpty || _newPw.text.isNotEmpty || _confirmPw.text.isNotEmpty;

  // ── username availability (400 ms debounce, like the web) ──────────────
  void _onUsernameChanged() {
    if (!mounted) return;
    final v = _username.text;
    if (v == _lastUsername) return;
    _lastUsername = v;
    _uTimer?.cancel();
    final current = _user?.username ?? '';
    _uSeq++;
    if (v.isEmpty || v == current) {
      setState(() => _uStatus = UsernameStatus.idle);
      return;
    }
    if (v.length < 3) {
      setState(() => _uStatus = UsernameStatus.short);
      return;
    }
    setState(() => _uStatus = UsernameStatus.checking);
    final seq = ++_uSeq;
    _uTimer = Timer(const Duration(milliseconds: 400), () => _checkUsername(v, seq));
  }

  Future<void> _checkUsername(String v, int seq) async {
    UsernameStatus next;
    try {
      final res = await Api.get(Endpoints.checkUsername, query: {'username': v});
      next = res['available'] == true ? UsernameStatus.available : UsernameStatus.taken;
    } on ApiException catch (e) {
      next = e.statusCode == 400 ? UsernameStatus.short : UsernameStatus.unknown;
    } catch (_) {
      next = UsernameStatus.unknown;
    }
    if (!mounted || seq != _uSeq) return;
    setState(() => _uStatus = next);
  }

  // ── photo ──────────────────────────────────────────────────────────────
  Future<void> _photoActions() async {
    final hasSaved = (_user?.profilePic ?? '').isNotEmpty;
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take photo'),
              onTap: () => Navigator.pop(ctx, 'camera'),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose from gallery'),
              onTap: () => Navigator.pop(ctx, 'gallery'),
            ),
            if (_photo != null)
              ListTile(
                leading: const Icon(Icons.undo_rounded),
                title: const Text('Discard new photo'),
                onTap: () => Navigator.pop(ctx, 'discard'),
              )
            else if (hasSaved)
              ListTile(
                leading: Icon(Icons.delete_outline_rounded, color: Theme.of(ctx).colorScheme.error),
                title: Text('Remove photo', style: TextStyle(color: Theme.of(ctx).colorScheme.error)),
                onTap: () => Navigator.pop(ctx, 'remove'),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (!mounted || action == null) return;
    switch (action) {
      case 'camera':
        await _pick(ImageSource.camera);
      case 'gallery':
        await _pick(ImageSource.gallery);
      case 'discard':
        setState(() => _photo = null);
      case 'remove':
        await _removePhoto();
    }
  }

  Future<void> _pick(ImageSource source) async {
    try {
      final picker = debugProfileImagePicker;
      final XFile? file = picker != null
          ? await picker(source)
          : await ImagePicker().pickImage(source: source, maxWidth: 1600, maxHeight: 1600, imageQuality: 85);
      if (file == null || !mounted) return;
      final bytes = await file.readAsBytes();
      if (!mounted) return;
      final tooBig = photoSizeError(bytes.length);
      if (tooBig != null) {
        Alerts.error(tooBig);
        return;
      }
      HapticFeedback.selectionClick();
      setState(() => _photo = _Photo(bytes, file.name, file.mimeType));
    } on PlatformException {
      if (mounted) Alerts.error("Couldn't open ${source == ImageSource.camera ? 'the camera' : 'your photos'}. Check the app's permissions in Settings.");
    } catch (_) {
      if (mounted) Alerts.error("Couldn't load that image.");
    }
  }

  Future<void> _removePhoto() async {
    final ok = await Alerts.confirm(
      context,
      'Are you sure you want to remove your profile picture? This action cannot be undone and takes effect immediately.',
      title: 'Remove Profile Picture?',
      confirmText: 'Yes, Remove',
    );
    if (!ok || !mounted) return;
    setState(() => _removing = true);
    try {
      final res = await Api.putForm(Endpoints.updateProfile, FormData.fromMap({'removeProfilePic': 'true'}));
      if (!mounted) return;
      await _applyServerUser(asMap(res), keepEdits: true);
      if (!mounted) return;
      Alerts.success('Profile picture removed successfully');
    } on ApiException catch (e) {
      if (mounted) Alerts.error(e.message.isEmpty ? 'Failed to remove profile picture' : e.message);
    } finally {
      if (mounted) setState(() => _removing = false);
    }
  }

  // ── save details ───────────────────────────────────────────────────────
  Future<void> _save() async {
    if (_saving) return;
    if (!(_formKey.currentState?.validate() ?? false)) {
      HapticFeedback.mediumImpact();
      return;
    }
    if (_uStatus == UsernameStatus.taken) {
      Alerts.error('Username already taken.');
      return;
    }
    final username = _username.text;
    // Same payload as the web: blank optional values are simply not sent.
    final fields = <String, String>{
      if (_isSuper) ...{
        'name': _name.text,
        if (username.isNotEmpty) 'username': username,
      } else ...{
        'employeeName': _name.text,
        'mobileNumber': _mobile.text,
        if (_email.text.isNotEmpty) 'emailOffice': _email.text,
        if (username.isNotEmpty) 'username': username,
        if (_address.text.isNotEmpty) 'address': _address.text,
      },
    };
    final form = FormData.fromMap(fields);
    final photo = _photo;
    if (photo != null) {
      final mime = imageMime(photo.mime, photo.name);
      form.files.add(MapEntry(
        'profilePic',
        MultipartFile.fromBytes(
          photo.bytes,
          filename: uploadFilename(photo.name, mime.subtype),
          contentType: DioMediaType(mime.type, mime.subtype),
        ),
      ));
    }
    FocusScope.of(context).unfocus();
    setState(() => _saving = true);
    try {
      final res = await Api.putForm(Endpoints.updateProfile, form);
      if (!mounted) return;
      await _applyServerUser(asMap(res));
      if (!mounted) return;
      HapticFeedback.lightImpact();
      Alerts.success('Profile updated successfully');
    } on ApiException catch (e) {
      if (mounted) Alerts.error(e.message.isEmpty ? 'Failed to update profile' : e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// The PUT answers with the fresh account; keep what /auth/me carries that
  /// the answer may lack (roleType…), then re-read /auth/me in the background.
  Future<void> _applyServerUser(Map<String, dynamic> data, {bool keepEdits = false}) async {
    final auth = context.read<AuthProvider>();
    final old = auth.user;
    if (data.isNotEmpty && old != null) {
      auth.setUser(AppUser({...old.raw, ...data, 'roleType': data['roleType'] ?? old.roleType}));
    }
    if (keepEdits) {
      setState(() => _photo = null);
    } else {
      setState(_syncControllers);
    }
    unawaited(auth.refreshUser());
  }

  void _discard() {
    FocusScope.of(context).unfocus();
    setState(_syncControllers);
  }

  // ── password ───────────────────────────────────────────────────────────
  Future<void> _changePassword() async {
    if (_savingPw) return;
    final problem = passwordProblem(current: _currentPw.text, next: _newPw.text, confirm: _confirmPw.text);
    if (problem != null) {
      HapticFeedback.mediumImpact();
      setState(() {
        _pwErrorField = problem.field;
        _pwError = problem.message;
      });
      Alerts.error(problem.message);
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _savingPw = true;
      _pwErrorField = null;
      _pwError = null;
    });
    try {
      await Api.put(Endpoints.changePassword, body: {'currentPassword': _currentPw.text, 'newPassword': _newPw.text});
      if (!mounted) return;
      _currentPw.clear();
      _newPw.clear();
      _confirmPw.clear();
      HapticFeedback.lightImpact();
      Alerts.success('Password changed successfully');
    } on ApiException catch (e) {
      if (!mounted) return;
      final msg = e.message.isEmpty ? 'Failed to change password' : e.message;
      setState(() {
        if (msg.toLowerCase().contains('current password')) {
          _pwErrorField = PasswordField.current;
          _pwError = msg;
        }
      });
      Alerts.error(msg);
    } finally {
      if (mounted) setState(() => _savingPw = false);
    }
  }

  void _clearPwError() {
    if (_pwError == null) return;
    setState(() {
      _pwError = null;
      _pwErrorField = null;
    });
  }

  Future<void> _refresh() async {
    await context.read<AuthProvider>().refreshUser();
    if (!mounted) return;
    // Never overwrite what the person is in the middle of typing.
    if (!_profileDirty) setState(_syncControllers);
  }

  Future<void> _confirmLeave() async {
    final leave = await Alerts.confirm(
      context,
      'You have unsaved changes. If you leave now they will be lost.',
      title: 'Discard changes?',
      confirmText: 'Discard',
    );
    if (leave && mounted) {
      Navigator.of(context).pop();
    }
  }

  // ── UI ─────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    final user = context.select<AuthProvider, AppUser?>((a) => a.user);
    if (user == null) return const AppScaffold(title: 'My profile', body: LoadingView());

    final isSuper = user.isSuperAdmin;
    final s = Theme.of(context).colorScheme;
    final dirty = _profileDirty;
    final guard = dirty || _passwordTouched;

    return PopScope(
      canPop: !guard || _saving,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _confirmLeave();
      },
      // A plain Scaffold (not the shell one): the Save bar lives in the body so
      // it rides on top of the keyboard instead of hiding behind it.
      child: Scaffold(
        appBar: AppBar(title: const Text('My profile')),
        body: TapToDismiss(
          child: Column(
            children: [
              Expanded(
                child: SafeArea(
                  top: false,
                  bottom: !dirty,
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 720),
                      child: RefreshIndicator(
                        onRefresh: _refresh,
                        child: ListView(
                          controller: _scroll,
                          physics: const AlwaysScrollableScrollPhysics(),
                          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                          padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
                          children: [
                            CompactCard(
                              padding: const EdgeInsets.fromLTRB(12, 14, 12, 12),
                              child: SizedBox(
                                width: double.infinity,
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.center,
                                  children: [
                                    ProfileAvatar(user: user, preview: _photo?.bytes, busy: _removing, onTap: _photoActions),
                                    TextButton(
                                      style: TextButton.styleFrom(minimumSize: const Size(40, 36), visualDensity: VisualDensity.compact),
                                      onPressed: _removing ? null : _photoActions,
                                      child: Text(_photo != null ? 'Change selected photo' : 'Change photo'),
                                    ),
                                    if (_photo != null)
                                      Text('New photo selected. Save changes to upload it.',
                                          textAlign: TextAlign.center, style: TextStyle(color: s.onSurfaceVariant, fontSize: 12)),
                                    const SizedBox(height: 2),
                                    Text(
                                      user.name.isEmpty ? 'User' : user.name,
                                      textAlign: TextAlign.center,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                                    ),
                                    const SizedBox(height: 6),
                                    MiniPill(user.roleName ?? 'No Role', color: s.primary, fg: AppColors.readable(context, s.primary)),
                                    if (!isSuper) OperatorFacts(raw: user.raw),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(height: 10),
                            Form(
                              key: _formKey,
                              child: CompactCard(
                                title: 'Profile details',
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: [
                                    CompactField(
                                      label: 'Full name',
                                      controller: _name,
                                      required: true,
                                      hint: 'Your full name',
                                      textCapitalization: TextCapitalization.words,
                                      keyboardType: TextInputType.name,
                                      textInputAction: TextInputAction.next,
                                      autofillHints: const [AutofillHints.name],
                                    ),
                                    const SizedBox(height: 10),
                                    if (isSuper)
                                      CompactField(
                                        key: ValueKey('email-${user.raw['email']}'),
                                        label: 'Email',
                                        initialValue: (user.raw['email'] ?? '').toString(),
                                        enabled: false,
                                        suffix: const Icon(Icons.lock_outline_rounded, size: 16),
                                      )
                                    else ...[
                                      CompactField(
                                        key: ValueKey('role-${user.roleName}'),
                                        label: 'Role',
                                        initialValue: user.roleName ?? '—',
                                        enabled: false,
                                        suffix: const Icon(Icons.lock_outline_rounded, size: 16),
                                      ),
                                      const SizedBox(height: 10),
                                      CompactField(
                                        label: 'Mobile number (optional)',
                                        controller: _mobile,
                                        hint: '10-digit mobile number',
                                        // Digits only (the formatter strips everything else), so the
                                        // plain number pad - no +*# keys that would be swallowed.
                                        keyboardType: const TextInputType.numberWithOptions(decimal: false, signed: false),
                                        inputFormatters: [MobileFormatter()],
                                        maxLength: 10,
                                        validator: (v) => Validators.phone(v),
                                        textInputAction: TextInputAction.next,
                                        autofillHints: const [AutofillHints.telephoneNumber],
                                      ),
                                      const SizedBox(height: 10),
                                      CompactField(
                                        label: 'Office email (optional)',
                                        controller: _email,
                                        hint: 'you@company.com',
                                        keyboardType: TextInputType.emailAddress,
                                        autocorrect: false,
                                        enableSuggestions: false,
                                        maxLength: 30,
                                        validator: (v) => Validators.email(v),
                                        textInputAction: TextInputAction.next,
                                        autofillHints: const [AutofillHints.email],
                                      ),
                                      const SizedBox(height: 10),
                                      CompactField(
                                        label: 'Address (optional)',
                                        controller: _address,
                                        hint: 'Enter your address...',
                                        keyboardType: TextInputType.multiline,
                                        textInputAction: TextInputAction.newline,
                                        maxLines: 3,
                                        minLines: 2,
                                        maxLength: 150,
                                        textCapitalization: TextCapitalization.sentences,
                                      ),
                                    ],
                                    const SizedBox(height: 10),
                                    CompactField(
                                      label: 'Username',
                                      controller: _username,
                                      hint: 'your.username',
                                      keyboardType: TextInputType.text,
                                      inputFormatters: [UsernameFormatter()],
                                      autocorrect: false,
                                      enableSuggestions: false,
                                      textInputAction: TextInputAction.done,
                                      autofillHints: const [AutofillHints.username],
                                      validator: (v) => (v ?? '').isNotEmpty && v!.length < 3 ? 'Min. 3 characters' : null,
                                      helper: 'Visible to admins and team members. Lowercase letters, numbers and _ @ - only.',
                                    ),
                                    UsernameStatusLine(_uStatus),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(height: 10),
                            CompactCard(
                              title: 'Change password',
                              child: AutofillGroup(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: [
                                    PasswordInput(
                                      label: 'Current password',
                                      controller: _currentPw,
                                      hint: 'Current password',
                                      textInputAction: TextInputAction.next,
                                      errorText: _pwErrorField == PasswordField.current ? _pwError : null,
                                      onChanged: (_) => _clearPwError(),
                                      autofillHints: const [AutofillHints.password],
                                    ),
                                    const SizedBox(height: 10),
                                    PasswordInput(
                                      label: 'New password',
                                      controller: _newPw,
                                      hint: 'Min. 8 characters',
                                      textInputAction: TextInputAction.next,
                                      errorText: _pwErrorField == PasswordField.newPassword ? _pwError : null,
                                      onChanged: (_) => _clearPwError(),
                                      autofillHints: const [AutofillHints.newPassword],
                                    ),
                                    const SizedBox(height: 6),
                                    PasswordChecklist(password: _newPw.text, confirm: _confirmPw.text),
                                    const SizedBox(height: 10),
                                    PasswordInput(
                                      label: 'Confirm new password',
                                      controller: _confirmPw,
                                      hint: 'Repeat new password',
                                      textInputAction: TextInputAction.done,
                                      errorText: _pwErrorField == PasswordField.confirm ? _pwError : null,
                                      onChanged: (_) => _clearPwError(),
                                      onSubmitted: (_) => FocusScope.of(context).unfocus(),
                                      autofillHints: const [AutofillHints.newPassword],
                                    ),
                                    const SizedBox(height: 14),
                                    PrimaryButton(
                                      label: 'Change password',
                                      icon: Icons.lock_reset_rounded,
                                      loading: _savingPw,
                                      onPressed: (_currentPw.text.isEmpty || _newPw.text.isEmpty || _confirmPw.text.isEmpty) ? null : _changePassword,
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              _SaveBar(visible: dirty, saving: _saving, onSave: _save, onDiscard: _discard),
            ],
          ),
        ),
      ),
    );
  }
}

/// Sticky Save / Discard bar — only there while something is edited.
class _SaveBar extends StatelessWidget {
  const _SaveBar({required this.visible, required this.saving, required this.onSave, required this.onDiscard});
  final bool visible;
  final bool saving;
  final VoidCallback onSave;
  final VoidCallback onDiscard;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return AnimatedSize(
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOut,
      alignment: Alignment.bottomCenter,
      child: !visible
          ? const SizedBox(width: double.infinity)
          : Material(
              color: s.surface,
              elevation: 8,
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                  child: Center(
                    heightFactor: 1,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 720),
                      child: Row(
                        children: [
                          OutlinedButton(
                            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
                            onPressed: saving ? null : onDiscard,
                            child: const Text('Discard'),
                          ),
                          const SizedBox(width: 10),
                          Expanded(child: PrimaryButton(label: 'Save changes', icon: Icons.check_rounded, loading: saving, onPressed: onSave)),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
    );
  }
}
