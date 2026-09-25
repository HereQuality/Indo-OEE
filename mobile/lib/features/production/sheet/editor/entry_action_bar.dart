import 'package:flutter/material.dart';

/// The sticky bottom bar of the entry editor: an optional message, Cancel and
/// Save / Update.
///
/// While the entries are incomplete Save only LOOKS inactive (like the web
/// footers' `isSaveBlocked`) — it stays pressable, and pressing it makes the
/// editor jump to the first incomplete field.
class EntryActionBar extends StatelessWidget {
  const EntryActionBar({
    super.key,
    required this.isEdit,
    required this.entryCount,
    required this.canSave,
    required this.saving,
    required this.savingIndex,
    required this.onSave,
    required this.onCancel,
    this.incompleteMessage,
    this.errorMessage,
  });

  final bool isEdit;
  final int entryCount;
  final bool canSave;
  final bool saving;

  /// 0-based block being saved right now (for "Saving 2 of 3…").
  final int savingIndex;

  /// "N of M entries are incomplete…", shown after a failed press of Save.
  final String? incompleteMessage;

  /// The server's reason the last save failed.
  final String? errorMessage;

  final VoidCallback onSave;
  final VoidCallback onCancel;

  static const inactiveHint = 'Fill in the required fields (marked *) first';

  String get _label {
    if (saving) {
      if (entryCount > 1) return 'Saving ${savingIndex + 1} of $entryCount…';
      return isEdit ? 'Updating…' : 'Saving…';
    }
    if (isEdit) return 'Update';
    return entryCount > 1 ? 'Save $entryCount entries' : 'Save';
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final inactive = !canSave && !saving;

    final saveButton = FilledButton(
      onPressed: saving ? null : onSave,
      style: FilledButton.styleFrom(
        backgroundColor: inactive ? Color.alphaBlend(cs.onSurface.withValues(alpha: 0.10), cs.surface) : null,
        foregroundColor: inactive ? cs.onSurface.withValues(alpha: 0.62) : null,
        // While saving the button keeps its brand colour (with a spinner) instead of greying out.
        disabledBackgroundColor: cs.primary.withValues(alpha: 0.8),
        disabledForegroundColor: cs.onPrimary,
        elevation: 0,
        minimumSize: const Size(64, 48),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (saving) ...[
            SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2.4, color: cs.onPrimary),
            ),
            const SizedBox(width: 10),
          ],
          Flexible(child: Text(_label, maxLines: 1, overflow: TextOverflow.ellipsis)),
        ],
      ),
    );

    return DecoratedBox(
      decoration: BoxDecoration(
        color: cs.surface,
        border: Border(top: BorderSide(color: cs.outlineVariant)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: isDark ? 0.35 : 0.08),
            blurRadius: 12,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Center(
          heightFactor: 1,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (errorMessage != null) _Notice(message: errorMessage!, icon: Icons.error_outline_rounded),
                  if (incompleteMessage != null && errorMessage == null)
                    _Notice(message: incompleteMessage!, icon: Icons.info_outline_rounded),
                  Row(
                    children: [
                      TextButton(onPressed: saving ? null : onCancel, child: const Text('Cancel')),
                      const SizedBox(width: 8),
                      Expanded(
                        child: inactive
                            ? Tooltip(message: inactiveHint, triggerMode: TooltipTriggerMode.longPress, child: saveButton)
                            : saveButton,
                      ),
                    ],
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

class _Notice extends StatelessWidget {
  const _Notice({required this.message, required this.icon});
  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: cs.error.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: cs.error.withValues(alpha: 0.35)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 1),
              child: Icon(icon, size: 18, color: cs.error),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                message,
                maxLines: 5,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 13, height: 1.3, color: cs.onSurface),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
