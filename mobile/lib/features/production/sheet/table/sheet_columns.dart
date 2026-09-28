import '../../shared/production_sheet_calc.dart';
import '../sheet_model.dart';
import '../widgets/sheet_format.dart';
import '../widgets/sheet_style.dart';

/// How a column is coloured — the web sheet's tones (see TONE / OEE_TINT in
/// ProductionEntriesTable.jsx): none = a typed value, calc = indigo wash,
/// day = teal wash (figures of the machine's whole date), oee = blue.
enum ColTone { none, calc, day, oee }

/// A cell the web draws once per run of rows (rowSpan): the Date over the
/// date's rows, the Machine (and the day figures) over the machine's rows.
enum ColMerge { none, date, machineDay }

/// What one body cell needs to know about its row.
class CellData {
  const CellData({
    required this.row,
    required this.calc,
    required this.day,
    required this.machineName,
  });
  final Json row;
  final Json calc;
  final Json day;
  final String machineName;
}

/// The chevron that rides beside an expandable column (its summary or, while
/// open, the last breakdown column).
class ColExpand {
  const ColExpand({
    required this.id,
    required this.isOpen,
    required this.label,
    this.end = false,
  });
  final String id;
  final bool isOpen;
  final String label;

  /// The collapse chevron on an opened breakdown's last column.
  final bool end;
}

typedef CellText = String Function(CellData d);

class SheetCol {
  const SheetCol({
    required this.key,
    required this.label,
    required this.width,
    required this.text,
    this.tone = ColTone.none,
    this.merge = ColMerge.none,
    this.start = false,
    this.formulaKey,
    this.expand,
    this.remarkKind,
    this.bold = false,
    this.sub = false,
  });

  final String key;
  final String label;

  /// Design width in px at the phone's 12 px text; the table scales it.
  final double width;
  final CellText text;
  final ColTone tone;
  final ColMerge merge;

  /// Left-aligned text (Operator, Part Name…) instead of centred figures.
  final bool start;
  final String? formulaKey;
  final ColExpand? expand;

  /// 'reject' | 'downtime' | 'general': an eye that opens that remark.
  final String? remarkKind;
  final bool bold;

  /// A breakdown column shown after an opened total.
  final bool sub;

  SheetCol withExpand(ColExpand e) => _copy(expand: e);

  SheetCol withWidth(double w) => _copy(width: w);

  SheetCol _copy({double? width, ColExpand? expand}) => SheetCol(
    key: key,
    label: label,
    width: width ?? this.width,
    text: text,
    tone: tone,
    merge: merge,
    start: start,
    formulaKey: formulaKey,
    expand: expand ?? this.expand,
    remarkKind: remarkKind,
    bold: bold,
    sub: sub,
  );
}

/// The Date / Machine pair frozen at the left, the middle that scrolls, and
/// the Actions column frozen at the right (which is not a [SheetCol]).
class SheetColumns {
  const SheetColumns({required this.left, required this.middle});
  final List<SheetCol> left;
  final List<SheetCol> middle;

  double leftWidth(double k) => left.fold(0.0, (s, c) => s + c.width * k);
  double middleWidth(double k) => middle.fold(0.0, (s, c) => s + c.width * k);

  /// Left edge (design px x k) of the middle column [key], measured from the
  /// start of the middle section.
  double middleLeftOf(String key, double k) {
    var x = 0.0;
    for (final c in middle) {
      if (c.key == key) return x;
      x += c.width * k;
    }
    return x;
  }
}

/// The open breakdowns: each id is one expandable column.
const List<String> expandIds = ['cycle', 'rejectedQty', 'downtime'];

/// Edit + Delete beside each other: roomy on an iPad, compact on a phone so Actions
/// can stay pinned and visible without eating the columns.
const double actionsWidth = 104;
const double actionsWidthPhone = 76;

String _text(Object? v) => textStr(v);

SheetCol _sub(
  String key,
  String label,
  CellText text, {
  double width = 92,
  String? formulaKey,
  ColTone tone = ColTone.none,
  String? remarkKind,
}) => SheetCol(
  key: key,
  label: label,
  width: width,
  text: text,
  formulaKey: formulaKey,
  tone: tone,
  remarkKind: remarkKind,
  sub: true,
);

/// The columns of the web table in sheet order, with the four breakdowns
/// opened as [open] says.
SheetColumns buildSheetColumns(Set<String> open) {
  final left = <SheetCol>[
    SheetCol(
      key: 'date',
      label: 'Date',
      width: 84,
      merge: ColMerge.date,
      bold: true,
      start: true,
      text: (d) => displayDay('${d.row['date']}'),
    ),
    SheetCol(
      key: 'machine',
      label: 'Machine',
      width: 70,
      merge: ColMerge.machineDay,
      bold: true,
      start: true,
      text: (d) => d.machineName.isEmpty ? '—' : d.machineName,
    ),
  ];

  void expandable(
    SheetCol summary,
    String id,
    String label,
    List<SheetCol> subs,
    List<SheetCol> out,
  ) {
    final isOpen = open.contains(id);
    out.add(
      summary.withExpand(ColExpand(id: id, isOpen: isOpen, label: label)),
    );
    if (isOpen) {
      for (var i = 0; i < subs.length; i++) {
        out.add(
          i == subs.length - 1
              ? subs[i].withExpand(
                  ColExpand(id: id, isOpen: true, label: label, end: true),
                )
              : subs[i],
        );
      }
    }
  }

  final mid = <SheetCol>[
    SheetCol(
      key: 'operator',
      label: 'Operator',
      width: 124,
      start: true,
      text: (d) => _text(d.row['operator']),
    ),
    SheetCol(
      key: 'itemName',
      label: 'Part Name',
      width: 164,
      start: true,
      text: (d) => _text(d.row['itemName']),
    ),
    SheetCol(
      key: 'drawingNo',
      label: 'Drawing No.',
      width: 124,
      start: true,
      text: (d) => _text(d.row['drawingNo']),
    ),
  ];

  expandable(
    SheetCol(
      key: 'cycle',
      label: 'Total Cycle Time (sec)',
      width: 150,
      tone: ColTone.calc,
      formulaKey: 'cycle',
      text: (d) => nStr(d.calc['totalCycleSec']),
    ),
    'cycle',
    'Total Cycle Time',
    [
      for (final f in cycleOpFields)
        _sub(
          '${f['key']}',
          cycleOpLabel(f),
          (d) => _text(d.row[f['key']]),
          width: 96,
        ),
    ],
    mid,
  );

  mid.addAll([
    SheetCol(
      key: 'on',
      label: 'Machine ON Time',
      width: 92,
      text: (d) => _text(d.row['machineOnTime']),
    ),
    SheetCol(
      key: 'off',
      label: 'Machine OFF Time',
      width: 92,
      text: (d) => _text(d.row['machineOffTime']),
    ),
    SheetCol(
      key: 'shift',
      label: 'Machine Shift Time (hr:min)',
      width: 104,
      tone: ColTone.calc,
      formulaKey: 'shift',
      text: (d) => hmStr(d.calc['shiftHours']),
    ),
    SheetCol(
      key: 'idealQty',
      label: 'Ideal Quantity',
      width: 88,
      tone: ColTone.calc,
      formulaKey: 'idealQty',
      text: (d) => nStr(d.calc['idealQty']),
    ),
    SheetCol(
      key: 'actualQty',
      label: 'Actual Quantity',
      width: 92,
      text: (d) => nStr(d.calc['actualQty']),
    ),
    SheetCol(
      key: 'okQty',
      label: 'Actual OK Quantity',
      width: 100,
      text: (d) => minStr(d.row['okQty']),
    ),
  ]);

  expandable(
    SheetCol(
      key: 'rejectedQty',
      label: 'Rejected Quantity',
      width: 148,
      tone: ColTone.calc,
      formulaKey: 'rejectedQty',
      text: (d) => nStr(d.calc['rejectedQty']),
    ),
    'rejectedQty',
    'Rejected Quantity',
    [
      for (final reason in rejectReasons)
        _sub(
          reason,
          reason,
          (d) {
            final b = d.row['rejectBreakdown'];
            return minStr(b is Map ? b[reason] : null);
          },
          width: reason == 'Other' ? 124 : 100,
          remarkKind: reason == 'Other' ? 'reject' : null,
        ),
    ],
    mid,
  );

  mid.add(
    SheetCol(
      key: 'pctOk',
      label: '% OK Quantity',
      width: 88,
      tone: ColTone.calc,
      formulaKey: 'pctOk',
      text: (d) => pctStr(d.calc['pctOk']),
    ),
  );

  mid.add(
    SheetCol(
      key: 'plannedShift',
      label: 'Planned Operator Shift Time (hr:min)',
      width: 160,
      text: (d) => hmStr(d.row['plannedOperatorShiftHours']),
    ),
  );

  mid.add(
    SheetCol(
      key: 'unutilized',
      label: 'Unutilized Machine Time (%)',
      width: 112,
      tone: ColTone.day,
      formulaKey: 'unutilized',
      text: (d) => pctStr(d.day['unutilized']),
    ),
  );

  expandable(
    SheetCol(
      key: 'totalStoppage',
      label: 'Total Stoppage (min)',
      width: 150,
      tone: ColTone.calc,
      formulaKey: 'totalStoppage',
      text: (d) => nStr(d.calc['totalStoppageMin']),
    ),
    'downtime',
    'Total Stoppage',
    [
      // Lunch / Rest is stoppage time, so it sits with the other stoppage boxes.
      _sub(
        'lunchMin',
        'Lunch / Rest (min)',
        (d) => zeroIfBlank(d.row['lunchMin']),
        width: 100,
      ),
      for (final f in stoppageFields)
        if (f['key'] != 'plannedDownMin' && f['key'] != 'lunchMin')
          _sub(
            '${f['key']}',
            downtimeLabels['${f['key']}'] ?? '${f['label']}',
            (d) => zeroIfBlank(d.row[f['key']]),
            width: f['key'] == 'otherMin' ? 124 : 104,
            remarkKind: f['key'] == 'otherMin' ? 'downtime' : null,
          ),
    ],
    mid,
  );

  mid.addAll([
    SheetCol(
      key: 'effective',
      label: 'Effective Machine Run Time (hr:min)',
      width: 116,
      tone: ColTone.calc,
      formulaKey: 'effective',
      text: (d) => hmStr(d.calc['effectiveHours']),
    ),
    SheetCol(
      key: 'unreported',
      label: 'Unreported Time (min)',
      width: 104,
      tone: ColTone.day,
      formulaKey: 'unreported',
      merge: ColMerge.machineDay,
      text: (d) => nStr(d.day['unreportedMin']),
    ),
    SheetCol(
      key: 'setupEff',
      label: 'Setup Efficiency (%)',
      width: 104,
      tone: ColTone.calc,
      formulaKey: 'setupEff',
      text: (d) => pctStr(d.calc['setupEfficiency']),
    ),
    SheetCol(
      key: 'oeeLosses',
      label: 'OEE considering losses (%)',
      width: 124,
      tone: ColTone.oee,
      formulaKey: 'oeeLosses',
      merge: ColMerge.machineDay,
      text: (d) => pctStr(d.day['oeeLosses']),
    ),
    SheetCol(
      key: 'oeeLunch',
      label: 'OEE not considering losses but lunch (%)',
      width: 164,
      tone: ColTone.oee,
      formulaKey: 'oeeLunch',
      merge: ColMerge.machineDay,
      text: (d) => pctStr(d.day['oeeLunch']),
    ),
    SheetCol(
      key: 'oeeLunchCot',
      label: 'OEE not considering losses but lunch and setup time (%)',
      width: 204,
      tone: ColTone.oee,
      formulaKey: 'oeeLunchCot',
      merge: ColMerge.machineDay,
      text: (d) => pctStr(d.day['oeeLunchCot']),
    ),
    SheetCol(
      key: 'remarks',
      label: 'Remarks',
      width: 84,
      remarkKind: 'general',
      text: (d) => '',
    ),
  ]);

  return SheetColumns(
    left: [for (final c in left) _fitted(c)],
    middle: [for (final c in mid) _fitted(c)],
  );
}

// ── Header fit ──────────────────────────────────────────────────────────────
// A header shows two lines and nothing more, so a label that needs a third
// ("Stoppage Allowed (min)" beside its ⓘ) used to end in "…". Every column is
// at least wide enough for its whole label on two lines. Estimated (bold 12 px
// text, ~6.6 px a character) rather than measured, so it is the same on every
// device and in tests.

const double _charPx = 6.6;
const double _headPad = 12; // 6 px each side
const double _formulaIcon = 17; // ⓘ + gap
const double _chevronSlot = 32;

/// Lines [label] takes when each may hold [chars] characters (greedy word wrap).
int _linesFor(String label, int chars) {
  var lines = 1, used = 0;
  for (final word in label.split(' ')) {
    if (word.length > chars) return 99; // a single word wider than the line
    final need = used == 0 ? word.length : used + 1 + word.length;
    if (need <= chars) {
      used = need;
    } else {
      lines++;
      used = word.length;
    }
  }
  return lines;
}

SheetCol _fitted(SheetCol c) {
  final extras =
      _headPad +
      (c.formulaKey != null ? _formulaIcon : 0) +
      (c.expand != null ? _chevronSlot : 0);
  var chars = 4;
  while (_linesFor(c.label, chars) > 2 && chars < 80) {
    chars++;
  }
  final need = (chars * _charPx + extras).ceilToDouble();
  return need > c.width ? c.withWidth(need) : c;
}
