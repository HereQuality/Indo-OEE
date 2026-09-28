// Hours the way a clock reads them (60 minutes to the hour, not 100).
//
// The server, the web app and the reports keep a shift length as decimal hours
// (3.5 = 3 h 30 min). On the phone a person types and reads it as H.MM — "3.30"
// is 3 h 30 min, and a single minute digit is tens of minutes ("3.5" is 3 h
// 50 min) — and sees it as "3:30". These helpers are the only place the two
// meet.

import 'production_sheet_calc.dart' show isNum, jsNumber;

/// Decimal hours -> "H:MM" (3.5 -> "3:30", 8 -> "8:00"). '' when not a number.
String hoursToHm(Object? hours) {
  final h = hours is num ? hours.toDouble() : jsNumber(hours);
  if (h == null || !isNum(h)) return '';
  final total = (h * 60).round();
  final sign = total < 0 ? '-' : '';
  final abs = total.abs();
  return '$sign${abs ~/ 60}:${(abs % 60).toString().padLeft(2, '0')}';
}

/// Decimal hours -> what the H.MM box shows (7.5 -> "7.30", 8 -> "8.00").
String hoursToHmInput(Object? hours) {
  final h = hours is num ? hours.toDouble() : jsNumber(hours);
  if (h == null || !isNum(h)) return '';
  final total = (h * 60).round().abs();
  return '${total ~/ 60}.${(total % 60).toString().padLeft(2, '0')}';
}

/// What an H.MM box holds: [hours] as decimal hours when it is a usable time,
/// [minutesTooBig] when the minutes part is above 59 (nothing else is wrong).
typedef HmParse = ({double? hours, bool minutesTooBig});

/// "3.30" -> 3.5 hours, "3.5" -> 3 h 50 min, "3" -> 3, "" -> null.
HmParse parseHm(Object? text) {
  final t = (text == null ? '' : '$text').trim().replaceAll(',', '.');
  final m = RegExp(r'^(\d{1,3})(?:\.(\d{0,2}))?$').firstMatch(t);
  if (m == null) return (hours: null, minutesTooBig: false);
  final h = int.parse(m.group(1)!);
  final frac = m.group(2) ?? '';
  final mm = frac.isEmpty ? 0 : int.parse(frac.length == 1 ? '${frac}0' : frac);
  if (mm > 59) return (hours: null, minutesTooBig: true);
  return (hours: (h * 60 + mm) / 60, minutesTooBig: false);
}

/// Decimal hours for the server, without float noise (3 h 50 min = 3.833333).
double hmToWireHours(double hours) => double.parse(hours.toStringAsFixed(6));
