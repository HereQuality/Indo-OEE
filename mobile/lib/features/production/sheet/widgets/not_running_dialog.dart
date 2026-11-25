import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../../core/api/api_client.dart';
import '../../../audit_trail/record_history_sheet.dart' show showMarkHistory;
import '../../../../core/widgets/form_widgets.dart';
import '../machine_day_status.dart';
import '../sheet_controller.dart';
import '../sheet_period.dart' show longDay;

const int notRunningRemarksMax = 300;

/// Opens the "Not running" form for [machineId] on [date] ([existing] = edit).
/// True when a mark was saved.
Future<bool> showNotRunningDialog(
  BuildContext context, {
  required SheetController controller,
  required String date,
  required String machineId,
  required String machineName,
  DayMark? existing,
}) async {
  final others = existing != null ? const <String>[] : controller.unfilledOn(date);
  final saved = await showDialog<bool>(
    context: context,
    builder: (_) => NotRunningDialog(
      controller: controller,
      date: date,
      machineId: machineId,
      machineName: machineName,
      existing: existing,
      unfilled: others.contains(machineId) ? others : [machineId, ...others],
    ),
  );
  return saved == true;
}

class NotRunningDialog extends StatefulWidget {
  const NotRunningDialog({
    super.key,
    required this.controller,
    required this.date,
    required this.machineId,
    required this.machineName,
    required this.unfilled,
    this.existing,
  });

  final SheetController controller;
  final String date;
  final String machineId;
  final String machineName;
  final DayMark? existing;

  /// Every unmarked empty row key that day (this one included).
  final List<String> unfilled;

  @override
  State<NotRunningDialog> createState() => _NotRunningDialogState();
}

class _NotRunningDialogState extends State<NotRunningDialog> {
  late final TextEditingController _remarks = TextEditingController(text: widget.existing?.remarks ?? '');
  late List<String> _picked = [...?widget.existing?.reasons];
  final Set<String> _machines = {};
  bool _saving = false;
  String? _error;
  bool _tried = false;

  @override
  void initState() {
    super.initState();
    widget.controller.ensureReasons().then((_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _remarks.dispose();
    super.dispose();
  }

  bool get _needsRemarks => _picked.contains('other');

  List<String> get _others => [for (final m in widget.unfilled) if (m != widget.machineId) m];

  List<String> _labels(List<String> values) {
    final byValue = {for (final r in widget.controller.reasons) r.value: r.label};
    return [for (final v in values) byValue[v] ?? v];
  }

  void _toggleReason(String value) {
    final order = [for (final r in widget.controller.reasons) r.value];
    final next = _picked.contains(value) ? (_picked.where((v) => v != value).toList()) : [..._picked, value];
    next.sort((a, b) => order.indexOf(a).compareTo(order.indexOf(b)));
    final text = autoRemarks(_remarks.text, _labels(_picked), _labels(next));
    setState(() {
      _picked = next;
      _remarks.value = TextEditingValue(text: text, selection: TextSelection.collapsed(offset: text.length));
    });
  }

  String? get _remarksError {
    if (!_tried) return null;
    if (_needsRemarks && _remarks.text.trim().isEmpty) return 'Remarks are required when the reason is Other';
    return null;
  }

  Future<void> _save() async {
    setState(() {
      _tried = true;
      _error = null;
    });
    if (_picked.isEmpty && _remarks.text.trim().isEmpty) {
      setState(() => _error = 'Pick a reason or write a description.');
      return;
    }
    if (_remarksError != null) return;
    setState(() => _saving = true);
    try {
      await widget.controller.saveMark(
        date: widget.date,
        machines: [widget.machineId, for (final m in _others) if (_machines.contains(m)) m],
        reasons: _picked.isEmpty ? const ['other'] : _picked,
        remarks: _remarks.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message.isEmpty ? 'Could not save. Please try again.' : e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not save. Please try again.');
    }
    if (mounted) setState(() => _saving = false);
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final reasons = widget.controller.reasons;
    final others = _others;
    final noun = widget.controller.spec.machineNoun;
    final remarksErr = _remarksError;
    return Dialog(
      key: const ValueKey('not-running-dialog'),
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(widget.existing != null ? 'Edit not running' : 'Not running', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text('${widget.machineName} · ${longDay(widget.date)}', style: TextStyle(fontSize: 13, color: s.onSurfaceVariant)),
              const SizedBox(height: 16),
              const FieldLabel('Reasons (pick one or more, or just write a description)', required: true),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final r in reasons)
                    FilterChip(
                      key: ValueKey('nr-reason-${r.value}'),
                      label: Text(r.label),
                      selected: _picked.contains(r.value),
                      onSelected: _saving ? null : (_) => _toggleReason(r.value),
                    ),
                ],
              ),
              const SizedBox(height: 16),
              AppTextField(
                key: const ValueKey('nr-remarks'),
                label: 'Remarks',
                required: _needsRemarks,
                controller: _remarks,
                hint: 'What happened (optional unless Other)',
                minLines: 3,
                maxLines: 6,
                maxLength: notRunningRemarksMax,
                enabled: !_saving,
                validator: (_) => null,
                textCapitalization: TextCapitalization.sentences,
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  Expanded(
                    child: remarksErr == null
                        ? const SizedBox.shrink()
                        : Text(remarksErr, key: const ValueKey('nr-remarks-error'), style: TextStyle(fontSize: 12, color: s.error)),
                  ),
                  Text('${_remarks.text.length}/$notRunningRemarksMax', key: const ValueKey('nr-counter'), style: TextStyle(fontSize: 12, color: s.onSurfaceVariant)),
                ],
              ),
              if (widget.existing == null && others.isNotEmpty) ...[
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(child: FieldLabel('Also mark other unfilled ${noun}s this day')),
                    TextButton(
                      key: const ValueKey('nr-select-all'),
                      onPressed: _saving
                          ? null
                          : () => setState(() => _machines.length == others.length ? _machines.clear() : _machines.addAll(others)),
                      child: Text(_machines.length == others.length ? 'Clear' : 'Select all'),
                    ),
                  ],
                ),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final m in others)
                      FilterChip(
                        key: ValueKey('nr-machine-$m'),
                        label: Text(widget.controller.machineName[m] ?? '—'),
                        selected: _machines.contains(m),
                        onSelected: _saving ? null : (on) => setState(() => on ? _machines.add(m) : _machines.remove(m)),
                      ),
                  ],
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!, key: const ValueKey('nr-error'), style: TextStyle(color: s.error, fontWeight: FontWeight.w600)),
              ],
              const SizedBox(height: 16),
              Wrap(
                alignment: WrapAlignment.end,
                spacing: 8,
                runSpacing: 8,
                children: [
                  // Editing a saved mark: who marked / changed it before (Audit Trail).
                  if (widget.existing != null)
                    TextButton.icon(
                      key: const ValueKey('nr-dialog-history'),
                      onPressed: _saving
                          ? null
                          : () => showMarkHistory(
                                context,
                                sheet: widget.controller.dayStatus.sheet,
                                date: widget.date,
                                machine: widget.machineId,
                                title: 'Not running · ${widget.machineName}',
                              ),
                      icon: const Icon(LucideIcons.history, size: 18),
                      label: const Text('History'),
                    ),
                  TextButton(
                    key: const ValueKey('nr-cancel'),
                    onPressed: _saving ? null : () => Navigator.of(context).pop(false),
                    child: const Text('Cancel'),
                  ),
                  PrimaryButton(key: const ValueKey('nr-save'), label: 'Save', expand: false, loading: _saving, onPressed: _save),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
