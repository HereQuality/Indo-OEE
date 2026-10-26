import 'dart:async';

import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/api/api_client.dart';
import '../../../../core/utils/alerts.dart';
import '../../../../core/widgets/states.dart';
import '../../entry_form/entry_form_toast.dart';
import '../../entry_form/entry_notice_dialog.dart';
import '../../entry_form/production_entry_form.dart';
import '../../process/process_spec.dart';
import '../../processes/cnc/cnc_spec.dart' show cncSpec;
import '../../shared/limit_notice.dart' show OverLimit, adminReviewNotice;
import '../../shared/planned_shift.dart';
import '../../shared/production_entry_validation.dart';
import '../../shared/production_sheet_calc.dart' show oeeMetricLabels;
import 'entry_action_bar.dart';
import 'entry_draft_store.dart';

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
    this.spec = cncSpec,
    this.extra = const {},
    this.lockedProcess,
    this.processes = const [],
  });

  /// Every Process document (Process Master) — what a spec with
  /// `usesPlannedShiftSetting` reads each machine's Planned Operator Shift from.
  final List<Map<String, dynamic>> processes;

  /// The process whose entry this is: its endpoints, rules, values and form.
  final ProcessSpec spec;

  /// The Process document this page is linked to (Data Entry Page), when
  /// exactly one is — what a spec's `finishPayload` / `unlinkedProcessMessage`
  /// read (Powder Coating sends it as the entry's `process`).
  final Map<String, dynamic>? lockedProcess;

  /// The spec's `extraReference` lists by name (work orders, …).
  final Map<String, List<Map<String, dynamic>>> extra;

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

  static const _saveTimeout = Duration(seconds: 25);

  bool get _isEdit => widget.row != null;

  // One map per machine block (immutable updates: a change replaces the block's map).
  late List<Map<String, dynamic>> _entries;
  // What the form held when it opened (fresh, restored draft or the saved record).
  late List<Map<String, dynamic>> _baseline;
  late List<Map<String, dynamic>> _machinesForForm;
  List<Map<String, String>> _errors = const [];

  // What each machine in the form already has saved on its date (`machine|date`
  // → slots), asked of the server once per pair while the form is open, so an
  // overlapping ON/OFF time is flagged as it is picked. The server refuses one on
  // Save regardless. A failed lookup is retried at most every 15 s.
  final OccupiedTimes _occupied = {};
  final Map<String, DateTime?> _occupiedAsked = {};
  // Likewise what each OPERATOR has saved on a date, on any machine
  // (`operator|date`), so one operator can't be put on two machines at once.
  final OperatorOccupied _operatorOccupied = {};
  final Map<String, DateTime?> _operatorAsked = {};
  static const _occupiedRetry = Duration(seconds: 15);
  static final _isoDay = RegExp(r'^\d{4}-\d{2}-\d{2}$');

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
      _entries = [widget.spec.toFormValues(widget.row!)];
    } else {
      _entries = [_freshEntry()];
      _ready = false;
      unawaited(_restoreDraft());
    }
    _recompute();
    // After the planned-shift defaults a fresh form already holds.
    _baseline = List.of(_entries);
  }

  @override
  void didUpdateWidget(EntryEditorScreen old) {
    super.didUpdateWidget(old);
    if (!identical(old.machines, widget.machines))
      _machinesForForm = _machinesWithSaved();
  }

  // An edited record's machine may have been deactivated since — keep it in the
  // list (locked in the form) so the field is not blank.
  List<Map<String, dynamic>> _machinesWithSaved() {
    if (!_isEdit) return widget.machines;
    final id = '${widget.row!['machine'] ?? ''}';
    if (id.isEmpty || widget.machines.any((m) => '${m['_id']}' == id))
      return widget.machines;
    final noun = widget.spec.machineNoun;
    return [
      ...widget.machines,
      {
        '_id': id,
        'machineName': widget.spec.savedMachineName(widget.row!) ?? '${noun[0].toUpperCase()}${noun.substring(1)} (no longer active)',
      },
    ];
  }

  Map<String, dynamic> _freshEntry() {
    final e = widget.spec.emptyEntry();
    final id = widget.initialMachineId;
    if (id != null &&
        id.isNotEmpty &&
        widget.machines.any((m) => '${m['_id']}' == id))
      e['machine'] = id;
    return e;
  }

  Future<void> _restoreDraft() async {
    final draft = await EntryDraftStore.load(draftKey: widget.spec.draftKey);
    if (!mounted) return;
    setState(() {
      if (draft != null) {
        _entries = [for (final d in draft) widget.spec.mergeDraftEntry(d)];
        _draftRestored = true;
        _recompute();
        _baseline = List.of(_entries);
      }
      _ready = true;
    });
  }

  // ── Live validation ──────────────────────────────────────────────────────
  // Every block's problems, worked out live from what's typed — the form shows
  // them once Save has been pressed, and Save itself only looks inactive until
  // there are none.
  void _recompute() {
    _applyPlannedShifts();
    // An edited row keeps its slot and the times it was loaded with: the row is
    // not "another entry", and an old row that already breaks the time rules
    // stays editable until its times are changed.
    final saved = _savedTimes;
    final overlap = !widget.spec.checksTimeOverlap
        ? [for (final _ in _entries) const <String, String>{}]
        : overlapErrors(
      _entries,
      _occupied,
      editSlot: _editSlot,
      saved: saved,
      words: widget.spec.timeWords,
    );
    // A machine (operator) that already has the most entries that date — the
    // server's own refusal, said on the box (specs with `maxEntriesPerDay`).
    final maxEntries = widget.spec.maxEntriesPerDay;
    final full = maxEntries == null
        ? [for (final _ in _entries) const <String, String>{}]
        : slotsFullErrors(
            _entries,
            _occupied,
            editSlot: _editSlot,
            saved: saved,
            max: maxEntries,
            who: (id) {
              for (final m in _machinesForForm) {
                if ('${m['_id']}' == id) return '${m['machineName'] ?? ''}'.isEmpty ? 'This ${widget.spec.machineNoun}' : '${m['machineName']}';
              }
              return 'This ${widget.spec.machineNoun}';
            },
          );
    final operatorClash = !widget.spec.checksOperatorClash
        ? [for (final _ in _entries) const <String, String>{}]
        : operatorOverlapErrors(
      _entries,
      _operatorOccupied,
      editing: _isEdit
          ? (machine: '${widget.row!['machine']}', slot: _editSlot ?? 0)
          : null,
      saved: saved,
      machineName: (id) {
        for (final m in _machinesForForm) {
          if ('${m['_id']}' == id) return '${m['machineName'] ?? ''}';
        }
        return '';
      },
    );
    _errors = [
      // A block's own problems (blank / invalid / OFF before ON) come first, then a
      // clash with the machine's own entries, then with the operator's other machines.
      for (var i = 0; i < _entries.length; i++)
        {
          ...operatorClash[i],
          ...overlap[i],
          ...full[i],
          ...widget.spec.validateEntry(_entries[i], saved: saved),
        },
    ];
    _askOccupied();
  }

  // ── Planned Operator Shift from Process Master ───────────────────────────
  // (specs with `usesPlannedShiftSetting`; web `plannedLocks` + its effect)

  /// Per block: the setting its machine's process gives (null = typed by hand).
  List<ShiftSetting?> _plannedShifts = const [];

  /// A new entry takes its machine's process's hours — filled into the box here
  /// whenever the machine (or the process list) changes; an edited entry keeps
  /// the shift it was saved with. Either way the box is then read-only
  /// (`shiftLine` shows why) and the server enforces the same on Save.
  void _applyPlannedShifts() {
    if (!widget.spec.usesPlannedShiftSetting) {
      _plannedShifts = const [];
      return;
    }
    _plannedShifts = [
      for (final v in _entries)
        plannedShiftFor(
          machineId: v['machine'],
          machines: widget.machines,
          processes: widget.processes,
          isEdit: _isEdit,
          savedPlanned: _isEdit ? widget.row!['plannedOperatorShiftHours'] : null,
        ),
    ];
    var changed = false;
    final next = [
      for (var i = 0; i < _entries.length; i++)
        () {
          final want = plannedShiftDefault(_plannedShifts[i]);
          if (want == null || _entries[i]['plannedOperatorShiftHours'] == want) return _entries[i];
          changed = true;
          return <String, dynamic>{..._entries[i], 'plannedOperatorShiftHours': want};
        }(),
    ];
    if (changed) _entries = next;
  }

  /// Block [i]'s time-rule problem (OFF not after ON, or an overlap), or null.
  String? _timeProblem(int i) {
    if (i >= _errors.length) return null;
    for (final k in const [
      'machineOnTime',
      'machineOffTime',
      'plannedOperatorShiftHours',
    ]) {
      final m = _errors[i][k];
      if (isTimeRuleMessage(m)) return m;
    }
    return null;
  }

  List<String?> _timeProblems() => [
    for (var i = 0; i < _errors.length; i++) _timeProblem(i),
  ];

  /// Warns the moment a pick creates (or changes) a time-rule problem — not
  /// only when Save is pressed. Nothing repeats while the problem stays as it
  /// was, and typing elsewhere in the block stays quiet.
  void _warnNewTimeProblems(List<String?> before) {
    for (var i = 0; i < _errors.length; i++) {
      final now = _timeProblem(i);
      if (now != null && now != (i < before.length ? before[i] : null))
        EntryFormToast.warn(now);
    }
  }

  int? get _editSlot => _isEdit ? (widget.row!['slot'] as num?)?.toInt() : null;
  Map<String, dynamic>? get _savedTimes => _isEdit
      ? {
          // Date and machine too: moving the row elsewhere is a change (web `saved`).
          'date': widget.row!['date'],
          'machine': widget.row!['machine'],
          'machineOnTime': widget.row!['machineOnTime'],
          'machineOffTime': widget.row!['machineOffTime'],
          'operator': widget.row!['operator'],
        }
      : null;

  void _askOccupied() {
    final now = DateTime.now();
    for (final v in _entries) {
      final machine = '${v['machine'] ?? ''}';
      final date = '${v['date'] ?? ''}';
      if (machine.isEmpty || !_isoDay.hasMatch(date)) continue;
      final key = '$machine|$date';
      if (_occupied.containsKey(key)) continue;
      if (_occupiedAsked.containsKey(key)) {
        final failedAt = _occupiedAsked[key];
        if (failedAt == null || now.difference(failedAt) < _occupiedRetry)
          continue; // in flight, or failed recently
      }
      _occupiedAsked[key] = null;
      unawaited(_loadOccupied(key, machine, date));
    }
    for (final v in _entries) {
      if (!widget.spec.checksOperatorClash) break;
      final op = '${v['operator'] ?? ''}'.trim();
      final date = '${v['date'] ?? ''}';
      if (op.isEmpty || !_isoDay.hasMatch(date)) continue;
      final key = '$op|$date';
      if (_operatorOccupied.containsKey(key)) continue;
      if (_operatorAsked.containsKey(key)) {
        final failedAt = _operatorAsked[key];
        if (failedAt == null || now.difference(failedAt) < _occupiedRetry)
          continue;
      }
      _operatorAsked[key] = null;
      unawaited(_loadOperatorOccupied(key, op, date));
    }
  }

  Future<void> _loadOperatorOccupied(
    String key,
    String operator,
    String date,
  ) async {
    try {
      final res = await Api.get(
        widget.spec.api.occupied,
        query: {'date': date, 'operator': operator},
      );
      if (!mounted) return;
      final before = _timeProblems();
      setState(() {
        _operatorOccupied[key] = asList(res);
        _recompute();
      });
      _warnNewTimeProblems(before);
    } catch (_) {
      // The server still checks on Save; look again in a while.
      _operatorAsked[key] = DateTime.now();
    }
  }

  Future<void> _loadOccupied(String key, String machine, String date) async {
    try {
      final res = await Api.get(
        widget.spec.api.occupied,
        query: {'date': date, widget.spec.api.machineParam: machine},
      );
      if (!mounted) return;
      final before = _timeProblems();
      setState(() {
        _occupied[key] = asList(res);
        _recompute();
      });
      // What is booked arrived after the times were picked: say so now.
      _warnNewTimeProblems(before);
    } catch (_) {
      // The server still checks on Save; look again in a while.
      _occupiedAsked[key] = DateTime.now();
    }
  }

  /// Something may have changed under us (a failed save, a partial save): read
  /// what is booked again.
  void _forgetOccupied() {
    _occupied.clear();
    _occupiedAsked.clear();
    _operatorOccupied.clear();
    _operatorAsked.clear();
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
    final before = _timeProblems();
    _apply([
      for (var i = 0; i < _entries.length; i++)
        i == index ? {..._entries[i], name: value} : _entries[i],
    ]);
    _warnNewTimeProblems(before);
  }

  void _onRejectChange(int index, String reason, dynamic value) {
    if (_saving || index < 0 || index >= _entries.length) return;
    _apply([
      for (var i = 0; i < _entries.length; i++)
        i == index ? widget.spec.applyRejectChange(_entries[i], reason, value) : _entries[i],
    ]);
  }

  void _onItemSelect(int index, String itemId) {
    if (_saving || index < 0 || index >= _entries.length) return;
    _apply([
      for (var i = 0; i < _entries.length; i++)
        i == index
            ? widget.spec.applyItemSelection(_entries[i], itemId, widget.items)
            : _entries[i],
    ]);
  }

  void _onAdd() {
    if (_saving) return;
    _apply([..._entries, widget.spec.newBlockAfter(_entries)]);
  }

  void _onRemove(int index) {
    if (_saving ||
        _entries.length <= 1 ||
        index < 0 ||
        index >= _entries.length)
      return;
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
    final first = widget.spec.firstError(_errors);
    if (first != null) {
      _haptic(HapticFeedback.selectionClick);
      // A quantity or stoppage past what the shift allows pops up why, with the
      // figures, before Save takes the operator to it (web `firstOverLimit`).
      OverLimit? over;
      if (widget.spec.showLimitPopups) {
        over = widget.spec.firstOverLimit(
          _entries,
          _errors,
          machineNames: {
            for (final m in _machinesForForm) '${m['_id']}': '${m['machineName'] ?? ''}',
          },
        );
        if (over != null && mounted) await EntryNotices.show(context, over.notice);
        if (!mounted) return;
      }
      setState(
        () => _focusTarget = {
          'index': over?.index ?? first['index'],
          'field': over?.field ?? first['field'],
          'nonce': ++_nonce,
        },
      );
      return;
    }

    // A new entry belongs to the process this page is linked to; with none (or
    // two) linked in Process Master there's nowhere to save it.
    final unlinked = widget.spec.unlinkedProcessMessage;
    if (unlinked != null && widget.lockedProcess == null) {
      Alerts.error(unlinked);
      return;
    }

    // Optional extra reminder that an entry above 100% goes to Admin review (the
    // web only shows the banner in the form, so a spec has to ask for this).
    if (widget.spec.noticeOnSaveForReview) {
      final labels = <String>{
        for (final e in _entries)
          for (final k in widget.spec.metrics(e).oeeOver100) oeeMetricLabels[k] ?? k,
      };
      if (labels.isNotEmpty && mounted) {
        await EntryNotices.show(context, adminReviewNotice(labels));
        if (!mounted) return;
      }
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
        // The form ignores touches while a save is out, so a stalled connection
        // must give up soon rather than leave it dead for the network's own minute.
        await Api.put(
          widget.spec.api.row,
          body: widget.spec.finishPayload(
            widget.spec.toPayload(blocks[i], isEdit: _isEdit),
            process: widget.lockedProcess,
          ),
        ).timeout(
          _saveTimeout,
          onTimeout: () => throw ApiException(
            'The server took too long to answer. Check your connection and try again.',
          ),
        );
        saved.add(i);
      }
      if (!mounted) return;
      _anySaved = true;
      if (!_isEdit) await EntryDraftStore.clear(draftKey: widget.spec.draftKey);
      Alerts.success(
        _isEdit
            ? 'Entry updated successfully!'
            : saved.length == 1
            ? 'Entry added successfully!'
            : '${saved.length} entries added successfully!',
      );
      _haptic(HapticFeedback.mediumImpact);
      if (!mounted) return;
      leaving = true;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      final reason = e is ApiException
          ? e.message
          : 'Failed to save. Please try again.';
      _haptic(HapticFeedback.heavyImpact);
      _forgetOccupied();
      _askOccupied(); // re-read what is booked right away
      if (saved.isNotEmpty) {
        final message =
            '${saved.length} saved, then: $reason The rest are still in the form.';
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
    if (!_isEdit && !widget.spec.hasAnyEntryData(_entries)) return false;
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
      // A restored draft is re-saved even if untouched (as on the web), so it
      // gets a fresh minute instead of expiring on its old clock.
      if (!widget.spec.hasAnyEntryData(_entries)) {
        await EntryDraftStore.clear(draftKey: widget.spec.draftKey);
      } else if (_needsConfirm || _draftRestored) {
        await EntryDraftStore.save(_entries, draftKey: widget.spec.draftKey);
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
    await EntryDraftStore.clear(draftKey: widget.spec.draftKey);
    if (!mounted) return;
    setState(() {
      _entries = [widget.spec.emptyEntry()];
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
    // While the keyboard is up the save bar would eat the little room the form
    // has left, so it folds away as the keyboard rises (over its first ~100 px,
    // so nothing jumps) and is back the moment the keyboard closes. This
    // context sits above the Scaffold, so it still sees the keyboard's height.
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    final barFactor = (1 - keyboard / 100).clamp(0.0, 1.0);
    final showClear = !_isEdit && _ready && widget.spec.hasAnyEntryData(_entries);

    return PopScope<Object?>(
      canPop: !_saving && !_anySaved && !_needsConfirm,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) unawaited(_attemptClose());
      },
      child: Scaffold(
        resizeToAvoidBottomInset: true,
        appBar: AppBar(
          leading: IconButton(
            tooltip: 'Close',
            icon: const Icon(Icons.close_rounded),
            onPressed: _saving ? null : () => unawaited(_attemptClose()),
          ),
          title: Text(_isEdit ? widget.spec.editTitle : widget.spec.addTitle),
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
        bottomNavigationBar: _ready && barFactor > 0
            ? ClipRect(
                child: Align(
                  alignment: Alignment.topCenter,
                  heightFactor: barFactor,
                  child: EntryActionBar(
                    isEdit: _isEdit,
                    entryCount: _entries.length,
                    canSave: _canSave,
                    saving: _saving,
                    savingIndex: _savingIndex,
                    incompleteMessage: _incompleteMessage,
                    errorMessage: _saveError,
                    onSave: () => unawaited(_save()),
                    onCancel: () => unawaited(_attemptClose()),
                  ),
                ),
              )
            : null,
      ),
    );
  }

  Widget _buildForm(BuildContext context) {
    // A tap on empty space or a drag puts the keyboard away (the number pad has
    // no return key on iOS); taps on a box or button are won by that widget.
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      child: SingleChildScrollView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 960),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_draftRestored)
                  _DraftBanner(onStartOver: () => unawaited(_clearForm())),
                // The blocks can't be edited while a save is in flight (their
                // indexes are what is being saved).
                AbsorbPointer(
                  absorbing: _saving,
                  child: ProductionEntryForm(
                    key: ValueKey(_formGeneration),
                    spec: widget.spec,
                    extra: widget.extra,
                    entries: _entries,
                    errors: _errors,
                    isSubmit: _isSubmit,
                    focusTarget: _focusTarget,
                    machines: _machinesForForm,
                    items: widget.items,
                    operators: widget.operators,
                    plannedShifts: _plannedShifts,
                    isEdit: _isEdit,
                    booked: [
                      for (final e in _entries)
                        bookedRanges(e, _occupied, editSlot: _editSlot, saved: _savedTimes),
                    ],
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
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(10, 0, 2, 0),
      decoration: BoxDecoration(
        color: cs.primary.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: cs.primary.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          Icon(Icons.history_rounded, size: 18, color: cs.primary),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Restored what you were typing.',
              style: TextStyle(fontSize: 13, color: cs.onSurface),
            ),
          ),
          TextButton(onPressed: onStartOver, child: const Text('Start over')),
        ],
      ),
    );
  }
}
