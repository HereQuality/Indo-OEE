import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/web_time_field.dart';
import '../../entry_form/entry_fields.dart';
import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_form_toast.dart';
import '../../entry_form/entry_layout.dart';
import '../../entry_form/entry_line_context.dart';
import '../../entry_form/entry_number_input.dart';
import '../../entry_form/entry_style.dart';
import '../../entry_form/machine_status.dart' show MachineStatusSelect, machineStatusList;
import '../../entry_form/web_parity_lines.dart';
import '../../shared/limit_notice.dart' show qtyNotice;
import '../../shared/planned_shift.dart' show plannedShiftReason;
import '../../shared/production_sheet_calc.dart';
import '../../shared/shift_hours.dart';
import 'injection_calc.dart';
import 'injection_metrics.dart';

// The lines of the INJECTION MOULDING form (port of InjectionEntryForm.jsx), in
// the paper sheet's words. Each keeps the typed keys it holds (the web `LINES`),
// so a line with an error flags itself ("Check this line").

const List<String> _line1 = ['date', 'machine', 'operator', 'workingMode', 'machineStatus'];
const List<String> _line2 = ['itemName', 'vendor', 'totalCycleSec'];
const List<String> _line3 = ['machineOnTime', 'machineOffTime'];
const List<String> _line5 = ['actualQty', 'okQty'];
const List<String> _line7 = ['plannedOperatorShiftHours', 'lunchMin'];
const List<String> _line12 = ['remarks'];

/// The quantity boxes in the paper sheet's own words (web `QTY_LABELS`).
const String injectionTotalLabel = 'TOTAL QTY';
const String injectionOkLabel = 'OK QTY';
const String injectionRejectedLabel = 'Rejected QTY';

/// The downtime boxes of the Idle Time line — every one but Lunch / Tea, which
/// sits beside Planned Operator Shift (web `DOWNTIME_BOXES`).
final List<(String, String)> injectionDowntimeBoxes = [
  for (final f in injectionStoppageFields)
    if (f.$1 != 'lunchMin') f,
];

/// Lunch / Tea's label (web `LUNCH_LABEL`).
final String injectionLunchLabel = injectionStoppageFields.firstWhere((f) => f.$1 == 'lunchMin').$2;

/// A status-only day (a Working Status but PRESENT, or Non Working): nothing but
/// Date, MC No., Operator, the status and Remarks is asked for.
bool _statusOnly(Map<String, dynamic> v) => injectionIsStatusOnly(v) || isNonWorking(v);

/// The INJECTION MOULDING entry form: Date / MC No. / Operator / Working
/// Status, Item Name + Standard Time per Piece, Machine ON–OFF Time with the
/// Machine Shift, the Production Master (TOTAL and OK typed, Rejected = TOTAL −
/// OK) with the sheet's grey figures under it, Planned Operator Shift + Lunch /
/// Tea, the nine other downtime boxes, and the rejection / rework remarks. No
/// Rejection Master. Reading order (left column, then right) is the web's.
class InjectionEntryLines extends EntryLines {
  const InjectionEntryLines();

  @override
  List<Widget> left(EntryLineContext c) => [
        injectionHeadLine(c),
        if (!_statusOnly(c.values)) ...[
          injectionItemLine(c),
          injectionTimeLine(c),
          injectionQuantityLine(c),
        ],
      ];

  @override
  List<Widget> right(EntryLineContext c) => [
        if (!_statusOnly(c.values)) ...[
          injectionShiftLine(c),
          injectionIdleLine(c),
        ],
        injectionRemarksLine(c),
      ];

  @override
  String collapsedSummary(Map<String, dynamic> v) => [
        if (entryText(v['itemName']).isNotEmpty) entryText(v['itemName']),
        if (entryText(v['actualQty']).isNotEmpty) 'TOTAL ${entryText(v['actualQty'])}',
        if (entryText(v['okQty']).isNotEmpty) 'OK ${entryText(v['okQty'])}',
      ].join(' · ');
}

/// Date, MC No., Operator and the Working Status (Working / Non Working, and
/// the Reasons For Not Working of a Non Working day).
Widget injectionHeadLine(EntryLineContext c) {
  final statusOnly = _statusOnly(c.values);
  final nonWorking = isNonWorking(c.values);
  return EntryLineCard(
    title: 'Date, MC No., Operator, Working Status',
    icon: Icons.event_note_rounded,
    hasError: c.lineHasError(_line1),
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
            label: 'MC No.',
            required: true,
            error: c.err('machine'),
            // Web: the select is just disabled while editing (no note under it).
            child: c.keyed('machine', c.machineBox(enabled: !c.isEdit)),
          ),
          EntryCell(
            label: 'Operator',
            required: !statusOnly,
            error: c.err('operator'),
            span: EntryCell.full,
            child: c.keyed(
              'operator',
              EntryPickerBox(
                key: ValueKey('entry${c.index}/operator'),
                // A record saved before this box read from Operator Master, or one
                // whose operator was deactivated, keeps showing its name.
                text: c.text('operator'),
                hint: 'Select operator',
                invalid: c.err('operator') != null,
                focusNode: c.nodeFor('operator'),
                semanticsLabel: 'Operator',
                onTap: c.pickOperator,
              ),
            ),
          ),
          ..._workingStatusCells(c),
        ],
      ),
      if (statusOnly) _statusOnlyNote(c, nonWorking: nonWorking),
    ],
  );
}

/// The sheet's Working Status (Working / Non Working) and, on a Non Working
/// day, its Reasons For Not Working (the shared ticks, "Remarks" included —
/// `MachineStatusSelect`), in this sheet's words.
List<EntryCell> _workingStatusCells(EntryLineContext c) {
  final nonWorking = isNonWorking(c.values);
  final mode = nonWorking ? 'Non Working' : 'Working';
  return [
    EntryCell(
      label: 'Working Status',
      error: c.err('workingMode'),
      span: EntryCell.full,
      child: c.keyed(
        'workingMode',
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            for (final m in workingModes)
              ChoiceChip(
                key: ValueKey('entry${c.index}/workingMode/$m'),
                label: Text(m),
                selected: mode == m,
                onSelected: (_) {
                  if (mode == m) return;
                  HapticFeedback.selectionClick();
                  c.set('workingMode', m);
                  // Working has no reason — drop any picked while it was Non Working.
                  if (m == 'Working') c.set('machineStatus', <dynamic>[]);
                },
              ),
          ],
        ),
      ),
    ),
    if (nonWorking)
      EntryCell(
        label: 'Reasons For Not Working',
        error: c.err('machineStatus'),
        span: EntryCell.full,
        child: c.keyed(
          'machineStatus',
          MachineStatusSelect(
            index: c.index,
            ticked: machineStatusList(c.values),
            remark: c.text('remarks'),
            onChanged: (list) => c.set('machineStatus', list),
            onOpenRemarks: () => c.focusField('remarks'),
          ),
        ),
      ),
  ];
}

/// The web's note under a status-only day (shown in place of the other lines).
Widget _statusOnlyNote(EntryLineContext c, {required bool nonWorking}) {
  final s = c.theme.colorScheme;
  return Padding(
    key: ValueKey('entry${c.index}/${nonWorking ? 'nonWorkingNote' : 'statusOnlyNote'}'),
    padding: const EdgeInsets.only(top: 8),
    child: Text.rich(
      TextSpan(
        style: TextStyle(fontSize: 12.5, height: 1.35, color: s.onSurfaceVariant),
        children: nonWorking
            ? const [
                TextSpan(text: 'Non Working', style: TextStyle(fontWeight: FontWeight.w700)),
                TextSpan(
                  text: ' — the machine did not run, so nothing else is needed. Pick a reason if you like (W.OFF and the like go in Remarks) and press Save.',
                ),
              ]
            : [
                TextSpan(text: jsString(c.values['workingStatus'] ?? ''), style: const TextStyle(fontWeight: FontWeight.w700)),
                const TextSpan(
                  text: ' — no production that day, so only Date, MC No. and Working Status are saved (Operator and Remarks too, if filled in).',
                ),
              ],
      ),
    ),
  );
}

/// Item Name, Standard Time per Piece (filled in from the Part, can be changed
/// for the day) and — when the machine's process has vendors — Vendor Name.
Widget injectionItemLine(EntryLineContext c) {
  final item = entryItemFor(c.values, c.items);
  final raw = item?['totalCycleSec'];
  // The picked Part's own time — shown as a hint once the box differs from it.
  final partCycle = (raw == null || raw == '') ? null : entryNum(raw);
  final typed = jsToNumber(c.values['totalCycleSec']);
  final usualHint = c.err('totalCycleSec') == null && partCycle != null && typed != partCycle
      ? "Part's usual: ${fmtNum(partCycle)} sec"
      : null;
  return EntryLineCard(
    title: 'Item Name, Standard Time per Piece',
    icon: Icons.precision_manufacturing_outlined,
    hasError: c.lineHasError(_line2),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Item Name',
            required: true,
            error: c.err('itemName'),
            span: EntryCell.full,
            child: c.keyed(
              'itemName',
              EntryPickerBox(
                key: ValueKey('entry${c.index}/itemName'),
                // Web `partCycleLabel`: "Cap 12 — 20 sec"; an old record's own name
                // when the part is not in the live list.
                text: partBoxText(c),
                hint: 'Select part',
                maxLines: 2,
                invalid: c.err('itemName') != null,
                focusNode: c.nodeFor('itemName'),
                semanticsLabel: 'Item Name',
                onTap: c.pickItem,
              ),
            ),
          ),
          EntryCell(
            label: 'Standard Time per Piece (in Sec)',
            required: true,
            error: c.err('totalCycleSec'),
            hint: usualHint,
            child: c.keyed(
              'totalCycleSec',
              c.numBox('totalCycleSec', decimals: true, label: 'Standard Time per Piece (in Sec)'),
            ),
          ),
          // Vendor Name: only when the machine's process has vendors (or the entry names one).
          ?vendorCell(c),
        ],
      ),
    ],
  );
}

/// Machine ON / OFF Time and the grey Machine Shift Time (decimal hours, with
/// its hours:minutes).
Widget injectionTimeLine(EntryLineContext c) {
  final shift = c.metrics.calc['shiftHours'];
  return EntryLineCard(
    title: 'Machine ON–OFF Time, Machine Shift Time',
    icon: Icons.schedule_rounded,
    hasError: c.lineHasError(_line3),
    children: [
      EntryGrid(
        maxCols: 3,
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
          EntryCell(
            label: 'Machine Shift Time (Hours)',
            child: c.calcBox(
              'shiftHours',
              isNum(shift) ? '${fmtNum(shift)} (${hoursToHm(shift)} hr)' : '',
              'Machine Shift Time (Hours)',
            ),
          ),
        ],
      ),
      if (c.booked.isNotEmpty)
        EntryHintText('Already booked for this machine on this date: ${c.booked.join(', ')} — pick a time outside it.'),
    ],
  );
}

/// The Production Master in the sheet's words — TOTAL QTY. (never more than
/// Ideal Quantity rounded down) and OK QTY. typed, the grey Rejected QTY — and
/// the sheet's grey figures under it: Ok Quantity (%), Ideal Quantity (2
/// decimals), Ideal Quantity/Hours and Effective Machine Run Time (hours).
Widget injectionQuantityLine(EntryLineContext c) {
  final m = c.metrics;
  final x = m is InjectionMetrics ? m : InjectionMetrics(c.values);
  final effective = m.calc['effectiveHours'];
  return EntryLineCard(
    title: 'Production Master — TOTAL QTY., OK QTY., Rejected QTY',
    icon: Icons.inventory_2_outlined,
    hasError: c.lineHasError(_line5),
    children: [
      EntryGrid(
        maxCols: 3,
        cells: [
          EntryCell(
            label: injectionTotalLabel,
            required: true,
            error: c.err('actualQty'),
            // Phone-only: says why the box takes nothing (the web raises a popup when you type).
            hint: c.locked('actualQty', m.idealQty)
                ? 'Ideal Quantity is 0, so $injectionTotalLabel can only be 0 — check the Machine ON/OFF times and the Standard Time per Piece.'
                : null,
            child: c.keyed(
              'actualQty',
              c.numBox(
                'actualQty',
                max: m.idealQty,
                label: injectionTotalLabel,
                // Past Ideal Quantity: the web's popup with the figures.
                onExceedTyped: c.onLimit(
                  (typed) => qtyNotice(calc: m.calc, entered: typed, label: injectionTotalLabel),
                  (max) => "$injectionTotalLabel can't be more than Ideal Quantity (${fmtNum(max)})",
                ),
              ),
            ),
          ),
          EntryCell(
            label: injectionOkLabel,
            required: true,
            error: c.err('okQty'),
            hint: c.locked('okQty', m.okMax) ? '$injectionTotalLabel is 0, so $injectionOkLabel can only be 0.' : null,
            child: c.keyed(
              'okQty',
              c.numBox(
                'okQty',
                max: m.okMax,
                label: injectionOkLabel,
                onExceed: (max) => EntryFormToast.warn("$injectionOkLabel can't be more than $injectionTotalLabel (${fmtNum(max)})"),
              ),
            ),
          ),
          EntryCell(
            label: injectionRejectedLabel,
            child: c.calcBox('rejectedQty', entryFmt(m.calc['rejectedQty']), injectionRejectedLabel),
          ),
        ],
      ),
      const SizedBox(height: EntryStyle.rowGap),
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Ok Quantity (%)',
            child: c.calcBox('pctOk', fmtPct(m.calc['pctOk']), 'Ok Quantity (%)'),
          ),
          EntryCell(
            label: 'Ideal Quantity',
            child: c.calcBox('idealQtyExact', fmtNum(x.idealQtyExact), 'Ideal Quantity'),
          ),
          EntryCell(
            label: 'Ideal Quantity/Hours',
            child: c.calcBox('idealQtyPerHour', fmtNum(x.idealQtyPerHour), 'Ideal Quantity/Hours'),
          ),
          EntryCell(
            label: 'Effective Machine Run Time (hours)',
            child: c.calcBox(
              'effectiveHours',
              isNum(effective) ? '${fmtNum(effective)} (${hoursToHm(effective)} hr)' : '',
              'Effective Machine Run Time (hours)',
            ),
          ),
        ],
      ),
      // Availability / Performance / Quality above 100% -> goes to Admin review.
      oeeCheck(c),
    ],
  );
}

/// Planned Operator Shift (decimal hours, or fixed by Process Master's lock),
/// Lunch / Tea / Washroom and the Idle Time allowance.
Widget injectionShiftLine(EntryLineContext c) {
  final m = c.metrics;
  final limit = m.stoppageLimit;
  final planned = m.plannedHours;
  final lunch = m.minutesLimit('lunchMin');
  final machineHm = hoursToHm(m.machineShiftMin == null ? null : m.machineShiftMin! / 60);
  // Process Master's setting for this machine: the box is read-only and says why.
  final setting = c.plannedShift;
  final lockNote = setting == null ? null : plannedShiftReason(setting, hoursToHm(setting.hours));
  // Web: not while OFF isn't after ON — that "shift" wraps past midnight and the
  // OFF box already says what is wrong.
  final endBeforeStart = (c.errors['machineOffTime'] ?? '').contains(' Time must be after ');
  final plannedHint = [
    if (c.err('plannedOperatorShiftHours') == null)
      m.plannedBelowMachine && !endBeforeStart
          ? "Can't be less than Machine Shift ($machineHm)."
          : planned != null
              ? '= ${hoursToHm(planned)} hr'
              : 'Type hours as on the sheet — 3.5 is 3 h 30 min.',
    ?lockNote,
  ];
  return EntryLineCard(
    title: 'Planned Operator Shift, Lunch / Tea / Washroom',
    icon: Icons.timelapse_rounded,
    hasError: c.lineHasError(_line7),
    // Web `<Line id={7} optional openByDefault={!plannedLock} countFields={["lunchMin"]}
    // summary={plannedLock ? "Shift fixed — Lunch / Tea optional" : ""}>`.
    optional: true,
    openByDefault: setting == null,
    hasValue: c.anyFilled(const ['lunchMin']),
    summary: setting != null ? 'Shift fixed — Lunch / Tea optional' : '',
    children: [
      EntryGrid(
        maxCols: 3,
        cells: [
          EntryCell(
            label: 'Planned Operator Shift (hours)',
            required: true,
            error: c.err('plannedOperatorShiftHours'),
            hint: plannedHint.isEmpty ? null : plannedHint.join('\n'),
            child: c.keyed(
              'plannedOperatorShiftHours',
              c.numBox(
                'plannedOperatorShiftHours',
                decimals: true,
                maxLength: 5,
                max: 24,
                enabled: setting == null,
                label: 'Planned Operator Shift (hours)',
                onExceed: (_) => EntryFormToast.warn("Planned Operator Shift can't be more than 24 hours."),
              ),
            ),
          ),
          EntryCell(
            label: injectionLunchLabel,
            error: c.err('lunchMin'),
            // Phone-only: says why the box takes nothing (the web raises a popup when you type).
            hint: c.locked('lunchMin', lunch.max) ? 'No idle time left, so Lunch / Tea can only be 0.' : null,
            child: c.keyed('lunchMin', c.minutesBox('lunchMin', injectionLunchLabel)),
          ),
          EntryCell(
            label: 'Idle Time Allowed (min)',
            child: c.calcBox('stoppageAllowed', limit == null ? '' : jsNumStr(limit), 'Idle Time Allowed (min)'),
          ),
        ],
      ),
    ],
  );
}

/// The nine other downtime boxes, the running Total Idle Time against its
/// allowance, and the "Other" remark once Other downtime is used.
Widget injectionIdleLine(EntryLineContext c) {
  final m = c.metrics;
  final keys = [for (final b in injectionDowntimeBoxes) b.$1, 'stoppageTotal', 'otherMinRemark'];
  final anyLocked = injectionDowntimeBoxes.any((b) => c.locked(b.$1, m.minutesLimit(b.$1).max));
  return EntryLineCard(
    title: 'Idle Time (min)',
    icon: Icons.build_circle_outlined,
    hasError: c.lineHasError(keys),
    optional: true,
    hasValue: c.anyFilled([for (final k in keys) if (k != 'stoppageTotal') k]),
    children: [
      EntryGrid(
        maxCols: 3,
        cells: [
          for (final (key, label) in injectionDowntimeBoxes)
            EntryCell(label: label, error: c.err(key), child: c.keyed(key, c.minutesBox(key, label))),
        ],
      ),
      // Phone-only: why some boxes take nothing (the web raises a popup when you type).
      if (anyLocked) EntryHintText(m.downtimeLockReason),
      const SizedBox(height: 10),
      c.keyed('stoppageTotal', _idleMeter(c)),
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

/// Every downtime box, Lunch / Tea included, has to fit inside the machine's own
/// run, so the running total sits next to that allowance — with a bar that
/// fills as it is used up.
Widget _idleMeter(EntryLineContext c) {
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
            TextSpan(text: 'Total Idle Time (with Lunch / Tea): ', style: TextStyle(color: s.onSurfaceVariant)),
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

/// "Reason/Remarks for Rejection/ Rework" (optional): the web's label over a
/// plain textarea (no placeholder).
Widget injectionRemarksLine(EntryLineContext c) => EntryLineCard(
      title: 'Reason / Remarks for Rejection / Rework',
      icon: Icons.notes_rounded,
      hasError: c.lineHasError(_line12),
      optional: true,
      hasValue: c.anyFilled(_line12),
      revealKey: 'entry${c.index}/remarks',
      children: [
        EntryGrid(
          cells: [
            EntryCell(
              label: 'Reason/Remarks for Rejection/ Rework',
              span: EntryCell.full,
              child: c.keyed(
                'remarks',
                EntryTextField(
                  key: ValueKey('entry${c.index}/remarks'),
                  value: c.text('remarks'),
                  maxLength: 500,
                  minLines: 2,
                  maxLines: 5,
                  focusNode: c.nodeFor('remarks'),
                  semanticsLabel: 'Reason/Remarks for Rejection/ Rework',
                  onChanged: (t) => c.set('remarks', t),
                ),
              ),
            ),
          ],
        ),
      ],
    );
