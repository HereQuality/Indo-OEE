import 'production_entry_validation.dart' show stoppageLimitMin;
import 'production_sheet_calc.dart' show fmtNum, jsToNumber;
import 'shift_hours.dart' show hoursToHm;

/// The popup content every entry form raises when a figure goes past what the
/// entry's own shift allows — a port of client/src/utils/limitNotice.js (the
/// web hands these to AlertContext's `notice(message, options)`).
///
///   Quantity  OK + Rejected (CNC: Actual Quantity) over Ideal Quantity
///   Stoppage  all stoppage together over the Machine Shift
///
/// Shown the moment a keystroke is blocked (the box won't take it) and on Save
/// for an entry that went over another way. This file is widget-free (parity
/// tested against the JS); `entry_form/entry_notice_dialog.dart` draws it.

/// One "label — value" line of a notice; [highlight] draws the value in red.
class NoticeDetail {
  const NoticeDetail(this.label, this.value, {this.highlight = false});
  final String label;
  final String value;
  final bool highlight;

  @override
  bool operator ==(Object other) =>
      other is NoticeDetail && other.label == label && other.value == value && other.highlight == highlight;
  @override
  int get hashCode => Object.hash(label, value, highlight);
  @override
  String toString() => '$label: $value${highlight ? ' (!)' : ''}';
}

/// What the dialog says: a [message], the figures behind it and a [hint].
class EntryNotice {
  const EntryNotice({
    required this.message,
    this.title = "Can't do that",
    this.details = const [],
    this.hint = '',
    this.okText = 'OK',
    this.returnFocus = true,
  });

  final String message;
  final String title;
  final List<NoticeDetail> details;
  final String hint;
  final String okText;

  /// False when the caller moves focus itself afterwards (Save scrolling to the field).
  final bool returnFocus;

  EntryNotice withoutReturnFocus() => EntryNotice(
        message: message,
        title: title,
        details: details,
        hint: hint,
        okText: okText,
        returnFocus: false,
      );

  /// Notice identity for de-duplication: the same one asked for again while
  /// it is open (one per blocked keystroke) must not stack another.
  String get signature => '$title|$message|${details.join(';')}';
}

/// How a sheet words its notices. After Powder Coating's worker inspects
/// pieces within Inspection Working Hours, it doesn't make them.
class NoticeWords {
  const NoticeWords({required this.who, required this.canMake, required this.shift, this.timeName = 'Machine ON / OFF'});
  final String who;
  final String canMake;
  final String shift;

  /// "Machine ON / OFF" or "Start / End" — the Time the hint tells you to check.
  final String timeName;
}

const NoticeWords machineWords = NoticeWords(who: 'Machine', canMake: 'this machine can make', shift: 'Machine Shift');
const NoticeWords workerWords =
    NoticeWords(who: 'Worker', canMake: 'this worker can inspect', shift: 'Inspection Working Hours', timeName: 'Start / End');

double _n(Object? v) {
  if (v == null || v == '') return 0;
  final x = jsToNumber(v);
  return (x.isNaN) ? 0 : x; // JS `Number(v) || 0`
}

List<NoticeDetail> _who(String machine, NoticeWords w) => machine.isEmpty ? const [] : [NoticeDetail(w.who, machine)];

/// Web `qtyNotice`: [calc] is the row calc (`idealQty`, `shiftHours`, `totalCycleSec`).
EntryNotice qtyNotice({
  required Map<String, dynamic> calc,
  required Object? entered,
  String label = 'OK + Rejected',
  String machine = '',
  NoticeWords words = machineWords,
}) =>
    EntryNotice(
      message: 'As per calculation, ${words.canMake} at most ${fmtNum(calc['idealQty'])} pieces in this shift.',
      title: "Can't add this much quantity",
      details: [
        ..._who(machine, words),
        NoticeDetail(words.shift, '${hoursToHm(calc['shiftHours'])} hr'),
        NoticeDetail('Time per piece', '${fmtNum(calc['totalCycleSec'])} sec'),
        NoticeDetail('Ideal Quantity (most possible)', fmtNum(calc['idealQty'])),
        NoticeDetail(label, fmtNum(entered), highlight: true),
      ],
      hint: 'Check the quantity, the time per piece, or the ${words.timeName} Time.',
    );

/// Web `stoppageNotice`.
EntryNotice stoppageNotice({
  required Object? limitMin,
  required Object? totalMin,
  String machine = '',
  NoticeWords words = machineWords,
}) =>
    EntryNotice(
      message: 'Stoppage happens within the ${words.shift}, so all of it together can\'t be more than ${_js(limitMin)} min.',
      title: "Can't add this much stoppage",
      details: [
        ..._who(machine, words),
        NoticeDetail(words.shift, '${_js(limitMin)} min'),
        NoticeDetail('Total stoppage', '${fmtNum(totalMin)} min', highlight: true),
      ],
      hint: 'Check the stoppage minutes, or the ${words.timeName} Time.',
    );

// A number the way a JS template literal prints it (60 -> "60", 7.5 -> "7.5").
String _js(Object? v) {
  if (v is num && v.isFinite && v == v.truncateToDouble() && v.abs() < 1e15) return '${v.toInt()}';
  return '$v';
}

/// The block [firstOverLimit] found, and the popup to show for it.
class OverLimit {
  const OverLimit({required this.index, required this.field, required this.notice});
  final int index;
  final String field;
  final EntryNotice notice;
}

/// Web `firstOverLimit`, called on Save when a block is incomplete: the first
/// block whose quantity or stoppage is past its limit, or null. Only a field
/// its validation already flagged counts (a status-only day has no quantities
/// to check). Save moves focus to that field itself once the popup is closed.
///
/// [qtyKey] 'actualQty' (CNC) or 'okQty' (OK + Rejected, the other sheets);
/// null skips the quantity check. [machineName] maps machine id -> name.
OverLimit? firstOverLimit(
  List<Map<String, dynamic>> entries,
  List<Map<String, String>> errorsList,
  Map<String, dynamic> Function(Map<String, dynamic>) rowCalc, {
  String? qtyKey = 'okQty',
  String? qtyLabel,
  NoticeWords words = machineWords,
  Map<String, String> machineName = const {},
}) {
  final label = qtyLabel ?? (qtyKey == 'actualQty' ? 'Actual Quantity' : 'OK + Rejected');
  for (var index = 0; index < entries.length; index++) {
    final v = entries[index];
    final errors = index < errorsList.length ? errorsList[index] : const <String, String>{};
    final machine = machineName['${v['machine']}'] ?? '';
    final calc = rowCalc(v);
    final entered = qtyKey == 'actualQty' ? _n(v['actualQty']) : _n(v['okQty']) + _n(v['rejectedQty']);
    final ideal = calc['idealQty'];
    if (qtyKey != null &&
        (errors[qtyKey] ?? '').isNotEmpty &&
        ideal is num &&
        ideal.isFinite &&
        entered > ideal) {
      return OverLimit(
        index: index,
        field: qtyKey,
        notice: qtyNotice(calc: calc, entered: entered, label: label, machine: machine, words: words).withoutReturnFocus(),
      );
    }
    final limitMin = stoppageLimitMin(v);
    if ((errors['stoppageTotal'] ?? '').isNotEmpty && limitMin != null) {
      // Other Activity (After Powder Coating) counts against the same limit.
      final totalMin = _n(calc['totalStoppageMin']) + _n(v['otherActivityMin']);
      return OverLimit(
        index: index,
        field: 'stoppageTotal',
        notice: stoppageNotice(limitMin: limitMin, totalMin: totalMin, machine: machine, words: words).withoutReturnFocus(),
      );
    }
  }
  return null;
}

/// The "goes to Admin review" wording shared by the form banner and the optional
/// Save notice (web OeeCheck.jsx).
String adminReviewText(Iterable<String> overLabels) =>
    '${overLabels.join(', ')} above 100% — this entry will still save, but goes to Admin review. Check the cycle time, quantities and stoppage.';

/// A notice for the optional "this entry goes to Admin review" popup on Save
/// (the web only shows the banner; a spec may opt in — see
/// `ProcessSpec.noticeOnSaveForReview`).
EntryNotice adminReviewNotice(Iterable<String> overLabels) => EntryNotice(
      title: 'Goes to Admin review',
      message: adminReviewText(overLabels),
    );
