import 'package:flutter/foundation.dart';

import '../core/api/api_client.dart';
import '../core/api/endpoints.dart';
import '../core/config.dart';

/// Company branding (name + logo), public so the login screen can show it.
class CompanyProvider extends ChangeNotifier {
  String name = '';
  String? logo;
  String? favicon;
  bool loaded = false;

  Future<void> load() async {
    try {
      final res = await Api.get(Endpoints.companyDetails);
      final d = asMap(res);
      name = (d['name'] ?? d['companyName'] ?? '').toString();
      final l = d['logo']?.toString();
      logo = (l == null || l.isEmpty) ? null : AppConfig.toBackendUrl(l);
      final f = d['favicon']?.toString();
      favicon = (f == null || f.isEmpty) ? null : AppConfig.toBackendUrl(f);
    } catch (_) {/* branding is optional */}
    loaded = true;
    notifyListeners();
  }
}
