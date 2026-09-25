import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/utils/alerts.dart';
import '../../core/widgets/form_widgets.dart';
import 'attachments.dart';
import 'support_models.dart';
import 'support_repository.dart';

/// Phone / iPad-portrait: full page with a Back arrow.
class CreateTicketPage extends StatelessWidget {
  const CreateTicketPage({super.key, this.repo = const SupportRepository()});
  final SupportRepository repo;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Raise support ticket')),
        body: SafeArea(top: false, child: CreateTicketForm(repo: repo)),
      );
}

/// iPad: the same form in a centred dialog.
Future<Ticket?> showCreateTicketDialog(BuildContext context, {SupportRepository repo = const SupportRepository()}) =>
    showDialog<Ticket>(
      context: context,
      builder: (ctx) => Dialog(
        insetPadding: const EdgeInsets.all(24),
        clipBehavior: Clip.antiAlias,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 600, maxHeight: 760),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 8, 0),
                child: Row(
                  children: [
                    const Expanded(child: Text('Raise support ticket', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
                    IconButton(tooltip: 'Close', onPressed: () => Navigator.pop(ctx), icon: const Icon(Icons.close_rounded)),
                  ],
                ),
              ),
              Flexible(child: CreateTicketForm(repo: repo)),
            ],
          ),
        ),
      ),
    );

/// Port of the web CreateModal: subject + description required, platform
/// (Web/App), priority (Low/Medium/High), up to 5 attachments of 5 MB each.
/// Pops its route with the created [Ticket].
class CreateTicketForm extends StatefulWidget {
  const CreateTicketForm({super.key, this.repo = const SupportRepository()});
  final SupportRepository repo;

  @override
  State<CreateTicketForm> createState() => _CreateTicketFormState();
}

class _CreateTicketFormState extends State<CreateTicketForm> {
  final _formKey = GlobalKey<FormState>();
  final _subject = TextEditingController();
  final _description = TextEditingController();
  String _priority = 'Medium';
  // This is the phone app, so "App" is the sensible default (the web defaults to "Web").
  String _platform = 'App';
  List<PendingAttachment> _files = [];
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _subject.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _addFiles() async {
    final next = await chooseAttachments(context, _files);
    if (next != null && mounted) setState(() => _files = next);
  }

  Future<void> _submit() async {
    if (_busy) return;
    final subject = _subject.text.trim();
    final description = _description.text.trim();
    if (subject.isEmpty || description.isEmpty) {
      setState(() => _error = 'Subject and description are required.');
      _formKey.currentState?.validate();
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final t = await widget.repo.create(
        subject: subject,
        description: description,
        priority: _priority,
        platform: _platform,
        files: _files,
      );
      if (!mounted) return;
      Alerts.success('Ticket raised!');
      Navigator.of(context).pop(t);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'Failed to raise ticket.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    return Form(
      key: _formKey,
      child: SingleChildScrollView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_error != null)
              Container(
                width: double.infinity,
                margin: const EdgeInsets.only(bottom: 14),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: s.error.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                child: Text(_error!, style: TextStyle(color: s.error, fontWeight: FontWeight.w600)),
              ),
            AppTextField(
              label: 'Subject',
              required: true,
              controller: _subject,
              hint: 'Briefly describe the issue…',
              textInputAction: TextInputAction.next,
              textCapitalization: TextCapitalization.sentences,
              enabled: !_busy,
            ),
            const SizedBox(height: 16),
            const FieldLabel('Platform'),
            const SizedBox(height: 6),
            SizedBox(
              width: double.infinity,
              child: SegmentedButton<String>(
                showSelectedIcon: false,
                segments: const [
                  ButtonSegment(value: 'Web', icon: Icon(Icons.desktop_windows_outlined, size: 18), label: Text('Web')),
                  ButtonSegment(value: 'App', icon: Icon(Icons.phone_iphone_rounded, size: 18), label: Text('App')),
                ],
                selected: {_platform},
                onSelectionChanged: _busy ? null : (v) => setState(() => _platform = v.first),
              ),
            ),
            const SizedBox(height: 16),
            const FieldLabel('Priority'),
            const SizedBox(height: 6),
            SizedBox(
              width: double.infinity,
              child: SegmentedButton<String>(
                showSelectedIcon: false,
                segments: [for (final p in kTicketPriorities) ButtonSegment(value: p, label: Text(p))],
                selected: {_priority},
                onSelectionChanged: _busy ? null : (v) => setState(() => _priority = v.first),
              ),
            ),
            const SizedBox(height: 16),
            AppTextField(
              label: 'Description',
              required: true,
              controller: _description,
              hint: 'Steps to reproduce, what you expected, etc.',
              minLines: 4,
              maxLines: 8,
              keyboardType: TextInputType.multiline,
              textCapitalization: TextCapitalization.sentences,
              enabled: !_busy,
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                const Expanded(child: FieldLabel('Attachments (optional · max 5 MB each)')),
                Text('${_files.length}/$kMaxAttachments', style: TextStyle(fontSize: 12.5, color: s.onSurfaceVariant)),
              ],
            ),
            const SizedBox(height: 8),
            if (_files.isNotEmpty) ...[
              PendingAttachmentStrip(files: _files, enabled: !_busy, onRemove: (i) => setState(() => _files = [..._files]..removeAt(i))),
              const SizedBox(height: 8),
            ],
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
              onPressed: _busy || _files.length >= kMaxAttachments ? null : _addFiles,
              icon: const Icon(Icons.add_photo_alternate_outlined),
              label: const Text('Add photo or file'),
            ),
            const SizedBox(height: 24),
            PrimaryButton(label: 'Create ticket', icon: Icons.send_rounded, loading: _busy, onPressed: _submit),
          ],
        ),
      ),
    );
  }
}
