import '../../../../core/theme/app_colors.dart';
import '../../process/process_spec.dart';
import '../../shared/production_sheet_calc.dart';
import '../sheet_model.dart';
import '../widgets/sheet_format.dart';
import '../widgets/sheet_style.dart';
import 'sheet_columns.dart';

// Columns / detail rows that several web sheets share (ProductionEntriesTable.jsx:
// MACHINE_STATUS_COLUMN, VENDOR_COLUMN, APQ_COLUMNS, REVIEW_COLUMN), built once
// for any spec to drop into its `columns()` / `detail()`:
//
//   machineStatusColumn()   Machine Working Status ("Working — …" / "Non Working — …")
//   vendorColumn()          Vendor Name — hidden unless the page uses vendors
//   apqColumns()            Availability / Performance / Quality, red above 100%
//   reviewColumn()          OEE Review badge: Pending review / Approved / Rejected
//
// and their detail counterparts (machineStatusMetric, vendorMetric, apqMetrics,
// reviewRows).

// ── Over 100% ─────────────────────────────────────────────────────────────

/// Web `pctOver`: a figure above 100% (a tiny tolerance keeps floating-point
/// dust out) is held for Admin review and shown in red, never capped.
bool isOver100(Object? v) => isNum(v) && (v as num) > 1 + 1e-9;

/// The red emphasis of a value above 100%, else null (plain).
CellStyle? over100Style(Object? v) => isOver100(v) ? CellStyle.danger : null;

/// The red emphasis of a day figure column (OEE considering losses, … and the
/// worker sheets' Productivity): above 100% the entry is held for Admin review,
/// so the web's `pctOver` paints it red. Null for any other column, or one that
/// brings its own style.
CellStyle? oeeFigureStyle(SheetCol col, Json day) =>
    (col.style == null && col.tone == ColTone.oee && _oeeFigureColumnKeys.contains(col.key)) ? over100Style(day[col.key]) : null;

const Set<String> _oeeFigureColumnKeys = {'oeeLosses', 'oeeLunch', 'oeeLunchCot', 'productivity', 'productivityLunch'};

// ── Machine Working Status ───────────────────────────────────────────────

/// Web MACHINE_STATUS_COLUMN: "Working", "Working — a, b" or "Non Working — a, b".
String machineStatusText(Json r) {
  final raw = r['machineStatus'];
  final status = raw is List ? [for (final s in raw) '$s'] : <String>[];
  if (r['workingMode'] == 'Non Working') return ['Non Working', ...status].join(' — ');
  return status.isNotEmpty ? 'Working — ${status.join(', ')}' : 'Working';
}

SheetCol machineStatusColumn() => fitSheetColumn(
  SheetCol(
    key: 'machineStatus',
    label: 'Machine Working Status',
    width: 150,
    start: true,
    text: (d) => machineStatusText(d.row),
  ),
);

DetailMetric machineStatusMetric(Json row) => DetailMetric(label: 'Machine Working Status', value: machineStatusText(row), maxLines: 3);

// ── Vendor ────────────────────────────────────────────────────────────────

/// Web VENDOR_COLUMN — right after Part Name; only on a page that uses vendors
/// (`SheetController.showVendorColumn`, applied through [SheetCol.shownWhen]).
SheetCol vendorColumn() => fitSheetColumn(
  SheetCol(
    key: 'vendorName',
    label: 'Vendor Name',
    width: 140,
    start: true,
    text: (d) => textStr(d.row['vendorName']),
    shownWhen: (env) => env.showVendor,
  ),
);

/// The Vendor Name row of the detail — only while the entry names one.
DetailMetric? vendorMetric(Json row) {
  final name = '${row['vendorName'] ?? ''}';
  return name.isEmpty ? null : DetailMetric(label: 'Vendor Name', value: name);
}

// ── Availability / Performance / Quality ─────────────────────────────────

/// Web APQ_COLUMNS: this entry's Availability / Performance / Quality
/// (`calc`), red when above 100%.
List<SheetCol> apqColumns() => [
  for (final (key, label) in const [
    ('availability', 'Availability (%)'),
    ('performance', 'Performance (%)'),
    ('quality', 'Quality (%)'),
  ])
    fitSheetColumn(
      SheetCol(
        key: key,
        label: label,
        width: 104,
        tone: ColTone.calc,
        formulaKey: key,
        text: (d) => pctStr(d.calc[key]),
        style: (d) => over100Style(d.calc[key]),
      ),
    ),
];

/// The three figures as detail rows (red above 100%, tap shows the formula).
List<DetailMetric> apqMetrics(Json calc) => [
  for (final (key, label) in const [
    ('availability', 'Availability (%)'),
    ('performance', 'Performance (%)'),
    ('quality', 'Quality (%)'),
  ])
    DetailMetric(
      label: label,
      value: pctStr(calc[key]),
      tone: isOver100(calc[key]) ? AppColors.critical : SheetTones.calc,
      formulaKey: key,
    ),
];

// ── OEE Review ───────────────────────────────────────────────────────────

/// The review state of a row: 'pending' | 'approved' | 'rejected', or '' for an
/// entry that never needed one.
String reviewStatusOf(Json r) {
  final review = r['review'];
  final status = review is Map ? '${review['status'] ?? ''}' : '';
  return const {'pending', 'approved', 'rejected'}.contains(status) ? status : '';
}

/// Web ReviewBadge's text: "—" for an entry that never needed review.
String reviewText(Json r) => switch (reviewStatusOf(r)) {
  'pending' => 'Pending review',
  'approved' => 'Approved',
  'rejected' => 'Rejected',
  _ => '—',
};

/// The badge colour: pending amber (warning-subtle), approved green, rejected red.
CellStyle? reviewStyle(Json r) => switch (reviewStatusOf(r)) {
  'pending' => const CellStyle(mark: CellMark.warn, pill: true, bold: true),
  'approved' => const CellStyle(mark: CellMark.ok, pill: true, bold: true),
  'rejected' => const CellStyle(mark: CellMark.danger, pill: true, bold: true),
  _ => null,
};

/// What the web shows on hover, as separate lines: what was over 100%
/// ("Availability 105.00%"), who decided, and the reviewer's remark.
({String over, String by, String remark}) reviewInfo(Json r) {
  final review = r['review'];
  if (review is! Map || reviewStatusOf(r).isEmpty) return (over: '', by: '', remark: '');
  final flagged = review['flagged'];
  final over = flagged is List
      ? [
          for (final f in flagged)
            if (f is Map) '${oeeMetricLabels['${f['metric']}'] ?? f['metric']} ${fmtPct(f['value'])}',
        ].join(', ')
      : '';
  final decided = review['decidedBy'];
  final name = decided is Map ? '${decided['name'] ?? ''}' : '';
  return (
    over: over,
    by: name.isEmpty ? '' : '${review['status']} by $name',
    remark: '${review['remark'] ?? ''}',
  );
}

/// Web REVIEW_COLUMN — after the OEE columns.
SheetCol reviewColumn() => fitSheetColumn(
  SheetCol(
    key: 'review',
    label: 'OEE Review',
    width: 120,
    formulaKey: 'review',
    text: (d) => reviewText(d.row),
    style: (d) => reviewStyle(d.row),
  ),
);

/// The detail rows of the review: the badge, then (when present) what was over
/// 100%, who decided and the remark — the phone's version of the hover title.
List<DetailRow> reviewRows(Json row) {
  final info = reviewInfo(row);
  return [
    DetailMetric(label: 'OEE Review', value: reviewText(row), formulaKey: 'review', style: reviewStyle(row)),
    if (info.over.isNotEmpty) DetailSubRow(label: 'Over 100%', value: info.over),
    if (info.by.isNotEmpty) DetailSubRow(label: 'Decision', value: info.by),
    if (info.remark.isNotEmpty) DetailSubRow(label: 'Remark', value: info.remark),
  ];
}
