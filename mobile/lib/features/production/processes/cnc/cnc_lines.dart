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
import '../../entry_form/entry_style.dart';
import '../../shared/limit_notice.dart' show qtyNotice;
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
  final itemName = c.text('itemName');
  final hasItem = c.text('item').isNotEmpty;
  final s = c.theme.colorScheme;
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
                // A record typed into the old grid has a part name but no link
                // to the Item master: show that name rather than an empty box.
                text: itemName,
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
      const SizedBox(height: 10),
      Text(
        hasItem || item != null ? 'Operations in this cycle' : 'Operations (pick a part first)',
        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: s.onSurface),
      ),
      const SizedBox(height: 2),
      Text(
        "Untick one to leave it out of this entry's cycle time.",
        style: TextStyle(fontSize: EntryStyle.noteSize, color: s.onSurfaceVariant, height: 1.25),
      ),
      const SizedBox(height: 8),
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

/// Ideal / Actual / OK quantity and what they make.
Widget quantityLine(EntryLineContext c) {
  final m = c.metrics;
  return EntryLineCard(
    title: 'Production Master',
    icon: Icons.inventory_2_outlined,
    hasError: c.lineHasError(_line5),
    children: [
      EntryGrid(
        cells: [
          EntryCell(label: 'Ideal Quantity', child: c.calcBox('idealQty', entryFmt(m.calc['idealQty']), 'Ideal Quantity')),
          EntryCell(
            label: 'Actual Quantity',
            required: true,
            error: c.err('actualQty'),
            hint: c.locked('actualQty', m.idealQty)
                ? 'Ideal Quantity is 0, so Actual can only be 0 — check the Machine ON/OFF times and the Part.'
                : null,
            child: c.keyed(
              'actualQty',
              c.numBox(
                'actualQty',
                max: m.idealQty,
                label: 'Actual Quantity',
                // Past Ideal Quantity: the web's popup with the figures (a toast without popups).
                onExceedTyped: c.onLimit(
                  (typed) => qtyNotice(calc: m.calc, entered: typed, label: 'Actual Quantity'),
                  (max) => "Actual Quantity can't be more than Ideal Quantity (${fmtNum(max)})",
                ),
              ),
            ),
          ),
          EntryCell(
            label: 'OK Quantity',
            required: true,
            error: c.err('okQty'),
            hint: c.locked('okQty', m.okMax) ? 'Actual Quantity is 0, so OK can only be 0.' : null,
            child: c.keyed(
              'okQty',
              c.numBox(
                'okQty',
                max: m.okMax,
                label: 'OK Quantity',
                onExceed: (max) => EntryFormToast.warn("OK Quantity can't be more than Actual Quantity (${fmtNum(max)})"),
              ),
            ),
          ),
          EntryCell(label: 'Rejected', child: c.calcBox('rejectedQty', entryFmt(m.calc['rejectedQty']), 'Rejected')),
          EntryCell(label: '% OK Quantity', child: c.calcBox('pctOk', fmtPct(m.calc['pctOk']), '% OK Quantity')),
        ],
      ),
      // Availability / Performance / Quality above 100% -> goes to Admin review.
      oeeCheck(c),
    ],
  );
}

/// The Rejection Master split: one box per reason, which have to add up to Rejected.
Widget rejectLine(EntryLineContext c) {
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
                for (var r = 0; r < rejectReasons.length; r++)
                  EntryCell(
                    label: rejectReasons[r],
                    child: EntryTextField(
                      key: ValueKey('entry${c.index}/reject/${rejectReasons[r]}'),
                      value: entryText(split is Map ? split[rejectReasons[r]] : null),
                      numeric: true,
                      decimals: false,
                      // The first box is where a failed Save puts the cursor.
                      focusNode: r == 0 ? c.nodeFor('rejectBreakdown') : null,
                      invalid: splitErr != null && m.splitMismatch,
                      max: m.rejectRoom(rejectReasons[r]),
                      semanticsLabel: rejectReasons[r],
                      onExceedMax: (max) => EntryFormToast.warn(
                        m.rejected == 0
                            ? 'Rejected Quantity is 0 (Actual − OK), so there is nothing to split.'
                            : 'Only ${jsNumStr(max)} of the ${jsNumStr(m.rejected)} rejected pieces are left for “${rejectReasons[r]}” — the boxes can\'t add up to more than Rejected.',
                      ),
                      onChanged: (t) => c.onRejectChange(c.index, rejectReasons[r], t),
                    ),
                  ),
              ],
            ),
            // Why some Rejection Master boxes can take no figure yet.
            if (rejectReasons.any((r) => EntryTextField.capLocks(entryText(split is Map ? split[r] : null), m.rejectRoom(r))))
              EntryHintText(m.rejectLockReason),
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
