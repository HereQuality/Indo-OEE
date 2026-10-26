import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/theme/app_colors.dart';
import '../../entry_form/common_lines.dart';
import '../../entry_form/entry_fields.dart';
import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_layout.dart';
import '../../entry_form/entry_line_context.dart';
import '../../entry_form/entry_number_input.dart';
import '../../entry_form/entry_op_tile.dart';
import '../../entry_form/machine_status.dart';
import '../../entry_form/web_parity_lines.dart';
import '../../shared/production_sheet_calc.dart';
import '../cnc/cnc_lines.dart' show quantityLine, rejectLine;
import 'vmc_calc.dart';

/// The downtime boxes the VMC form shows, in order: key + label (web DOWNTIME_BOXES).
const List<(String, String)> vmcDowntimeBoxes = [
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

const List<String> _line2 = ['itemName', 'vendor'];

/// What the form derives from a VMC block: CNC's metrics over the VMC figures
/// (the stoppage allowance is the Machine Shift itself, as in the shared metrics;
/// OK is capped by the typed Actual, Actual by Ideal Quantity).
class VmcMetrics extends EntryMetrics {
  VmcMetrics(super.values) : super(calcFn: vmcRowCalc);
}

/// The VMC Data Entry form (port of VmcEntryForm.jsx): the shared time / shift /
/// remarks cards with VMC's own Part (+ program ticks) and Downtime cards, and
/// CNC's Production Master (Actual + OK typed) and Rejection Master cards. A Non Working block asks for nothing but
/// date, machine, operator, reason and remarks.
class VmcEntryLines extends EntryLines {
  const VmcEntryLines();

  @override
  List<Widget> left(EntryLineContext c) => isNonWorking(c.values)
      ? [dateMachineOperatorLine(c, workingStatus: true), nonWorkingNote(c)]
      : [dateMachineOperatorLine(c, workingStatus: true), vmcPartLine(c), timeLine(c), quantityLine(c)];

  @override
  List<Widget> right(EntryLineContext c) =>
      isNonWorking(c.values) ? [remarksLine(c)] : [rejectLine(c), shiftLine(c), vmcDowntimeLine(c), remarksLine(c)];

  @override
  String collapsedSummary(Map<String, dynamic> v) => [
        if (isNonWorking(v)) 'Non Working',
        if (entryText(v['itemName']).isNotEmpty) entryText(v['itemName']),
        if (entryText(v['actualQty']).isNotEmpty) 'Actual ${entryText(v['actualQty'])}',
        if (entryText(v['okQty']).isNotEmpty) 'OK ${entryText(v['okQty'])}',
      ].join(' · ');
}

/// Part Name, Product Cycle Time and the Program Time / pieces tick boxes.
Widget vmcPartLine(EntryLineContext c) {
  final m = c.metrics;
  final item = entryItemFor(c.values, c.items);
  final excluded = entryExcludedOps(c.values);
  final itemName = c.text('itemName');
  return EntryLineCard(
    title: 'Part, Product Cycle Time',
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
            label: 'Product Cycle Time (sec)',
            hint: 'Program Time (min) × 60 ÷ No. of Piece In One Program — set on the Part (Production › Parts), not here',
            child: c.calcBox('totalCycleSec', entryFmt(m.calc['totalCycleSec']), 'Product Cycle Time (sec)'),
          ),
          // Vendor Name: only when the machine's process has vendors (or the entry names one).
          ?vendorCell(c),
        ],
      ),
      const SizedBox(height: 10),
      Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [for (final f in vmcProgramFields) _programTile(c, f.key, f.label, item, excluded)],
      ),
    ],
  );
}

// Ticking is purely a per-entry note: the two multiply together to make one cycle
// time, so Product Cycle Time keeps using both whichever is ticked.
Widget _programTile(EntryLineContext c, String key, String label, Map<String, dynamic>? item, Set<String> excluded) {
  final canTick = entryCanTick(item, key);
  final isExcluded = excluded.contains(key);
  return c.keyed(
    key,
    EntryOpTile(
      key: ValueKey('entry${c.index}/$key'),
      label: label,
      value: canTick ? entryFmt(item![key]) : '',
      ticked: canTick && !isExcluded,
      excluded: isExcluded,
      enabled: canTick,
      focusNode: c.nodeFor(key),
      onToggle: () {
        HapticFeedback.selectionClick();
        final raw = c.values['excludedOps'];
        final list = raw is List ? List<dynamic>.from(raw) : <dynamic>[];
        c.set('excludedOps', isExcluded ? list.where((k) => '$k' != key).toList() : [...list, key]);
      },
    ),
  );
}

/// The nine downtime boxes, the running total against the Machine Shift, and the
/// "Others" remark once Others downtime is used.
Widget vmcDowntimeLine(EntryLineContext c) {
  final m = c.metrics;
  final keys = [for (final b in vmcDowntimeBoxes) b.$1, 'stoppageTotal', 'otherMinRemark'];
  final anyLocked = vmcDowntimeBoxes.any((b) => c.locked(b.$1, m.minutesLimit(b.$1).max));
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
          for (final (key, label) in vmcDowntimeBoxes)
            EntryCell(label: label, error: c.err(key), child: c.keyed(key, c.minutesBox(key, label))),
        ],
      ),
      if (anyLocked) EntryHintText(m.downtimeLockReason),
      const SizedBox(height: 10),
      c.keyed('stoppageTotal', _vmcStoppageMeter(c)),
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

Widget _vmcStoppageMeter(EntryLineContext c) {
  final m = c.metrics;
  final s = c.theme.colorScheme;
  final limit = m.stoppageLimit;
  final over = m.overStoppage;
  final totalText = entryFmt(m.totalStoppage);
  final frac = limit == null
      ? 0.0
      : limit > 0
          ? (m.totalStoppage / limit).clamp(0.0, 1.0)
          : (m.totalStoppage > 0 ? 1.0 : 0.0);
  final err = c.err('stoppageTotal');
  return Column(
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
      if (limit != null)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: frac,
              minHeight: 5,
              backgroundColor: s.outlineVariant,
              color: over ? s.error : (frac > 0.85 ? AppColors.warn : s.primary),
            ),
          ),
        ),
      if (err != null) EntryErrorText(err),
    ],
  );
}
