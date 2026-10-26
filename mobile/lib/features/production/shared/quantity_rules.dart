// Port of client/src/utils/quantityRules.js — the CNC sheet's Production Master /
// Rejection Master rules, shared by every other machine sheet so they read and
// save quantities the same way: Actual and OK Quantity are typed, Rejected =
// Actual − OK (shown, never sent), and the Rejection Master split has to account
// for every rejected piece. Mirrored on the server by server/utils/rejectSplit.js
// — keep the three in step.

import 'production_entry_validation.dart' show cleanSplit, isBlank;
import 'production_sheet_calc.dart';

bool _finiteAtLeast0(double? n) => n != null && n.isFinite && n >= 0;

/// Fills errors['actualQty'] / ['okQty'] / ['rejectBreakdown'] / ['rejectOtherRemark']
/// for one block. [calc] is the sheet's own row calc (for Ideal Quantity);
/// [capByIdeal] false is for a sheet that doesn't stop Actual at Ideal.
void validateQuantities(
  Map<String, dynamic> v,
  Map<String, dynamic> calc,
  Map<String, String> errors, {
  bool capByIdeal = true,
}) {
  final actual = jsNumber(v['actualQty']);
  final ideal = calc['idealQty'];
  if (isBlank(v['actualQty'])) {
    errors['actualQty'] = 'Actual Quantity is required';
  } else if (!_finiteAtLeast0(actual)) {
    errors['actualQty'] = 'Must be 0 or more';
  } else if (capByIdeal && isNum(ideal) && actual! > (ideal as num)) {
    errors['actualQty'] = "Actual can't be more than Ideal Quantity (${jsNumStr(ideal)})";
  }

  final ok = jsNumber(v['okQty']);
  if (isBlank(v['okQty'])) {
    errors['okQty'] = 'OK Quantity is required';
  } else if (!_finiteAtLeast0(ok)) {
    errors['okQty'] = 'Must be 0 or more';
  } else if (isNum(actual) && ok! > actual!) {
    errors['okQty'] = "OK can't be more than Actual Quantity (${jsNumStr(actual)})";
  }

  // Rejected = Actual − OK, and every rejected piece needs a reason. Can only be
  // checked once Actual and OK are both usable.
  final rejectedKnown = isNum(actual) && isNum(ok) && ok! <= actual!;
  final rejected = rejectedKnown ? actual - ok : 0.0;
  final split = cleanSplit(v['rejectBreakdown']);
  final splitTotal = split.values.fold<double>(0, (s, n) => s + n);
  final raw = v['rejectBreakdown'];
  final hasBadBox = raw is Map &&
      raw.values.any((n) {
        if (isBlank(n)) return false;
        final x = jsToNumber(n);
        return !x.isFinite || x < 0;
      });
  if (hasBadBox) {
    errors['rejectBreakdown'] = 'Rejected quantities must be 0 or more';
  } else if (rejectedKnown && splitTotal < rejected) {
    errors['rejectBreakdown'] =
        '${jsNumStr(rejected - splitTotal)} of ${jsNumStr(rejected)} rejected piece(s) still have no reason — the boxes must add up to the rejected quantity';
  } else if (rejectedKnown && splitTotal > rejected) {
    errors['rejectBreakdown'] = rejected > 0
        ? 'Split is ${jsNumStr(splitTotal - rejected)} more than the ${jsNumStr(rejected)} rejected — the boxes must add up to the rejected quantity'
        : 'Nothing was rejected (Actual − OK is 0), so these boxes should be empty';
  }
  if ((split['Other'] ?? 0) > 0 && isBlank(v['rejectOtherRemark'])) {
    errors['rejectOtherRemark'] = 'Remark is required when "Other" is a reject reason';
  }
}

/// A stored number as the text a form box shows (90 -> '90', null -> '').
String _numText(Object? v) {
  if (v == null) return '';
  if (v is num) return v.isFinite ? jsNumStr(v) : '';
  return v.toString();
}

/// Form values for a saved record's quantities: `actualQty` (text) and
/// `rejectBreakdown` (reason -> text). A record saved before Actual existed has
/// only OK and Rejected: Actual is their sum, and its rejected pieces go against
/// its single reason (or none) so editing it loses nothing.
///
/// [reasons]: the sheet's own reject reasons (Before Powder Coating has its own
/// — `bpcRejectReasons`); every other sheet leaves it out: the CNC list.
Map<String, dynamic> quantityFormValues(Map<String, dynamic> row, [List<String> reasons = rejectReasons]) {
  final ok = jsNumber(row['okQty']);
  final rej = jsNumber(row['rejectedQty']);
  final stored = jsNumber(row['actualQty']);
  final String actual;
  if (isNum(stored)) {
    actual = _numText(stored);
  } else if (isNum(ok) || isNum(rej)) {
    actual = _numText((isNum(ok) ? ok! : 0) + (isNum(rej) ? rej! : 0));
  } else {
    actual = '';
  }
  final split = <String, dynamic>{};
  final s = row['rejectBreakdown'];
  if (s is Map && s.isNotEmpty) {
    for (final e in s.entries) {
      if (reasons.contains(e.key)) split['${e.key}'] = _numText(e.value);
    }
  } else {
    final reason = row['rejectReason'];
    if (reason is String && reasons.contains(reason) && isNum(rej) && rej! > 0) {
      split[reason] = _numText(rej);
    }
  }
  return {'actualQty': actual, 'rejectBreakdown': split};
}

/// Request-body fields for the split. rejectedQty is never sent — the server
/// derives it from Actual − OK. [wire] turns a number into what goes on the wire
/// (a whole number as an int).
Map<String, dynamic> rejectPayload(Map<String, dynamic> v, Object? Function(double) wire) {
  final split = cleanSplit(v['rejectBreakdown']);
  // The biggest contributor also goes in the single rejectReason older records
  // and the entries table read (the first wins a tie, like JS's stable sort).
  var topReason = '';
  var best = double.negativeInfinity;
  for (final e in split.entries) {
    if (e.value > best) {
      best = e.value;
      topReason = e.key;
    }
  }
  return <String, dynamic>{
    'rejectBreakdown': {for (final e in split.entries) e.key: wire(e.value)},
    'rejectReason': topReason,
    // A remark belongs only to an "Other" that is still in use.
    'rejectOtherRemark': (split['Other'] ?? 0) > 0 ? jsTrim(jsString(v['rejectOtherRemark'] ?? '')) : '',
  };
}

/// Any Rejection Master box holds a non-zero figure.
bool hasRejectData(Map<String, dynamic> v) {
  final split = v['rejectBreakdown'];
  return split is Map && split.values.any((n) => n != null && n != '' && jsToNumber(n) != 0);
}

/// One Rejection Master box changed: [values] with that reason's quantity set
/// (a spec's `applyRejectChange`).
Map<String, dynamic> applyRejectSplitChange(Map<String, dynamic> values, String reason, dynamic value) {
  final current = values['rejectBreakdown'];
  return {
    ...values,
    'rejectBreakdown': <String, dynamic>{
      if (current is Map) ...Map<String, dynamic>.from(current),
      reason: value,
    },
  };
}
