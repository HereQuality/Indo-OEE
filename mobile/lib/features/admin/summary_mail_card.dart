import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../core/utils/alerts.dart';
import '../../core/utils/formatters.dart';
import '../../core/widgets/form_widgets.dart';

/// The Company page's "Summary Email — OEE & OK Qty" card (web
/// client/src/Components/Common/SummaryMailCard.jsx): who gets the Efficiency
/// Report (OEE) by email and when — the daily one on the ticked weekdays
/// (Monday to Saturday) at its send time (9:00 AM by default) for the
/// previous day in full (Monday's covers Saturday and Sunday), the weekly one
/// on the chosen weekday at its send time (Monday 9:30 AM) for the previous
/// Monday to Sunday. "Send now" mails one straight away to check the setup.
class SummaryMailCard extends StatefulWidget {
  const SummaryMailCard({super.key});

  @override
  State<SummaryMailCard> createState() => _SummaryMailCardState();
}

const _weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Day chips in week order, Monday first.
const _dayChips = [1, 2, 3, 4, 5, 6, 0];
const _defaultDailyDays = [1, 2, 3, 4, 5, 6];

/// "Mon to Sat", "every day", "Mon, Wed, Fri".
String daysLabel(Iterable<int> days) {
  final d = days.where((x) => x >= 0 && x <= 6).toSet();
  if (d.length == 7) return 'every day';
  final inOrder = _dayChips.where(d.contains).toList();
  if (inOrder.isEmpty) return 'no day';
  String short(int x) => _weekdays[x].substring(0, 3);
  var run = true;
  for (var i = 1; i < inOrder.length; i++) {
    if (_dayChips.indexOf(inOrder[i]) != _dayChips.indexOf(inOrder[i - 1]) + 1) run = false;
  }
  return run && inOrder.length > 2 ? '${short(inOrder.first)} to ${short(inOrder.last)}' : inOrder.map(short).join(', ');
}

class _SummaryMailSettings {
  _SummaryMailSettings({
    this.recipients = const [],
    this.dailyEnabled = true,
    this.weeklyEnabled = true,
    this.dailySendAt = '09:00',
    this.dailyDays = _defaultDailyDays,
    this.weeklySendAt = '09:30',
    this.weeklyDay = 1,
    this.lastDailyFor = '',
    this.lastWeeklyFor = '',
    this.mailConfigured = true,
  });

  factory _SummaryMailSettings.fromJson(Map<String, dynamic> d) => _SummaryMailSettings(
        recipients: [for (final e in (d['recipients'] as List? ?? const [])) e.toString()],
        dailyEnabled: d['dailyEnabled'] != false,
        weeklyEnabled: d['weeklyEnabled'] != false,
        dailySendAt: (d['dailySendAt'] ?? '09:00').toString(),
        dailyDays: (d['dailyDays'] as List?)?.map((e) => (e as num).toInt()).toList() ?? _defaultDailyDays,
        weeklySendAt: (d['weeklySendAt'] ?? '09:30').toString(),
        weeklyDay: (d['weeklyDay'] as num?)?.toInt() ?? 1,
        lastDailyFor: (d['lastDailyFor'] ?? '').toString(),
        lastWeeklyFor: (d['lastWeeklyFor'] ?? '').toString(),
        mailConfigured: d['mailConfigured'] != false,
      );

  final List<String> recipients;
  final bool dailyEnabled;
  final bool weeklyEnabled;
  final String dailySendAt;
  final List<int> dailyDays;
  final String weeklySendAt;
  final int weeklyDay;
  final String lastDailyFor;
  final String lastWeeklyFor;
  final bool mailConfigured;
}

/// The addresses typed in: one per line / comma / space.
List<String> parseRecipients(String raw) => [
      for (final e in raw.split(RegExp(r'[\s,;]+')))
        if (e.trim().isNotEmpty) e.trim().toLowerCase(),
    ];

class _SummaryMailCardState extends State<SummaryMailCard> {
  _SummaryMailSettings? _saved;
  String? _error;
  bool _saving = false;
  String _sending = '';

  final _recipients = TextEditingController();
  final _testTo = TextEditingController();
  bool _daily = true;
  bool _weekly = true;
  String _dailyAt = '09:00';
  Set<int> _dailyDays = _defaultDailyDays.toSet();
  String _weeklyAt = '09:30';
  int _weeklyDay = 1;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _recipients.dispose();
    _testTo.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final res = await Api.get(Endpoints.summaryMail);
      if (!mounted) return;
      _apply(_SummaryMailSettings.fromJson(asMap(res)));
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : "Couldn't load the summary email settings");
    }
  }

  void _apply(_SummaryMailSettings s) => setState(() {
        _saved = s;
        _recipients.text = s.recipients.join('\n');
        _daily = s.dailyEnabled;
        _weekly = s.weeklyEnabled;
        _dailyAt = s.dailySendAt;
        _dailyDays = s.dailyDays.toSet();
        _weeklyAt = s.weeklySendAt;
        _weeklyDay = s.weeklyDay;
      });

  List<int> get _dailyDaysSorted => _dailyDays.toList()..sort();

  bool get _dirty {
    final s = _saved;
    if (s == null) return false;
    return parseRecipients(_recipients.text).join(',') != s.recipients.join(',') ||
        _daily != s.dailyEnabled ||
        _weekly != s.weeklyEnabled ||
        _dailyAt != s.dailySendAt ||
        _dailyDaysSorted.join(',') != (s.dailyDays.toList()..sort()).join(',') ||
        _weeklyAt != s.weeklySendAt ||
        _weeklyDay != s.weeklyDay;
  }

  Future<void> _save() async {
    FocusScope.of(context).unfocus();
    setState(() => _saving = true);
    try {
      final res = await Api.put(Endpoints.summaryMail, body: {
        'recipients': parseRecipients(_recipients.text),
        'dailyEnabled': _daily,
        'weeklyEnabled': _weekly,
        'dailySendAt': _dailyAt,
        'dailyDays': _dailyDaysSorted,
        'weeklySendAt': _weeklyAt,
        'weeklyDay': _weeklyDay,
      });
      if (!mounted) return;
      _apply(_SummaryMailSettings.fromJson(asMap(res)));
      Alerts.success('Summary email settings saved.');
    } catch (e) {
      Alerts.error(e is ApiException ? e.message : 'Failed to save the summary email settings.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _sendNow(String kind) async {
    setState(() => _sending = kind);
    try {
      final to = _testTo.text.trim();
      final res = await Api.post(Endpoints.summaryMailSend, body: {'kind': kind, if (to.isNotEmpty) 'to': to});
      Alerts.success(res['message'] is String ? res['message'] as String : 'Sent.');
    } catch (e) {
      Alerts.error(e is ApiException ? e.message : "Couldn't send the summary.");
    } finally {
      if (mounted) setState(() => _sending = '');
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final s = _saved;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(Icons.mail_outline_rounded, size: 20, color: cs.onSurface),
              const SizedBox(width: 8),
              const Expanded(child: Text('Summary Email — OEE & OK Qty', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
            ]),
            const SizedBox(height: 12),
            if (s == null && _error == null)
              const Padding(padding: EdgeInsets.symmetric(vertical: 24), child: Center(child: CircularProgressIndicator()))
            else if (s == null)
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(_error!, style: TextStyle(color: cs.error)),
                const SizedBox(height: 8),
                OutlinedButton(onPressed: _load, child: const Text('Retry')),
              ])
            else
              ..._form(context, s),
          ],
        ),
      ),
    );
  }

  List<Widget> _form(BuildContext context, _SummaryMailSettings s) {
    final cs = Theme.of(context).colorScheme;
    final count = parseRecipients(_recipients.text).length;
    final small = TextStyle(fontSize: 12.5, height: 1.4, color: cs.onSurfaceVariant);
    return [
      if (!s.mailConfigured)
        Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: const Color(0xFFFEF3C7), borderRadius: BorderRadius.circular(10)),
          child: const Text(
            "Email isn't set up on the server yet — add SMTP_HOST, SMTP_USER and SMTP_PASS to the server's .env and restart it. Settings saved here are kept and used once that's done.",
            style: TextStyle(fontSize: 12.5, height: 1.4, color: Color(0xFF78350F)),
          ),
        ),
      Text(
        'The Efficiency Report (OEE) for every process and machine, as a PDF with the OEE and OK Qty summary in the mail: the daily one goes out ${daysLabel(_dailyDays)} at ${Fmt.hm12(_dailyAt)} with the previous day\'s entries in full (after a skipped day it covers every day since the last mail, so Saturday and Sunday both arrive on Monday); the weekly one on ${_weekdays[_weeklyDay]} at ${Fmt.hm12(_weeklyAt)} with the previous Monday to Sunday. Times are Indian Standard Time.',
        style: small,
      ),
      const SizedBox(height: 14),
      AppTextField(
        label: 'Send to (one email per line)',
        controller: _recipients,
        hint: 'owner@company.com\nplant.head@company.com',
        minLines: 3,
        maxLines: 6,
        keyboardType: TextInputType.multiline,
        onChanged: (_) => setState(() {}),
        helper: count == 0 ? 'No recipients yet' : '$count recipient${count == 1 ? '' : 's'}',
      ),
      const SizedBox(height: 12),
      Material(
        color: cs.surfaceContainerHighest.withValues(alpha: 0.5),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: cs.outlineVariant)),
        child: Padding(
        padding: const EdgeInsets.fromLTRB(4, 4, 12, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SwitchListTile.adaptive(
              value: _daily,
              onChanged: (v) => setState(() => _daily = v),
              dense: true,
              contentPadding: const EdgeInsets.symmetric(horizontal: 8),
              title: const Text('Daily report', style: TextStyle(fontWeight: FontWeight.w600)),
              subtitle: const Text('Previous day, in full'),
            ),
            Padding(
              padding: const EdgeInsets.only(left: 8),
              child: AppTimeField(key: ValueKey('daily:$_dailyAt'), label: 'Daily send time', value: _dailyAt, enabled: _daily, onChanged: (v) => setState(() => _dailyAt = v ?? _dailyAt)),
            ),
            const SizedBox(height: 10),
            Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const FieldLabel('Daily send days'),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final d in _dayChips)
                      FilterChip(
                        label: Text(_weekdays[d].substring(0, 3)),
                        selected: _dailyDays.contains(d),
                        onSelected: _daily ? (on) => setState(() => on ? _dailyDays.add(d) : _dailyDays.remove(d)) : null,
                        visualDensity: VisualDensity.compact,
                      ),
                  ],
                ),
                if (_dailyDays.isEmpty) ...[
                  const SizedBox(height: 4),
                  Text('Pick at least one day.', style: TextStyle(fontSize: 12, color: cs.error)),
                ],
              ]),
            ),
            const SizedBox(height: 10),
            SwitchListTile.adaptive(
              value: _weekly,
              onChanged: (v) => setState(() => _weekly = v),
              dense: true,
              contentPadding: const EdgeInsets.symmetric(horizontal: 8),
              title: const Text('Weekly report', style: TextStyle(fontWeight: FontWeight.w600)),
              subtitle: const Text('Previous Monday to Sunday'),
            ),
            Padding(
              padding: const EdgeInsets.only(left: 8),
              child: LayoutBuilder(
                builder: (context, c) {
                  final day = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const FieldLabel('Weekly on'),
                    const SizedBox(height: 6),
                    DropdownButtonFormField<int>(
                      initialValue: _weeklyDay,
                      isExpanded: true,
                      items: [for (var i = 0; i < 7; i++) DropdownMenuItem(value: i, child: Text(_weekdays[i]))],
                      onChanged: _weekly ? (v) => setState(() => _weeklyDay = v ?? _weeklyDay) : null,
                    ),
                  ]);
                  final time = AppTimeField(key: ValueKey('weekly:$_weeklyAt'), label: 'Weekly send time', value: _weeklyAt, enabled: _weekly, onChanged: (v) => setState(() => _weeklyAt = v ?? _weeklyAt));
                  if (c.maxWidth < 420) return Column(children: [day, const SizedBox(height: 10), time]);
                  return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: day), const SizedBox(width: 10), Expanded(child: time)]);
                },
              ),
            ),
          ],
        ),
        ),
      ),
      if (s.lastDailyFor.isNotEmpty || s.lastWeeklyFor.isNotEmpty) ...[
        const SizedBox(height: 8),
        Text(
          [if (s.lastDailyFor.isNotEmpty) 'Last daily sent on ${s.lastDailyFor}.', if (s.lastWeeklyFor.isNotEmpty) 'Last weekly sent on ${s.lastWeeklyFor}.'].join(' '),
          style: small,
        ),
      ],
      const SizedBox(height: 14),
      AppTextField(
        label: 'Send now to…',
        controller: _testTo,
        hint: 'Blank = saved recipients',
        keyboardType: TextInputType.emailAddress,
      ),
      const SizedBox(height: 8),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          OutlinedButton.icon(
            onPressed: _sending.isNotEmpty || !s.mailConfigured ? null : () => _sendNow('daily'),
            icon: _sending == 'daily' ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send_rounded, size: 16),
            label: const Text('Send daily now'),
          ),
          OutlinedButton.icon(
            onPressed: _sending.isNotEmpty || !s.mailConfigured ? null : () => _sendNow('weekly'),
            icon: _sending == 'weekly' ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send_rounded, size: 16),
            label: const Text('Send weekly now'),
          ),
        ],
      ),
      const SizedBox(height: 14),
      PrimaryButton(label: 'Save Settings', loading: _saving, onPressed: _dirty && _dailyDays.isNotEmpty ? _save : null),
    ];
  }
}
