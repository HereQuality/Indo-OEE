import 'package:flutter/foundation.dart' show ValueListenable;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/theme/app_colors.dart';
import '../../entry_form/entry_layout.dart';
import '../../entry_form/entry_style.dart';

// The web's `FormLine optional` (Components/Production/FormLine.jsx): a section
// that starts folded to one slim row ("Optional — tap to add") so the form looks
// short, and opens by itself when it already holds something (editing an entry),
// when it has an error after Save, or when `openByDefault` says it needs typing.
// Its boxes stay built while folded, so nothing typed is lost and Save can still
// point at one of them.
//
// The Status list's "Remarks" tick asks the Remarks section to open and take the
// cursor — the web's `entry:open-remarks` event; here a per-block signal.

final Map<int, ValueNotifier<int>> _remarksSignals = {};

/// The "open the Remarks section" request of form block [index].
ValueNotifier<int> remarksOpenSignal(int index) => _remarksSignals.putIfAbsent(index, () => ValueNotifier<int>(0));

/// Asks block [index]'s Remarks section to open (and then take the cursor).
void requestOpenRemarks(int index) => remarksOpenSignal(index).value++;

/// The words in a folded section's header, as the web's FormLine words them.
String foldHeaderNote({required bool shown, required bool hasValue, String summary = ''}) =>
    shown ? (hasValue ? 'Filled in' : '') : (summary.isNotEmpty ? summary : (hasValue ? 'Filled in' : 'Optional — tap to add'));

class PowderFoldCard extends StatefulWidget {
  const PowderFoldCard({
    super.key,
    required this.id,
    required this.index,
    required this.title,
    required this.icon,
    required this.hasError,
    required this.hasValue,
    required this.children,
    this.openByDefault = false,
    this.summary = '',
    this.openSignal,
    this.onSignalOpened,
  });

  /// Short name for keys (`entry<index>/fold/<id>`).
  final String id;
  final int index;
  final String title;
  final IconData icon;

  /// Save was pressed and a box inside needs attention: opens the section.
  final bool hasError;

  /// A box inside already holds something (web `hasValue`).
  final bool hasValue;
  final bool openByDefault;

  /// Shown on the folded header instead of "Optional — tap to add".
  final String summary;
  final List<Widget> children;

  /// A request to open this section (the Remarks one), and what to do once it is open.
  final ValueListenable<int>? openSignal;
  final VoidCallback? onSignalOpened;

  @override
  State<PowderFoldCard> createState() => _PowderFoldCardState();
}

class _PowderFoldCardState extends State<PowderFoldCard> {
  late bool _open = widget.hasValue || widget.openByDefault;

  bool get _shown => _open || widget.hasError;

  @override
  void initState() {
    super.initState();
    widget.openSignal?.addListener(_onSignal);
  }

  @override
  void didUpdateWidget(PowderFoldCard old) {
    super.didUpdateWidget(old);
    if (old.openSignal != widget.openSignal) {
      old.openSignal?.removeListener(_onSignal);
      widget.openSignal?.addListener(_onSignal);
    }
    // The web's effect: opens when one of these turns on, and leaves it to the
    // person afterwards.
    final turnedOn = (widget.hasValue && !old.hasValue) ||
        (widget.openByDefault && !old.openByDefault) ||
        (widget.hasError && !old.hasError);
    if (turnedOn) _open = true;
  }

  @override
  void dispose() {
    widget.openSignal?.removeListener(_onSignal);
    super.dispose();
  }

  void _onSignal() {
    if (!mounted) return;
    setState(() => _open = true);
    // Once the section is on screen, the cursor goes in.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onSignalOpened?.call();
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final dark = s.brightness == Brightness.dark;
    final shown = _shown;
    final note = widget.hasError ? '' : foldHeaderNote(shown: shown, hasValue: widget.hasValue, summary: widget.summary);
    return Card(
      elevation: dark ? 0 : 1,
      shadowColor: s.shadow.withValues(alpha: 0.12),
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: widget.hasError ? s.error : s.outlineVariant, width: widget.hasError ? 1.4 : 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            key: ValueKey('entry${widget.index}/fold/${widget.id}'),
            onTap: () {
              HapticFeedback.selectionClick();
              setState(() => _open = !shown);
            },
            child: Semantics(
              button: true,
              expanded: shown,
              child: Padding(
                padding: const EdgeInsets.all(EntryStyle.cardPadding),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Container(
                      width: 26,
                      height: 26,
                      decoration: BoxDecoration(color: s.primary.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
                      child: Icon(widget.icon, size: 15, color: AppColors.readable(context, s.primary)),
                    ),
                    const SizedBox(width: 8),
                    // The title, and under it (so a 360 px screen at large text never
                    // overflows) "Check this line" / "Optional — tap to add" / "Filled in".
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Semantics(
                            header: true,
                            child: Text(widget.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, height: 1.25)),
                          ),
                          if (widget.hasError)
                            const Padding(padding: EdgeInsets.only(top: 4), child: EntryBadge('Check this line'))
                          else if (note.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 1),
                              child: Text(
                                note,
                                key: ValueKey('entry${widget.index}/fold/${widget.id}/note'),
                                style: TextStyle(fontSize: 12, height: 1.25, color: s.onSurfaceVariant),
                              ),
                            ),
                        ],
                      ),
                    ),
                    AnimatedRotation(
                      turns: shown ? 0.5 : 0,
                      duration: const Duration(milliseconds: 150),
                      child: Icon(Icons.expand_more_rounded, size: 20, color: s.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // Built while folded (maintainState) so a failed Save can still find a box.
          Visibility(
            visible: shown,
            maintainState: true,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(EntryStyle.cardPadding, 0, EntryStyle.cardPadding, EntryStyle.cardPadding),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: widget.children),
            ),
          ),
        ],
      ),
    );
  }
}
