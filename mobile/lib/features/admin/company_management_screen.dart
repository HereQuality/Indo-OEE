import 'dart:typed_data';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../app/app_scaffold.dart';
import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import '../../core/utils/alerts.dart';
import '../../core/widgets/form_widgets.dart';
import '../../providers/company_provider.dart';
import 'summary_mail_card.dart';

/// Replaceable in tests (image_picker has no platform there).
@visibleForTesting
Future<XFile?> Function()? debugCompanyImagePicker;

/// The Company page (web client/src/pages/CompanyManagement.jsx), Super Admin
/// only: the company's name, logo and favicon, and the Summary Email card —
/// who gets the daily / weekly Efficiency Report (OEE) and when.
class CompanyManagementScreen extends StatefulWidget {
  const CompanyManagementScreen({super.key});

  @override
  State<CompanyManagementScreen> createState() => _CompanyManagementScreenState();
}

class _Picked {
  _Picked(this.name, this.bytes);
  final String name;
  final Uint8List bytes;
}

class _CompanyManagementScreenState extends State<CompanyManagementScreen> {
  final _name = TextEditingController();
  bool _loading = true;
  bool _saving = false;
  String _savedName = '';
  String? _currentLogo;
  String? _currentFavicon;
  _Picked? _logo;
  _Picked? _favicon;
  bool _removeLogo = false;
  bool _removeFavicon = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final d = asMap(await Api.get(Endpoints.companyDetails));
      if (!mounted) return;
      setState(() {
        _savedName = (d['name'] ?? '').toString();
        _name.text = _savedName;
        _currentLogo = _url(d['logo']);
        _currentFavicon = _url(d['favicon']);
        _logo = null;
        _favicon = null;
        _removeLogo = false;
        _removeFavicon = false;
      });
    } catch (e) {
      Alerts.error(e is ApiException ? e.message : 'Failed to load company settings');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String? _url(Object? v) {
    final s = v?.toString() ?? '';
    return s.isEmpty ? null : s;
  }

  bool get _changed => _name.text.trim() != _savedName || _logo != null || _removeLogo || _favicon != null || _removeFavicon;

  Future<void> _pick(bool logo) async {
    try {
      final picker = debugCompanyImagePicker;
      final x = picker != null ? await picker() : await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1600, maxHeight: 1600);
      if (x == null || !mounted) return;
      final bytes = await x.readAsBytes();
      if (bytes.length > 2 * 1024 * 1024) {
        Alerts.error('${logo ? 'Logo' : 'Favicon'} must be 2MB or less');
        return;
      }
      setState(() {
        if (logo) {
          _logo = _Picked(x.name, bytes);
          _removeLogo = false;
        } else {
          _favicon = _Picked(x.name, bytes);
          _removeFavicon = false;
        }
      });
    } catch (_) {
      Alerts.error('Could not open that. Check the app has access to photos in Settings.');
    }
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      Alerts.error('Company name is required');
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() => _saving = true);
    try {
      final form = FormData.fromMap({
        'name': _name.text.trim(),
        if (_logo == null && _removeLogo) 'removeLogo': 'true',
        if (_favicon == null && _removeFavicon) 'removeFavicon': 'true',
      });
      for (final e in {'logo': _logo, 'favicon': _favicon}.entries) {
        final p = e.value;
        if (p != null) form.files.add(MapEntry(e.key, MultipartFile.fromBytes(p.bytes, filename: p.name, contentType: DioMediaType.parse(_mime(p.name)))));
      }
      await Api.putForm(Endpoints.companies, form);
      if (!mounted) return;
      Alerts.success('Settings saved successfully!');
      await Future.wait([_load(), context.read<CompanyProvider>().load()]);
    } catch (e) {
      Alerts.error(e is ApiException ? e.message : 'Failed to save settings');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String _mime(String name) {
    final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
    return switch (ext) {
      'jpg' || 'jpeg' => 'image/jpeg',
      'gif' => 'image/gif',
      'webp' => 'image/webp',
      'svg' => 'image/svg+xml',
      'ico' => 'image/x-icon',
      _ => 'image/png',
    };
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Company',
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : SafeArea(
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 760),
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                    children: [
                      _settingsCard(context),
                      const SizedBox(height: 16),
                      const SummaryMailCard(),
                    ],
                  ),
                ),
              ),
            ),
    );
  }

  Widget _settingsCard(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(Icons.business_rounded, size: 20, color: cs.onSurface),
              const SizedBox(width: 8),
              const Expanded(child: Text('Company Settings', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700))),
            ]),
            const SizedBox(height: 14),
            AppTextField(label: 'Company Name', controller: _name, required: true, hint: 'e.g. HQEPL', onChanged: (_) => setState(() {}), textCapitalization: TextCapitalization.words),
            const SizedBox(height: 16),
            LayoutBuilder(
              builder: (context, c) {
                final logo = _ImageSlot(
                  label: 'Company Logo',
                  hint: 'Recommended: PNG/SVG, max 2MB. Saved as WebP.',
                  icon: Icons.add_photo_alternate_outlined,
                  picked: _logo?.bytes,
                  current: _removeLogo ? null : _currentLogo,
                  height: 56,
                  onPick: () => _pick(true),
                  onRemove: () => setState(() {
                    _logo = null;
                    _removeLogo = true;
                  }),
                );
                final favicon = _ImageSlot(
                  label: 'Favicon',
                  hint: 'Recommended: ICO/PNG, max 2MB. Shown in the browser tab.',
                  icon: Icons.public_rounded,
                  picked: _favicon?.bytes,
                  current: _removeFavicon ? null : _currentFavicon,
                  height: 48,
                  onPick: () => _pick(false),
                  onRemove: () => setState(() {
                    _favicon = null;
                    _removeFavicon = true;
                  }),
                );
                if (c.maxWidth < 520) return Column(children: [logo, const SizedBox(height: 16), favicon]);
                return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: logo), const SizedBox(width: 16), Expanded(child: favicon)]);
              },
            ),
            const SizedBox(height: 16),
            Align(
              alignment: Alignment.centerRight,
              child: PrimaryButton(label: 'Save Settings', loading: _saving, onPressed: _changed ? _save : null, expand: false),
            ),
          ],
        ),
      ),
    );
  }
}

/// A logo / favicon slot: the image with Change and Remove, or a dashed
/// "upload" box when there is none.
class _ImageSlot extends StatelessWidget {
  const _ImageSlot({
    required this.label,
    required this.hint,
    required this.icon,
    required this.picked,
    required this.current,
    required this.height,
    required this.onPick,
    required this.onRemove,
  });

  final String label;
  final String hint;
  final IconData icon;
  final Uint8List? picked;
  final String? current;
  final double height;
  final VoidCallback onPick;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final has = picked != null || current != null;
    Widget image() => picked != null
        ? Image.memory(picked!, height: height, fit: BoxFit.contain)
        : CachedNetworkImage(imageUrl: current!, height: height, fit: BoxFit.contain, errorWidget: (_, _, _) => Icon(Icons.broken_image_outlined, color: cs.onSurfaceVariant));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        FieldLabel(label),
        const SizedBox(height: 2),
        Text(hint, style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
        const SizedBox(height: 8),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: cs.surfaceContainerHighest.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: cs.outlineVariant),
          ),
          child: has
              ? Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    ConstrainedBox(constraints: const BoxConstraints(maxWidth: 140), child: image()),
                    Wrap(spacing: 8, runSpacing: 6, children: [
                      OutlinedButton.icon(onPressed: onPick, icon: const Icon(Icons.add_photo_alternate_outlined, size: 16), label: const Text('Change'), style: OutlinedButton.styleFrom(visualDensity: VisualDensity.compact)),
                      TextButton.icon(onPressed: onRemove, icon: const Icon(Icons.delete_outline_rounded, size: 16), label: const Text('Remove'), style: TextButton.styleFrom(foregroundColor: cs.error, visualDensity: VisualDensity.compact)),
                    ]),
                  ],
                )
              : InkWell(
                  borderRadius: BorderRadius.circular(8),
                  onTap: onPick,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 88),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(icon, size: 28, color: cs.onSurfaceVariant),
                          const SizedBox(height: 6),
                          Text('Tap to upload ${label.toLowerCase()}', textAlign: TextAlign.center, style: TextStyle(fontSize: 12.5, color: cs.onSurfaceVariant)),
                        ],
                      ),
                    ),
                  ),
                ),
        ),
      ],
    );
  }
}
