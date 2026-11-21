import 'package:flutter/material.dart';

/// "Email this report to…" — the web's prompt before mailing the Efficiency
/// Report. Returns the typed addresses ('' = the Company page's saved
/// recipients), or null when cancelled.
Future<String?> showReportEmailDialog(BuildContext context) => showDialog<String>(context: context, builder: (_) => const _ReportEmailDialog());

class _ReportEmailDialog extends StatefulWidget {
  const _ReportEmailDialog();

  @override
  State<_ReportEmailDialog> createState() => _ReportEmailDialogState();
}

class _ReportEmailDialogState extends State<_ReportEmailDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return AlertDialog(
      title: const Text('Email the report'),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'The Efficiency Report (OEE) for the period, process and machines on screen, as a PDF.',
                style: TextStyle(fontSize: 13, height: 1.35, color: cs.onSurfaceVariant),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _controller,
                autofocus: true,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.done,
                maxLines: 3,
                minLines: 1,
                decoration: const InputDecoration(
                  labelText: 'Send to',
                  hintText: 'name@company.com, another@company.com',
                  helperText: "Leave blank to send to the Company page's saved recipients",
                  helperMaxLines: 2,
                ),
                onSubmitted: (v) => Navigator.pop(context, v),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton.icon(
          onPressed: () => Navigator.pop(context, _controller.text),
          icon: const Icon(Icons.send_rounded, size: 18),
          label: const Text('Send'),
        ),
      ],
    );
  }
}
