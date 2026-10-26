// Planned Operator Shift the way the sheet writes it: decimal hours.
//
// The server, the web app, the reports and the paper sheet all keep a shift
// length as decimal hours — "5.33" is 5 h 20 min and "0.5" is 30 min — so that
// is what a person types here too; it is taken to the whole minute, and shown
// in the tables as hr:min ("5:20"). These helpers are the only place the two
// meet. Keep in step with client/src/utils/shiftHours.js.

import 'production_sheet_calc.dart' show isNum, jsNumber, jsRound, jsString;

/// Decimal hours -> "H:MM" (3.5 -> "3:30", 8 -> "8:00"). '' when not a number.
String hoursToHm(Object? hours) {
  final h = hours is num ? hours.toDouble() : jsNumber(hours);
  if (h == null || !isNum(h)) return '';
  final total = jsRound(h * 60).toInt();
  final sign = total < 0 ? '-' : '';
  final abs = total.abs();
  return '$sign${abs ~/ 60}:${(abs % 60).toString().padLeft(2, '0')}';
}

/// Decimal hours -> what the box shows, to the whole minute (5 h 20 min -> "5.33",
/// 8 -> "8", 3.5 -> "3.5").
String hoursToShiftInput(Object? hours) {
  final h = hours is num ? hours.toDouble() : jsNumber(hours);
  if (h == null || !isNum(h)) return '';
  final minutes = jsRound(h * 60).abs();
  final text = (minutes / 60).toStringAsFixed(2);
  // 5.00 -> "5", 3.50 -> "3.5", 5.33 -> "5.33" (like JS's Number(x.toFixed(2))).
  return text.contains('.') ? text.replaceFirst(RegExp(r'\.?0+$'), '') : text;
}

/// What the box holds: [hours] as decimal hours (to the whole minute) when it is
/// a usable number, else null.
typedef ShiftParse = ({double? hours});

/// "5.33" -> 5 h 20 min, "0.5" -> 30 min, "8" -> 8, "" -> null.
ShiftParse parseShiftHours(Object? text) {
  final t = (text == null ? '' : jsString(text)).trim().replaceAll(',', '.');
  if (!RegExp(r'^\d{0,3}(?:\.\d*)?$').hasMatch(t) || !RegExp(r'\d').hasMatch(t)) {
    return (hours: null);
  }
  return (hours: jsRound(double.parse(t.startsWith('.') ? '0$t' : t) * 60) / 60);
}

/// Decimal hours for the server, without float noise (5 h 20 min = 5.333333).
double hmToWireHours(double hours) => double.parse(hours.toStringAsFixed(6));
