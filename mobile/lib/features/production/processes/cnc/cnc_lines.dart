import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../entry_form/common_lines.dart';
import '../../entry_form/entry_fields.dart';
import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_form_toast.dart';
import '../../entry_form/entry_layout.dart';
import '../../entry_form/entry_line_context.dart';
import '../../entry_form/entry_number_input.dart';
import '../../entry_form/entry_op_tile.dart';
import '../../entry_form/machine_status.dart';
import '../../entry_form/web_parity_lines.dart';
import '../../shared/limit_notice.dart' show NoticeWords, machineWords, qtyNotice;
import '../../shared/production_sheet_calc.dart';

final List<String> _line2 = ['itemName', 'vendor', ...entryCycleOpKeys];
const List<String> _line5 = ['actualQty', 'okQty'];
const List<String> _line13 = ['rejectBreakdown', 'rejectOtherRemark'];

/// The CNC Data Entry form (port of ProductionEntryForm.jsx): the shared lines
/// with CNC's own Part (+ operation ticks), Production Master and Rejection
/// Master cards. The template to copy for another process's lines.
class CncEntryLines extends EntryLines {
  const CncEntryLines();

  // A Non Working entry (web: the machine did not run) asks for nothing but the
  // head line (Date, Machine, Operator, Status) and the Remarks.
  @override
  List<Widget> left(EntryLineContext c) => isNonWorking(c.values)
      ? [dateMachineOperatorLine(c, workingStatus: true), nonWorkingNote(c)]
      : [dateMachineOperatorLine(c, workingStatus: true), partLine(c), timeLine(c), quantityLine(c)];

  @override
  List<Widget> right(EntryLineContext c) =>
      isNonWorking(c.values) ? [remarksLine(c)] : [rejectLine(c), shiftLine(c), downtimeLine(c), remarksLine(c)];

  @override
  String collapsedSummary(Map<String, dynamic> v) => [
        if (entryText(v['itemName']).isNotEmpty) entryText(v['itemName']),
        if (entryText(v['actualQty']).isNotEmpty) 'Actual ${entryText(v['actualQty'])}',
        if (entryText(v['okQty']).isNotEmpty) 'OK ${entryText(v['okQty'])}',
      ].join(' · ');
}

/// Part Name, Total Cycle Time and the tickable operations.
Widget partLine(EntryLineContext c) {
  final m = c.metrics;
  final item = entryItemFor(c.values, c.items);
  final excluded = entryExcludedOps(c.values);
  return EntryLineCard(
    title: 'Part Name, Total Cycle Time',
    icon: Icons.precision_manufacturing_outlined,
    hasError: c.lineHasError(_line2),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Part Name',
            required: true,
            error: c.err('itemName'),
            span: EntryCell.full,
            child: c.keyed(
              'itemName',
              EntryPickerBox(
                key: ValueKey('entry${c.index}/itemName'),
                // Web `partCycleLabel`: "Flange 40 — 60 sec". A record typed into the
                // old grid has a part name but no link to the Item master: show that
                // name rather than an empty box.
                text: partBoxText(c),
                hint: 'Select part',
                maxLines: 2,
                invalid: c.err('itemName') != null,
                focusNode: c.nodeFor('itemName'),
                semanticsLabel: 'Part Name',
                onTap: c.pickItem,
              ),
            ),
          ),
          EntryCell(
            label: 'Total Cycle Time (sec)',
            child: c.calcBox('totalCycleSec', entryFmt(m.calc['totalCycleSec']), 'Total Cycle Time (sec)'),
          ),
          // Vendor Name: only when the machine's process has vendors (or the entry names one).
          ?vendorCell(c),
        ],
      ),
      // The web has no heading or note over the operation tick boxes.
      const SizedBox(height: 10),
      Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [for (final f in cycleOpFields) _opTile(c, f, item, excluded)],
      ),
    ],
  );
}

Widget _opTile(EntryLineContext c, Map<String, dynamic> f, Map<String, dynamic>? item, Set<String> excluded) {
  final key = f['key'] as String;
  final canTick = entryCanTick(item, key);
  final isExcluded = excluded.contains(key);
  return c.keyed(
    key,
    EntryOpTile(
      key: ValueKey('entry${c.index}/$key'),
      label: cycleOpLabel(f),
      value: canTick ? entryFmt(item![key]) : '',
      ticked: canTick && !isExcluded,
      excluded: isExcluded,
      enabled: canTick,
      focusNode: c.nodeFor(key),
      onToggle: () {
        HapticFeedback.selectionClick();
        final raw = c.values['excludedOps'];
        final list = raw is List ? List<dynamic>.from(raw) : <dynamic>[];
        // Unticking only excludes the operation from this entry's Total Cycle
        // Time; the Part's own seconds are never touched, so ticking it back
        // needs nothing restored.
        c.set('excludedOps', isExcluded ? list.where((k) => '$k' != key).toList() : [...list, key]);
      },
    ),
  );
}

/// How a sheet names the three Production Master boxes (web QuantityMaster.jsx
/// `labels`): Before Powder Coating says TOTAL QTY / OK QTY / Rejected QTY.
/// Left out, they read as on the CNC form. [okShort] is how the phone-only
/// hints call OK ("… so OK can only be 0").
class QtyLabels {
  const QtyLabels({this.actual = 'Actual Quantity', this.ok = 'OK Quantity', this.rejected = 'Rejected', this.okShort = 'OK'});
  final String actual;
  final String ok;
  final String rejected;
  final String okShort;
}

/// The web's Production Master: Actual Quantity and OK Quantity (typed) and the
/// grey Rejected — nothing else. Ideal Quantity is not a box: it only caps Actual
/// (past it the web's popup, or a toast, shows the figures).
///
/// The web ProductionMasterFields' options: [labels] names the boxes the sheet's
/// own way; [capByIdeal] false leaves Actual uncapped (an over-Ideal entry goes
/// to OEE Review instead) and OK capped only by a typed Actual; [words] words
/// the quantity popup. [moreCells] (a sheet's grey Ideal / Effective boxes) sit
/// in their own row under the three, above the over-100% banner.
Widget quantityLine(
  EntryLineContext c, {
  QtyLabels labels = const QtyLabels(),
  bool capByIdeal = true,
  NoticeWords words = machineWords,
  List<EntryCell> moreCells = const [],
}) {
  final m = c.metrics;
  // Web: `max={actualTyped ? Number(actualQty) : capByIdeal ? calc.idealQty : undefined}`.
  final okMax = capByIdeal ? m.okMax : (isBlankValue(c.values['actualQty']) ? null : entryNum(c.values['actualQty']));
  return EntryLineCard(
    title: 'Production Master',
    icon: Icons.inventory_2_outlined,
    hasError: c.lineHasError(_line5),
    children: [
      EntryGrid(
        // The web's three boxes in one row where there is room (a tablet column).
        maxCols: 3,
        cells: [
          EntryCell(
            label: labels.actual,
            required: true,
            error: c.err('actualQty'),
            // Phone-only: says why the box takes nothing (the web raises a popup when you type).
            hint: capByIdeal && c.locked('actualQty', m.idealQty)
                ? 'Ideal Quantity is 0, so Actual can only be 0 — check the Machine ON/OFF times and the Part.'
                : null,
            child: c.keyed(
              'actualQty',
              c.numBox(
                'actualQty',
                max: capByIdeal ? m.idealQty : null,
                label: labels.actual,
                // Past Ideal Quantity: the web's popup with the figures (a toast without popups).
                onExceedTyped: capByIdeal
                    ? c.onLimit(
                        (typed) => qtyNotice(calc: m.calc, entered: typed, label: labels.actual, words: words),
                        (max) => "${labels.actual} can't be more than Ideal Quantity (${fmtNum(max)})",
                      )
                    : null,
              ),
            ),
          ),
          EntryCell(
            label: labels.ok,
            required: true,
            error: c.err('okQty'),
            hint: c.locked('okQty', okMax) ? '${labels.actual} is 0, so ${labels.okShort} can only be 0.' : null,
            child: c.keyed(
              'okQty',
              c.numBox(
                'okQty',
                max: okMax,
                label: labels.ok,
                onExceed: (max) => EntryFormToast.warn("${labels.ok} can't be more than ${labels.actual} (${fmtNum(max)})"),
              ),
            ),
          ),
          EntryCell(label: labels.rejected, child: c.calcBox('rejectedQty', entryFmt(m.calc['rejectedQty']), labels.rejected)),
        ],
      ),
      if (moreCells.isNotEmpty) ...[
        const SizedBox(height: 10),
        EntryGrid(maxCols: 3, cells: moreCells),
      ],
      // Availability / Performance / Quality above 100% -> goes to Admin review.
      oeeCheck(c),
    ],
  );
}

/// The Rejection Master split: one box per reason, which have to add up to Rejected.
///
/// [reasons]: the sheet's own reject reasons (web RejectionMasterFields
/// `reasons` — Before Powder Coating has its own); left out, the CNC list.
/// [labels] only words the phone-only hint under boxes that can't take a figure yet.
Widget rejectLine(EntryLineContext c, {List<String> reasons = rejectReasons, QtyLabels labels = const QtyLabels()}) {
  final m = c.metrics;
  final s = c.theme.colorScheme;
  final split = c.values['rejectBreakdown'];
  final splitErr = c.err('rejectBreakdown');
  final rejectedText = entryFmt(m.calc['rejectedQty']);
  final mismatchStyle = TextStyle(color: s.error, fontWeight: FontWeight.w700);
  final muted = TextStyle(color: s.onSurfaceVariant);
  return EntryLineCard(
    title: 'Rejection Master (Qty)',
    icon: Icons.block_rounded,
    hasError: c.lineHasError(_line13),
    optional: true,
    hasValue: c.anyFilled(_line13),
    children: [
      c.keyed(
        'rejectBreakdown',
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            EntryGrid(
              maxCols: 3,
              cells: [
                for (var r = 0; r < reasons.length; r++)
                  EntryCell(
                    label: reasons[r],
                    child: EntryTextField(
                      key: ValueKey('entry${c.index}/reject/${reasons[r]}'),
                      value: entryText(split is Map ? split[reasons[r]] : null),
                      numeric: true,
                      decimals: false,
                      // The first box is where a failed Save puts the cursor.
                      focusNode: r == 0 ? c.nodeFor('rejectBreakdown') : null,
                      invalid: splitErr != null && m.splitMismatch,
                      max: m.rejectRoom(reasons[r]),
                      semanticsLabel: reasons[r],
                      onExceedMax: (max) => EntryFormToast.warn(
                        m.rejected == 0
                            ? 'Rejected Quantity is 0 (Actual − OK), so there is nothing to split.'
                            : 'Only ${jsNumStr(max)} of the ${jsNumStr(m.rejected)} rejected pieces are left for “${reasons[r]}” — the boxes can\'t add up to more than Rejected.',
                      ),
                      onChanged: (t) => c.onRejectChange(c.index, reasons[r], t),
                    ),
                  ),
              ],
            ),
            // Phone-only: why some Rejection Master boxes can take no figure yet.
            if (reasons.any((r) => EntryTextField.capLocks(entryText(split is Map ? split[r] : null), m.rejectRoom(r))))
              EntryHintText(_rejectLockReason(m, labels)),
            const SizedBox(height: 8),
            // The split has to account for every rejected piece, so the
            // running total sits next to the figure it must match.
            Text.rich(
              key: ValueKey('entry${c.index}/splitSummary'),
              style: const TextStyle(fontSize: 13, height: 1.3),
              TextSpan(
                children: [
                  TextSpan(text: 'Split so far: ', style: muted),
                  TextSpan(
                    text: jsNumStr(m.splitTotal),
                    style: m.splitMismatch ? mismatchStyle : const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  TextSpan(text: ' of ${rejectedText.isEmpty ? '0' : rejectedText} rejected', style: muted),
                  if (m.splitTotal < m.rejected)
                    TextSpan(text: ' — ${jsNumStr(m.rejected - m.splitTotal)} left to assign', style: TextStyle(color: s.error)),
                ],
              ),
            ),
            if (splitErr != null) EntryErrorText(splitErr),
          ],
        ),
      ),
      if (m.rejectOtherUsed) ...[
        const SizedBox(height: 10),
        EntryGrid(
          cells: [
            EntryCell(
              label: 'Remark for “Other” rejection',
              required: true,
              error: c.err('rejectOtherRemark'),
              span: EntryCell.full,
              child: c.keyed(
                'rejectOtherRemark',
                EntryTextField(
                  key: ValueKey('entry${c.index}/rejectOtherRemark'),
                  value: c.text('rejectOtherRemark'),
                  maxLength: 300,
                  minLines: 2,
                  maxLines: 4,
                  hint: 'Why were these pieces rejected as “Other”?',
                  invalid: c.err('rejectOtherRemark') != null,
                  focusNode: c.nodeFor('rejectOtherRemark'),
                  semanticsLabel: 'Remark for Other rejection',
                  onChanged: (t) => c.set('rejectOtherRemark', t),
                ),
              ),
            ),
          ],
        ),
      ],
    ],
  );
}

/// Why the Rejection Master boxes can't take a figure yet, in the sheet's own
/// words ([EntryMetrics.rejectLockReason] on a form that keeps the CNC labels).
String _rejectLockReason(EntryMetrics m, QtyLabels labels) {
  if (labels.actual == const QtyLabels().actual && labels.ok == const QtyLabels().ok) return m.rejectLockReason;
  if (!m.rejectedKnown) {
    return 'Enter ${labels.actual} and ${labels.ok} first — a reject quantity can only be entered once some pieces are rejected (${labels.actual} more than ${labels.ok}).';
  }
  if (m.rejected <= 0) return 'Nothing to reject — ${labels.actual} and ${labels.ok} are equal.';
  return m.rejectLockReason;
}
