import 'dart:convert';
import 'dart:io';

/// Loads test/production/calc/fixtures/[name] (written by tool/gen_golden.mjs
/// from the REAL client JS) and turns the NaN/Infinity/undefined markers back
/// into Dart values: {"$n": "NaN"|"Inf"|"-Inf"} -> double, {"$u": 1} -> null.
///
/// For one-off soak runs, point CALC_FIXTURE_DIR at a folder of freshly
/// generated fixtures (see tool/gen_golden.mjs: SEED=.. SCALE=..).
dynamic loadFixture(String name) {
  final rel = Platform.environment['CALC_FIXTURE_DIR'] ?? 'test/production/calc/fixtures';
  var file = File('$rel/$name');
  if (!file.existsSync()) file = File('mobile/$rel/$name');
  return _decode(jsonDecode(file.readAsStringSync()));
}

dynamic _decode(dynamic j) {
  if (j is Map) {
    if (j.length == 1 && j.containsKey(r'$n')) {
      switch (j[r'$n']) {
        case 'NaN':
          return double.nan;
        case 'Inf':
          return double.infinity;
        case '-Inf':
          return double.negativeInfinity;
      }
    }
    if (j.length == 1 && j.containsKey(r'$u')) return null;
    return <String, dynamic>{for (final e in j.entries) e.key as String: _decode(e.value)};
  }
  if (j is List) return [for (final e in j) _decode(e)];
  return j;
}

/// Describes the first difference between [actual] and the JS [expected], or
/// null when they match: numbers to 1e-9 (relative for big values), NaN equals
/// NaN, null equals null, maps by key (extra/missing keys count), lists in order.
String? diff(dynamic actual, dynamic expected, [String path = r'$']) {
  if (expected == null) return actual == null ? null : '$path: expected null, got ${_show(actual)}';
  if (expected is num) {
    if (actual is! num) return '$path: expected ${_show(expected)}, got ${_show(actual)}';
    final e = expected.toDouble();
    final a = actual.toDouble();
    if (e.isNaN) return a.isNaN ? null : '$path: expected NaN, got $a';
    if (a.isNaN) return '$path: expected $e, got NaN';
    if (e.isInfinite || a.isInfinite) return e == a ? null : '$path: expected $e, got $a';
    final tol = 1e-9 * (e.abs() > 1 ? e.abs() : 1);
    return (a - e).abs() <= tol ? null : '$path: expected $e, got $a';
  }
  if (expected is String || expected is bool) {
    return actual == expected ? null : '$path: expected ${_show(expected)}, got ${_show(actual)}';
  }
  if (expected is List) {
    if (actual is! List) return '$path: expected a list, got ${_show(actual)}';
    if (actual.length != expected.length) return '$path: expected ${expected.length} items, got ${actual.length}';
    for (var i = 0; i < expected.length; i++) {
      final d = diff(actual[i], expected[i], '$path[$i]');
      if (d != null) return d;
    }
    return null;
  }
  if (expected is Map) {
    if (actual is! Map) return '$path: expected a map, got ${_show(actual)}';
    for (final k in expected.keys) {
      if (!actual.containsKey(k)) return '$path.$k: missing key';
      final d = diff(actual[k], expected[k], '$path.$k');
      if (d != null) return d;
    }
    for (final k in actual.keys) {
      if (!expected.containsKey(k)) return '$path.$k: unexpected key (${_show(actual[k])})';
    }
    return null;
  }
  return '$path: unsupported expected ${_show(expected)}';
}

String _show(dynamic v) {
  if (v is double && (v.isNaN || v.isInfinite)) return '$v';
  try {
    return jsonEncode(v);
  } catch (_) {
    return '$v';
  }
}

String showCase(dynamic v) => _show(v);
