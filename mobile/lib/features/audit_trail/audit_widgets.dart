import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/widgets/form_widgets.dart' show FieldLabel;
import 'audit_models.dart';

/// Coloured pill naming the action ("Created", "Edited", "Marked Not running" …).
class ActionBadge extends StatelessWidget {
  const ActionBadge({super.key, required this.action, this.label});
  final String action;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final c = auditActionColor(action);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(999), border: Border.all(color: c.withValues(alpha: 0.45))),
      child: Text(label ?? auditActionLabel(action), style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: c, height: 1.2)),
    );
  }
}

/// Grey pill naming the module ("CNC data entry", "Machines", "Sign-in" …).
class ModuleChip extends StatelessWidget {
  const ModuleChip({super.key, required this.module});
  final String module;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: s.surfaceContainerHighest, borderRadius: BorderRadius.circular(999)),
      child: Text(module, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: s.onSurfaceVariant, height: 1.2)),
    );
  }
}

/// The changed fields of one log: `label | from → to`. For a whole record
/// (create / delete) just the value; folded after [foldAfter] rows with a
/// "Show all N fields" link.
class ChangeList extends StatefulWidget {
  const ChangeList({super.key, required this.log, this.foldAfter = 8});
  final AuditLog log;
  final int foldAfter;

  @override
  State<ChangeList> createState() => _ChangeListState();
}

class _ChangeListState extends State<ChangeList> {
  bool _all = false;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final log = widget.log;
    final changes = log.changes;
    if (changes.isEmpty) {
      return Text('No field details recorded.', style: TextStyle(fontSize: 12.5, color: s.onSurfaceVariant, fontStyle: FontStyle.italic));
    }
    final folded = log.isWholeRecord && !_all && changes.length > widget.foldAfter;
    final shown = folded ? changes.take(widget.foldAfter).toList() : changes;
    final labelStyle = TextStyle(fontSize: 12.5, color: s.onSurfaceVariant, fontWeight: FontWeight.w600);
    const valueStyle = TextStyle(fontSize: 12.5);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final c in shown)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(flex: 2, child: Text(c.label, style: labelStyle)),
                const SizedBox(width: 8),
                Expanded(
                  flex: 3,
                  child: log.isWholeRecord
                      ? Text(auditValueText(log.action == 'delete' ? (c.from ?? c.to) : (c.to ?? c.from)), style: valueStyle)
                      : Text.rich(
                          TextSpan(children: [
                            TextSpan(text: auditValueText(c.from), style: TextStyle(color: s.onSurfaceVariant, decoration: TextDecoration.lineThrough)),
                            const TextSpan(text: '  →  '),
                            TextSpan(text: auditValueText(c.to), style: const TextStyle(fontWeight: FontWeight.w600)),
                          ]),
                          style: valueStyle,
                        ),
                ),
              ],
            ),
          ),
        if (folded)
          TextButton(
            key: const ValueKey('audit-show-all-fields'),
            style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 4), minimumSize: const Size(0, 32), tapTargetSize: MaterialTapTargetSize.shrinkWrap),
            onPressed: () => setState(() => _all = true),
            child: Text('Show all ${changes.length} fields'),
          ),
      ],
    );
  }
}

/// One line of the trail: badge + module + what, "by who · role · Web/App",
/// the time (IST) on the right; tap to open the field changes, remark and
/// metrics. [expanded] opens it from the start (record history).
class AuditLogTile extends StatefulWidget {
  const AuditLogTile({super.key, required this.log, this.expanded = false, this.actionLabel, this.dense = false});
  final AuditLog log;
  final bool expanded;
  final String? actionLabel;
  final bool dense;

  @override
  State<AuditLogTile> createState() => _AuditLogTileState();
}

class _AuditLogTileState extends State<AuditLogTile> {
  late bool _open = widget.expanded;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final log = widget.log;
    final who = [
      if (log.actor.name.isNotEmpty) 'by ${log.actor.name}' else 'by —',
      if (log.actor.role.isNotEmpty) log.actor.role,
      if (log.clientLabel.isNotEmpty) log.clientLabel,
    ].join(' · ');
    final metrics = log.isEntry ? auditMetricsLine(log.metrics) : null;
    final hasDetail = log.changes.isNotEmpty || log.remark.isNotEmpty || metrics != null || log.flagged.isNotEmpty || log.ip.isNotEmpty;
    final tone = auditActionColor(log.action);

    return Container(
      margin: EdgeInsets.only(bottom: widget.dense ? 6 : 8),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color ?? s.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: s.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Positioned(left: 0, top: 0, bottom: 0, width: 4, child: ColoredBox(color: tone.withValues(alpha: 0.7))),
          InkWell(
            onTap: hasDetail ? () => setState(() => _open = !_open) : null,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Wrap(
                          spacing: 6,
                          runSpacing: 4,
                          children: [
                            ActionBadge(action: log.action, label: widget.actionLabel),
                            if (log.module.isNotEmpty) ModuleChip(module: log.module),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text('${formatIst(log.createdAt)} IST', style: TextStyle(fontSize: 11.5, color: s.onSurfaceVariant, fontFeatures: const [FontFeature.tabularFigures()])),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(log.label.isEmpty ? auditActionLabel(log.action) : log.label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, height: 1.25)),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Expanded(child: Text(who, style: TextStyle(fontSize: 12.5, color: s.onSurfaceVariant), maxLines: 2, overflow: TextOverflow.ellipsis)),
                      if (hasDetail)
                        Icon(_open ? Icons.expand_less : Icons.expand_more, size: 18, color: s.onSurfaceVariant),
                    ],
                  ),
                  if (_open && hasDetail) ...[
                    const SizedBox(height: 8),
                    Divider(height: 1, color: s.outlineVariant),
                    const SizedBox(height: 8),
                    if (log.changes.isNotEmpty) ChangeList(log: log),
                    if (log.flagged.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        'Over 100%: ${log.flagged.map((f) => '${f.metric} ${auditValueText(f.value)}').join(', ')}',
                        style: TextStyle(fontSize: 12.5, color: auditActionColor('flagged'), fontWeight: FontWeight.w600),
                      ),
                    ],
                    if (metrics != null) ...[
                      const SizedBox(height: 6),
                      Row(children: [
                        Icon(LucideIcons.gauge, size: 14, color: s.onSurfaceVariant),
                        const SizedBox(width: 6),
                        Expanded(child: Text(metrics, key: const ValueKey('audit-metrics'), style: TextStyle(fontSize: 12.5, color: s.onSurfaceVariant, fontFeatures: const [FontFeature.tabularFigures()]))),
                      ]),
                    ],
                    if (log.remark.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text('Remark: ${log.remark}', style: const TextStyle(fontSize: 12.5, fontStyle: FontStyle.italic)),
                    ],
                    if (log.machineName.isNotEmpty || log.date.isNotEmpty || log.ip.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        [
                          if (log.machineName.isNotEmpty) log.machineName,
                          if (log.date.isNotEmpty) displayDay(log.date),
                          if (log.ip.isNotEmpty) 'IP ${log.ip}',
                        ].join(' · '),
                        style: TextStyle(fontSize: 11.5, color: s.onSurfaceVariant),
                      ),
                    ],
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The filter form: date range with quick picks, Module / Action / User
/// dropdowns, Search, Reset and Apply. The same widget is the tablet's left
/// panel and the phone's bottom sheet ([inSheet] adds a title and close).
class FiltersSheet extends StatefulWidget {
  const FiltersSheet({
    super.key,
    required this.initial,
    required this.options,
    required this.onApply,
    this.inSheet = false,
  });

  final AuditFilters initial;
  final AuditFilterOptions options;
  final ValueChanged<AuditFilters> onApply;
  final bool inSheet;

  @override
  State<FiltersSheet> createState() => _FiltersSheetState();
}

class _FiltersSheetState extends State<FiltersSheet> {
  late AuditFilters _f = widget.initial;
  late final TextEditingController _q = TextEditingController(text: widget.initial.q);

  @override
  void didUpdateWidget(covariant FiltersSheet old) {
    super.didUpdateWidget(old);
    if (old.initial != widget.initial && widget.initial != _f) {
      _f = widget.initial;
      _q.text = widget.initial.q;
    }
  }

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  Future<void> _pickDate(bool from) async {
    final current = DateTime.tryParse(from ? _f.from : _f.to) ?? DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 1)),
      helpText: from ? 'From' : 'To',
    );
    if (picked == null || !mounted) return;
    setState(() => _f = from ? _f.copyWith(from: isoDay(picked)) : _f.copyWith(to: isoDay(picked)));
  }

  void _quick(AuditFilters range) => setState(() => _f = _f.copyWith(from: range.from, to: range.to));

  void _apply() => widget.onApply(_f.copyWith(q: _q.text.trim()));

  void _reset() {
    final d = AuditFilters.lastDays(30);
    _q.text = '';
    setState(() => _f = d);
    widget.onApply(d);
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final o = widget.options;
    final today = AuditFilters.lastDays(1);
    final week = AuditFilters.lastDays(7);
    final month = AuditFilters.lastDays(30);
    final thisMonth = AuditFilters.thisMonth();
    bool isRange(AuditFilters r) => _f.from == r.from && _f.to == r.to;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.inSheet)
          Row(children: [
            const Expanded(child: Text('Filter', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
            IconButton(tooltip: 'Close', onPressed: () => Navigator.of(context).maybePop(), icon: const Icon(Icons.close)),
          ])
        else
          const Padding(padding: EdgeInsets.only(bottom: 4), child: Text('Filter', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
        const SizedBox(height: 6),
        const FieldLabel('Date range'),
        Row(children: [
          Expanded(child: _DateBox(key: const ValueKey('audit-filter-from'), label: 'From', value: _f.from, onTap: () => _pickDate(true))),
          const SizedBox(width: 8),
          Expanded(child: _DateBox(key: const ValueKey('audit-filter-to'), label: 'To', value: _f.to, onTap: () => _pickDate(false))),
        ]),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            _QuickPick(key: const ValueKey('audit-quick-today'), label: 'Today', selected: isRange(today), onTap: () => _quick(today)),
            _QuickPick(key: const ValueKey('audit-quick-7'), label: '7 days', selected: isRange(week), onTap: () => _quick(week)),
            _QuickPick(key: const ValueKey('audit-quick-30'), label: '30 days', selected: isRange(month), onTap: () => _quick(month)),
            _QuickPick(key: const ValueKey('audit-quick-month'), label: 'This month', selected: isRange(thisMonth), onTap: () => _quick(thisMonth)),
          ],
        ),
        const SizedBox(height: 14),
        const FieldLabel('Module'),
        _Dropdown(
          key: const ValueKey('audit-filter-module'),
          value: _f.modules.length == 1 ? _f.modules.first : '',
          allLabel: 'All modules',
          items: [for (final m in o.modules) (m.key, m.label)],
          onChanged: (v) => setState(() => _f = _f.copyWith(modules: v.isEmpty ? const [] : [v])),
        ),
        const SizedBox(height: 12),
        const FieldLabel('Action'),
        _Dropdown(
          key: const ValueKey('audit-filter-action'),
          value: _f.actions.length == 1 ? _f.actions.first : '',
          allLabel: 'All actions',
          items: [for (final a in o.actions) (a.key, a.label)],
          onChanged: (v) => setState(() => _f = _f.copyWith(actions: v.isEmpty ? const [] : [v])),
        ),
        const SizedBox(height: 12),
        const FieldLabel('User'),
        _Dropdown(
          key: const ValueKey('audit-filter-actor'),
          value: _f.actor,
          allLabel: 'Everyone',
          items: [for (final a in o.actors) (a.id, a.role.isEmpty ? a.name : '${a.name} · ${a.role}')],
          onChanged: (v) => setState(() => _f = _f.copyWith(actor: v)),
        ),
        const SizedBox(height: 12),
        const FieldLabel('Search'),
        TextField(
          key: const ValueKey('audit-filter-q'),
          controller: _q,
          textInputAction: TextInputAction.search,
          onSubmitted: (_) => _apply(),
          decoration: InputDecoration(
            isDense: true,
            hintText: 'Machine, part, user, remark…',
            prefixIcon: const Icon(Icons.search, size: 20),
            suffixIcon: _q.text.isEmpty ? null : IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => setState(() => _q.clear())),
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          ),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 16),
        Row(children: [
          Expanded(child: OutlinedButton(key: const ValueKey('audit-filter-reset'), onPressed: _reset, child: const Text('Reset'))),
          const SizedBox(width: 8),
          Expanded(child: FilledButton(key: const ValueKey('audit-filter-apply'), onPressed: _apply, child: const Text('Apply'))),
        ]),
        if (!widget.inSheet) ...[
          const SizedBox(height: 10),
          Text('Times are IST.', style: TextStyle(fontSize: 11.5, color: s.onSurfaceVariant)),
        ],
      ],
    );
  }
}

class _DateBox extends StatelessWidget {
  const _DateBox({super.key, required this.label, required this.value, required this.onTap});
  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: InputDecorator(
        decoration: InputDecoration(labelText: label, isDense: true, contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12), suffixIcon: const Icon(Icons.calendar_today_outlined, size: 18)),
        child: Text(value.isEmpty ? 'Any' : displayDay(value), style: TextStyle(fontSize: 14, color: value.isEmpty ? s.onSurfaceVariant : s.onSurface), maxLines: 1, overflow: TextOverflow.ellipsis),
      ),
    );
  }
}

class _QuickPick extends StatelessWidget {
  const _QuickPick({super.key, required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onTap(),
        visualDensity: VisualDensity.compact,
        labelStyle: const TextStyle(fontSize: 12.5),
      );
}

class _Dropdown extends StatelessWidget {
  const _Dropdown({super.key, required this.value, required this.allLabel, required this.items, required this.onChanged});
  final String value;
  final String allLabel;
  final List<(String, String)> items;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final known = value.isEmpty || items.any((i) => i.$1 == value);
    return DropdownButtonFormField<String>(
      key: ValueKey('$value|${items.length}'),
      initialValue: known ? value : '',
      isExpanded: true,
      decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
      items: [
        DropdownMenuItem(value: '', child: Text(allLabel)),
        for (final i in items) DropdownMenuItem(value: i.$1, child: Text(i.$2, overflow: TextOverflow.ellipsis)),
      ],
      onChanged: (v) => onChanged(v ?? ''),
    );
  }
}
