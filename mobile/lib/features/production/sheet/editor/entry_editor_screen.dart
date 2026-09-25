import 'dart:async';

import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/api/api_client.dart';
import '../../../../core/api/endpoints.dart';
import '../../../../core/utils/alerts.dart';
import '../../../../core/widgets/states.dart';
import '../../entry_form/production_entry_form.dart';
import '../../shared/production_entry_validation.dart';
import 'entry_action_bar.dart';
import 'entry_draft_store.dart';
import 'entry_editor_logic.dart';

/// Full-screen add / edit route of a Production Data Entry (port of the entry
/// modal in client/src/pages/ProductionSheet.jsx). It hosts the
/// [ProductionEntryForm] and owns every bit of state and save logic: the
/// blocks, the live per-block validation, item copy, sequential saves with
/// partial-failure handling, and the add-mode draft.
///
/// Push it with `MaterialPageRoute<bool>`; it pops with `true` when anything
/// was saved (also after a partial save when the user leaves). It loads
/// nothing itself — the machines / items / operators come from the caller.
class EntryEditorScreen extends StatefulWidget {
  const EntryEditorScreen({
    super.key,
    this.row,
    this.initialMachineId,
    required this.machines,
    required this.items,
    required this.operators,
  });

  /// The saved record to edit; null = add a new entry.
  final Map<String, dynamic>? row;

  /// Machine to pre-select when adding.
  final String? initialMachineId;

  /// Selectable machines, already scoped to the process, in sheet order.
  final List<Map<String, dynamic>> machines;
  final List<Map<String, dynamic>> items;
  final List<Map<String, dynamic>> operators;

  @override
  State<EntryEditorScreen> createState() => _EntryEditorScreenState();
}

class _EntryEditorScreenState extends State<EntryEditorScreen> {
  static const _equality = DeepCollectionEquality();

  bool get _isEdit => widget.row != null;

  // One map per machine block (immutable updates: a change replaces the block's map).
  late List<Map<String, dynamic>> _entries;
  // What the form held when it opened (fresh, restored draft or the saved record).
  late List<Map<String, dynamic>> _baseline;
  late List<Map<String, dynamic>> _machinesForForm;
  List<Map<String, String>> _errors = const [];

  bool _ready = true; // false while the add-mode draft is being looked up
  bool _draftRestored = false;
  bool _isSubmit = false;
  Map<String, dynamic>? _focusTarget;
  int _nonce = 0;
  // Bumped when the values change behind the form's back (clear, restored,
  // partial save) so its text boxes start again from the new values.
  int _formGeneration = 0;

  bool _saving = false;
  int _savingIndex = 0;
  bool _anySaved = false;
  // After a partial save the blocks still in the form were never saved.
  bool _forceDirty = false;
  String? _saveError;
  // A confirm dialog is up — a second tap on Close / Clear must not stack another.
  bool _dialogOpen = false;

  @override
  void initState() {
    super.initState();
    _machinesForForm = _machinesWithSaved();
    if (_isEdit) {
      _entries = [toFormValues(widget.row!)];
    } else {
      _entries = [_freshEntry()];
      _ready = false;
      unawaited(_restoreDraft());
    }
    _baseline = List.of(_entries);
    _recompute();
  }

  @override
  void didUpdateWidget(EntryEditorScreen old) {
    super.didUpdateWidget(old);
    if (!identical(old.machines, widget.machines)) _machinesForForm = _machinesWithSaved();
  }

  // An edited record's machine may have been deactivated since — keep it in the
  // list (locked in the form) so the field is not blank.
  List<Map<String, dynamic>> _machinesWithSaved() {
    if (!_isEdit) return widget.machines;
    final id = '${widget.row!['machine'] ?? ''}';
    if (id.isEmpty || widget.machines.any((m) => '${m['_id']}' == id)) return widget.machines;
    return [
      ...widget.machines,
      {'_id': id, 'machineName': 'Machine (no longer active)'},
    ];
  }

  Map<String, dynamic> _freshEntry() {
    final e = emptyEntry();
    final id = widget.initialMachineId;
    if (id != null && id.isNotEmpty && widget.machines.any((m) => '${m['_id']}' == id)) e['machine'] = id;
    return e;
  }

  Future<void> _restoreDraft() async {
    final draft = await EntryDraftStore.load();
    if (!mounted) return;
    setState(() {
      if (draft != null) {
        _entries = [for (final d in draft) mergeDraftEntry(d)];
        _baseline = List.of(_entries);
        _draftRestored = true;
        _recompute();
      }
      _ready = true;
    });
  }

  // ── Live validation ──────────────────────────────────────────────────────
  // Every block's problems, worked out live from what's typed — the form shows
  // them once Save has been pressed, and Save itself only looks inactive until
  // there are none.
  void _recompute() {
    _errors = [for (final e in _entries) validateEntry(e)];
  }

  int get _incompleteCount => _errors.where((e) => e.isNotEmpty).length;
  bool get _canSave => _incompleteCount == 0;

  void _apply(List<Map<String, dynamic>> next) {
    setState(() {
      _entries = next;
      _saveError = null;
      _recompute();
    });
  }

  // ── Form callbacks ───────────────────────────────────────────────────────
  void _onChange(int index, String name, dynamic value) {
    if (_saving || index < 0 || index >= _entries.length) return;
    _apply([
      for (var i = 0; i < _entries.length; i++) i == index ? {..._entries[i], name: value} : _entries[i],
    ]);
  }

  void _onRejectChange(int index, String reason, dynamic value) {
    if (_saving || index < 0 || index >= _entries.length) return;
    final current = _entries[index]['rejectBreakdown'];
    _apply([
      for (var i = 0; i < _entries.length; i++)
        i == index
            ? {
                ..._entries[i],
                'rejectBreakdown': <String, dynamic>{if (current is Map) ...Map<String, dynamic>.from(current), reason: value},
              }
            : _entries[i],
    ]);
  }

  void _onItemSelect(int index, String itemId) {
    if (_saving || index < 0 || index >= _entries.length) return;
    _apply([
      for (var i = 0; i < _entries.length; i++)
        i == index ? applyItemSelection(_entries[i], itemId, widget.items) : _entries[i],
    ]);
  }

  void _onAdd() {
    if (_saving) return;
    _apply([..._entries, newBlockAfter(_entries)]);
  }

  void _onRemove(int index) {
    if (_saving || _entries.length <= 1 || index < 0 || index >= _entries.length) return;
    _apply([
      for (var i = 0; i < _entries.length; i++)
        if (i != index) _entries[i],
    ]);
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  Future<void> _save() async {
    if (_saving) return;
    setState(() => _isSubmit = true);

    // Nothing is saved while any block is incomplete — the button only looks
    // inactive so it can still be pressed, and pressing it scrolls to the first
    // incomplete block's first missing field.
    final first = firstError(_errors);
    if (first != null) {
      _haptic(HapticFeedback.selectionClick);
      setState(() => _focusTarget = {'index': first['index'], 'field': first['field'], 'nonce': ++_nonce});
      return;
    }

    FocusManager.instance.primaryFocus?.unfocus();
    final blocks = List<Map<String, dynamic>>.of(_entries);
    setState(() {
      _saving = true;
      _savingIndex = 0;
      _saveError = null;
    });

    // Saved one after another rather than in parallel, so a mid-way failure
    // leaves a clear "saved the first N". Those are dropped from the form as
    // they go, so pressing Save again after fixing the failed one can't add
    // them a second time.
    final saved = <int>{};
    var leaving = false;
    try {
      for (var i = 0; i < blocks.length; i++) {
        if (!mounted) return;
        setState(() => _savingIndex = i);
        await Api.put(Endpoints.productionSheetRow, body: toPayload(blocks[i], isEdit: _isEdit));
        saved.add(i);
      }
      if (!mounted) return;
      _anySaved = true;
      if (!_isEdit) await EntryDraftStore.clear();
      Alerts.success(_isEdit
          ? 'Entry updated successfully!'
          : saved.length == 1
              ? 'Entry added successfully!'
              : '${saved.length} entries added successfully!');
      _haptic(HapticFeedback.mediumImpact);
      if (!mounted) return;
      leaving = true;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      final reason = e is ApiException ? e.message : 'Failed to save. Please try again.';
      _haptic(HapticFeedback.heavyImpact);
      if (saved.isNotEmpty) {
        final message = '${saved.length} saved, then: $reason The rest are still in the form.';
        Alerts.error(message);
        setState(() {
          _anySaved = true;
          _forceDirty = true;
          _entries = [
            for (var i = 0; i < blocks.length; i++)
              if (!saved.contains(i)) blocks[i],
          ];
          _focusTarget = null;
          _formGeneration++;
          _saveError = message;
          _recompute();
        });
      } else {
        Alerts.error(reason);
        setState(() => _saveError = reason);
      }
    } finally {
      // A successful save keeps the "Saving…" state while the screen slides away.
      if (mounted && !leaving) setState(() => _saving = false);
    }
  }

  void _haptic(Future<void> Function() feedback) {
    // Not every platform / test host has a haptic engine.
    unawaited(feedback().catchError((Object _) {}));
  }

  // ── Leaving ──────────────────────────────────────────────────────────────
  bool get _needsConfirm {
    if (!_isEdit && !hasAnyEntryData(_entries)) return false;
    return _forceDirty || !_equality.equals(_entries, _baseline);
  }

  Future<void> _attemptClose() async {
    if (_saving || _dialogOpen) return;
    if (_needsConfirm) {
      _dialogOpen = true;
      final leave = _isEdit
          ? await Alerts.confirm(
              context,
              'Your changes to this entry have not been saved.',
              title: 'Discard changes?',
              confirmText: 'Discard',
              cancelText: 'Keep editing',
            )
          : await Alerts.confirm(
              context,
              'What you have typed is kept as a draft for 1 minute, then discarded.',
              title: 'Leave this entry?',
              confirmText: 'Leave',
              cancelText: 'Keep editing',
              danger: false,
            );
      _dialogOpen = false;
      if (!leave || !mounted) return;
    }
    if (!_isEdit) {
      // Typing survives an accidental close for a minute (see EntryDraftStore).
      if (!hasAnyEntryData(_entries)) {
        await EntryDraftStore.clear();
      } else if (_needsConfirm) {
        await EntryDraftStore.save(_entries);
      }
    }
    if (!mounted) return;
    Navigator.of(context).pop(_anySaved);
  }

  // The "Clear form" button — wipes every block back to blank and drops the
  // saved draft, so a bad start doesn't linger.
  Future<void> _clearForm() async {
    if (_saving || _dialogOpen) return;
    _dialogOpen = true;
    final ok = await Alerts.confirm(
      context,
      "Clear everything typed in this form? This can't be undone.",
      title: 'Clear form',
      confirmText: 'Clear',
    );
    _dialogOpen = false;
    if (!ok || !mounted) return;
    await EntryDraftStore.clear();
    if (!mounted) return;
    setState(() {
      _entries = [emptyEntry()];
      _forceDirty = false;
      _draftRestored = false;
      _focusTarget = null;
      _isSubmit = false;
      _saveError = null;
      _formGeneration++;
      _recompute();
    });
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  String? get _incompleteMessage {
    if (!_isSubmit || _canSave) return null;
    return _entries.length == 1
        ? 'This entry is incomplete — fix the highlighted fields to save.'
        : '$_incompleteCount of ${_entries.length} entries are incomplete — fix the highlighted fields to save.';
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    // With the keyboard up on a short screen the bar would leave the form
    // almost no room — it comes back the moment the keyboard closes.
    final keyboardCrowds = media.viewInsets.bottom > 0 && media.size.height - media.viewInsets.bottom < 480;
    final showClear = !_isEdit && _ready && hasAnyEntryData(_entries);

    return PopScope<Object?>(
      canPop: !_saving && !_anySaved && !_needsConfirm,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_attemptClose());
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(
            tooltip: 'Close',
            icon: const Icon(Icons.close_rounded),
            onPressed: _saving ? null : () => unawaited(_attemptClose()),
          ),
          title: Text(_isEdit ? 'Update Production Entry' : 'Add Production Entry'),
          actions: [
            if (showClear)
              IconButton(
                tooltip: 'Clear form',
                icon: const Icon(Icons.delete_sweep_outlined),
                onPressed: _saving ? null : () => unawaited(_clearForm()),
              ),
            const SizedBox(width: 4),
          ],
        ),
        body: SafeArea(
          top: false,
          child: _ready ? _buildForm(context) : const LoadingView(),
        ),
        bottomNavigationBar: _ready && !keyboardCrowds
            ? EntryActionBar(
                isEdit: _isEdit,
                entryCount: _entries.length,
                canSave: _canSave,
                saving: _saving,
                savingIndex: _savingIndex,
                incompleteMessage: _incompleteMessage,
                errorMessage: _saveError,
                onSave: () => unawaited(_save()),
                onCancel: () => unawaited(_attemptClose()),
              )
            : null,
      ),
    );
  }

  Widget _buildForm(BuildContext context) {
    return SingleChildScrollView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      child: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_draftRestored) _DraftBanner(onStartOver: () => unawaited(_clearForm())),
              // The blocks can't be edited while a save is in flight (their
              // indexes are what is being saved).
              AbsorbPointer(
                absorbing: _saving,
                child: ProductionEntryForm(
                  key: ValueKey(_formGeneration),
                  entries: _entries,
                  errors: _errors,
                  isSubmit: _isSubmit,
                  focusTarget: _focusTarget,
                  machines: _machinesForForm,
                  items: widget.items,
                  operators: widget.operators,
                  isEdit: _isEdit,
                  onChange: _onChange,
                  onItemSelect: _onItemSelect,
                  onRejectChange: _onRejectChange,
                  onAdd: _onAdd,
                  onRemove: _onRemove,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "Restored what you were typing" — shown when the add form opened with a
/// draft saved within the last minute.
class _DraftBanner extends StatelessWidget {
  const _DraftBanner({required this.onStartOver});
  final VoidCallback onStartOver;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(12, 4, 4, 4),
      decoration: BoxDecoration(
        color: cs.primary.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: cs.primary.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          Icon(Icons.history_rounded, size: 20, color: cs.primary),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Restored what you were typing.',
              style: TextStyle(fontSize: 13.5, color: cs.onSurface),
            ),
          ),
          TextButton(onPressed: onStartOver, child: const Text('Start over')),
        ],
      ),
    );
  }
}
