import 'package:intl/intl.dart';

/// Display + wire formatting helpers.
class Fmt {
  Fmt._();

  static final _date = DateFormat('dd MMM yyyy');
  static final _dateShort = DateFormat('dd MMM');
  static final _dateTime = DateFormat('dd MMM yyyy, hh:mm a');
  static final _time = DateFormat('hh:mm a');
  static final _ymd = DateFormat('yyyy-MM-dd');
  static final _hm24 = DateFormat('HH:mm');

  /// Parses an ISO string coming from the server (UTC or with offset) into
  /// local time. Returns null for empty / unparseable input.
  static DateTime? parse(dynamic v) {
    if (v == null) return null;
    if (v is DateTime) return v.toLocal();
    final s = v.toString();
    if (s.isEmpty) return null;
    return DateTime.tryParse(s)?.toLocal();
  }

  static String date(dynamic v, {String empty = '—'}) {
    final d = parse(v);
    return d == null ? empty : _date.format(d);
  }

  static String dateShort(dynamic v, {String empty = '—'}) {
    final d = parse(v);
    return d == null ? empty : _dateShort.format(d);
  }

  static String dateTime(dynamic v, {String empty = '—'}) {
    final d = parse(v);
    return d == null ? empty : _dateTime.format(d);
  }

  static String time(dynamic v, {String empty = '—'}) {
    final d = parse(v);
    return d == null ? empty : _time.format(d);
  }

  /// `yyyy-MM-dd` for query strings / request bodies.
  static String ymd(DateTime d) => _ymd.format(d);

  /// `HH:mm` (24h) — the wire format for time fields.
  static String hm24(DateTime d) => _hm24.format(d);

  /// "08:30" -> "08:30 AM". Returns the input when it isn't HH:mm.
  static String hm12(String? hm, {String empty = '—'}) {
    if (hm == null || hm.isEmpty) return empty;
    final m = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(hm);
    if (m == null) return hm;
    final h = int.parse(m.group(1)!);
    final mm = m.group(2)!;
    final suffix = h >= 12 ? 'PM' : 'AM';
    final h12 = h % 12 == 0 ? 12 : h % 12;
    return '${h12.toString().padLeft(2, '0')}:$mm $suffix';
  }

  /// 1234.5 -> "1,234.5" (max [decimals] fraction digits, trailing zeros trimmed).
  static String number(num? v, {int decimals = 2, String empty = '—'}) {
    if (v == null) return empty;
    return NumberFormat('#,##,##0.${'#' * decimals}', 'en_IN').format(v);
  }

  static String percent(num? v, {int decimals = 1, String empty = '—'}) {
    if (v == null) return empty;
    return '${NumberFormat('0.${'#' * decimals}').format(v)}%';
  }

  /// 95 -> "1h 35m", 40 -> "40m".
  static String minutes(num? v, {String empty = '—'}) {
    if (v == null) return empty;
    final total = v.round();
    if (total < 60) return '${total}m';
    final h = total ~/ 60;
    final m = total % 60;
    return m == 0 ? '${h}h' : '${h}h ${m}m';
  }

  /// "sameep kumar" -> "SK".
  static String initials(String? name, {int max = 2}) {
    final parts = (name ?? '').trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    return parts.take(max).map((p) => p[0].toUpperCase()).join();
  }
}
