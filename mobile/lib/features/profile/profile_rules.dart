import 'package:flutter/services.dart';

/// The rules of client/src/pages/Profile.jsx (and server/controllers/profile.controller.js),
/// kept free of widgets so they can be unit-tested.

/// Profile pictures larger than this are rejected (web + multer both use 2 MB).
const int maxProfilePicBytes = 2 * 1024 * 1024;

String? photoSizeError(int bytes) => bytes > maxProfilePicBytes ? 'Profile picture must be less than 2MB' : null;

/// Username input: only lowercase letters, numbers, `_`, `@`, `-`.
String normalizeUsername(String v) => v.toLowerCase().replaceAll(RegExp(r'[^a-z0-9_@-]'), '');

/// Mobile number input: digits only, at most 10.
String normalizeMobile(String v) {
  final d = v.replaceAll(RegExp(r'[^0-9]'), '');
  return d.length > 10 ? d.substring(0, 10) : d;
}

class UsernameFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final t = normalizeUsername(newValue.text);
    if (t == newValue.text) return newValue;
    final offset = normalizeUsername(newValue.text.substring(0, newValue.selection.baseOffset.clamp(0, newValue.text.length))).length;
    return TextEditingValue(text: t, selection: TextSelection.collapsed(offset: offset.clamp(0, t.length)));
  }
}

class MobileFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final t = normalizeMobile(newValue.text);
    if (t == newValue.text) return newValue;
    return TextEditingValue(text: t, selection: TextSelection.collapsed(offset: t.length));
  }
}

/// Live strength hints under "New password".
class PasswordChecks {
  const PasswordChecks({required this.length, required this.upper, required this.lower, required this.digit});
  final bool length;
  final bool upper;
  final bool lower;
  final bool digit;

  bool get ok => length && upper && lower && digit;

  factory PasswordChecks.of(String p) => PasswordChecks(
        length: p.length >= 8,
        upper: RegExp(r'[A-Z]').hasMatch(p),
        lower: RegExp(r'[a-z]').hasMatch(p),
        digit: RegExp(r'\d').hasMatch(p),
      );
}

enum PasswordField { current, newPassword, confirm }

class PasswordProblem {
  const PasswordProblem(this.field, this.message);
  final PasswordField field;
  final String message;
}

/// The web's submit-time checks, in the web's order (messages verbatim).
PasswordProblem? passwordProblem({required String current, required String next, required String confirm}) {
  if (current.isEmpty) return const PasswordProblem(PasswordField.current, 'Current password is required.');
  if (next != confirm) {
    return const PasswordProblem(PasswordField.confirm, "New password and confirmation don't match.");
  }
  if (next.length < 8) {
    return const PasswordProblem(PasswordField.newPassword, 'New password must be at least 8 characters.');
  }
  if (!PasswordChecks.of(next).ok) {
    return const PasswordProblem(
      PasswordField.newPassword,
      'Password must contain at least one uppercase letter, one lowercase letter, and one number.',
    );
  }
  return null;
}

/// Content type for the multipart part (multer only accepts `image/*`).
({String type, String subtype}) imageMime(String? mime, String filename) {
  final m = (mime ?? '').toLowerCase();
  if (m.startsWith('image/') && m.length > 6) return (type: 'image', subtype: m.substring(6));
  final ext = filename.contains('.') ? filename.split('.').last.toLowerCase() : '';
  return switch (ext) {
    'png' => (type: 'image', subtype: 'png'),
    'gif' => (type: 'image', subtype: 'gif'),
    'webp' => (type: 'image', subtype: 'webp'),
    'heic' => (type: 'image', subtype: 'heic'),
    _ => (type: 'image', subtype: 'jpeg'),
  };
}

/// multer names the stored file after the extension, so make sure there is one.
String uploadFilename(String name, String subtype) {
  final n = name.trim().isEmpty ? 'profile' : name.trim();
  if (n.contains('.')) return n;
  return '$n.${subtype == 'jpeg' ? 'jpg' : subtype}';
}
