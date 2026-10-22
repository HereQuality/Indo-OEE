import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../entry_form/common_lines.dart';
import '../../entry_form/entry_fields.dart';
import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_layout.dart';
import '../../entry_form/entry_number_input.dart';
import '../../entry_form/entry_line_context.dart';
import '../../entry_form/entry_op_tile.dart';
import '../../entry_form/entry_style.dart';
import '../../entry_form/machine_status.dart';
import '../../entry_form/web_parity_lines.dart';
import '../../shared/limit_notice.dart' show qtyNotice;
import '../../shared/production_sheet_calc.dart';
import 'spm_calc.dart';
import 'spm_validation.dart';

/// The downtime boxes of the SPM form: key + label, in the web's order.
const List<(String, String)> spmDowntimeBoxes = [
  ('plannedDownMin', 'Planned Downtime (min)'),
  ('setupMin', 'Set-up Time (min)'),
  ('noManPowerMin', 'No Manpower (min)'),
  ('materialShiftingMin', 'Material Shifting (min)'),
  ('noMaterialMin', 'No Material (min)'),
  ('bdMechMin', 'B.D. Mech. (min)'),
  ('bdEleMin', 'B.D. Ele. (min)'),
  ('noPowerMin', 'No Power (min)'),
  ('otherMin', 'Others (min)'),
];

final List<String> _linePart = ['itemName', 'vendor', ...spmReferenceKeys];
const List<String> _lineQty = ['okQty', 'rejectedQty'];

/// What the SPM form derives from a block's values: CNC's [EntryMetrics] over
/// the SPM figures, with the web SPM form's own caps — the stoppage allowance is
/// the Machine Shift itself, and OK + Rejected share Ideal Quantity.
class SpmMetrics extends EntryMetrics {
  SpmMetrics(super.values) : super(calcFn: spmRowCalc);

  /// Machine Shift in minutes: all stoppage together can't be more than the machine ran.
  @override
  double? get stoppageLimit => spmStoppageLimit(values);

  @override
  ({double max, String message}) minutesLimit(String key) {
    final limit = stoppageLimit;
    final own = jsToNumber(values[key]);
    final room = limit == null
        ? 1440.0
        : math.min(1440.0, math.max(0.0, limit - (totalStoppage - (own.isNaN ? 0.0 : own))));
    return (
      max: room,
      message: limit == null
          ? "Downtime can't be more than 1440 minutes (a day)."
          : "Stoppage happens within the Machine Shift, so all of it together can't be more than ${jsNumStr(limit)} min.",
    );
  }

  double _typed(String key) {
    final n = jsToNumber(values[key]);
    return n.isNaN ? 0.0 : n;
  }

  /// What OK / Rejected may still take: whatever of Ideal Quantity the other
  /// leaves (null until Ideal Quantity is known).
  double? qtyRoom(String otherKey) {
    final ideal = idealQty;
    return ideal == null ? null : math.max(0.0, ideal - _typed(otherKey));
  }

  /// The message for a blocked keystroke past Ideal Quantity (web `qtyNotice`).
  String get qtyMessage => 'As per calculation, this machine can make at most ${fmtNum(idealQty)} pieces in this shift.';
}

/// The SPM Data Entry form (port of SpmEntryForm.jsx): the shared lines with
/// SPM's own Part / cycle-breakdown, Production (OK + Rejected) and Downtime cards.
class SpmEntryLines extends EntryLines {
  const SpmEntryLines();

  @override
  List<Widget> left(EntryLineContext c) => spmIsNonWorking(c.values)
      ? [dateMachineOperatorLine(c, workingStatus: true), nonWorkingNote(c)]
      : [dateMachineOperatorLine(c, workingStatus: true), spmPartLine(c), timeLine(c), spmQuantityLine(c)];

  @override
  List<Widget> right(EntryLineContext c) =>
      spmIsNonWorking(c.values) ? [remarksLine(c)] : [shiftLine(c), spmDowntimeLine(c), remarksLine(c)];

  @override
  String collapsedSummary(Map<String, dynamic> v) {
    if (spmIsNonWorking(v)) return 'Non Working';
    return [
      if (entryText(v['itemName']).isNotEmpty) entryText(v['itemName']),
      if (entryText(v['okQty']).isNotEmpty) 'OK ${entryText(v['okQty'])}',
      if (entryText(v['rejectedQty']).isNotEmpty) 'Rejected ${entryText(v['rejectedQty'])}',
    ].join(' · ');
  }
}

/// Part Name, the Part's reference figures, its tickable operations and Total
/// Cycle Time.
Widget spmPartLine(EntryLineContext c) {
  final m = c.metrics;
  final item = entryItemFor(c.values, c.items);
  final excluded = entryExcludedOps(c.values);
  final s = c.theme.colorScheme;
  return EntryLineCard(
    title: 'Part, Cycle Breakdown',
    icon: Icons.precision_manufacturing_outlined,
    hasError: c.lineHasError(_linePart),
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
                // A record typed into the old grid has a part name but no link to
                // the Item master: show that name rather than an empty box.
                text: c.text('itemName'),
                hint: 'Select part',
                maxLines: 2,
                invalid: c.err('itemName') != null,
                focusNode: c.nodeFor('itemName'),
                semanticsLabel: 'Part Name',
                onTap: c.pickItem,
              ),
            ),
          ),
          // Vendor Name: only when the machine's process has vendors (or the entry names one).
          ?vendorCell(c),
        ],
      ),
      const SizedBox(height: 10),
      // Set once on the Part (Production › Parts) and copied onto the entry
      // read-only — never typed here.
      EntryGrid(
        maxCols: 3,
        minColWidth: 100,
        cells: [
          for (final f in spmReferenceFields)
            EntryCell(label: f['label'], child: c.calcBox(f['key']!, entryFmt(c.values[f['key']]), f['label']!)),
        ],
      ),
      const SizedBox(height: 10),
      Text(
        item != null || c.text('item').isNotEmpty ? 'Operations in this cycle' : 'Operations (pick a part first)',
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
        children: [for (final f in spmOpFields) _opTile(c, f, item, excluded)],
      ),
      const SizedBox(height: 10),
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Total Cycle Time (Sec)',
            child: c.calcBox('totalCycleSec', entryFmt(m.calc['totalCycleSec']), 'Total Cycle Time (Sec)'),
          ),
        ],
      ),
    ],
  );
}

Widget _opTile(EntryLineContext c, Map<String, String> f, Map<String, dynamic>? item, Set<String> excluded) {
  final key = f['key']!;
  final canTick = entryCanTick(item, key);
  final isExcluded = excluded.contains(key);
  return c.keyed(
    key,
    EntryOpTile(
      key: ValueKey('entry${c.index}/$key'),
      label: spmOpLabel(f),
      value: canTick ? entryFmt(item![key]) : '',
      ticked: canTick && !isExcluded,
      excluded: isExcluded,
      enabled: canTick,
      focusNode: c.nodeFor(key),
      onToggle: () {
        HapticFeedback.selectionClick();
        final raw = c.values['excludedOps'];
        final list = raw is List ? List<dynamic>.from(raw) : <dynamic>[];
        // Unticking only takes this operation's seconds out of this entry's
        // Total Cycle Time; the Part's own record is never touched.
        c.set('excludedOps', isExcluded ? list.where((k) => '$k' != key).toList() : [...list, key]);
      },
    ),
  );
}

/// Actual OK and Rejected Quantity (both typed, together within Ideal Quantity).
Widget spmQuantityLine(EntryLineContext c) {
  final m = c.metrics as SpmMetrics;
  Widget box(String field, String other, String label) {
    final room = m.qtyRoom(other);
    return c.keyed(
      field,
      c.numBox(
        field,
        max: room,
        label: label,
        // Web: typed + what the other box holds, against Ideal Quantity (popup; a toast without popups).
        onExceedTyped: c.onLimit(
          (typed) => qtyNotice(calc: m.calc, entered: typed + m._typed(other)),
          (_) => m.qtyMessage,
        ),
      ),
    );
  }

  return EntryLineCard(
    title: 'Production (Qty)',
    icon: Icons.inventory_2_outlined,
    hasError: c.lineHasError(_lineQty),
    children: [
      EntryGrid(
        cells: [
          EntryCell(label: 'Ideal Quantity', child: c.calcBox('idealQty', entryFmt(m.calc['idealQty']), 'Ideal Quantity')),
          EntryCell(
            label: 'Actual OK Quantity',
            required: true,
            error: c.err('okQty'),
            hint: c.locked('okQty', m.qtyRoom('rejectedQty')) ? 'Ideal Quantity is used up, so OK can only be 0.' : null,
            child: box('okQty', 'rejectedQty', 'Actual OK Quantity'),
          ),
          EntryCell(
            label: 'Rejected Quantity',
            required: true,
            error: c.err('rejectedQty'),
            hint: c.locked('rejectedQty', m.qtyRoom('okQty')) ? 'Ideal Quantity is used up, so Rejected can only be 0.' : null,
            child: box('rejectedQty', 'okQty', 'Rejected Quantity'),
          ),
          EntryCell(label: '% OK Quantity', child: c.calcBox('pctOk', fmtPct(m.calc['pctOk']), '% OK Quantity')),
        ],
      ),
      // Availability / Performance / Quality above 100% -> goes to Admin review.
      oeeCheck(c),
    ],
  );
}

/// The nine downtime boxes, the running total against the allowance, and the
/// "Others" remark once that downtime is used.
Widget spmDowntimeLine(EntryLineContext c) {
  final m = c.metrics;
  final s = c.theme.colorScheme;
  final limit = m.stoppageLimit;
  final over = m.overStoppage;
  final totalText = entryFmt(m.totalStoppage);
  final anyLocked = spmDowntimeBoxes.any((b) => c.locked(b.$1, m.minutesLimit(b.$1).max));
  final keys = [for (final b in spmDowntimeBoxes) b.$1, 'stoppageTotal', 'otherMinRemark'];
  final err = c.err('stoppageTotal');
  return EntryLineCard(
    title: 'Downtime / Stoppage (min)',
    icon: Icons.build_circle_outlined,
    hasError: c.lineHasError(keys),
    optional: true,
    hasValue: c.anyFilled([for (final k in keys) if (k != 'stoppageTotal') k]),
    children: [
      EntryGrid(
        maxCols: 3,
        cells: [
          for (final (key, label) in spmDowntimeBoxes)
            EntryCell(label: label, error: c.err(key), child: c.keyed(key, c.minutesBox(key, label))),
        ],
      ),
      if (anyLocked) EntryHintText(m.downtimeLockReason),
      const SizedBox(height: 10),
      c.keyed(
        'stoppageTotal',
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text.rich(
              key: ValueKey('entry${c.index}/stoppageSummary'),
              style: const TextStyle(fontSize: 13, height: 1.3),
              TextSpan(
                children: [
                  TextSpan(text: 'Total stoppage (with Lunch / Rest): ', style: TextStyle(color: s.onSurfaceVariant)),
                  TextSpan(
                    text: '${totalText.isEmpty ? '0' : totalText} min',
                    style: TextStyle(fontWeight: FontWeight.w700, color: over ? s.error : null),
                  ),
                  TextSpan(
                    text: limit == null ? ' — enter Machine ON/OFF Time to see the allowance' : ' of ${jsNumStr(limit)} min allowed',
                    style: TextStyle(color: s.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            if (err != null) EntryErrorText(err),
          ],
        ),
      ),
      if (m.otherDowntimeUsed) ...[
        const SizedBox(height: 10),
        EntryGrid(
          cells: [
            EntryCell(
              label: 'Remark for Others downtime',
              required: true,
              error: c.err('otherMinRemark'),
              span: EntryCell.full,
              child: c.keyed(
                'otherMinRemark',
                EntryTextField(
                  key: ValueKey('entry${c.index}/otherMinRemark'),
                  value: c.text('otherMinRemark'),
                  maxLength: 300,
                  minLines: 2,
                  maxLines: 4,
                  hint: 'What was the “Others” downtime?',
                  invalid: c.err('otherMinRemark') != null,
                  focusNode: c.nodeFor('otherMinRemark'),
                  semanticsLabel: 'Remark for Others downtime',
                  onChanged: (t) => c.set('otherMinRemark', t),
                ),
              ),
            ),
          ],
        ),
      ],
    ],
  );
}
