import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Labelled, compact (~40 px) text input used by the profile / support forms.
/// Unlike the shared AppTextField it exposes autocorrect / suggestions /
/// scrollPadding, so codes, usernames and passwords get the right keyboard and
/// the focused box always scrolls clear of the keyboard and the sticky bar.
class CompactField extends StatelessWidget {
  const CompactField({
    super.key,
    required this.label,
    this.controller,
    this.initialValue,
    this.hint,
    this.helper,
    this.validator,
    this.keyboardType,
    this.textInputAction,
    this.obscureText = false,
    this.maxLines = 1,
    this.minLines,
    this.enabled = true,
    this.required = false,
    this.suffix,
    this.onChanged,
    this.onSubmitted,
    this.inputFormatters,
    this.maxLength,
    this.autofillHints,
    this.textCapitalization = TextCapitalization.none,
    this.autocorrect = true,
    this.enableSuggestions = true,
    this.errorText,
  });

  final String label;
  final TextEditingController? controller;
  final String? initialValue;
  final String? hint;
  final String? helper;
  final String? Function(String?)? validator;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final bool obscureText;
  final int? maxLines;
  final int? minLines;
  final bool enabled;
  final bool required;
  final Widget? suffix;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final List<TextInputFormatter>? inputFormatters;
  final int? maxLength;
  final Iterable<String>? autofillHints;
  final TextCapitalization textCapitalization;
  final bool autocorrect;
  final bool enableSuggestions;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text.rich(
          TextSpan(
            text: label,
            style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: s.onSurface),
            children: [if (required) TextSpan(text: ' *', style: TextStyle(color: s.error))],
          ),
        ),
        const SizedBox(height: 4),
        TextFormField(
          controller: controller,
          initialValue: controller == null ? initialValue : null,
          validator: validator ?? (required ? (v) => (v == null || v.trim().isEmpty) ? '$label is required' : null : null),
          keyboardType: keyboardType,
          textInputAction: textInputAction,
          obscureText: obscureText,
          maxLines: obscureText ? 1 : maxLines,
          minLines: obscureText ? null : minLines,
          enabled: enabled,
          onChanged: onChanged,
          onFieldSubmitted: onSubmitted,
          inputFormatters: inputFormatters,
          maxLength: maxLength,
          textCapitalization: textCapitalization,
          autofillHints: autofillHints,
          autocorrect: autocorrect,
          enableSuggestions: enableSuggestions,
          scrollPadding: const EdgeInsets.fromLTRB(20, 20, 20, 140),
          style: const TextStyle(fontSize: 14),
          autovalidateMode: AutovalidateMode.onUserInteraction,
          forceErrorText: errorText,
          decoration: InputDecoration(
            hintText: hint,
            helperText: helper,
            helperMaxLines: 3,
            errorMaxLines: 3,
            suffixIcon: suffix,
            suffixIconConstraints: const BoxConstraints(minWidth: 40, minHeight: 40),
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            counterText: '',
          ),
        ),
      ],
    );
  }
}

/// Compact panel: title row + child, 12 px padding, 12 px radius (the shared
/// SectionCard is 16 px padded, which read as bulky on a phone).
class CompactCard extends StatelessWidget {
  const CompactCard({super.key, this.title, this.trailing, required this.child, this.padding = const EdgeInsets.all(12)});
  final String? title;
  final Widget? trailing;
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: s.outlineVariant)),
      child: Padding(
        padding: padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (title != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  children: [
                    Expanded(child: Text(title!, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700))),
                    ?trailing,
                  ],
                ),
              ),
            child,
          ],
        ),
      ),
    );
  }
}

/// Tapping empty space closes the keyboard. Taps on buttons / fields inside are
/// unaffected (the innermost recogniser wins the gesture arena).
class TapToDismiss extends StatelessWidget {
  const TapToDismiss({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: () {
          final f = FocusManager.instance.primaryFocus;
          if (f != null && f.hasFocus) f.unfocus();
        },
        child: child,
      );
}

/// Compact pill (status / priority / platform / role): 11.5 px text, 8x3 padding.
class MiniPill extends StatelessWidget {
  const MiniPill(this.label, {super.key, required this.color, required this.fg, this.icon});
  final String label;
  final Color color;
  final Color fg;
  final IconData? icon;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(999)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[Icon(icon, size: 12, color: fg), const SizedBox(width: 3)],
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: fg),
              ),
            ),
          ],
        ),
      );
}
