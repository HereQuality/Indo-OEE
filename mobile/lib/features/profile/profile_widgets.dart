import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/utils/formatters.dart';
import '../../core/widgets/common_widgets.dart';
import '../../core/widgets/form_widgets.dart';
import '../../models/app_user.dart';
import 'profile_rules.dart';

/// Round avatar with a camera badge. Shows [preview] (a picked but unsaved
/// photo) over the saved picture; tapping it opens the photo actions.
class ProfileAvatar extends StatelessWidget {
  const ProfileAvatar({super.key, required this.user, required this.preview, required this.busy, required this.onTap});

  final AppUser user;
  final Uint8List? preview;
  final bool busy;
  final VoidCallback onTap;

  static const double radius = 48;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final Widget avatar = preview != null
        ? CircleAvatar(radius: radius, backgroundImage: MemoryImage(preview!))
        : UserAvatar(imageUrl: user.profilePic, name: user.name, radius: radius);
    return Semantics(
      button: true,
      label: 'Change profile photo',
      child: InkResponse(
        onTap: busy ? null : onTap,
        radius: radius + 12,
        child: SizedBox(
          width: radius * 2 + 8,
          height: radius * 2 + 8,
          child: Stack(
            alignment: Alignment.center,
            children: [
              Container(
                padding: const EdgeInsets.all(3),
                decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: s.outlineVariant, width: 2)),
                child: avatar,
              ),
              if (busy)
                Positioned.fill(
                  child: DecoratedBox(
                    decoration: BoxDecoration(shape: BoxShape.circle, color: s.surface.withValues(alpha: 0.6)),
                    child: const Center(child: SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 3))),
                  ),
                ),
              Positioned(
                right: 0,
                bottom: 0,
                child: Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: s.primary,
                    shape: BoxShape.circle,
                    border: Border.all(color: s.surface, width: 2),
                  ),
                  child: Icon(Icons.photo_camera_rounded, size: 17, color: s.onPrimary),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Departments / skills / joining date / remark (Operators only, like the web).
class OperatorFacts extends StatelessWidget {
  const OperatorFacts({super.key, required this.raw});
  final Map<String, dynamic> raw;

  static List<String> _names(dynamic v, List<String> keys) {
    if (v is! List) return const [];
    final out = <String>[];
    for (final e in v) {
      String? t;
      if (e is Map) {
        for (final k in keys) {
          if (e[k] != null && e[k].toString().isNotEmpty) {
            t = e[k].toString();
            break;
          }
        }
      } else if (e != null) {
        t = e.toString();
      }
      if (t != null && t.isNotEmpty) out.add(t);
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final departments = _names(raw['departmentIds'], ['departmentName', 'name']);
    final skills = _names(raw['skills'], ['label', 'name']);
    final joining = Fmt.parse(raw['joiningDate']);
    final remark = (raw['remark'] ?? '').toString().trim();
    if (departments.isEmpty && skills.isEmpty && joining == null && remark.isEmpty) return const SizedBox.shrink();

    Widget block(String label, Widget child) => Padding(
          padding: const EdgeInsets.only(top: 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label.toUpperCase(),
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1, color: s.onSurfaceVariant),
              ),
              const SizedBox(height: 6),
              child,
            ],
          ),
        );

    Widget chips(List<String> items, Color tone) => Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [for (final t in items) StatusChip(t, color: tone)],
        );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 16),
        Divider(height: 1, color: s.outlineVariant),
        if (departments.isNotEmpty) block('Departments', Text(departments.join(', '), style: const TextStyle(fontWeight: FontWeight.w500))),
        if (skills.isNotEmpty) block('Skills', chips(skills, s.primary)),
        if (joining != null) block('Joining date', Text(Fmt.date(joining), style: const TextStyle(fontWeight: FontWeight.w500))),
        if (remark.isNotEmpty) block('Remark', Text(remark)),
      ],
    );
  }
}

enum UsernameStatus { idle, checking, available, taken, short, unknown }

class UsernameStatusLine extends StatelessWidget {
  const UsernameStatusLine(this.status, {super.key});
  final UsernameStatus status;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    if (status == UsernameStatus.idle) return const SizedBox.shrink();
    final (String text, Color color, IconData? icon) = switch (status) {
      UsernameStatus.checking => ('Checking…', s.onSurfaceVariant, null),
      UsernameStatus.available => ('Username available', AppColors.readable(context, AppColors.ok), Icons.check_circle_rounded),
      UsernameStatus.taken => ('Username already taken', s.error, Icons.cancel_rounded),
      UsernameStatus.short => ('Min. 3 characters', s.onSurfaceVariant, null),
      _ => ("Couldn't check availability", s.onSurfaceVariant, null),
    };
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        children: [
          if (status == UsernameStatus.checking)
            const Padding(
              padding: EdgeInsets.only(right: 6),
              child: SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2)),
            )
          else if (icon != null)
            Padding(padding: const EdgeInsets.only(right: 6), child: Icon(icon, size: 15, color: color)),
          Flexible(child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color))),
        ],
      ),
    );
  }
}

/// Password box with a show/hide eye and an inline error.
class PasswordInput extends StatefulWidget {
  const PasswordInput({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.errorText,
    this.onChanged,
    this.textInputAction,
    this.autofillHints,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final String? errorText;
  final ValueChanged<String>? onChanged;
  final TextInputAction? textInputAction;
  final Iterable<String>? autofillHints;

  @override
  State<PasswordInput> createState() => _PasswordInputState();
}

class _PasswordInputState extends State<PasswordInput> {
  bool _show = false;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        FieldLabel(widget.label, required: true),
        const SizedBox(height: 6),
        TextField(
          controller: widget.controller,
          obscureText: !_show,
          enableSuggestions: false,
          autocorrect: false,
          onChanged: widget.onChanged,
          textInputAction: widget.textInputAction,
          autofillHints: widget.autofillHints,
          decoration: InputDecoration(
            hintText: widget.hint,
            errorText: widget.errorText,
            errorMaxLines: 3,
            suffixIcon: IconButton(
              tooltip: _show ? 'Hide password' : 'Show password',
              icon: Icon(_show ? Icons.visibility_off_outlined : Icons.visibility_outlined, size: 20),
              onPressed: () => setState(() => _show = !_show),
            ),
          ),
        ),
      ],
    );
  }
}

/// "8+ characters / uppercase / lowercase / number / matches" ticks.
class PasswordChecklist extends StatelessWidget {
  const PasswordChecklist({super.key, required this.password, required this.confirm});
  final String password;
  final String confirm;

  @override
  Widget build(BuildContext context) {
    final c = PasswordChecks.of(password);
    return Wrap(
      spacing: 14,
      runSpacing: 4,
      children: [
        _Tick('8+ characters', c.length),
        _Tick('Uppercase letter', c.upper),
        _Tick('Lowercase letter', c.lower),
        _Tick('Number', c.digit),
        if (confirm.isNotEmpty) _Tick('Passwords match', password == confirm),
      ],
    );
  }
}

class _Tick extends StatelessWidget {
  const _Tick(this.text, this.ok);
  final String text;
  final bool ok;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final color = ok ? AppColors.readable(context, AppColors.ok) : s.onSurfaceVariant;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(ok ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded, size: 15, color: color),
        const SizedBox(width: 5),
        Flexible(child: Text(text, style: TextStyle(fontSize: 12, color: color, fontWeight: ok ? FontWeight.w600 : FontWeight.w400))),
      ],
    );
  }
}
