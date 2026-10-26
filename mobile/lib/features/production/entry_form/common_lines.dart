import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/web_time_field.dart';
import '../shared/production_sheet_calc.dart';
import '../shared/planned_shift.dart' show plannedShiftReason;
import '../shared/shift_hours.dart';
import 'entry_fields.dart';
import 'entry_form_logic.dart';
import 'entry_form_toast.dart';
import 'entry_layout.dart';
import 'entry_line_context.dart';
import 'entry_number_input.dart';
import 'machine_status.dart';

// The lines every process's form shares (a port of the common blocks of
// ProductionEntryForm.jsx). A process lists them from its [EntryLines] next to
// its own cards (Part / Quantity / Reject… — see processes/cnc/cnc_lines.dart).
//
// Each line keeps the typed keys it holds in a const list, so a line containing
// an error can flag itself ("Check this line").

const List<String> _line1 = ['date', 'machine', 'operator'];
const List<String> _line1Status = ['date', 'machine', 'operator', 'workingMode', 'machineStatus'];
const List<String> _line3 = ['machineOnTime', 'machineOffTime'];
const List<String> _line7 = ['plannedOperatorShiftHours', 'lunchMin'];
const List<String> _line12 = ['remarks'];

/// The downtime boxes the CNC form shows, in order: key + label.
const List<(String, String)> cncDowntimeBoxes = [
  ('setupMin', 'Setup Time (min)'),
  ('noManPowerMin', 'No Man Power (min)'),
  ('materialShiftingMin', 'Material Shifting (min)'),
  ('noMaterialMin', 'No Material (min)'),
  ('bdMechMin', 'Breakdown Mechanical (min)'),
  ('bdEleMin', 'BD Electricity (min)'),
  ('noPowerMin', 'No Power (min)'),
  ('otherMin', 'Other (min)'),
];

/// Date, Machine No., Operator.
///
/// [workingStatus] adds the web's Machine Working Status (Working / Non Working
/// and, for a Non Working entry, the Status ticks incl. "Remarks" —
/// `machine_status.dart`) and makes Operator optional while Non Working. Off by
/// default: a process that has the status in its web form turns it on.
Widget dateMachineOperatorLine(EntryLineContext c, {bool workingStatus = false}) {
  final operatorName = c.text('operator');
  return EntryLineCard(
    title: 'Date, Machine No., Operator',
    icon: Icons.event_note_rounded,
    hasError: c.lineHasError(workingStatus ? _line1Status : _line1),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Date',
            required: true,
            error: c.err('date'),
            child: c.keyed(
              'date',
              EntryDateField(
                key: ValueKey('entry${c.index}/date'),
                value: c.text('date'),
                invalid: c.err('date') != null,
                focusNode: c.nodeFor('date'),
                onChanged: (d) {
                  HapticFeedback.selectionClick();
                  c.set('date', d);
                },
              ),
            ),
          ),
          EntryCell(
            label: 'Machine No.',
            required: true,
            error: c.err('machine'),
            hint: c.isEdit ? "Can't be changed while editing" : null,
            child: c.keyed('machine', c.machineBox(enabled: !c.isEdit)),
          ),
          EntryCell(
            label: 'Operator',
            required: !(workingStatus && isNonWorking(c.values)),
            error: c.err('operator'),
            span: EntryCell.full,
            child: c.keyed(
              'operator',
              EntryPickerBox(
                key: ValueKey('entry${c.index}/operator'),
                // A record saved before this box read from Operator Master, or
                // one whose operator was deactivated, keeps showing its name.
                text: operatorName,
                hint: 'Select operator',
                invalid: c.err('operator') != null,
                focusNode: c.nodeFor('operator'),
                semanticsLabel: 'Operator',
                onTap: c.pickOperator,
              ),
            ),
          ),
          if (workingStatus) ...machineWorkingStatusCells(c),
        ],
      ),
    ],
  );
}

/// Machine ON / OFF time. (The web no longer draws a Machine Shift box here; the shift only
/// shows as the hint under Planned Operator Shift.)
Widget timeLine(EntryLineContext c) {
  return EntryLineCard(
    title: 'Machine ON–OFF Time, Machine Shift',
    icon: Icons.schedule_rounded,
    hasError: c.lineHasError(_line3),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Machine ON Time',
            required: true,
            error: c.err('machineOnTime'),
            child: c.keyed(
              'machineOnTime',
              WebTimeField(
                key: ValueKey('entry${c.index}/machineOnTime'),
                value: c.text('machineOnTime'),
                semanticsLabel: 'Machine ON Time',
                invalid: c.err('machineOnTime') != null,
                focusNode: c.nodeFor('machineOnTime'),
                onChanged: (t) => c.set('machineOnTime', t),
              ),
            ),
          ),
          EntryCell(
            label: 'Machine OFF Time',
            required: true,
            error: c.err('machineOffTime'),
            child: c.keyed(
              'machineOffTime',
              WebTimeField(
                key: ValueKey('entry${c.index}/machineOffTime'),
                value: c.text('machineOffTime'),
                semanticsLabel: 'Machine OFF Time',
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
        EntryHintText(
          'Already booked for this machine on this date: ${c.booked.join(', ')} — pick a time outside it.',
        ),
    ],
  );
}

/// Planned Operator Shift (hours), Lunch / Rest and the stoppage allowance.
Widget shiftLine(EntryLineContext c) {
  final m = c.metrics;
  final limit = m.stoppageLimit;
  final planned = m.plannedHours;
  final lunch = m.minutesLimit('lunchMin');
  final machineHm = hoursToHm(
    m.machineShiftMin == null ? null : m.machineShiftMin! / 60,
  );
  // Process Master's setting for this machine (specs with
  // `usesPlannedShiftSetting`): the box is read-only and says why.
  final setting = c.plannedShift;
  final lockNote = setting == null
      ? null
      : plannedShiftReason(setting, hoursToHm(setting.hours));
  final plannedHint = [
    if (c.err('plannedOperatorShiftHours') == null)
      m.plannedBelowMachine
          ? "Can't be less than Machine Shift ($machineHm)."
          : planned != null
          ? '= ${hoursToHm(planned)} hr'
          : 'Type hours as on the sheet — 3.5 is 3 h 30 min.',
    ?lockNote,
  ];
  return EntryLineCard(
    title: 'Planned Operator Shift, Lunch / Rest',
    icon: Icons.timelapse_rounded,
    hasError: c.lineHasError(_line7),
    // Web `<Line id={7} optional openByDefault={!plannedLock} countFields={["lunchMin"]}
    // summary={plannedLock ? "Fixed — nothing to enter" : ""}>`: folded when Process Master
    // fixes the shift; only Lunch / Rest counts as typed.
    optional: true,
    openByDefault: setting == null,
    hasValue: c.anyFilled(const ['lunchMin']),
    summary: setting != null ? 'Fixed \u2014 nothing to enter' : '',
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Planned Operator Shift (hr.min)',
            required: true,
            error: c.err('plannedOperatorShiftHours'),
            // Typed as decimal hours like the sheet: 5.33 is 5 h 20 min.
            hint: plannedHint.isEmpty ? null : plannedHint.join('\n'),
            child: c.keyed(
              'plannedOperatorShiftHours',
              c.numBox(
                'plannedOperatorShiftHours',
                decimals: true,
                maxLength: 5,
                max: 24,
                enabled: setting == null,
                label: 'Planned Operator Shift (hr.min)',
                onExceed: (_) => EntryFormToast.warn(
                  "Planned Operator Shift can't be more than 24 hours.",
                ),
              ),
            ),
          ),
          EntryCell(
            label: 'Lunch / Rest (min)',
            error: c.err('lunchMin'),
            hint: c.locked('lunchMin', lunch.max)
                ? 'No stoppage time left, so Lunch / Rest can only be 0.'
                : null,
            child: c.keyed(
              'lunchMin',
              // Web: the same capped minutes box as every downtime box (a stoppage
              // popup on a spec with limit popups, else the toast).
              c.minutesBox('lunchMin', 'Lunch / Rest (min)'),
            ),
          ),
          EntryCell(
            label: 'Stoppage Allowed (min)',
            child: c.calcBox(
              'stoppageAllowed',
              limit == null ? '' : jsNumStr(limit),
              'Stoppage Allowed (min)',
            ),
          ),
        ],
      ),
    ],
  );
}

/// The downtime boxes ([boxes]: key + label, in order), the running total with
/// its allowance bar, and the "Other" remark box once Other downtime is used.
Widget downtimeLine(
  EntryLineContext c, {
  List<(String, String)> boxes = cncDowntimeBoxes,
}) {
  final m = c.metrics;
  final keys = [for (final b in boxes) b.$1, 'stoppageTotal', 'otherMinRemark'];
  final anyLocked = boxes.any((b) => c.locked(b.$1, m.minutesLimit(b.$1).max));
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
          for (final (key, label) in boxes)
            EntryCell(
              label: label,
              error: c.err(key),
              child: c.keyed(key, c.minutesBox(key, label)),
            ),
        ],
      ),
      // Why some downtime boxes are shut.
      if (anyLocked) EntryHintText(m.downtimeLockReason),
      const SizedBox(height: 10),
      c.keyed('stoppageTotal', stoppageMeter(c)),
      if (m.otherDowntimeUsed) ...[
        const SizedBox(height: 10),
        EntryGrid(
          cells: [
            EntryCell(
              label: 'Remark for Other downtime',
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
                  hint: 'What was the “Other” downtime?',
                  invalid: c.err('otherMinRemark') != null,
                  focusNode: c.nodeFor('otherMinRemark'),
                  semanticsLabel: 'Remark for Other downtime',
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

/// Lunch / Rest and every box above have to fit inside the Machine Shift (the
/// machine's own ON–OFF span), so the running total sits next to that allowance — with a bar that fills as the allowance is used up.
Widget stoppageMeter(EntryLineContext c) {
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
            TextSpan(
              text: 'Total stoppage (with Lunch / Rest): ',
              style: TextStyle(color: s.onSurfaceVariant),
            ),
            TextSpan(
              text: '${totalText.isEmpty ? '0' : totalText} min',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: over ? s.error : null,
              ),
            ),
            TextSpan(
              text: limit == null
                  ? ' — enter Machine ON/OFF Time to see the allowance'
                  : ' of ${jsNumStr(limit)} min allowed',
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
              color: over
                  ? s.error
                  : (frac > 0.85 ? AppColors.warn : s.primary),
            ),
          ),
        ),
      if (err != null) EntryErrorText(err),
    ],
  );
}

/// The general remarks box (optional).
Widget remarksLine(EntryLineContext c) => EntryLineCard(
  title: 'Remarks',
  icon: Icons.notes_rounded,
  hasError: c.lineHasError(_line12),
  optional: true,
  hasValue: c.anyFilled(_line12),
  revealKey: 'entry${c.index}/remarks',
  children: [
    EntryGrid(
      cells: [
        EntryCell(
          span: EntryCell.full,
          child: c.keyed(
            'remarks',
            EntryTextField(
              key: ValueKey('entry${c.index}/remarks'),
              value: c.text('remarks'),
              maxLength: 500,
              minLines: 2,
              maxLines: 5,
              hint: 'Anything worth noting about this shift (optional)',
              focusNode: c.nodeFor('remarks'),
              semanticsLabel: 'Remarks',
              onChanged: (t) => c.set('remarks', t),
            ),
          ),
        ),
      ],
    ),
  ],
);
