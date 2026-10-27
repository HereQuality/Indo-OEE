import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/api/api_client.dart';
import 'package:indo/features/production/processes/rivet/rivet_spec.dart';
import 'package:indo/features/production/processes/spm/spm_spec.dart';
import 'package:indo/features/production/sheet/editor/entry_draft_store.dart';
import 'package:indo/providers/auth_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fake_api.dart';

const _block = <Map<String, dynamic>>[
  {'partNo': 'A1'},
];

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FakeApi.install();
  });

  test('ending a session deletes every process draft; a later draft survives', () async {
    final auth = AuthProvider(onSessionEnd: clearEntryDrafts);
    await EntryDraftStore.save(_block, draftKey: rivetSpec.draftKey);
    await EntryDraftStore.save(_block, draftKey: spmSpec.draftKey);
    await EntryDraftStore.save(_block);
    expect(await EntryDraftStore.load(draftKey: rivetSpec.draftKey), isNotNull);

    ApiClient.instance.onUnauthorized!(); // 401 / expired token -> _endSession
    await Future<void>.delayed(const Duration(milliseconds: 50));

    expect(await EntryDraftStore.load(draftKey: rivetSpec.draftKey), isNull);
    expect(await EntryDraftStore.load(draftKey: spmSpec.draftKey), isNull);
    expect(await EntryDraftStore.load(), isNull);

    // Next user signs in and types a draft: it is kept as usual.
    await EntryDraftStore.save(_block, draftKey: rivetSpec.draftKey);
    expect(await EntryDraftStore.load(draftKey: rivetSpec.draftKey), isNotNull);
    auth.dispose();
  });

  test('normal form close still restores within 60 s and expires after', () async {
    final t = DateTime(2026, 1, 1, 10);
    await EntryDraftStore.save(_block, now: t, draftKey: rivetSpec.draftKey);
    expect(await EntryDraftStore.load(now: t.add(const Duration(seconds: 59)), draftKey: rivetSpec.draftKey), isNotNull);
    expect(await EntryDraftStore.load(now: t.add(const Duration(seconds: 61)), draftKey: rivetSpec.draftKey), isNull);
  });
}
