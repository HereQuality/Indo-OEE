import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';

/// Whether the logged-in user is Admin / Super Admin — who may review OEE
/// entries and change a process's Operator Planned Shift (web
/// hooks/useReviewAccess.jsx → GET /oee-review/access). The server enforces
/// the same rule on every request; this only decides what the screens offer.
class ReviewAccessRepository {
  const ReviewAccessRepository();

  /// `{canReview: false}` when the lookup fails (offer nothing).
  Future<bool> canReview() async {
    try {
      final data = asMap(await Api.get(Endpoints.oeeReviewAccess));
      return data['canReview'] == true;
    } catch (_) {
      return false;
    }
  }
}
