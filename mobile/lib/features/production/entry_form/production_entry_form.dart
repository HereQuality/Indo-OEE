import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'entry_block.dart';

/// The Production Data Entry form (port of ProductionEntryForm.jsx): one block
/// per machine, each behind its own "+". A block starts as just a machine picker
/// and that "+"; pressing it opens that machine's whole sheet — every line, in
/// the web's order, each a card. Only one block is open at a time (opening one
/// collapses the other, keeping what was typed). "Add another machine" appends
/// and opens a further block. Editing shows a single block, already open, with
/// the machine locked.
///
/// The page owns the data: [entries] are the JS-shaped form values (typed
/// fields are Strings; `rejectBreakdown` a Map; `excludedOps` a List), [errors]
/// is validateEntry()'s output per block and every edit goes out through the
/// callbacks. Errors show only once [isSubmit] is true. A failed Save hands
/// [focusTarget] `{index, field, nonce}`: a new nonce opens that block, scrolls
/// the field into view and focuses it.
///
/// The widget is a plain Column (no scrolling of its own) meant to sit inside
/// the caller's scroll view, capped to 960 px wide (two columns of cards from 700 px).
class ProductionEntryForm extends StatefulWidget {
  const ProductionEntryForm({
    super.key,
    required this.entries,
    required this.errors,
    required this.isSubmit,
    this.focusTarget,
    required this.machines,
    required this.items,
    required this.operators,
    this.isEdit = false,
    required this.onChange,
    required this.onItemSelect,
    required this.onRejectChange,
    required this.onAdd,
    required this.onRemove,
  });

  final List<Map<String, dynamic>> entries;
  final List<Map<String, String>> errors;
  final bool isSubmit;
  final Map<String, dynamic>? focusTarget;
  final List<Map<String, dynamic>> machines;
  final List<Map<String, dynamic>> items;
  final List<Map<String, dynamic>> operators;
  final bool isEdit;
  final void Function(int index, String name, dynamic value) onChange;
  final void Function(int index, String itemId) onItemSelect;
  final void Function(int index, String reason, dynamic value) onRejectChange;
  final VoidCallback onAdd;
  final void Function(int index) onRemove;

  @override
  State<ProductionEntryForm> createState() => _ProductionEntryFormState();
}

class _ProductionEntryFormState extends State<ProductionEntryForm> {
  /// Longest a block takes to open or collapse (its AnimatedSize), so scrolling
  /// waits until the layout above it has settled.
  static const Duration _settle = Duration(milliseconds: 280);

  int? _expanded;
  final List<GlobalKey<EntryBlockState>> _blockKeys = [];
  Object? _handledNonce;
  Timer? _timer;
  int _token = 0;

  @override
  void initState() {
    super.initState();
    _expanded = widget.isEdit ? 0 : null;
    _syncFocusTarget();
  }

  @override
  void didUpdateWidget(ProductionEntryForm old) {
    super.didUpdateWidget(old);
    _syncFocusTarget();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  // ── focus target ──────────────────────────────────────────────────────────

  // A failed Save hands over the first incomplete block and field. Open that
  // block, then scroll to the field once it has been built (a collapsed block
  // only builds its fields after opening) and put the cursor in it.
  void _syncFocusTarget() {
    final t = widget.focusTarget;
    if (t == null) {
      _handledNonce = null;
      return;
    }
    final nonce = t['nonce'] ?? 0;
    if (_handledNonce != null && _handledNonce == nonce) return;
    _handledNonce = nonce;

    final index = (t['index'] as num?)?.toInt();
    final field = t['field']?.toString();
    if (index == null || field == null || index < 0 || index >= widget.entries.length) return;

    var wait = Duration.zero;
    if (!widget.isEdit && _expanded != index) {
      _expanded = index; // build follows this update
      wait = _settle;
    }
    _scrollToField(index, field, wait);
  }

  void _scrollToField(int index, String field, Duration wait) {
    final token = ++_token;
    _timer?.cancel();
    var tries = 0;
    void attempt() {
      if (!mounted || token != _token) return;
      final block = index < _blockKeys.length ? _blockKeys[index].currentState : null;
      final ctx = block?.contextFor(field);
      if (block == null || ctx == null || !ctx.mounted) {
        // Not built yet — try again shortly, like the web's requestAnimationFrame loop.
        if (++tries < 30) _timer = Timer(const Duration(milliseconds: 50), attempt);
        return;
      }
      Scrollable.ensureVisible(
        ctx,
        alignment: 0.25,
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
      ).then((_) {
        if (!mounted || token != _token) return;
        block.focusField(field);
      });
    }

    _timer = Timer(wait, attempt);
  }

  // ── accordion ─────────────────────────────────────────────────────────────

  void _setExpanded(int? index) {
    if (widget.isEdit) return;
    final previous = _expanded;
    if (index == previous) return;
    HapticFeedback.selectionClick();
    setState(() => _expanded = index);
    // Opening scrolls to the block just opened; collapsing back to none scrolls
    // to whichever block was just closed.
    _scrollToBlock(index ?? previous);
  }

  void _scrollToBlock(int? index) {
    if (index == null) return;
    final token = ++_token;
    _timer?.cancel();
    _timer = Timer(_settle, () {
      if (!mounted || token != _token) return;
      final ctx = index < _blockKeys.length ? _blockKeys[index].currentContext : null;
      if (ctx == null || !ctx.mounted) return;
      Scrollable.ensureVisible(
        ctx,
        alignment: 0.04,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOutCubic,
      );
    });
  }

  void _add() {
    HapticFeedback.lightImpact();
    final next = widget.entries.length;
    setState(() => _expanded = next);
    widget.onAdd();
    _scrollToBlock(next);
  }

  void _remove(int index) {
    setState(() {
      final open = _expanded;
      if (open == index) {
        _expanded = null;
      } else if (open != null && open > index) {
        _expanded = open - 1;
      }
    });
    widget.onRemove(index);
  }

  @override
  Widget build(BuildContext context) {
    final entries = widget.entries;
    while (_blockKeys.length < entries.length) {
      _blockKeys.add(GlobalKey<EntryBlockState>(debugLabel: 'entry-block-${_blockKeys.length}'));
    }
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 960),
        // A tap on empty space (between fields) puts the keyboard away — the
        // number pad has no Done key on iOS. Taps on a field or button are won
        // by that widget, so this never steals them.
        child: GestureDetector(
          behavior: HitTestBehavior.translucent,
          onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < entries.length; i++) ...[
                if (i > 0) const SizedBox(height: 8),
                EntryBlock(
                  key: _blockKeys[i],
                  index: i,
                  values: entries[i],
                  errors: i < widget.errors.length ? widget.errors[i] : const <String, String>{},
                  isSubmit: widget.isSubmit,
                  machines: widget.machines,
                  items: widget.items,
                  operators: widget.operators,
                  isEdit: widget.isEdit,
                  canRemove: !widget.isEdit && entries.length > 1,
                  expanded: widget.isEdit || _expanded == i,
                  onExpand: _setExpanded,
                  onChange: (index, name, value) => widget.onChange(index, name, value),
                  onItemSelect: (index, itemId) => widget.onItemSelect(index, itemId),
                  onRejectChange: (index, reason, value) => widget.onRejectChange(index, reason, value),
                  onRemove: _remove,
                ),
              ],
              if (!widget.isEdit) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  key: const ValueKey('entry-add'),
                  onPressed: _add,
                  style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
                  icon: const Icon(Icons.add_rounded, size: 20),
                  label: const Text('Add another machine'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
