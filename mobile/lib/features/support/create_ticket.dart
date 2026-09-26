import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/utils/alerts.dart';
import '../../core/widgets/form_widgets.dart';
import '../profile/compact_field.dart';
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
    // sticky: the Create button rides on top of the keyboard.
    body: TapToDismiss(child: CreateTicketForm(repo: repo, sticky: true)),
  );
}

/// iPad: the same form in a centred dialog.
Future<Ticket?> showCreateTicketDialog(
  BuildContext context, {
  SupportRepository repo = const SupportRepository(),
}) => showDialog<Ticket>(
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
            padding: const EdgeInsets.fromLTRB(16, 4, 4, 0),
            child: Row(
              children: [
                const Expanded(
                  child: Text(
                    'Raise support ticket',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                  ),
                ),
                IconButton(
                  tooltip: 'Close',
                  onPressed: () => Navigator.pop(ctx),
                  icon: const Icon(Icons.close_rounded),
                ),
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
  const CreateTicketForm({super.key, this.repo = const SupportRepository(), this.sticky = false});
  final SupportRepository repo;

  /// true: the Create button is a bar pinned under the form (full page). false:
  /// it is the last item of the scrolling form (dialog).
  final bool sticky;

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

  /// Chips wrap onto a new line at large text sizes (a SegmentedButton cannot).
  Widget _choice(String label, IconData? icon, bool selected, VoidCallback onTap) => ChoiceChip(
        avatar: icon == null ? null : Icon(icon, size: 16),
        label: Text(label),
        selected: selected,
        showCheckmark: false,
        visualDensity: VisualDensity.compact,
        labelStyle: TextStyle(fontSize: 13, fontWeight: selected ? FontWeight.w700 : FontWeight.w500),
        onSelected: _busy ? null : (_) => onTap(),
      );

  Widget _label(String text) => Text(text, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600));

  Widget _submitButton() => PrimaryButton(
        label: 'Create ticket',
        icon: Icons.send_rounded,
        loading: _busy,
        onPressed: _submit,
      );

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final form = Form(
      key: _formKey,
      child: SingleChildScrollView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: EdgeInsets.fromLTRB(16, 12, 16, widget.sticky ? 16 : 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_error != null)
              Container(
                width: double.infinity,
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: s.error.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  _error!,
                  style: TextStyle(fontSize: 13, color: s.error, fontWeight: FontWeight.w600),
                ),
              ),
            CompactField(
              label: 'Subject',
              required: true,
              controller: _subject,
              hint: 'Briefly describe the issue…',
              keyboardType: TextInputType.text,
              textInputAction: TextInputAction.next,
              textCapitalization: TextCapitalization.sentences,
              enabled: !_busy,
            ),
            const SizedBox(height: 12),
            _label('Platform'),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                _choice('Web', Icons.desktop_windows_outlined, _platform == 'Web', () => setState(() => _platform = 'Web')),
                _choice('App', Icons.phone_iphone_rounded, _platform == 'App', () => setState(() => _platform = 'App')),
              ],
            ),
            const SizedBox(height: 12),
            _label('Priority'),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                for (final p in kTicketPriorities) _choice(p, null, _priority == p, () => setState(() => _priority = p)),
              ],
            ),
            const SizedBox(height: 12),
            CompactField(
              label: 'Description',
              required: true,
              controller: _description,
              hint: 'Steps to reproduce, what you expected, etc.',
              minLines: 4,
              maxLines: 8,
              keyboardType: TextInputType.multiline,
              textInputAction: TextInputAction.newline,
              textCapitalization: TextCapitalization.sentences,
              enabled: !_busy,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: _label('Attachments (optional · max 5 MB each)')),
                Text(
                  '${_files.length}/$kMaxAttachments',
                  style: TextStyle(fontSize: 12, color: s.onSurfaceVariant),
                ),
              ],
            ),
            const SizedBox(height: 6),
            if (_files.isNotEmpty) ...[
              PendingAttachmentStrip(
                files: _files,
                enabled: !_busy,
                onRemove: (i) => setState(() => _files = [..._files]..removeAt(i)),
              ),
              const SizedBox(height: 6),
            ],
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40), visualDensity: VisualDensity.compact),
              onPressed: _busy || _files.length >= kMaxAttachments ? null : _addFiles,
              icon: const Icon(Icons.add_photo_alternate_outlined, size: 18),
              label: const Text('Add photo or file'),
            ),
            if (!widget.sticky) ...[
              const SizedBox(height: 16),
              _submitButton(),
            ],
          ],
        ),
      ),
    );
    if (!widget.sticky) return form;
    return Column(
      children: [
        Expanded(child: form),
        Material(
          color: s.surface,
          elevation: 6,
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: _submitButton(),
            ),
          ),
        ),
      ],
    );
  }
}
