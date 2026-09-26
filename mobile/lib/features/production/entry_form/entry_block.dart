import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/utils/alerts.dart';
import '../../../core/widgets/form_widgets.dart';
import '../shared/production_sheet_calc.dart';
import 'entry_fields.dart';
import 'entry_form_logic.dart';
import 'entry_form_toast.dart';
import 'entry_layout.dart';
import 'entry_number_input.dart';
import 'entry_style.dart';

// The lines of the sheet, in order — which typed keys each holds, so a line
// containing an error can flag itself ("Check this line").
const List<String> _line1 = ['date', 'machine', 'operator'];
final List<String> _line2 = ['itemName', ...entryCycleOpKeys];
const List<String> _line3 = ['machineOnTime', 'machineOffTime'];
const List<String> _line5 = ['actualQty', 'okQty'];
const List<String> _line13 = ['rejectBreakdown', 'rejectOtherRemark'];
const List<String> _line7 = ['plannedOperatorShiftHours', 'lunchMin'];
const List<String> _line8 = [
  'setupMin',
  'noManPowerMin',
  'materialShiftingMin',
  'noMaterialMin',
  'bdMechMin',
  'bdEleMin',
  'noPowerMin',
  'otherMin',
  'stoppageTotal',
  'otherMinRemark',
];
const List<String> _line12 = ['remarks'];

const List<(String, String)> _downtimeBoxes = [
  ('setupMin', 'Setup Time (min)'),
  ('noManPowerMin', 'No Man Power (min)'),
  ('materialShiftingMin', 'Material Shifting (min)'),
  ('noMaterialMin', 'No Material (min)'),
  ('bdMechMin', 'Breakdown Mechanical (min)'),
  ('bdEleMin', 'BD Electricity (min)'),
  ('noPowerMin', 'No Power (min)'),
  ('otherMin', 'Other (min)'),
];

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
    required this.canRemove,
    required this.expanded,
    required this.onExpand,
    required this.onChange,
    required this.onItemSelect,
    required this.onRejectChange,
    required this.onRemove,
  });

  final int index;
  final Map<String, dynamic> values;
  final Map<String, String> errors;
  final bool isSubmit;
  final List<Map<String, dynamic>> machines;
  final List<Map<String, dynamic>> items;
  final List<Map<String, dynamic>> operators;
  final bool isEdit;
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
        o.isSubmit != w.isSubmit ||
        o.isEdit != w.isEdit ||
        o.canRemove != w.canRemove ||
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
    if (!widget.isSubmit) return null;
    final e = widget.errors[key];
    return (e == null || e.isEmpty) ? null : e;
  }

  bool _lineHasError(List<String> fields) => widget.isSubmit && fields.any((f) => (widget.errors[f] ?? '').isNotEmpty);

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
    final r = await showPicker<String>(
      context,
      title: 'Machine No.',
      options: [for (final m in widget.machines) PickOption<String>('${m['_id']}', '${m['machineName'] ?? ''}')],
      selected: id.isEmpty ? null : id,
    );
    if (!mounted || r == null || r.value == null) return;
    HapticFeedback.selectionClick();
    _set('machine', r.value);
  }

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
      options: [
        for (final it in widget.items)
          PickOption<String>(
            '${it['_id']}',
            '${it['itemName'] ?? ''}',
            subtitle: entryFmt(it['totalCycleSec']).isEmpty ? null : '${entryFmt(it['totalCycleSec'])} sec',
          ),
      ],
      selected: id.isEmpty ? null : id,
      allowClear: true,
    );
    if (!mounted || r == null) return;
    HapticFeedback.selectionClick();
    widget.onItemSelect(_i, r.value ?? '');
  }

  Future<void> _confirmRemove() async {
    if (entryHasData(_v)) {
      final ok = await Alerts.confirm(
        context,
        'Remove this machine and everything typed into it?',
        title: 'Remove machine',
        confirmText: 'Remove',
      );
      if (!ok || !mounted) return;
    }
    HapticFeedback.mediumImpact();
    widget.onRemove(_i);
  }

  Widget _removeButton() => IconButton(
        key: ValueKey('entry$_i/remove'),
        tooltip: 'Remove this machine',
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
    final hasData = entryHasData(_v);
    final hasMachine = entryText(_v['machine']).isNotEmpty;
    final card = _cardColor(context);

    final status = incomplete
        ? Align(
            alignment: Alignment.centerLeft,
            child: EntryBadge(incompleteBadgeText(errorCount)),
          )
        : Text(
            !hasMachine
                ? 'Select a machine, then press +'
                : hasData
                    ? 'Entry filled in — press + to reopen it'
                    : "Press + to fill this machine's entry",
            style: TextStyle(color: s.onSurfaceVariant, fontSize: EntryStyle.noteSize, height: 1.25),
          );

    final summary = <String>[
      if (entryText(_v['itemName']).isNotEmpty) entryText(_v['itemName']),
      if (entryText(_v['actualQty']).isNotEmpty) 'Actual ${entryText(_v['actualQty'])}',
      if (entryText(_v['okQty']).isNotEmpty) 'OK ${entryText(_v['okQty'])}',
    ].join(' · ');

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
          const FieldLabel('Machine No.', required: true),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(child: _k('machine@collapsed', _machineBox(enabled: !w.isEdit))),
              const SizedBox(width: 8),
              IconButton.filled(
                key: ValueKey('entry$_i/expand'),
                tooltip: hasMachine ? 'Open the entry fields' : 'Select a machine first',
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
        hint: 'Select machine',
        enabled: enabled,
        invalid: _err('machine') != null,
        focusNode: enabled && widget.expanded ? _fn('machine') : null,
        semanticsLabel: 'Machine No.',
        icon: enabled ? Icons.keyboard_arrow_down_rounded : Icons.lock_outline_rounded,
        onTap: _pickMachine,
      );

  // ── expanded ──────────────────────────────────────────────────────────────

  Widget _expandedView(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final w = widget;
    final m = EntryMetrics(_v);
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
              tooltip: 'Collapse this machine',
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
                  'Machine ${name.isEmpty ? _i + 1 : name}',
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
    final left = <Widget>[_dateMachineOperator(), _partLine(m), _timeLine(m), _quantityLine(m)];
    final right = <Widget>[_rejectLine(m), _shiftLine(m), _downtimeLine(m), _remarksLine()];

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

  // The typed-number box every numeric field shares.
  Widget _num(
    String field, {
    bool decimals = false,
    double? max,
    void Function(double max)? onExceed,
    bool lockable = true,
    bool? invalid,
    FocusNode? node,
    String? label,
  }) =>
      EntryTextField(
        key: ValueKey('entry$_i/$field'),
        value: entryText(_v[field]),
        numeric: true,
        decimals: decimals,
        max: max,
        onExceedMax: onExceed,
        lockable: lockable,
        invalid: invalid ?? _err(field) != null,
        focusNode: node ?? _fn(field),
        semanticsLabel: label,
        onChanged: (t) => _set(field, t),
      );

  Widget _minutesBox(EntryMetrics m, String field, String label) {
    final limit = m.minutesLimit(field);
    return _num(field, max: limit.max, onExceed: (_) => EntryFormToast.warn(limit.message), label: label);
  }

  bool _locked(String field, double? max) => EntryTextField.capLocks(entryText(_v[field]), max);

  Widget _calc(String key, String value, String label) =>
      EntryCalcBox(key: ValueKey('entry$_i/calc/$key'), value: value, semanticsLabel: label);

  Widget _dateMachineOperator() {
    final w = widget;
    final operatorName = entryText(_v['operator']);
    return EntryLineCard(
      title: 'Date, Machine No., Operator',
      icon: Icons.event_note_rounded,
      hasError: _lineHasError(_line1),
      children: [
        EntryGrid(
          cells: [
            EntryCell(
              label: 'Date',
              required: true,
              error: _err('date'),
              child: _k(
                'date',
                EntryDateField(
                  key: ValueKey('entry$_i/date'),
                  value: entryText(_v['date']),
                  invalid: _err('date') != null,
                  focusNode: _fn('date'),
                  onChanged: (d) {
                    HapticFeedback.selectionClick();
                    _set('date', d);
                  },
                ),
              ),
            ),
            EntryCell(
              label: 'Machine No.',
              required: true,
              error: _err('machine'),
              hint: w.isEdit ? "Can't be changed while editing" : null,
              child: _k('machine', _machineBox(enabled: !w.isEdit)),
            ),
            EntryCell(
              label: 'Operator',
              required: true,
              error: _err('operator'),
              span: EntryCell.full,
              child: _k(
                'operator',
                EntryPickerBox(
                  key: ValueKey('entry$_i/operator'),
                  // A record saved before this box read from Operator Master, or
                  // one whose operator was deactivated, keeps showing its name.
                  text: operatorName,
                  hint: 'Select operator',
                  invalid: _err('operator') != null,
                  focusNode: _fn('operator'),
                  semanticsLabel: 'Operator',
                  onTap: _pickOperator,
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _partLine(EntryMetrics m) {
    final item = entryItemFor(_v, widget.items);
    final excluded = entryExcludedOps(_v);
    final itemName = entryText(_v['itemName']);
    final hasItem = entryText(_v['item']).isNotEmpty;
    final s = Theme.of(context).colorScheme;
    return EntryLineCard(
      title: 'Part Name, Total Cycle Time',
      icon: Icons.precision_manufacturing_outlined,
      hasError: _lineHasError(_line2),
      children: [
        EntryGrid(
          cells: [
            EntryCell(
              label: 'Part Name',
              required: true,
              error: _err('itemName'),
              span: EntryCell.full,
              child: _k(
                'itemName',
                EntryPickerBox(
                  key: ValueKey('entry$_i/itemName'),
                  // A record typed into the old grid has a part name but no link
                  // to the Item master: show that name rather than an empty box.
                  text: itemName,
                  hint: 'Select part',
                  maxLines: 2,
                  invalid: _err('itemName') != null,
                  focusNode: _fn('itemName'),
                  semanticsLabel: 'Part Name',
                  onTap: _pickItem,
                ),
              ),
            ),
            EntryCell(
              label: 'Total Cycle Time (sec)',
              child: _calc('totalCycleSec', entryFmt(m.calc['totalCycleSec']), 'Total Cycle Time (sec)'),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Text(
          hasItem || item != null ? 'Operations in this cycle' : 'Operations (pick a part first)',
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: s.onSurface),
        ),
        const SizedBox(height: 2),
        Text(
          "Untick one to leave it out of this entry's cycle time.",
          style: TextStyle(fontSize: EntryStyle.noteSize, color: s.onSurfaceVariant, height: 1.25),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [for (final f in cycleOpFields) _opTile(f, item, excluded)],
        ),
      ],
    );
  }

  Widget _opTile(Map<String, dynamic> f, Map<String, dynamic>? item, Set<String> excluded) {
    final key = f['key'] as String;
    final canTick = entryCanTick(item, key);
    final isExcluded = excluded.contains(key);
    return _k(
      key,
      _OpTile(
        key: ValueKey('entry$_i/$key'),
        label: cycleOpLabel(f),
        value: canTick ? entryFmt(item![key]) : '',
        ticked: canTick && !isExcluded,
        excluded: isExcluded,
        enabled: canTick,
        focusNode: _fn(key),
        onToggle: () {
          HapticFeedback.selectionClick();
          final raw = _v['excludedOps'];
          final list = raw is List ? List<dynamic>.from(raw) : <dynamic>[];
          // Unticking only excludes the operation from this entry's Total Cycle
          // Time; the Part's own seconds are never touched, so ticking it back
          // needs nothing restored.
          _set('excludedOps', isExcluded ? list.where((k) => '$k' != key).toList() : [...list, key]);
        },
      ),
    );
  }

  Widget _timeLine(EntryMetrics m) => EntryLineCard(
        title: 'Machine ON–OFF Time, Machine Shift',
        icon: Icons.schedule_rounded,
        hasError: _lineHasError(_line3),
        children: [
          EntryGrid(
            cells: [
              EntryCell(
                label: 'Machine ON Time',
                required: true,
                error: _err('machineOnTime'),
                child: _k(
                  'machineOnTime',
                  EntryTimeField(
                    key: ValueKey('entry$_i/machineOnTime'),
                    value: entryText(_v['machineOnTime']),
                    title: 'Machine ON Time',
                    invalid: _err('machineOnTime') != null,
                    focusNode: _fn('machineOnTime'),
                    onChanged: (t) => _set('machineOnTime', t),
                  ),
                ),
              ),
              EntryCell(
                label: 'Machine OFF Time',
                required: true,
                error: _err('machineOffTime'),
                child: _k(
                  'machineOffTime',
                  EntryTimeField(
                    key: ValueKey('entry$_i/machineOffTime'),
                    value: entryText(_v['machineOffTime']),
                    title: 'Machine OFF Time',
                    invalid: _err('machineOffTime') != null,
                    focusNode: _fn('machineOffTime'),
                    onChanged: (t) => _set('machineOffTime', t),
                  ),
                ),
              ),
              EntryCell(
                label: 'Machine Shift (hr)',
                child: _calc('shiftHours', entryFmt(m.calc['shiftHours']), 'Machine Shift (hr)'),
              ),
            ],
          ),
        ],
      );

  Widget _quantityLine(EntryMetrics m) => EntryLineCard(
        title: 'Ideal Qty, Actual Qty, OK Qty, Rejected, % OK Qty',
        icon: Icons.inventory_2_outlined,
        hasError: _lineHasError(_line5),
        children: [
          EntryGrid(
            cells: [
              EntryCell(label: 'Ideal Quantity', child: _calc('idealQty', entryFmt(m.calc['idealQty']), 'Ideal Quantity')),
              EntryCell(
                label: 'Actual Quantity',
                required: true,
                error: _err('actualQty'),
                hint: _locked('actualQty', m.idealQty)
                    ? 'Ideal Quantity is 0, so Actual can only be 0 — check the Machine ON/OFF times and the Part.'
                    : null,
                child: _k(
                  'actualQty',
                  _num(
                    'actualQty',
                    max: m.idealQty,
                    lockable: false, // required: 0 must stay typeable
                    label: 'Actual Quantity',
                    onExceed: (max) => EntryFormToast.warn("Actual Quantity can't be more than Ideal Quantity (${fmtNum(max)})"),
                  ),
                ),
              ),
              EntryCell(
                label: 'OK Quantity',
                required: true,
                error: _err('okQty'),
                hint: _locked('okQty', m.okMax) ? 'Actual Quantity is 0, so OK can only be 0.' : null,
                child: _k(
                  'okQty',
                  _num(
                    'okQty',
                    max: m.okMax,
                    lockable: false, // required: 0 must stay typeable
                    label: 'OK Quantity',
                    onExceed: (max) => EntryFormToast.warn("OK Quantity can't be more than Actual Quantity (${fmtNum(max)})"),
                  ),
                ),
              ),
              EntryCell(label: 'Rejected', child: _calc('rejectedQty', entryFmt(m.calc['rejectedQty']), 'Rejected')),
              EntryCell(label: '% OK Quantity', child: _calc('pctOk', fmtPct(m.calc['pctOk']), '% OK Quantity')),
            ],
          ),
        ],
      );

  Widget _rejectLine(EntryMetrics m) {
    final s = Theme.of(context).colorScheme;
    final split = _v['rejectBreakdown'];
    final splitErr = _err('rejectBreakdown');
    final rejectedText = entryFmt(m.calc['rejectedQty']);
    final mismatchStyle = TextStyle(color: s.error, fontWeight: FontWeight.w700);
    final muted = TextStyle(color: s.onSurfaceVariant);
    return EntryLineCard(
      title: 'Reject Master',
      icon: Icons.block_rounded,
      hasError: _lineHasError(_line13),
      children: [
        _k(
          'rejectBreakdown',
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              EntryGrid(
                maxCols: 3,
                cells: [
                  for (var r = 0; r < rejectReasons.length; r++)
                    EntryCell(
                      label: rejectReasons[r],
                      child: EntryTextField(
                        key: ValueKey('entry$_i/reject/${rejectReasons[r]}'),
                        value: entryText(split is Map ? split[rejectReasons[r]] : null),
                        numeric: true,
                        decimals: false,
                        // The first box is where a failed Save puts the cursor.
                        focusNode: r == 0 ? _fn('rejectBreakdown') : null,
                        invalid: splitErr != null && m.splitMismatch,
                        max: m.rejectRoom(rejectReasons[r]),
                        semanticsLabel: rejectReasons[r],
                        onExceedMax: (max) => EntryFormToast.warn(
                          m.rejected == 0
                              ? 'Rejected Quantity is 0 (Actual − OK), so there is nothing to split.'
                              : 'Only ${jsNumStr(max)} of the ${jsNumStr(m.rejected)} rejected pieces are left for “${rejectReasons[r]}” — the boxes can\'t add up to more than Rejected.',
                        ),
                        onChanged: (t) => widget.onRejectChange(_i, rejectReasons[r], t),
                      ),
                    ),
                ],
              ),
              if (_rejectLockNote(m) case final note?) EntryHintText(note),
              const SizedBox(height: 8),
              // The split has to account for every rejected piece, so the
              // running total sits next to the figure it must match.
              Text.rich(
                key: ValueKey('entry$_i/splitSummary'),
                style: const TextStyle(fontSize: 13, height: 1.3),
                TextSpan(
                  children: [
                    TextSpan(text: 'Split so far: ', style: muted),
                    TextSpan(
                      text: jsNumStr(m.splitTotal),
                      style: m.splitMismatch ? mismatchStyle : const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    TextSpan(text: ' of ${rejectedText.isEmpty ? '0' : rejectedText} rejected', style: muted),
                    if (m.splitTotal < m.rejected)
                      TextSpan(text: ' — ${jsNumStr(m.rejected - m.splitTotal)} left to assign', style: TextStyle(color: s.error)),
                  ],
                ),
              ),
              if (splitErr != null) EntryErrorText(splitErr),
            ],
          ),
        ),
        if (m.rejectOtherUsed) ...[
          const SizedBox(height: 10),
          EntryGrid(
            cells: [
              EntryCell(
                label: 'Remark for “Other” rejection',
                required: true,
                error: _err('rejectOtherRemark'),
                span: EntryCell.full,
                child: _k(
                  'rejectOtherRemark',
                  EntryTextField(
                    key: ValueKey('entry$_i/rejectOtherRemark'),
                    value: entryText(_v['rejectOtherRemark']),
                    maxLength: 300,
                    minLines: 2,
                    maxLines: 4,
                    hint: 'Why were these pieces rejected as “Other”?',
                    invalid: _err('rejectOtherRemark') != null,
                    focusNode: _fn('rejectOtherRemark'),
                    semanticsLabel: 'Remark for Other rejection',
                    onChanged: (t) => _set('rejectOtherRemark', t),
                  ),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _shiftLine(EntryMetrics m) {
    final limit = m.stoppageLimit;
    final lunch = m.minutesLimit('lunchMin');
    return EntryLineCard(
      title: 'Planned Operator Shift, Lunch / Rest',
      icon: Icons.timelapse_rounded,
      hasError: _lineHasError(_line7),
      children: [
        EntryGrid(
          cells: [
            EntryCell(
              label: 'Planned Operator Shift (hr)',
              required: true,
              error: _err('plannedOperatorShiftHours'),
              child: _k(
                'plannedOperatorShiftHours',
                _num(
                  'plannedOperatorShiftHours',
                  decimals: true,
                  max: 24,
                  label: 'Planned Operator Shift (hr)',
                  onExceed: (_) => EntryFormToast.warn("Planned Operator Shift can't be more than 24 hours."),
                ),
              ),
            ),
            EntryCell(
              label: 'Lunch / Rest (min)',
              // Only asked for while the planned shift leaves time over the run.
              required: m.lunchNeeded,
              error: _err('lunchMin'),
              hint: limit == 0
                  ? 'Not needed — the machine ran the whole planned shift.'
                  : _locked('lunchMin', lunch.max)
                      ? (m.lunchNeeded ? 'No stoppage time left, so Lunch / Rest can only be 0.' : 'No stoppage time left.')
                      : null,
              child: _k(
                'lunchMin',
                _num(
                  'lunchMin',
                  max: lunch.max,
                  // Required while the shift leaves time over the run: then 0 must stay typeable.
                  lockable: !m.lunchNeeded,
                  label: 'Lunch / Rest (min)',
                  onExceed: (_) => EntryFormToast.warn(lunch.message),
                ),
              ),
            ),
            EntryCell(
              label: 'Stoppage Allowed (min)',
              child: _calc('stoppageAllowed', limit == null ? '' : jsNumStr(limit), 'Stoppage Allowed (min)'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _downtimeLine(EntryMetrics m) => EntryLineCard(
        title: 'Downtime / Stoppage (min)',
        icon: Icons.build_circle_outlined,
        hasError: _lineHasError(_line8),
        children: [
          EntryGrid(
            maxCols: 3,
            cells: [
              for (final (key, label) in _downtimeBoxes)
                EntryCell(label: label, error: _err(key), child: _k(key, _minutesBox(m, key, label))),
            ],
          ),
          if (_downtimeLockNote(m) case final note?) EntryHintText(note),
          const SizedBox(height: 10),
          _k('stoppageTotal', _stoppageMeter(m)),
          if (m.otherDowntimeUsed) ...[
            const SizedBox(height: 10),
            EntryGrid(
              cells: [
                EntryCell(
                  label: 'Remark for Other downtime',
                  required: true,
                  error: _err('otherMinRemark'),
                  span: EntryCell.full,
                  child: _k(
                    'otherMinRemark',
                    EntryTextField(
                      key: ValueKey('entry$_i/otherMinRemark'),
                      value: entryText(_v['otherMinRemark']),
                      maxLength: 300,
                      minLines: 2,
                      maxLines: 4,
                      hint: 'What was the “Other” downtime?',
                      invalid: _err('otherMinRemark') != null,
                      focusNode: _fn('otherMinRemark'),
                      semanticsLabel: 'Remark for Other downtime',
                      onChanged: (t) => _set('otherMinRemark', t),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      );

  /// Why some Reject Master boxes are shut (or null while none is).
  String? _rejectLockNote(EntryMetrics m) {
    final split = _v['rejectBreakdown'];
    final anyLocked = rejectReasons.any(
      (r) => _locked2(split is Map ? split[r] : null, m.rejectRoom(r)),
    );
    if (!anyLocked) return null;
    return m.rejectLockReason;
  }

  /// Why some downtime boxes are shut (or null while none is).
  String? _downtimeLockNote(EntryMetrics m) {
    final anyLocked = [..._downtimeBoxes.map((b) => b.$1)].any((k) => _locked(k, m.minutesLimit(k).max));
    if (!anyLocked) return null;
    return m.downtimeLockReason;
  }

  bool _locked2(Object? value, double max) => EntryTextField.capLocks(entryText(value), max);

  // Lunch / Rest and every box above have to fit inside what Planned Operator
  // Shift leaves after the machine's own run, so the running total sits next to
  // that allowance — with a bar that fills as the allowance is used up.
  Widget _stoppageMeter(EntryMetrics m) {
    final s = Theme.of(context).colorScheme;
    final limit = m.stoppageLimit;
    final over = m.overStoppage;
    final totalText = entryFmt(m.totalStoppage);
    final frac = limit == null
        ? 0.0
        : limit > 0
            ? (m.totalStoppage / limit).clamp(0.0, 1.0)
            : (m.totalStoppage > 0 ? 1.0 : 0.0);
    final err = _err('stoppageTotal');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text.rich(
          key: ValueKey('entry$_i/stoppageSummary'),
          style: const TextStyle(fontSize: 13, height: 1.3),
          TextSpan(
            children: [
              TextSpan(text: 'Total stoppage (with Lunch / Rest): ', style: TextStyle(color: s.onSurfaceVariant)),
              TextSpan(
                text: '${totalText.isEmpty ? '0' : totalText} min',
                style: TextStyle(fontWeight: FontWeight.w700, color: over ? s.error : null),
              ),
              TextSpan(
                text: limit == null
                    ? ' — enter Planned Operator Shift and Machine ON/OFF Time to see the allowance'
                    : ' of ${jsNumStr(limit)} min allowed',
                style: TextStyle(color: s.onSurfaceVariant),
              ),
            ],
          ),
        ),
        if (limit != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: frac,
                minHeight: 5,
                backgroundColor: s.outlineVariant,
                color: over ? s.error : (frac > 0.85 ? AppColors.warn : s.primary),
              ),
            ),
          ),
        if (err != null) EntryErrorText(err),
      ],
    );
  }

  Widget _remarksLine() => EntryLineCard(
        title: 'Remarks',
        icon: Icons.notes_rounded,
        hasError: _lineHasError(_line12),
        children: [
          EntryGrid(
            cells: [
              EntryCell(
                span: EntryCell.full,
                child: _k(
                  'remarks',
                  EntryTextField(
                    key: ValueKey('entry$_i/remarks'),
                    value: entryText(_v['remarks']),
                    maxLength: 500,
                    minLines: 2,
                    maxLines: 5,
                    hint: 'Anything worth noting about this shift (optional)',
                    focusNode: _fn('remarks'),
                    semanticsLabel: 'Remarks',
                    onChanged: (t) => _set('remarks', t),
                  ),
                ),
              ),
            ],
          ),
        ],
      );
}

/// One cycle operation of the picked Part as a tickable tile. Untick to leave
/// it out of this entry's cycle time (its seconds stay struck through); a
/// Part without the operation shows it disabled.
class _OpTile extends StatelessWidget {
  const _OpTile({
    super.key,
    required this.label,
    required this.value,
    required this.ticked,
    required this.excluded,
    required this.enabled,
    required this.focusNode,
    required this.onToggle,
  });

  final String label;
  final String value;
  final bool ticked;
  final bool excluded;
  final bool enabled;
  final FocusNode focusNode;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final tint = ticked ? Color.alphaBlend(s.primary.withValues(alpha: 0.10), EntryStyle.fill(context)) : EntryStyle.fill(context);
    final valueStyle = excluded
        ? TextStyle(decoration: TextDecoration.lineThrough, color: s.onSurfaceVariant)
        : const TextStyle(fontWeight: FontWeight.w700);
    return Semantics(
      checked: ticked,
      enabled: enabled,
      label: value.isEmpty ? label : '$label, $value',
      excludeSemantics: true,
      onTap: enabled ? onToggle : null,
      child: Opacity(
        opacity: enabled ? 1 : 0.5,
        child: Focus(
          focusNode: focusNode,
          child: Material(
            color: tint,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(EntryStyle.radius),
              side: BorderSide(color: ticked ? s.primary.withValues(alpha: 0.55) : s.outlineVariant),
            ),
            child: InkWell(
              canRequestFocus: false,
              borderRadius: BorderRadius.circular(EntryStyle.radius),
              onTap: enabled ? onToggle : null,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 40),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(4, 2, 10, 2),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ExcludeFocus(
                        child: IgnorePointer(
                          child: Checkbox(
                            value: ticked,
                            onChanged: enabled ? (_) {} : null,
                            visualDensity: VisualDensity.compact,
                            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                        ),
                      ),
                      const SizedBox(width: 2),
                      Flexible(
                        child: Text.rich(
                          TextSpan(
                            style: const TextStyle(fontSize: 12.5, height: 1.25),
                            children: [
                              TextSpan(text: label, style: TextStyle(color: excluded ? s.onSurfaceVariant : s.onSurface)),
                              if (value.isNotEmpty) TextSpan(text: ' — $value', style: valueStyle),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
