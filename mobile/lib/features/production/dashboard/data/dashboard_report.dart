import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' show Rect;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../../../core/api/api_client.dart';
import '../../../../core/api/endpoints.dart';

/// The Production Dashboard's Efficiency Report (OEE) — the same PDF the web
/// dashboard's "PDF" / "Email" buttons make (server
/// controllers/dashboardReport.controller.js), for the dashboard's own scope:
/// the period, the open process (none = all processes) and the ticked
/// machines (none = every machine of the process combined).
class DashboardReport {
  DashboardReport._();

  /// The query / body both endpoints take.
  static Map<String, String> params({
    required List<String> range,
    String? processId,
    List<String> machineIds = const [],
  }) =>
      {
        'from': range[0],
        'to': range[1],
        'process': ?processId,
        if (machineIds.isNotEmpty) 'machine': machineIds.join(','),
      };

  /// Downloads the PDF. Returns its bytes and the server's file name.
  static Future<({Uint8List bytes, String filename})> pdf(Map<String, String> params) async {
    try {
      final res = await Api.dio.get<List<int>>(
        Endpoints.dashboardReportPdf,
        queryParameters: params,
        options: Options(responseType: ResponseType.bytes),
      );
      final disposition = res.headers.value('content-disposition') ?? '';
      final m = RegExp(r'filename="([^"]+)"').firstMatch(disposition);
      return (bytes: Uint8List.fromList(res.data ?? const []), filename: m?.group(1) ?? 'OEE-report.pdf');
    } on DioException catch (e) {
      // An error body comes back as JSON even though a PDF was asked for.
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

  /// Mails the report (PDF attached) to [to] — addresses separated by commas,
  /// spaces or new lines — or, when blank, to the Company page's saved
  /// recipients. Returns the server's message.
  static Future<String> email(Map<String, String> params, {String to = ''}) async {
    final res = await Api.post(Endpoints.dashboardReportEmail, body: {...params, if (to.trim().isNotEmpty) 'recipients': to.trim()});
    return res['message'] is String ? res['message'] as String : 'Report sent';
  }
}

/// Hands a downloaded PDF to the system share sheet (Save to Files, Mail,
/// WhatsApp, print, …). Tests replace [sharePdf] (no platform there).
typedef SharePdf = Future<void> Function(Uint8List bytes, String filename, {Rect? origin});

SharePdf sharePdf = shareWithSystem;

Future<void> shareWithSystem(Uint8List bytes, String filename, {Rect? origin}) async {
  final dir = await getTemporaryDirectory();
  final file = File('${dir.path}/$filename');
  await file.writeAsBytes(bytes, flush: true);
  await SharePlus.instance.share(ShareParams(
    files: [XFile(file.path, mimeType: 'application/pdf', name: filename)],
    subject: 'Efficiency Report (OEE)',
    sharePositionOrigin: origin,
  ));
}
