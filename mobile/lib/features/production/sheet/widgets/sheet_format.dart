import '../../shared/production_sheet_calc.dart';

/// Display helpers of ProductionEntriesTable.jsx: a blank reads as a dash.
String dash(String? v) => (v == null || v.isEmpty) ? '—' : v;

/// A calculated number (blank / NaN -> dash).
String nStr(Object? v) => dash(fmtNum(v));

/// A 0–1 ratio as a percentage (blank / NaN -> dash).
String pctStr(Object? v) => dash(fmtPct(v));

/// A typed figure: blank reads as a dash, not as a 0 nobody typed.
String minStr(Object? v) => (v == null || v == '') ? '—' : dash(fmtNum(jsToNumber(v)));

/// The downtime figures read better as 0 than a dash — they add up into Total
/// Stoppage. Display only: the formulas already treat blank as 0.
String zeroIfBlank(Object? v) => fmtNum((v == null || v == '') ? 0 : jsToNumber(v));

/// Plain text field (operator, part, drawing no.): blank -> dash.
String textStr(Object? v) => dash(v == null ? null : '$v');

/// True when a typed figure exists (not blank / not NaN).
bool hasValue(Object? v) {
  if (v == null || v == '') return false;
  return isNum(jsToNumber(v));
}

/// True when a typed figure exists and is above zero.
bool positive(Object? v) => hasValue(v) && jsToNumber(v) > 0;
