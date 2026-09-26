import 'package:dio/dio.dart';

import '../../core/api/api_client.dart';
import 'attachments.dart';
import 'support_models.dart';

/// api/tickets.api.js. Every call throws [ApiException] with a readable message.
class SupportRepository {
  const SupportRepository();

  static const base = '/api/v1/tickets';

  Future<List<Ticket>> list() async {
    final res = await Api.get(base);
    return asList(res).map(Ticket.fromJson).toList();
  }

  Future<Ticket> details(String id) async =>
      Ticket.fromJson((await Api.get('$base/$id'))['data']);

  /// JSON when there are no files, multipart (`attachments` x N) otherwise — same as the web.
  Future<Ticket> create({
    required String subject,
    required String description,
    required String priority,
    required String platform,
    List<PendingAttachment> files = const [],
  }) async {
    final fields = {
      'subject': subject,
      'description': description,
      'priority': priority,
      'platform': platform,
    };
    final res = files.isEmpty
        ? await Api.post(base, body: fields)
        : await Api.postForm(base, await _form(fields, files));
    return Ticket.fromJson(res['data']);
  }

  Future<Ticket> reply(
    String id,
    String message, {
    List<PendingAttachment> files = const [],
  }) async {
    final res = files.isEmpty
        ? await Api.post('$base/$id/reply', body: {'message': message})
        : await Api.postForm(
            '$base/$id/reply',
            await _form({'message': message}, files),
          );
    return Ticket.fromJson(res['data']);
  }

  Future<void> forward(String id) => Api.post('$base/$id/forward');
  Future<void> startProgress(String id) => Api.post('$base/$id/start-progress');
  Future<void> askForConfirmation(String id) =>
      Api.post('$base/$id/ask-confirmation');

  /// [accept] true = "Accept" (closes), false = "Reject" (reopens, optional reason).
  Future<void> verify(String id, {required bool accept, String? reason}) =>
      Api.post(
        '$base/$id/verify',
        body: {
          'action': accept ? 'Accept' : 'Reject',
          if (reason != null && reason.isNotEmpty) 'reason': reason,
        },
      );

  Future<void> delete(String id) => Api.delete('$base/$id');
  Future<void> markRead(String id) => Api.patch('$base/$id/read');

  Future<FormData> _form(
    Map<String, String> fields,
    List<PendingAttachment> files,
  ) async {
    final form = FormData();
    fields.forEach((k, v) => form.fields.add(MapEntry(k, v)));
    for (final f in files) {
      form.files.add(MapEntry('attachments', await f.toMultipart()));
    }
    return form;
  }
}
