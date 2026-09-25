import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/theme/app_colors.dart';
import 'sheet_style.dart';

const BoxConstraints _sheetWidth = BoxConstraints(maxWidth: 720);

Color _partTone(BuildContext context, String key) => switch (key) {
      'reject' => SheetTones.text(context, SheetTones.reject),
      'downtime' => SheetTones.text(context, SheetTones.downtime),
      _ => Theme.of(context).colorScheme.onSurfaceVariant,
    };

/// The remarks an entry carries, each in its own labelled section with the
/// figure it explains — the phone's version of the web eye popover. [parts] are
/// `remarkParts` items ({key, title, figure, text}); the Remarks column of the
/// web holds only the general one, the eye beside an "Other" figure only its own.
Future<void> showRemarkSheet(BuildContext context, List<Map<String, dynamic>> parts) {
  HapticFeedback.selectionClick();
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    constraints: _sheetWidth,
    builder: (ctx) {
      final s = Theme.of(ctx).colorScheme;
      return SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(ctx).height * 0.8),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 8, 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.visibility_outlined, size: 20, color: s.onSurfaceVariant),
                    const SizedBox(width: 8),
                    const Expanded(child: Text('Remarks', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700))),
                    IconButton(
                      tooltip: 'Close',
                      icon: const Icon(Icons.close_rounded),
                      onPressed: () => Navigator.of(ctx).pop(),
                    ),
                  ],
                ),
                Flexible(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.only(right: 12, bottom: 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (var i = 0; i < parts.length; i++) ...[
                          if (i > 0) Divider(height: 28, color: s.outlineVariant),
                          if (parts.length > 1 || parts[i]['key'] != 'general')
                            Padding(
                              padding: const EdgeInsets.only(bottom: 4),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.baseline,
                                textBaseline: TextBaseline.alphabetic,
                                children: [
                                  Expanded(
                                    child: Text(
                                      '${parts[i]['title']}'.toUpperCase(),
                                      style: TextStyle(
                                        fontSize: 11,
                                        letterSpacing: 0.6,
                                        fontWeight: FontWeight.w800,
                                        color: _partTone(ctx, '${parts[i]['key']}'),
                                      ),
                                    ),
                                  ),
                                  if ('${parts[i]['figure'] ?? ''}'.isNotEmpty)
                                    Text(
                                      '${parts[i]['figure']}',
                                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: s.onSurfaceVariant),
                                    ),
                                ],
                              ),
                            ),
                          SelectableText('${parts[i]['text']}', style: const TextStyle(fontSize: 15, height: 1.4)),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}

/// How a calculated figure is worked out — the phone's version of the eye beside
/// a calculated column header on the web.
Future<void> showFormulaSheet(BuildContext context, {required String title, required String formulaKey}) {
  final text = sheetFormulas[formulaKey];
  if (text == null) return Future.value();
  HapticFeedback.selectionClick();
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    constraints: _sheetWidth,
    builder: (ctx) {
      final s = Theme.of(ctx).colorScheme;
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 8, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.functions_rounded, size: 22, color: AppColors.readable(ctx, s.primary)),
                  const SizedBox(width: 8),
                  Expanded(child: Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))),
                  IconButton(
                    tooltip: 'Close',
                    icon: const Icon(Icons.close_rounded),
                    onPressed: () => Navigator.of(ctx).pop(),
                  ),
                ],
              ),
              Flexible(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.only(right: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'How this is calculated',
                        style: TextStyle(fontSize: 12, color: s.onSurfaceVariant, fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 6),
                      Text(text, style: const TextStyle(fontSize: 15, height: 1.45)),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}
