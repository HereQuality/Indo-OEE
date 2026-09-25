import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../utils/formatters.dart';

/// Labelled text input (label above the box, like the web forms).
class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    required this.label,
    this.controller,
    this.initialValue,
    this.hint,
    this.validator,
    this.keyboardType,
    this.textInputAction,
    this.obscureText = false,
    this.maxLines = 1,
    this.minLines,
    this.enabled = true,
    this.readOnly = false,
    this.required = false,
    this.suffix,
    this.prefix,
    this.onChanged,
    this.onSubmitted,
    this.inputFormatters,
    this.maxLength,
    this.autofocus = false,
    this.helper,
    this.textCapitalization = TextCapitalization.none,
    this.autofillHints,
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
  final bool readOnly;
  final bool required;
  final Widget? suffix;
  final Widget? prefix;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final List<TextInputFormatter>? inputFormatters;
  final int? maxLength;
  final bool autofocus;
  final TextCapitalization textCapitalization;
  final Iterable<String>? autofillHints;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        FieldLabel(label, required: required),
        const SizedBox(height: 6),
        TextFormField(
          controller: controller,
          initialValue: controller == null ? initialValue : null,
          validator: validator ?? (required ? (v) => (v == null || v.trim().isEmpty) ? '$label is required' : null : null),
          keyboardType: keyboardType,
          textInputAction: textInputAction,
          obscureText: obscureText,
          maxLines: obscureText ? 1 : maxLines,
          minLines: minLines,
          enabled: enabled,
          readOnly: readOnly,
          onChanged: onChanged,
          onFieldSubmitted: onSubmitted,
          inputFormatters: inputFormatters,
          maxLength: maxLength,
          autofocus: autofocus,
          textCapitalization: textCapitalization,
          autofillHints: autofillHints,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          decoration: InputDecoration(
            hintText: hint,
            helperText: helper,
            suffixIcon: suffix,
            prefixIcon: prefix,
            counterText: '',
          ),
        ),
      ],
    );
  }
}

/// The small label above a field, with an optional red asterisk.
class FieldLabel extends StatelessWidget {
  const FieldLabel(this.text, {super.key, this.required = false});
  final String text;
  final bool required;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Text.rich(
      TextSpan(
        text: text,
        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: s.onSurface),
        children: [
          if (required) TextSpan(text: ' *', style: TextStyle(color: s.error)),
        ],
      ),
    );
  }
}

/// A picker option.
class PickOption<T> {
  const PickOption(this.value, this.label, {this.subtitle});
  final T value;
  final String label;
  final String? subtitle;
}

/// Searchable single-select bottom sheet. Returns the chosen option's value,
/// or null when dismissed. [allowClear] adds a "None" row that returns
/// [clearValue] (null by default — check [cleared] via the boolean wrapper if
/// you need to tell "dismissed" from "cleared"; use [showPicker] for that).
Future<PickResult<T>?> showPicker<T>(
  BuildContext context, {
  required String title,
  required List<PickOption<T>> options,
  T? selected,
  bool allowClear = false,
  bool searchable = true,
}) {
  return showModalBottomSheet<PickResult<T>>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (ctx) => _PickerSheet<T>(
      title: title,
      options: options,
      selected: selected,
      allowClear: allowClear,
      searchable: searchable,
    ),
  );
}

class PickResult<T> {
  const PickResult(this.value);
  final T? value; // null = cleared
}

class _PickerSheet<T> extends StatefulWidget {
  const _PickerSheet({
    required this.title,
    required this.options,
    required this.selected,
    required this.allowClear,
    required this.searchable,
  });
  final String title;
  final List<PickOption<T>> options;
  final T? selected;
  final bool allowClear;
  final bool searchable;

  @override
  State<_PickerSheet<T>> createState() => _PickerSheetState<T>();
}

class _PickerSheetState<T> extends State<_PickerSheet<T>> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final q = _q.trim().toLowerCase();
    final list = q.isEmpty
        ? widget.options
        : widget.options
            .where((o) => o.label.toLowerCase().contains(q) || (o.subtitle ?? '').toLowerCase().contains(q))
            .toList();
    final maxH = MediaQuery.sizeOf(context).height * 0.85;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: maxH),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Row(
                children: [
                  Expanded(child: Text(widget.title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))),
                  if (widget.allowClear && widget.selected != null)
                    TextButton(onPressed: () => Navigator.pop(context, PickResult<T>(null)), child: const Text('Clear')),
                ],
              ),
            ),
            if (widget.searchable && widget.options.length > 6)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: TextField(
                  autofocus: false,
                  onChanged: (v) => setState(() => _q = v),
                  decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search'),
                ),
              ),
            Flexible(
              child: list.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.all(28),
                      child: Text('No matches', style: TextStyle(color: s.onSurfaceVariant)),
                    )
                  : ListView.builder(
                      shrinkWrap: true,
                      itemCount: list.length,
                      itemBuilder: (_, i) {
                        final o = list[i];
                        final sel = o.value == widget.selected;
                        return ListTile(
                          title: Text(o.label, style: TextStyle(fontWeight: sel ? FontWeight.w700 : FontWeight.w500)),
                          subtitle: o.subtitle == null ? null : Text(o.subtitle!),
                          trailing: sel ? Icon(Icons.check_circle, color: s.primary) : null,
                          onTap: () => Navigator.pop(context, PickResult<T>(o.value)),
                        );
                      },
                    ),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}

/// A form field that looks like a dropdown and opens a searchable sheet.
class AppDropdownField<T> extends FormField<T> {
  AppDropdownField({
    super.key,
    required String label,
    required List<PickOption<T>> options,
    T? value,
    ValueChanged<T?>? onChanged,
    String? hint,
    bool required = false,
    bool allowClear = false,
    bool enabled = true,
    String? Function(T?)? validator,
  }) : super(
          initialValue: value,
          enabled: enabled,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          validator: validator ?? (required ? (v) => v == null ? '$label is required' : null : null),
          builder: (state) {
            final ctx = state.context;
            final s = Theme.of(ctx).colorScheme;
            String? shown;
            for (final o in options) {
              if (o.value == state.value) shown = o.label;
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                FieldLabel(label, required: required),
                const SizedBox(height: 6),
                InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: !enabled
                      ? null
                      : () async {
                          FocusScope.of(ctx).unfocus();
                          final r = await showPicker<T>(
                            ctx,
                            title: label,
                            options: options,
                            selected: state.value,
                            allowClear: allowClear,
                          );
                          if (r != null) {
                            state.didChange(r.value);
                            onChanged?.call(r.value);
                          }
                        },
                  child: InputDecorator(
                    isEmpty: shown == null,
                    decoration: InputDecoration(
                      hintText: hint ?? 'Select',
                      errorText: state.errorText,
                      suffixIcon: const Icon(Icons.keyboard_arrow_down_rounded),
                      enabled: enabled,
                    ),
                    child: Text(
                      shown ?? '',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: enabled ? s.onSurface : s.onSurfaceVariant),
                    ),
                  ),
                ),
              ],
            );
          },
        );
}

/// Date form field (native date picker). Value is a DateTime (date only).
class AppDateField extends FormField<DateTime> {
  AppDateField({
    super.key,
    required String label,
    DateTime? value,
    ValueChanged<DateTime?>? onChanged,
    bool required = false,
    bool enabled = true,
    DateTime? firstDate,
    DateTime? lastDate,
    String? Function(DateTime?)? validator,
  }) : super(
          initialValue: value,
          enabled: enabled,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          validator: validator ?? (required ? (v) => v == null ? '$label is required' : null : null),
          builder: (state) {
            final ctx = state.context;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                FieldLabel(label, required: required),
                const SizedBox(height: 6),
                InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: !enabled
                      ? null
                      : () async {
                          FocusScope.of(ctx).unfocus();
                          final now = DateTime.now();
                          final picked = await showDatePicker(
                            context: ctx,
                            initialDate: state.value ?? now,
                            firstDate: firstDate ?? DateTime(2020),
                            lastDate: lastDate ?? DateTime(now.year + 5),
                          );
                          if (picked != null) {
                            state.didChange(picked);
                            onChanged?.call(picked);
                          }
                        },
                  child: InputDecorator(
                    isEmpty: state.value == null,
                    decoration: InputDecoration(
                      hintText: 'Select date',
                      errorText: state.errorText,
                      suffixIcon: const Icon(Icons.calendar_today_outlined, size: 20),
                      enabled: enabled,
                    ),
                    child: Text(state.value == null ? '' : Fmt.date(state.value)),
                  ),
                ),
              ],
            );
          },
        );
}

/// Time form field (native time picker). Value is "HH:mm" (24h).
class AppTimeField extends FormField<String> {
  AppTimeField({
    super.key,
    required String label,
    String? value,
    ValueChanged<String?>? onChanged,
    bool required = false,
    bool enabled = true,
    String? Function(String?)? validator,
  }) : super(
          initialValue: value,
          enabled: enabled,
          autovalidateMode: AutovalidateMode.onUserInteraction,
          validator: validator ?? (required ? (v) => (v == null || v.isEmpty) ? '$label is required' : null : null),
          builder: (state) {
            final ctx = state.context;
            TimeOfDay initial = TimeOfDay.now();
            final m = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(state.value ?? '');
            if (m != null) initial = TimeOfDay(hour: int.parse(m.group(1)!), minute: int.parse(m.group(2)!));
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                FieldLabel(label, required: required),
                const SizedBox(height: 6),
                InkWell(
                  borderRadius: BorderRadius.circular(12),
                  onTap: !enabled
                      ? null
                      : () async {
                          FocusScope.of(ctx).unfocus();
                          final picked = await showTimePicker(context: ctx, initialTime: initial);
                          if (picked != null) {
                            final hm = '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
                            state.didChange(hm);
                            onChanged?.call(hm);
                          }
                        },
                  child: InputDecorator(
                    isEmpty: (state.value ?? '').isEmpty,
                    decoration: InputDecoration(
                      hintText: 'Select time',
                      errorText: state.errorText,
                      suffixIcon: const Icon(Icons.schedule, size: 20),
                      enabled: enabled,
                    ),
                    child: Text(Fmt.hm12(state.value, empty: '')),
                  ),
                ),
              ],
            );
          },
        );
}

/// Filled primary button that shows a spinner while [loading].
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({super.key, required this.label, required this.onPressed, this.loading = false, this.icon, this.expand = true});
  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final IconData? icon;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final child = loading
        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: 18), const SizedBox(width: 8)],
              Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
            ],
          );
    final btn = FilledButton(onPressed: loading ? null : onPressed, child: child);
    return expand ? SizedBox(width: double.infinity, child: btn) : btn;
  }
}

/// Search box for list screens.
class SearchField extends StatelessWidget {
  const SearchField({super.key, required this.onChanged, this.hint = 'Search', this.controller});
  final ValueChanged<String> onChanged;
  final String hint;
  final TextEditingController? controller;

  @override
  Widget build(BuildContext context) => TextField(
        controller: controller,
        onChanged: onChanged,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          hintText: hint,
          prefixIcon: const Icon(Icons.search),
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        ),
      );
}
