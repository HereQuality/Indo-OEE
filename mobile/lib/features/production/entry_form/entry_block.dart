import 'package:flutter/foundation.dart' show listEquals;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/utils/alerts.dart';
import '../../../core/widgets/form_widgets.dart';
import '../process/process_spec.dart';
import '../shared/planned_shift.dart' show ShiftSetting;
import '../processes/cnc/cnc_spec.dart' show cncSpec;
import '../shared/production_entry_validation.dart' show isTimeRuleMessage;
import 'entry_fields.dart';
import 'entry_form_logic.dart';
import 'entry_form_toast.dart';
import 'entry_layout.dart';
import 'part_options.dart';
import 'entry_line_context.dart';
import 'entry_style.dart';

Object? _snapshot(Object? v) {
  if (v is Map) return {for (final e in v.entries) e.key: _snapshot(e.value)};
  if (v is List) return [for (final e in v) _snapshot(e)];
  return v;
}

bool _same(Object? a, Object? b) {
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final e in a.entries) {
      if (!b.containsKey(e.key) || !_same(e.value, b[e.key])) return false;
    }
    return true;
  }
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!_same(a[i], b[i])) return false;
    }
    return true;
  }
  return a == b;
}

bool _sameRefs(List<Object?> a, List<Object?> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (!identical(a[i], b[i])) return false;
  }
  return true;
}

/// One machine block of the entry form: collapsed (machine picker + "+") or
/// open (the sheet's lines, each a card). Rebuilds only when something it shows
/// changed, so typing in one block never re-lays-out the others.
class EntryBlock extends StatefulWidget {
  const EntryBlock({
    super.key,
    required this.index,
    required this.values,
    required this.errors,
    required this.isSubmit,
    required this.machines,
    required this.items,
    required this.operators,
    required this.isEdit,
    this.booked = const [],
    required this.canRemove,
    required this.expanded,
    required this.onExpand,
    required this.onChange,
    required this.onItemSelect,
    required this.onRejectChange,
    required this.onRemove,
    this.spec = cncSpec,
    this.extra = const {},
    this.takenMachines = const [],
    this.plannedShift,
  });

  /// Process Master's Planned Operator Shift for this block's machine (specs
  /// with `usesPlannedShiftSetting`); null = typed by hand.
  final ShiftSetting? plannedShift;

  /// The process this block belongs to: its lines, metrics and rules.
  final ProcessSpec spec;

  /// Machine (worker) ids another block of the form already holds on this
  /// block's date — only for a spec with `uniqueMachinePerDate`.
  final List<String> takenMachines;

  /// The spec's `extraReference` lists (work orders, …) by name.
  final Map<String, List<Map<String, dynamic>>> extra;

  final int index;
  final Map<String, dynamic> values;
  final Map<String, String> errors;
  final bool isSubmit;
  final List<Map<String, dynamic>> machines;
  final List<Map<String, dynamic>> items;
  final List<Map<String, dynamic>> operators;
  final bool isEdit;

  /// What this block's machine already has saved on its date, as readable
  /// ranges — shown under the ON/OFF times so a free slot is easy to pick.
  final List<String> booked;
  final bool canRemove;
  final bool expanded;

  /// Open this block (its index) or collapse everything (null).
  final ValueChanged<int?> onExpand;
  final void Function(int index, String name, dynamic value) onChange;
  final void Function(int index, String itemId) onItemSelect;
  final void Function(int index, String reason, dynamic value) onRejectChange;
  final void Function(int index) onRemove;

  /// How many times a block rebuilt its content — tests use it to prove that
  /// typing in one block leaves the others alone.
  @visibleForTesting
  static final Map<int, int> contentBuilds = {};

  @override
  State<EntryBlock> createState() => EntryBlockState();
}

class EntryBlockState extends State<EntryBlock> {
  final Map<String, GlobalKey> _keys = {};
  final Map<String, FocusNode> _nodes = {};

  Widget? _cache;
  bool _depsChanged = true;
  Object? _snapValues;
  Object? _snapErrors;
  EntryBlock? _snapWidget;

  GlobalKey _gk(String field) => _keys.putIfAbsent(field, () => GlobalKey(debugLabel: 'entry-field-$field'));
  FocusNode _fn(String field) => _nodes.putIfAbsent(field, () => FocusNode(debugLabel: 'entry-$field'));

  /// Where the form scrolls to for [field] (null while it is not on screen).
  BuildContext? contextFor(String field) => _keys[field]?.currentContext;

  /// Puts the cursor (or the focus ring) on [field]; false when it has no box.
  bool focusField(String field) {
    final node = _nodes[field];
    if (node == null || node.context == null) return false;
    node.requestFocus();
    return true;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _depsChanged = true;
  }

  @override
  void dispose() {
    for (final n in _nodes.values) {
      n.dispose();
    }
    super.dispose();
  }

  bool _stale() {
    final o = _snapWidget;
    final w = widget;
    if (_cache == null || _depsChanged || o == null) return true;
    if (o.index != w.index ||
        !identical(o.spec, w.spec) ||
        !identical(o.extra, w.extra) ||
        o.isSubmit != w.isSubmit ||
        o.isEdit != w.isEdit ||
        o.canRemove != w.canRemove ||
        !listEquals(o.booked, w.booked) ||
        !listEquals(o.takenMachines, w.takenMachines) ||
        o.plannedShift != w.plannedShift ||
        o.expanded != w.expanded) {
      return true;
    }
    if (!_sameRefs(o.machines, w.machines) || !_sameRefs(o.items, w.items) || !_sameRefs(o.operators, w.operators)) {
      return true;
    }
    return !_same(_snapValues, w.values) || !_same(_snapErrors, w.errors);
  }

  @override
  Widget build(BuildContext context) {
    // Subscribe to what the cached tree bakes in, so a theme or text-size
    // change rebuilds it.
    Theme.of(context);
    MediaQuery.textScalerOf(context);
    if (!_stale()) return _cache!;
    _snapWidget = widget;
    _snapValues = _snapshot(widget.values);
    _snapErrors = _snapshot(widget.errors);
    _depsChanged = false;
    EntryBlock.contentBuilds.update(widget.index, (n) => n + 1, ifAbsent: () => 1);
    return _cache = RepaintBoundary(
      child: AnimatedSize(
        duration: const Duration(milliseconds: 240),
        curve: Curves.easeOutCubic,
        alignment: Alignment.topCenter,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(3, 1, 3, 5),
          child: widget.expanded ? _expandedView(context) : _collapsedView(context),
        ),
      ),
    );
  }

  // ── shared bits ───────────────────────────────────────────────────────────

  int get _i => widget.index;
  Map<String, dynamic> get _v => widget.values;

  String? _err(String key) {
    final e = widget.errors[key];
    if (e == null || e.isEmpty) return null;
    // The time rules (OFF after ON, no overlap) show as soon as the times are
    // picked; everything else waits until Save has been pressed.
    return (widget.isSubmit || isTimeRuleMessage(e)) ? e : null;
  }

  void _set(String name, dynamic value) => widget.onChange(_i, name, value);

  Widget _k(String field, Widget child) => KeyedSubtree(key: _gk(field), child: child);

  String get _machineName {
    final id = entryText(_v['machine']);
    for (final m in widget.machines) {
      if ('${m['_id']}' == id) return '${m['machineName'] ?? ''}';
    }
    return '';
  }

  Color _cardColor(BuildContext context) => Theme.of(context).cardTheme.color ?? Theme.of(context).colorScheme.surface;

  Future<void> _pickMachine() async {
    final id = entryText(_v['machine']);
    final taken = widget.takenMachines;
    final r = await showPicker<String>(
      context,
      title: widget.spec.machineLabel,
      options: [
        for (final m in widget.machines)
          PickOption<String>(
            '${m['_id']}',
            '${m['machineName'] ?? ''}${taken.contains('${m['_id']}') ? ' — already added' : ''}',
          ),
      ],
      selected: id.isEmpty ? null : id,
    );
    if (!mounted || r == null || r.value == null) return;
    // Another block of this form already has this one on the same date.
    if (r.value != id && taken.contains(r.value)) {
      EntryFormToast.warn('Already added to this form for this date.');
      return;
    }
    HapticFeedback.selectionClick();
    _set('machine', r.value);
    // Choosing a machine opens its entry fields straight away — no separate "+"
    // press (the "+" stays for reopening a collapsed block).
    if (!widget.isEdit && !widget.expanded) widget.onExpand(_i);
  }

  /// Opens the machine picker — "Add another machine" asks for the machine first.
  Future<void> askMachine() => widget.isEdit ? Future<void>.value() : _pickMachine();

  Future<void> _pickOperator() async {
    final name = entryText(_v['operator']);
    final r = await showPicker<String>(
      context,
      title: 'Operator',
      options: [for (final o in widget.operators) PickOption<String>('${o['name'] ?? ''}', '${o['name'] ?? ''}')],
      selected: name.isEmpty ? null : name,
      allowClear: true,
    );
    if (!mounted || r == null) return;
    HapticFeedback.selectionClick();
    _set('operator', r.value ?? '');
  }

  Future<void> _pickItem() async {
    final id = entryText(_v['item']);
    final r = await showPicker<String>(
      context,
      title: 'Part Name',
      options: partPickOptions(widget.items, widget.spec.itemSubtitle),
      selected: id.isEmpty ? null : id,
      allowClear: true,
      alwaysSearch: true,
    );
    if (!mounted || r == null) return;
    HapticFeedback.selectionClick();
    widget.onItemSelect(_i, r.value ?? '');
  }

  Future<void> _confirmRemove() async {
    if (widget.spec.entryHasData(_v)) {
      final ok = await Alerts.confirm(
        context,
        'Remove this ${widget.spec.machineNoun} and everything typed into it?',
        title: 'Remove ${widget.spec.machineNoun}',
        confirmText: 'Remove',
      );
      if (!ok || !mounted) return;
    }
    HapticFeedback.mediumImpact();
    widget.onRemove(_i);
  }

  Widget _removeButton() => IconButton(
        key: ValueKey('entry$_i/remove'),
        tooltip: 'Remove this ${widget.spec.machineNoun}',
        onPressed: _confirmRemove,
        icon: const Icon(Icons.delete_outline_rounded),
        style: IconButton.styleFrom(
          minimumSize: const Size(40, 40),
          foregroundColor: Theme.of(context).colorScheme.error,
          backgroundColor: Theme.of(context).colorScheme.error.withValues(alpha: 0.10),
        ),
      );

  // ── collapsed ─────────────────────────────────────────────────────────────

  Widget _collapsedView(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final w = widget;
    final errorCount = w.errors.length;
    final incomplete = w.isSubmit && errorCount > 0;
    final hasData = widget.spec.entryHasData(_v);
    final hasMachine = entryText(_v['machine']).isNotEmpty;
    final card = _cardColor(context);

    final status = incomplete
        ? Align(
            alignment: Alignment.centerLeft,
            child: EntryBadge(incompleteBadgeText(errorCount)),
          )
        : Text(
            !hasMachine
                ? (w.machines.isEmpty && widget.spec.noMachinesMessage != null
                    ? widget.spec.noMachinesMessage!
                    : 'Select a ${widget.spec.machineNoun} — its entry fields open automatically')
                : hasData
                    ? 'Entry filled in — press + to reopen it'
                    : "Press + to fill this ${widget.spec.machineNoun}'s entry",
            style: TextStyle(color: s.onSurfaceVariant, fontSize: EntryStyle.noteSize, height: 1.25),
          );

    final summary = widget.spec.lines.collapsedSummary(_v);

    return Container(
      key: ValueKey('entry$_i/collapsed'),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: hasData ? Color.alphaBlend(s.primary.withValues(alpha: 0.07), card) : card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: incomplete ? s.error : (hasData ? s.primary.withValues(alpha: 0.4) : s.outlineVariant),
          width: incomplete ? 1.4 : 1,
        ),
        boxShadow: s.brightness == Brightness.dark
            ? null
            : [BoxShadow(color: s.shadow.withValues(alpha: 0.06), blurRadius: 4, offset: const Offset(0, 1))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          FieldLabel(widget.spec.machineLabel, required: true),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(child: _k('machine@collapsed', _machineBox(enabled: !w.isEdit))),
              const SizedBox(width: 8),
              IconButton.filled(
                key: ValueKey('entry$_i/expand'),
                tooltip: hasMachine ? 'Open the entry fields' : 'Select a ${widget.spec.machineNoun} first',
                onPressed: hasMachine ? () => widget.onExpand(_i) : null,
                icon: const Icon(Icons.add_rounded),
                style: IconButton.styleFrom(minimumSize: const Size(44, 44)),
              ),
              if (w.canRemove) ...[const SizedBox(width: 4), _removeButton()],
            ],
          ),
          if (_err('machine') != null) EntryErrorText(_err('machine')!),
          const SizedBox(height: 2),
          InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: hasMachine ? () => widget.onExpand(_i) : null,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  status,
                  if (hasData && summary.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      summary,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: s.onSurface, fontSize: 13, fontWeight: FontWeight.w600, height: 1.25),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _machineBox({required bool enabled}) => EntryPickerBox(
        key: ValueKey('entry$_i/machine'),
        text: _machineName,
        hint: 'Select ${widget.spec.machineNoun}',
        enabled: enabled,
        invalid: _err('machine') != null,
        focusNode: enabled && widget.expanded ? _fn('machine') : null,
        semanticsLabel: widget.spec.machineLabel,
        icon: enabled ? Icons.keyboard_arrow_down_rounded : Icons.lock_outline_rounded,
        onTap: _pickMachine,
      );

  // ── expanded ──────────────────────────────────────────────────────────────

  Widget _expandedView(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final w = widget;
    final errorCount = w.errors.length;
    final incomplete = w.isSubmit && errorCount > 0;
    final card = _cardColor(context);
    final name = _machineName;

    final header = Container(
      key: ValueKey('entry$_i/header'),
      padding: const EdgeInsets.fromLTRB(6, 6, 6, 6),
      decoration: BoxDecoration(
        color: Color.alphaBlend(s.primary.withValues(alpha: 0.08), card),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: incomplete ? s.error : s.primary.withValues(alpha: 0.55), width: incomplete ? 1.4 : 1.2),
      ),
      child: Row(
        children: [
          if (!w.isEdit)
            IconButton.filledTonal(
              key: ValueKey('entry$_i/collapse'),
              tooltip: 'Collapse this ${widget.spec.machineNoun}',
              onPressed: () => widget.onExpand(null),
              icon: const Icon(Icons.remove_rounded),
              style: IconButton.styleFrom(minimumSize: const Size(40, 40)),
            )
          else
            const Padding(padding: EdgeInsets.symmetric(horizontal: 10), child: Icon(Icons.edit_note_rounded, size: 22)),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.spec.machineBlockTitle(name, _i),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                ),
                if (incomplete) ...[
                  const SizedBox(height: 3),
                  EntryBadge(incompleteBadgeText(errorCount)),
                ],
              ],
            ),
          ),
          if (w.canRemove) _removeButton(),
        ],
      ),
    );

    // Left column then right column is also the order "next" walks the boxes.
    final lines = widget.spec.lines;
    final line = _lineContext(context);
    final left = lines.left(line);
    final right = lines.right(line);

    Widget stack(List<Widget> cards) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var n = 0; n < cards.length; n++) ...[if (n > 0) const SizedBox(height: 8), cards[n]],
          ],
        );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        header,
        const SizedBox(height: 8),
        // An iPad dialog or a landscape phone gets two columns of cards.
        LayoutBuilder(
          builder: (context, c) => c.maxWidth >= _twoColumnsFrom
              ? Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: FocusTraversalGroup(child: stack(left))),
                    const SizedBox(width: 8),
                    Expanded(child: FocusTraversalGroup(child: stack(right))),
                  ],
                )
              : stack([...left, ...right]),
        ),
      ],
    );
  }

  /// Width from which the cards sit in two columns.
  static const double _twoColumnsFrom = 700;

  /// What the process's lines build from (see [EntryLineContext]).
  EntryLineContext _lineContext(BuildContext context) => EntryLineContext(
        buildContext: context,
        index: _i,
        values: _v,
        errors: widget.errors,
        isSubmit: widget.isSubmit,
        isEdit: widget.isEdit,
        booked: widget.booked,
        machines: widget.machines,
        items: widget.items,
        operators: widget.operators,
        extra: widget.extra,
        metrics: widget.spec.metrics(_v),
        onChange: widget.onChange,
        onItemSelect: widget.onItemSelect,
        onRejectChange: widget.onRejectChange,
        keyFor: _gk,
        nodeFor: _fn,
        pickOperator: _pickOperator,
        pickItem: _pickItem,
        machineBox: ({required bool enabled}) => _machineBox(enabled: enabled),
        plannedShift: widget.plannedShift,
        popups: widget.spec.showLimitPopups,
      );
}
