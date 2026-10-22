import 'package:flutter/painting.dart' show Color;

import '../../../../core/theme/app_colors.dart';
import '../../processes/cnc/cnc_columns.dart';
import '../sheet_model.dart';

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

/// How a cell is emphasised beyond its [ColTone] — a spec marks a value (an
/// over-100% figure in red, a review badge…) without touching the text:
/// [danger] red, [warn] amber, [ok] green (all theme-readable on both modes).
enum CellMark { none, danger, warn, ok }

/// Per-cell emphasis returned by [SheetCol.style]; null = the column's plain look.
class CellStyle {
  const CellStyle({this.mark = CellMark.none, this.pill = false, this.bold});

  /// The colour family of the text (and of the pill's wash).
  final CellMark mark;

  /// Draw the text as a rounded badge (the web's `badge rounded-pill`).
  final bool pill;

  /// Force the weight (null = the column's own).
  final bool? bold;

  static const CellStyle danger = CellStyle(mark: CellMark.danger, bold: true);

  @override
  bool operator ==(Object other) =>
      other is CellStyle && other.mark == mark && other.pill == pill && other.bold == bold;
  @override
  int get hashCode => Object.hash(mark, pill, bold);
}

/// The theme colour behind a [CellMark] (lift it with `SheetTones.text`).
Color cellMarkColor(CellMark m) => switch (m) {
  CellMark.danger => AppColors.critical,
  CellMark.warn => AppColors.warn,
  CellMark.ok => AppColors.ok,
  CellMark.none => AppColors.brand600,
};

typedef CellStyleFn = CellStyle? Function(CellData d);

/// What decides whether an optional column is shown (see [SheetCol.shownWhen]):
/// the page's facts, worked out by the list controller.
class SheetEnv {
  const SheetEnv({this.showVendor = true});

  /// The page's process uses vendors (Vendor Master), or a loaded entry names
  /// one — the web's `showVendorColumn`.
  final bool showVendor;
}

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
    this.style,
    this.shownWhen,
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

  /// Optional per-cell emphasis (red over-100% figures, review badges…). Null,
  /// or a null result, keeps the plain look — existing columns are unaffected.
  final CellStyleFn? style;

  /// Optional visibility rule (the Vendor Name column): hidden when it returns
  /// false for the page's [SheetEnv]. Null = always shown.
  final bool Function(SheetEnv env)? shownWhen;

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
    style: style,
    shownWhen: shownWhen,
  );
}

/// The Date / Machine pair frozen at the left, the middle that scrolls, and
/// the Actions column frozen at the right (which is not a [SheetCol]).
class SheetColumns {
  const SheetColumns({
    required this.left,
    required this.middle,
    this.expandSummary = const {'cycle': 'cycle', 'rejectedQty': 'rejectedQty', 'downtime': 'totalStoppage'},
  });
  final List<SheetCol> left;
  final List<SheetCol> middle;

  /// For each expandable breakdown id, the key of the total column it belongs
  /// to (the table keeps that total in view when the breakdown opens).
  final Map<String, String> expandSummary;

  /// These columns without the ones [SheetCol.shownWhen] hides for [env].
  /// Returns this very object when nothing is hidden.
  SheetColumns where(SheetEnv env) {
    bool shown(SheetCol c) => c.shownWhen == null || c.shownWhen!(env);
    if (left.every(shown) && middle.every(shown)) return this;
    return SheetColumns(
      left: left.where(shown).toList(),
      middle: middle.where(shown).toList(),
      expandSummary: expandSummary,
    );
  }

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

/// A breakdown column shown after an opened total (see [addExpandable]).
SheetCol sheetSubCol(
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

/// The CNC table's columns — kept here under its old name for callers and tests
/// that build them directly; a [ProcessSpec] supplies its own via `columns()`.
SheetColumns buildSheetColumns(Set<String> open) => cncColumns(open);

/// Adds [summary] to [out] with its expand chevron and, while [id] is open, the
/// [subs] after it (the last one carries the collapse chevron).
void addExpandable(
  Set<String> open,
  SheetCol summary,
  String id,
  String label,
  List<SheetCol> subs,
  List<SheetCol> out,
) {
  final isOpen = open.contains(id);
  out.add(summary.withExpand(ColExpand(id: id, isOpen: isOpen, label: label)));
  if (isOpen) {
    for (var i = 0; i < subs.length; i++) {
      out.add(
        i == subs.length - 1
            ? subs[i].withExpand(ColExpand(id: id, isOpen: true, label: label, end: true))
            : subs[i],
      );
    }
  }
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

/// [c] widened to fit its whole label on two header lines.
SheetCol fitSheetColumn(SheetCol c) {
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
