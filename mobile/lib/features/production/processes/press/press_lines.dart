import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/form_widgets.dart' show PickOption, showPicker;
import '../../../../core/widgets/web_time_field.dart';
import '../../entry_form/common_lines.dart';
import '../../entry_form/entry_fields.dart';
import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_layout.dart';
import '../../entry_form/entry_line_context.dart';
import '../../entry_form/entry_number_input.dart';
import '../../entry_form/entry_op_tile.dart';
import '../../entry_form/machine_status.dart';
import '../../entry_form/web_parity_lines.dart';
import '../../shared/limit_notice.dart' show qtyNotice;
import '../../shared/production_sheet_calc.dart';
import 'press_calc.dart';
import 'press_metrics.dart';

const List<String> _line2 = ['itemName', 'operation', 'setupNo', 'vendor'];
const List<String> _line4 = ['machineOnTime', 'machineOffTime'];
const List<String> _line3 = ['standardTimeMin', 'pcsPerStandardTime'];
const List<String> _line5 = ['okQty', 'rejectedQty'];

/// The downtime boxes of the PRESS form: key + label, in order.
const List<(String, String)> pressDowntimeBoxes = [
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

/// The PRESS Data Entry form (port of PressEntryForm.jsx), in the web's line
/// order: Date/Machine/Operator, Part/Operation/Setup No., Standard Time, Machine
/// ON–OFF, Production (Qty), Planned Operator Shift/Lunch, Downtime, Remarks.
class PressEntryLines extends EntryLines {
  const PressEntryLines();

  @override
  List<Widget> left(EntryLineContext c) => isNonWorking(c.values)
      ? [dateMachineOperatorLine(c, workingStatus: true), nonWorkingNote(c)]
      : [
          dateMachineOperatorLine(c, workingStatus: true),
          pressPartLine(c),
          pressStandardTimeLine(c),
          pressTimeLine(c),
          pressQuantityLine(c),
        ];

  // Non Working: the machine did not run, so only the head line and Remarks are asked for.
  @override
  List<Widget> right(EntryLineContext c) =>
      isNonWorking(c.values) ? [remarksLine(c)] : [shiftLine(c), pressDowntimeLine(c), remarksLine(c)];

  @override
  String collapsedSummary(Map<String, dynamic> v) => isNonWorking(v)
      ? 'Non Working'
      : [
        if (entryText(v['itemName']).isNotEmpty) entryText(v['itemName']),
        if (entryText(v['okQty']).isNotEmpty) 'OK ${entryText(v['okQty'])}',
        if (entryText(v['rejectedQty']).isNotEmpty) 'Rejected ${entryText(v['rejectedQty'])}',
      ].join(' · ');
}

/// A pick-one box over a short fixed list (Operation, Setup No.). A value saved
/// before the list was fixed, or since retired from it, still shows as it is.
Widget _choiceBox(EntryLineContext c, String field, String title, String hint, List<String> options) {
  final current = c.text(field);
  return c.keyed(
    field,
    Builder(
      builder: (ctx) => EntryPickerBox(
        key: ValueKey('entry${c.index}/$field'),
        text: current,
        hint: hint,
        invalid: c.err(field) != null,
        focusNode: c.nodeFor(field),
        semanticsLabel: title,
        onTap: () async {
          final r = await showPicker<String>(
            ctx,
            title: title,
            options: [for (final o in options) PickOption<String>(o, o)],
            selected: options.contains(current) ? current : null,
            allowClear: true,
          );
          if (r != null) c.set(field, r.value ?? '');
        },
      ),
    ),
  );
}

/// Part Name, Operation and Setup No.
Widget pressPartLine(EntryLineContext c) {
  final itemName = c.text('itemName');
  return EntryLineCard(
    title: 'Part, Operation, Setup No.',
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
            label: 'Operation',
            error: c.err('operation'),
            child: _choiceBox(c, 'operation', 'Operation', 'Select operation', pressOperations),
          ),
          EntryCell(
            label: 'Setup No.',
            error: c.err('setupNo'),
            child: _choiceBox(c, 'setupNo', 'Setup No.', 'Select setup no.', pressSetupNumbers),
          ),
          // Vendor Name: only when the machine's process has vendors (or the entry names one).
          ?vendorCell(c),
        ],
      ),
    ],
  );
}

/// Product Cycle Time and the two tickable standard-time boxes. Ticking them is
/// a per-entry note only (they multiply together, so there is no honest partial
/// cycle time); Product Cycle Time keeps using both.
Widget pressStandardTimeLine(EntryLineContext c) {
  final item = entryItemFor(c.values, c.items);
  final excluded = entryExcludedOps(c.values);
  final calc = c.metrics.calc;
  return EntryLineCard(
    title: 'Standard Time, Product Cycle Time',
    icon: Icons.timer_outlined,
    hasError: c.lineHasError(_line3),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Product Cycle Time (sec)',
            hint: 'Standard Time Taken (min) × 60 ÷ No. Piece in Standard Time — set on the Part (Production › Parts), not here',
            child: c.calcBox('totalCycleSec', entryFmt(calc['totalCycleSec']), 'Product Cycle Time (sec)'),
          ),
        ],
      ),
      const SizedBox(height: 10),
      Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final f in pressProgramFields) _programTile(c, f['key']!, f['label']!, item, excluded),
        ],
      ),
    ],
  );
}

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

/// Machine ON / OFF Time and the Machine Shift they make — PRESS's own wording
/// ("Machine Time ON" / "Machine Time OFF", PressEntryForm.jsx line 4).
Widget pressTimeLine(EntryLineContext c) {
  return EntryLineCard(
    title: 'Machine ON–OFF Time, Machine Shift',
    icon: Icons.schedule_rounded,
    hasError: c.lineHasError(_line4),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Machine Time ON',
            required: true,
            error: c.err('machineOnTime'),
            child: c.keyed(
              'machineOnTime',
              WebTimeField(
                key: ValueKey('entry${c.index}/machineOnTime'),
                value: c.text('machineOnTime'),
                semanticsLabel: 'Machine Time ON',
                invalid: c.err('machineOnTime') != null,
                focusNode: c.nodeFor('machineOnTime'),
                onChanged: (t) => c.set('machineOnTime', t),
              ),
            ),
          ),
          EntryCell(
            label: 'Machine Time OFF',
            required: true,
            error: c.err('machineOffTime'),
            child: c.keyed(
              'machineOffTime',
              WebTimeField(
                key: ValueKey('entry${c.index}/machineOffTime'),
                value: c.text('machineOffTime'),
                semanticsLabel: 'Machine Time OFF',
                minTime: c.offEarliest,
                invalid: c.err('machineOffTime') != null,
                focusNode: c.nodeFor('machineOffTime'),
                onChanged: (t) => c.set('machineOffTime', t),
              ),
            ),
          ),
        ],
      ),
      if (c.booked.isNotEmpty)
        EntryHintText('Already booked for this machine on this date: ${c.booked.join(', ')} — pick a time outside it.'),
    ],
  );
}

/// Actual OK Quantity and Rejected Quantity (both typed): together they can't
/// beat Ideal Quantity, so each box takes only what the other leaves.
Widget pressQuantityLine(EntryLineContext c) {
  final m = c.metrics as PressMetrics;
  Widget box(String field, String label, String other) {
    final room = m.qtyRoom(other);
    return c.keyed(
      field,
      c.numBox(
        field,
        max: room,
        label: label,
        // Past Ideal Quantity: the web's popup (entered = typed + the other box); a toast without popups.
        onExceedTyped: c.onLimit(
          (typed) => qtyNotice(calc: m.calc, entered: typed + (jsNumber(c.values[other]) ?? 0)),
          (_) => m.qtyMessage,
        ),
      ),
    );
  }

  return EntryLineCard(
    title: 'Production (Qty)',
    icon: Icons.inventory_2_outlined,
    hasError: c.lineHasError(_line5),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Actual OK Quantity',
            required: true,
            error: c.err('okQty'),
            hint: c.locked('okQty', m.qtyRoom('rejectedQty')) ? 'Ideal Quantity leaves no room, so OK can only be 0.' : null,
            child: box('okQty', 'Actual OK Quantity', 'rejectedQty'),
          ),
          EntryCell(
            label: 'Rejected Quantity',
            required: true,
            error: c.err('rejectedQty'),
            hint: c.locked('rejectedQty', m.qtyRoom('okQty')) ? 'Ideal Quantity leaves no room, so Rejected can only be 0.' : null,
            child: box('rejectedQty', 'Rejected Quantity', 'okQty'),
          ),
        ],
      ),
      // Availability / Performance / Quality above 100% -> goes to Admin review.
      oeeCheck(c),
    ],
  );
}

/// The nine downtime boxes, the running total against the Machine Shift, and the
/// "Others" remark once Others downtime is used.
Widget pressDowntimeLine(EntryLineContext c) {
  final m = c.metrics;
  final keys = [for (final b in pressDowntimeBoxes) b.$1, 'stoppageTotal', 'otherMinRemark'];
  final anyLocked = pressDowntimeBoxes.any((b) => c.locked(b.$1, m.minutesLimit(b.$1).max));
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
          for (final (key, label) in pressDowntimeBoxes)
            EntryCell(label: label, error: c.err(key), child: c.keyed(key, c.minutesBox(key, label))),
        ],
      ),
      if (anyLocked) EntryHintText(m.downtimeLockReason),
      const SizedBox(height: 10),
      c.keyed('stoppageTotal', _stoppageMeter(c)),
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

/// Every stoppage box, Lunch / Rest included, has to fit inside the Machine
/// Shift, so the running total sits next to that allowance.
Widget _stoppageMeter(EntryLineContext c) {
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
