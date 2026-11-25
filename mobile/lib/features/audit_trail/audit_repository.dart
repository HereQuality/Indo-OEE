import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' show Rect;

import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/api/api_client.dart';
import '../../core/api/endpoints.dart';
import 'audit_models.dart';

/// The Audit Trail calls (routes under /api/v1/audit-trail).
class AuditRepository {
  const AuditRepository();

  /// One page of logs matching [filters] — newest first — and the total.
  Future<AuditPage> logs(AuditFilters filters, {int skip = 0, int limit = AuditFilters.pageSize}) async {
    final r = await Api.get(Endpoints.auditTrail, query: filters.toQuery(skip: skip, limit: limit));
    final logs = [for (final l in (r['data'] as List? ?? const [])) if (l is Map) AuditLog.from(l)];
    final total = r['total'];
    return AuditPage(logs: logs, total: total is num ? total.toInt() : logs.length);
  }

  /// Every log of one record (an entry by id, or a Not running mark by
  /// sheet + date + machine), newest first, no date range.
  Future<List<AuditLog>> history(AuditFilters filters) async {
    final page = await logs(filters, limit: 200);
    return page.logs;
  }

  /// The dropdown choices: modules, actions and the users who did something.
  Future<AuditFilterOptions> filterOptions() async {
    final r = await Api.get(Endpoints.auditTrailFilters);
    return AuditFilterOptions.from(asMap(r));
  }

  /// Downloads the CSV of everything matching [filters] (no paging).
  Future<Uint8List> exportCsv(AuditFilters filters) async {
    try {
      final res = await Api.dio.get<List<int>>(
        Endpoints.auditTrailExportCsv,
        queryParameters: filters.toQuery(paging: false),
        options: Options(responseType: ResponseType.bytes),
      );
      return Uint8List.fromList(res.data ?? const []);
    } on DioException catch (e) {
      // An error body comes back as JSON even though a CSV was asked for.
      final data = e.response?.data;
      if (data is List<int>) {
        try {
          e.response!.data = await Api.dio.transformer.transformResponse(
            e.requestOptions..responseType = ResponseType.json,
            ResponseBody.fromBytes(data, e.response!.statusCode ?? 500, headers: {Headers.contentTypeHeader: ['application/json']}),
          );
        } catch (_) {/* not JSON */}
      }
      throw Api.fromDio(e);
    }
  }
}

/// Hands the downloaded CSV to the system share sheet (Save to Files, Mail,
/// WhatsApp, …). Tests replace [shareCsv] (no platform there).
typedef ShareCsv = Future<void> Function(Uint8List bytes, String filename, {Rect? origin});

ShareCsv shareCsv = shareCsvWithSystem;

Future<void> shareCsvWithSystem(Uint8List bytes, String filename, {Rect? origin}) async {
  final dir = await getTemporaryDirectory();
  final file = File('${dir.path}/$filename');
  await file.writeAsBytes(bytes, flush: true);
  await SharePlus.instance.share(ShareParams(
    files: [XFile(file.path, mimeType: 'text/csv', name: filename)],
    subject: 'Audit Trail',
    sharePositionOrigin: origin,
  ));
}
