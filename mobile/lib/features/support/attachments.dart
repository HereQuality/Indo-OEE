import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config.dart';
import '../../core/utils/alerts.dart';
import 'support_models.dart';

/// Extensions the server accepts (upload.middleware.js `attachmentFileFilter`).
const _mimeByExt = {
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'heic': 'image/heic',
  'pdf': 'application/pdf',
  'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls': 'application/vnd.ms-excel',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'txt': 'text/plain',
};

String? mimeForName(String name) {
  final i = name.lastIndexOf('.');
  if (i < 0) return null;
  return _mimeByExt[name.substring(i + 1).toLowerCase()];
}

String formatBytes(int b) {
  if (b < 1024) return '$b B';
  if (b < 1024 * 1024) return '${(b / 1024).toStringAsFixed(0)} KB';
  return '${(b / 1024 / 1024).toStringAsFixed(1)} MB';
}

/// A file the person picked but has not sent yet. Holds a path (device picks)
/// or bytes (tests / in-memory sources).
class PendingAttachment {
  PendingAttachment({required this.name, this.path, this.bytes, required this.size})
      : assert(path != null || bytes != null);

  final String name;
  final String? path;
  final Uint8List? bytes;
  final int size;

  String? get mime => mimeForName(name);
  bool get isImage => (mime ?? '').startsWith('image/');

  /// The server rejects `application/octet-stream` (dio's default), so the
  /// content type is always set from the file extension.
  Future<MultipartFile> toMultipart() {
    final type = DioMediaType.parse(mime ?? 'application/octet-stream');
    return bytes != null
        ? Future.value(MultipartFile.fromBytes(bytes!, filename: name, contentType: type))
        : MultipartFile.fromFile(path!, filename: name, contentType: type);
  }
}

/// Where attachments come from. Replaceable in tests (image_picker and
/// file_picker have no platform there).
abstract class AttachmentSource {
  const AttachmentSource();
  Future<List<PendingAttachment>> photos();
  Future<List<PendingAttachment>> camera();
  Future<List<PendingAttachment>> files();
}

class DeviceAttachmentSource extends AttachmentSource {
  const DeviceAttachmentSource();

  // Same as the web's client-side compression: max 1200 px, JPEG ~72 %.
  static const _maxSide = 1200.0;
  static const _quality = 72;

  Future<List<PendingAttachment>> _fromXFiles(Iterable<XFile> xs) async => [
        for (final x in xs) PendingAttachment(name: x.name, path: x.path, size: await x.length()),
      ];

  @override
  Future<List<PendingAttachment>> photos() async => _fromXFiles(
        await ImagePicker().pickMultiImage(maxWidth: _maxSide, maxHeight: _maxSide, imageQuality: _quality),
      );

  @override
  Future<List<PendingAttachment>> camera() async {
    final x = await ImagePicker()
        .pickImage(source: ImageSource.camera, maxWidth: _maxSide, maxHeight: _maxSide, imageQuality: _quality);
    return x == null ? const [] : _fromXFiles([x]);
  }

  @override
  Future<List<PendingAttachment>> files() async {
    final picked = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'jpg', 'jpeg', 'png', 'gif', 'webp'],
    );
    final out = <PendingAttachment>[];
    for (final f in picked) {
      final p = f.path;
      if (p == null) continue;
      out.add(PendingAttachment(name: f.name, path: p, size: (await f.length()) ?? 0));
    }
    return out;
  }
}

@visibleForTesting
AttachmentSource attachmentSource = const DeviceAttachmentSource();

/// Adds [incoming] to [current] enforcing the server's limits (5 files, 5 MB
/// each, allowed types) and toasting what was skipped.
List<PendingAttachment> mergeAttachments(List<PendingAttachment> current, List<PendingAttachment> incoming) {
  final out = [...current];
  var dropped = false;
  for (final f in incoming) {
    if (f.mime == null) {
      Alerts.error('"${f.name}" is not a supported file type.');
    } else if (f.size > kMaxAttachmentBytes) {
      Alerts.error('"${f.name}" is larger than 5MB limit.');
    } else if (out.length >= kMaxAttachments) {
      dropped = true;
    } else {
      out.add(f);
    }
  }
  if (dropped) Alerts.warning('You can attach up to $kMaxAttachments files.');
  return out;
}

enum _Pick { photos, camera, files }

/// Bottom sheet "Camera / Photo library / Files" then the pick itself. Returns
/// [current] plus whatever was added (limits applied), or null if dismissed.
Future<List<PendingAttachment>?> chooseAttachments(BuildContext context, List<PendingAttachment> current,
    {bool imagesOnly = false}) async {
  final choice = await showModalBottomSheet<_Pick>(
    context: context,
    useSafeArea: true,
    showDragHandle: true,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.photo_camera_outlined),
            title: const Text('Take a photo'),
            minTileHeight: 52,
            onTap: () => Navigator.pop(ctx, _Pick.camera),
          ),
          ListTile(
            leading: const Icon(Icons.photo_library_outlined),
            title: const Text('Photo library'),
            minTileHeight: 52,
            onTap: () => Navigator.pop(ctx, _Pick.photos),
          ),
          if (!imagesOnly)
            ListTile(
              leading: const Icon(Icons.attach_file_rounded),
              title: const Text('Files (PDF, Word, Excel, text)'),
              minTileHeight: 52,
              onTap: () => Navigator.pop(ctx, _Pick.files),
            ),
        ],
      ),
    ),
  );
  if (choice == null) return null;
  try {
    final picked = switch (choice) {
      _Pick.photos => await attachmentSource.photos(),
      _Pick.camera => await attachmentSource.camera(),
      _Pick.files => await attachmentSource.files(),
    };
    if (picked.isEmpty) return null;
    return mergeAttachments(current, picked);
  } catch (_) {
    Alerts.error('Could not open that. Check the app has access in Settings.');
    return null;
  }
}

/// Opens an uploaded attachment: images in a zoomable viewer, everything else
/// in the system browser / a viewer app (that is also how it is downloaded).
Future<void> openAttachment(BuildContext context, String url) async {
  final resolved = AppConfig.toBackendUrl(url) ?? url;
  if (isImageUrl(url)) {
    await Navigator.of(context).push(MaterialPageRoute<void>(
      fullscreenDialog: true,
      builder: (_) => ImageViewerPage(url: resolved),
    ));
    return;
  }
  await _launch(resolved);
}

Future<void> _launch(String url) async {
  try {
    final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!ok) Alerts.error('Could not open the file.');
  } catch (_) {
    Alerts.error('Could not open the file.');
  }
}

class ImageViewerPage extends StatelessWidget {
  const ImageViewerPage({super.key, required this.url});
  final String url;

  @override
  Widget build(BuildContext context) => Scaffold(
        // A photo viewer is black in both themes on purpose.
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: Colors.black,
          foregroundColor: Colors.white,
          actions: [
            IconButton(
              tooltip: 'Open / download',
              icon: const Icon(Icons.open_in_new_rounded),
              onPressed: () => _launch(url),
            ),
          ],
        ),
        body: SafeArea(
          child: InteractiveViewer(
            minScale: 1,
            maxScale: 5,
            child: Center(
              child: CachedNetworkImage(
                imageUrl: url,
                fit: BoxFit.contain,
                placeholder: (_, _) => const CircularProgressIndicator(color: Colors.white),
                errorWidget: (_, _, _) => const Icon(Icons.broken_image_outlined, color: Colors.white70, size: 48),
              ),
            ),
          ),
        ),
      );
}

/// Uploaded attachments of a ticket / message: image thumbnails + file chips.
class AttachmentGallery extends StatelessWidget {
  const AttachmentGallery({super.key, required this.urls, this.thumb = 84, this.onFilled = false});
  final List<String> urls;
  final double thumb;

  /// true when drawn on a filled (primary) bubble, so file links stay readable.
  final bool onFilled;

  @override
  Widget build(BuildContext context) {
    if (urls.isEmpty) return const SizedBox.shrink();
    final s = Theme.of(context).colorScheme;
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (var i = 0; i < urls.length; i++)
          if (isImageUrl(urls[i]))
            Semantics(
              button: true,
              label: 'Open image ${i + 1}',
              child: InkWell(
                borderRadius: BorderRadius.circular(10),
                onTap: () => openAttachment(context, urls[i]),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: SizedBox(
                    width: thumb,
                    height: thumb,
                    child: CachedNetworkImage(
                      imageUrl: AppConfig.toBackendUrl(urls[i]) ?? urls[i],
                      fit: BoxFit.cover,
                      memCacheWidth: (thumb * 3).round(),
                      placeholder: (_, _) => ColoredBox(color: s.surfaceContainerHighest),
                      errorWidget: (_, _, _) => ColoredBox(
                        color: s.surfaceContainerHighest,
                        child: Icon(Icons.broken_image_outlined, color: s.onSurfaceVariant),
                      ),
                    ),
                  ),
                ),
              ),
            )
          else
            ActionChip(
              avatar: Icon(Icons.attach_file_rounded, size: 16, color: onFilled ? s.onPrimary : s.primary),
              label: Text('File ${i + 1}', style: TextStyle(color: onFilled ? s.onPrimary : null)),
              backgroundColor: onFilled ? s.onPrimary.withValues(alpha: 0.16) : null,
              side: onFilled ? BorderSide(color: s.onPrimary.withValues(alpha: 0.4)) : null,
              onPressed: () => openAttachment(context, urls[i]),
            ),
      ],
    );
  }
}

/// Files picked but not yet sent, with a remove button on each.
class PendingAttachmentStrip extends StatelessWidget {
  const PendingAttachmentStrip({super.key, required this.files, required this.onRemove, this.enabled = true});
  final List<PendingAttachment> files;
  final ValueChanged<int> onRemove;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    if (files.isEmpty) return const SizedBox.shrink();
    final s = Theme.of(context).colorScheme;
    return SizedBox(
      height: 84,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: files.length,
        separatorBuilder: (_, _) => const SizedBox(width: 10),
        itemBuilder: (_, i) {
          final f = files[i];
          return SizedBox(
            width: f.isImage ? 84 : 150,
            height: 84,
            child: Stack(
              children: [
                Positioned.fill(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 6, right: 6),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: f.isImage ? _thumb(f, s) : _fileTile(f, s),
                    ),
                  ),
                ),
                Positioned(
                  top: 0,
                  right: 0,
                  child: Semantics(
                    button: true,
                    label: 'Remove ${f.name}',
                    child: InkResponse(
                      onTap: enabled ? () => onRemove(i) : null,
                      radius: 22,
                      child: SizedBox(
                        width: 44,
                        height: 44,
                        child: Align(
                          alignment: Alignment.topRight,
                          child: Container(
                            width: 22,
                            height: 22,
                            decoration: BoxDecoration(color: s.error, shape: BoxShape.circle),
                            child: Icon(Icons.close_rounded, size: 14, color: s.onError),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _thumb(PendingAttachment f, ColorScheme s) {
    final err = ColoredBox(
      color: s.surfaceContainerHighest,
      child: Icon(Icons.image_outlined, color: s.onSurfaceVariant),
    );
    return f.bytes != null
        ? Image.memory(f.bytes!, fit: BoxFit.cover, errorBuilder: (_, _, _) => err)
        : Image.file(File(f.path!), fit: BoxFit.cover, cacheWidth: 240, errorBuilder: (_, _, _) => err);
  }

  Widget _fileTile(PendingAttachment f, ColorScheme s) => Container(
        color: s.surfaceContainerHighest,
        padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.insert_drive_file_outlined, size: 20, color: s.primary),
            const SizedBox(height: 4),
            Text(f.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
            Text(formatBytes(f.size), style: TextStyle(fontSize: 11, color: s.onSurfaceVariant)),
          ],
        ),
      );
}
