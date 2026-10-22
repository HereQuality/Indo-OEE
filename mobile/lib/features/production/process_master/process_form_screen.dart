import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../app/app_scaffold.dart';
import '../../../core/api/api_client.dart' show ApiException;
import '../../../core/utils/alerts.dart';
import '../../../core/widgets/form_widgets.dart';
import '../../../core/widgets/states.dart';
import '../dashboard/sheets/customize_sheet.dart';
import '../shared/production_sheet_calc.dart' show jsToNumber;
import 'process_master_logic.dart';
import 'process_master_repository.dart';

/// Add / Update Process (the web modal). Pops `true` once saved.
///
/// Gated like the web: the Data Entry Page picker and the dashboard picker are
/// for [isAdmin] (Super Admin) only, the Operator Planned Shift switch and hours
/// for [canSetShift] (Admin / Super Admin); anyone else sees them read-only and
/// the process keeps what it has.
class ProcessFormScreen extends StatefulWidget {
  const ProcessFormScreen({
    super.key,
    this.processId,
    required this.isAdmin,
    required this.canSetShift,
    this.repo = const ProcessMasterRepository(),
  });

  /// Null = adding.
  final String? processId;
  final bool isAdmin;
  final bool canSetShift;
  final ProcessMasterRepository repo;

  @override
  State<ProcessFormScreen> createState() => _ProcessFormScreenState();
}

class _ProcessFormScreenState extends State<ProcessFormScreen> {
  Json _v = initialProcessValues();
  Map<String, String> _errors = const {};
  bool _submitted = false;
  bool _loading = true;
  bool _saving = false;
  String? _loadError;

  List<Json> _machines = const [];
  List<Json> _activeProcesses = const [];
  List<MenuChoice> _menus = const [];

  final _name = TextEditingController();
  final _description = TextEditingController();
  final _hours = TextEditingController(text: '12');

  bool get _editing => widget.processId != null;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    _hours.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final results = await Future.wait([
        widget.repo.machines(),
        widget.repo.activeProcesses(),
        if (widget.isAdmin) widget.repo.menuChoices() else Future.value(const <MenuChoice>[]),
        if (_editing) widget.repo.byId(widget.processId!) else Future.value(<String, dynamic>{}),
      ]);
      if (!mounted) return;
      _machines = (results[0] as List).cast<Json>();
      _activeProcesses = (results[1] as List).cast<Json>();
      _menus = (results[2] as List).cast<MenuChoice>();
      if (_editing) _v = valuesFromProcess(results[3] as Json);
      _name.text = '${_v['processName']}';
      _description.text = '${_v['description']}';
      _hours.text = '${_v['plannedShiftHours']}';
      setState(() => _loading = false);
    } catch (e) {
      if (!mounted) return;
      if (_editing) Alerts.error('Failed to fetch process details');
      setState(() {
        _loading = false;
        _loadError = e is ApiException ? e.message : 'Failed to load';
      });
    }
  }

  void _set(String key, Object? value) => setState(() {
    _v = {..._v, key: value};
    if (_submitted) _errors = validateProcess(_v);
  });

  Future<void> _save() async {
    if (_saving) return;
    FocusScope.of(context).unfocus();
    final errors = validateProcess(_v);
    setState(() {
      _errors = errors;
      _submitted = true;
    });
    if (errors.isNotEmpty) return;
    setState(() => _saving = true);
    try {
      final body = processPayload(_v);
      if (_editing) {
        await widget.repo.update(widget.processId!, body);
      } else {
        await widget.repo.create(body);
      }
      if (!mounted) return;
      Alerts.success(_editing ? 'Process Updated Successfully!' : 'Process Added Successfully!');
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      final m = e is ApiException ? e.message : '';
      Alerts.error(m.isNotEmpty ? m : 'Failed to save process. Please try again.');
      setState(() => _saving = false);
    }
  }

  Future<void> _pickMachines() async {
    final choices = machineChoices(_machines, _activeProcesses, widget.processId ?? '');
    final picked = await showMultiPicker(
      context,
      title: 'Machines in this process',
      options: [for (final m in choices) PickOption<String>('${m['_id']}', '${m['machineName'] ?? ''}')],
      selected: List<String>.from(_v['machineIds'] as List),
      emptyMessage: _machines.isNotEmpty
          ? 'No free machines — the rest are already in a process'
          : 'No machines — add them in Production › Machines',
    );
    if (picked != null) _set('machineIds', picked);
  }

  Future<void> _pickMenu() async {
    final r = await showPicker<String>(
      context,
      title: 'Data Entry Page',
      options: [for (final m in _menus) PickOption<String>(m.url, m.label)],
      selected: '${_v['dataEntryMenu']}'.isEmpty ? null : '${_v['dataEntryMenu']}',
      allowClear: true,
    );
    if (r == null) return;
    final url = r.value ?? '';
    final label = url.isEmpty ? '' : _menus.firstWhere((m) => m.url == url).label;
    setState(() => _v = {..._v, 'dataEntryMenu': url, 'dataEntryMenuLabel': label});
  }

  Future<void> _customize() => showCustomizeSheet(
    context,
    stats: List<String>.from(_v['stats'] as List),
    charts: List<String>.from(_v['charts'] as List),
    // Kept on the form; the process itself saves with the rest of it.
    onSave: (stats, charts) async => setState(() => _v = {..._v, 'stats': stats, 'charts': charts}),
  );

  @override
  Widget build(BuildContext context) {
    final title = _editing ? 'Update Process' : 'Add Process';
    if (_loading) return AppScaffold(title: title, body: const LoadingView());
    if (_loadError != null) {
      return AppScaffold(title: title, body: ErrorView(message: _loadError!, onRetry: _load));
    }
    final s = Theme.of(context).colorScheme;
    final names = _machines.where((m) => (_v['machineIds'] as List).contains('${m['_id']}')).toList();
    return AppScaffold(
      title: title,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                key: const ValueKey('process-form'),
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                children: [
                  _field(
                    AppTextField(
                      key: const ValueKey('process/name'),
                      label: 'Process Name',
                      required: true,
                      controller: _name,
                      maxLength: 40,
                      validator: (_) => null,
                      onChanged: (t) => _set('processName', t),
                    ),
                    _errors['processName'],
                  ),
                  _field(
                    AppTextField(
                      key: const ValueKey('process/description'),
                      label: 'Description',
                      controller: _description,
                      maxLength: 200,
                      validator: (_) => null,
                      onChanged: (t) => _set('description', t),
                    ),
                    _errors['description'],
                  ),
                  const FieldLabel('Machines in this process'),
                  const SizedBox(height: 6),
                  InkWell(
                    key: const ValueKey('process/machines'),
                    borderRadius: BorderRadius.circular(12),
                    onTap: _pickMachines,
                    child: InputDecorator(
                      isEmpty: names.isEmpty,
                      decoration: const InputDecoration(
                        hintText: 'Select machines…',
                        suffixIcon: Icon(Icons.keyboard_arrow_down_rounded),
                      ),
                      child: names.isEmpty
                          ? const SizedBox(height: 20)
                          : Wrap(
                              spacing: 6,
                              runSpacing: 6,
                              children: [for (final m in names) _chip(context, '${m['machineName'] ?? ''}')],
                            ),
                    ),
                  ),
                  _note(
                    context,
                    "Entries made on these machines are what this process's dashboard shows. A machine already in another process isn't listed — take it out of that process first.",
                  ),
                  const SizedBox(height: 16),
                  const FieldLabel('Data Entry Page'),
                  const SizedBox(height: 6),
                  if (widget.isAdmin)
                    InkWell(
                      key: const ValueKey('process/menu'),
                      borderRadius: BorderRadius.circular(12),
                      onTap: _pickMenu,
                      child: InputDecorator(
                        isEmpty: '${_v['dataEntryMenu']}'.isEmpty,
                        decoration: const InputDecoration(
                          hintText: 'Not linked to a page',
                          suffixIcon: Icon(Icons.keyboard_arrow_down_rounded),
                        ),
                        child: Text(
                          _menuLabel(),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    )
                  else
                    // Browsing the menu list is Super Admin only server-side: a non-admin just
                    // sees what is linked.
                    InputDecorator(
                      key: const ValueKey('process/menu-readonly'),
                      decoration: const InputDecoration(enabled: false),
                      child: Text(
                        '${_v['dataEntryMenuLabel']}'.isEmpty ? 'Not linked to a page' : '${_v['dataEntryMenuLabel']}',
                        style: TextStyle(color: s.onSurfaceVariant),
                      ),
                    ),
                  _note(
                    context,
                    "The existing sidebar page where this process's own entries get typed in — that page then scopes itself to this process's machines instead of offering every process's.",
                  ),
                  const SizedBox(height: 16),
                  _plannedShiftCard(context),
                  if (widget.isAdmin) ...[
                    const SizedBox(height: 16),
                    _dashboardCard(context),
                  ],
                  const SizedBox(height: 8),
                  CheckboxListTile(
                    key: const ValueKey('process/active'),
                    contentPadding: EdgeInsets.zero,
                    controlAffinity: ListTileControlAffinity.leading,
                    title: const Text('Is Active'),
                    value: _v['isActive'] == true,
                    onChanged: (b) => _set('isActive', b == true),
                  ),
                ],
              ),
            ),
            _actionBar(context),
          ],
        ),
      ),
    );
  }

  String _menuLabel() {
    final url = '${_v['dataEntryMenu']}';
    if (url.isEmpty) return '';
    for (final m in _menus) {
      if (m.url == url) return m.label;
    }
    return '${_v['dataEntryMenuLabel']}';
  }

  Widget _field(Widget child, String? error) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        child,
        if (_submitted && error != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(error, style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12.5)),
          ),
      ],
    ),
  );

  Widget _chip(BuildContext context, String label) {
    final s = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: s.surfaceContainerHighest.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: s.outlineVariant),
      ),
      child: Text(label, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
    );
  }

  Widget _note(BuildContext context, String text) => Padding(
    padding: const EdgeInsets.only(top: 6),
    child: Text(text, style: TextStyle(fontSize: 12.5, color: Theme.of(context).colorScheme.onSurfaceVariant)),
  );

  Widget _plannedShiftCard(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final locked = _v['plannedShiftLocked'] == true;
    final can = widget.canSetShift;
    final hoursError = _errors['plannedShiftHours'];
    return Container(
      key: const ValueKey('process/shift'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: s.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(child: Text('Operator Planned Shift', style: TextStyle(fontWeight: FontWeight.w700))),
              if (can)
                Switch(
                  key: const ValueKey('process/shift-lock'),
                  value: locked,
                  onChanged: (b) => _set('plannedShiftLocked', b),
                )
              else
                Flexible(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: s.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      locked ? 'Locked · ${_v['plannedShiftHours']} hr' : 'Unlocked · typed on each entry',
                      style: TextStyle(fontSize: 12, color: s.onSurfaceVariant),
                    ),
                  ),
                ),
            ],
          ),
          if (can) Text(locked ? 'Locked' : 'Unlocked', style: const TextStyle(fontSize: 13)),
          if (locked && can) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                const Text('Shift hours', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                SizedBox(
                  width: 96,
                  child: TextField(
                    key: const ValueKey('process/shift-hours'),
                    controller: _hours,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
                    decoration: const InputDecoration(isDense: true),
                    onChanged: (t) => _set('plannedShiftHours', t),
                  ),
                ),
                Text('hr', style: TextStyle(color: s.onSurfaceVariant)),
                for (final h in const [8, 12, 24])
                  ChoiceChip(
                    key: ValueKey('process/shift-$h'),
                    label: Text('$h'),
                    selected: jsToNumber('${_v['plannedShiftHours']}') == h,
                    onSelected: (_) {
                      _hours.text = '$h';
                      _set('plannedShiftHours', '$h');
                    },
                  ),
              ],
            ),
          ],
          if (hoursError != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(hoursError, style: TextStyle(color: s.error, fontSize: 12.5)),
            ),
          _note(
            context,
            "Planned Operator Shift for this process's machines. Locked: the hours below, fixed on every entry. Unlocked: the hours are typed by hand on each data entry. Entries already saved keep their own value.${can ? '' : ' Only Admin or Super Admin can change this.'}",
          ),
        ],
      ),
    );
  }

  Widget _dashboardCard(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final stats = (_v['stats'] as List).length;
    final charts = (_v['charts'] as List).length;
    return Container(
      key: const ValueKey('process/dashboard'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), border: Border.all(color: s.outlineVariant)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Dashboard — what this process shows', style: TextStyle(fontWeight: FontWeight.w700)),
          _note(
            context,
            "Tick the KPI tiles and graphs this process's dashboard should show. Ticked cards are numbered in the order they appear — drag to move one earlier or later.",
          ),
          const SizedBox(height: 10),
          Text('$stats KPI tiles · $charts graphs', key: const ValueKey('process/dashboard-summary')),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            key: const ValueKey('process/customize'),
            onPressed: _customize,
            icon: const Icon(Icons.dashboard_customize_outlined),
            label: const Text('Choose KPI tiles & graphs'),
          ),
        ],
      ),
    );
  }

  Widget _actionBar(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Material(
      color: s.surface,
      elevation: 6,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        child: Row(
          children: [
            Expanded(
              child: OutlinedButton(
                key: const ValueKey('process/cancel'),
                onPressed: _saving ? null : () => Navigator.of(context).pop(false),
                child: const Text('Cancel'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: FilledButton(
                key: const ValueKey('process/save'),
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : Text(_editing ? 'Update' : 'Save'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A searchable checklist sheet; returns the chosen values (null when dismissed).
Future<List<String>?> showMultiPicker(
  BuildContext context, {
  required String title,
  required List<PickOption<String>> options,
  required List<String> selected,
  String emptyMessage = 'Nothing to choose from',
}) {
  return showModalBottomSheet<List<String>>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (ctx) => _MultiPickerSheet(title: title, options: options, selected: selected, emptyMessage: emptyMessage),
  );
}

class _MultiPickerSheet extends StatefulWidget {
  const _MultiPickerSheet({required this.title, required this.options, required this.selected, required this.emptyMessage});
  final String title;
  final List<PickOption<String>> options;
  final List<String> selected;
  final String emptyMessage;

  @override
  State<_MultiPickerSheet> createState() => _MultiPickerSheetState();
}

class _MultiPickerSheetState extends State<_MultiPickerSheet> {
  late final Set<String> _picked = {...widget.selected};
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final media = MediaQuery.of(context);
    final maxH = (media.size.height - media.viewInsets.bottom - media.padding.top) * 0.85;
    final q = _q.trim().toLowerCase();
    final list = [for (final o in widget.options) if (q.isEmpty || o.label.toLowerCase().contains(q)) o];
    return Padding(
      padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: maxH),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 8, 8),
              child: Row(
                children: [
                  Expanded(child: Text(widget.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))),
                  IconButton(tooltip: 'Close', icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(context)),
                ],
              ),
            ),
            if (widget.options.length > 6)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: TextField(
                  key: const ValueKey('multi-picker/search'),
                  onChanged: (v) => setState(() => _q = v),
                  decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search machines'),
                ),
              ),
            Divider(height: 1, color: s.outlineVariant),
            Flexible(
              child: list.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.all(28),
                      child: Text(widget.options.isEmpty ? widget.emptyMessage : 'No matches for “${_q.trim()}”', textAlign: TextAlign.center, style: TextStyle(color: s.onSurfaceVariant)),
                    )
                  : ListView.builder(
                      shrinkWrap: true,
                      itemCount: list.length,
                      itemBuilder: (_, i) {
                        final o = list[i];
                        return CheckboxListTile(
                          key: ValueKey('multi-picker/${o.value}'),
                          title: Text(o.label),
                          value: _picked.contains(o.value),
                          onChanged: (b) => setState(() => b == true ? _picked.add(o.value) : _picked.remove(o.value)),
                        );
                      },
                    ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  key: const ValueKey('multi-picker/done'),
                  // Keep the order the options came in, like the web's select.
                  onPressed: () => Navigator.pop(context, [for (final o in widget.options) if (_picked.contains(o.value)) o.value]),
                  child: Text('Done (${_picked.length})'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
