/// Form field validators — each returns an error string or null.
class Validators {
  Validators._();

  static String? Function(String?) required([String label = 'This field']) =>
      (v) => (v == null || v.trim().isEmpty) ? '$label is required' : null;

  static String? email(String? v, {bool required = false}) {
    final s = (v ?? '').trim();
    if (s.isEmpty) return required ? 'Email is required' : null;
    return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(s) ? null : 'Enter a valid email';
  }

  static String? phone(String? v, {bool required = false}) {
    final s = (v ?? '').trim();
    if (s.isEmpty) return required ? 'Mobile number is required' : null;
    return RegExp(r'^[0-9+\-\s()]{7,15}$').hasMatch(s) ? null : 'Enter a valid mobile number';
  }

  static String? Function(String?) number({
    String label = 'Value',
    num? min,
    num? max,
    bool required = true,
    bool integer = false,
  }) =>
      (v) {
        final s = (v ?? '').trim();
        if (s.isEmpty) return required ? '$label is required' : null;
        final n = num.tryParse(s);
        if (n == null) return '$label must be a number';
        if (integer && n != n.roundToDouble()) return '$label must be a whole number';
        if (min != null && n < min) return '$label must be at least $min';
        if (max != null && n > max) return '$label must be at most $max';
        return null;
      };

  static String? Function(String?) minLength(int n, [String label = 'This field']) =>
      (v) => (v ?? '').length < n ? '$label must be at least $n characters' : null;
}
