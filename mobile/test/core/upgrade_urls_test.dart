import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/config.dart';

// The backend hands out "http://indo.hqepl.com/uploads/…" links that iOS / Android
// refuse to load; every response is rewritten onto https. This runs on the UI
// thread for every response, so it edits the decoded JSON in place.
void main() {
  const http = 'http://indo.hqepl.com';
  const https = 'https://indo.hqepl.com';

  test('rewrites our own links at any depth, keeping path, query and fragment', () {
    final out = AppConfig.upgradeUrls({
      'logo': '$http/uploads/logo.png',
      'user': {
        'profilePic': '$http/uploads/a.png?v=2#x',
        'files': ['$http/uploads/1.pdf', 'plain text', 7, null, true],
      },
      'rows': [
        {'attachments': ['$http/uploads/2.png']},
      ],
      'bare': http,
    }) as Map;
    expect(out['logo'], '$https/uploads/logo.png');
    expect((out['user'] as Map)['profilePic'], '$https/uploads/a.png?v=2#x');
    expect((out['user'] as Map)['files'], ['$https/uploads/1.pdf', 'plain text', 7, null, true]);
    expect(((out['rows'] as List).single as Map)['attachments'], ['$https/uploads/2.png']);
    expect(out['bare'], https);
  });

  test('leaves other hosts, look-alike hosts and https links alone', () {
    final input = {
      'other': 'http://example.com/x.png',
      'lookalike': '$http.evil.com/x.png',
      'lookalike2': '$http-cdn/x.png',
      'secure': '$https/uploads/x.png',
      'mention': 'see $http/uploads/x.png for details', // not a link on its own
    };
    final out = AppConfig.upgradeUrls(input) as Map;
    expect(out, {
      'other': 'http://example.com/x.png',
      'lookalike': '$http.evil.com/x.png',
      'lookalike2': '$http-cdn/x.png',
      'secure': '$https/uploads/x.png',
      'mention': 'see $http/uploads/x.png for details',
    });
  });

  test('edits in place: the same object comes back, and nothing is copied when nothing changes', () {
    final rows = [
      for (var i = 0; i < 50; i++) {'id': i, 'name': 'row $i', 'tags': ['a', 'b']},
    ];
    expect(identical(AppConfig.upgradeUrls(rows), rows), isTrue);

    final withLink = {'pic': '$http/uploads/p.png', 'n': 1};
    final out = AppConfig.upgradeUrls(withLink);
    expect(identical(out, withLink), isTrue);
    expect(withLink['pic'], '$https/uploads/p.png');
  });

  test('a payload the size of a dashboard month is not a frame killer', () {
    final rows = [
      for (var i = 0; i < 10000; i++)
        {
          '_id': 'id$i',
          for (var k = 0; k < 40; k++) 'field$k': k.isEven ? k * 1.5 : 'value $k',
          'rejectBreakdown': {'Tool Mark': 3},
          'pic': i % 500 == 0 ? '$http/uploads/$i.png' : '',
        },
    ];
    final sw = Stopwatch()..start();
    AppConfig.upgradeUrls(rows);
    sw.stop();
    expect((rows[500] as Map)['pic'], '$https/uploads/500.png');
    // The old copy-everything version took ~350 ms here in a debug build.
    expect(sw.elapsedMilliseconds, lessThan(150));
  });

  test('unmodifiable lists and maps are copied instead of throwing', () {
    final list = List<dynamic>.unmodifiable(['$http/uploads/a.png', 'x']);
    final outList = AppConfig.upgradeUrls(list) as List;
    expect(outList, ['$https/uploads/a.png', 'x']);
    expect(list.first, '$http/uploads/a.png', reason: 'the frozen original is untouched');

    final map = Map<String, dynamic>.unmodifiable({
      'pic': '$http/uploads/b.png',
      'nested': List<dynamic>.unmodifiable(['$http/uploads/c.png']),
    });
    final outMap = AppConfig.upgradeUrls(map) as Map;
    expect(outMap['pic'], '$https/uploads/b.png');
    expect(outMap['nested'], ['$https/uploads/c.png']);
  });

  test('scalars pass through', () {
    expect(AppConfig.upgradeUrls(null), isNull);
    expect(AppConfig.upgradeUrls(5), 5);
    expect(AppConfig.upgradeUrls(true), true);
    expect(AppConfig.upgradeUrls('$http/uploads/z.png'), '$https/uploads/z.png');
  });
}
