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
import 'mfd_calc.dart';
import 'mfd_metrics.dart';

// The lines of the MODULAR FRAME DRILLING form (port of MfdEntryForm.jsx), in
// the paper sheet's words. Each keeps the typed keys it holds (the web `LINES`),
// so a line with an error flags itself ("Check this line").

const List<String> _line1 = ['date', 'machine', 'operator', 'workingMode', 'machineStatus'];
const List<String> _line2 = ['itemName', 'vendor', 'totalCycleSec'];
const List<String> _line3 = ['machineOnTime', 'machineOffTime'];
const List<String> _line4 = ['settingOnTime', 'settingOffTime'];
const List<String> _line5 = ['actualQty', 'okQty'];
const List<String> _line7 = ['plannedOperatorShiftHours', 'lunchMin'];
const List<String> _line12 = ['remarks'];

/// The quantity boxes in the paper sheet's own words (web `QTY_LABELS`; Actual
/// is the form's own — the paper has only ACTUAL OK and Rejected).
const String mfdActualLabel = 'Actual Quantity';
const String mfdOkLabel = 'ACTUAL OK Quantity';
const String mfdRejectedLabel = 'Rejected Quantity';

/// The downtime boxes of the Downtime line — every one but Lunch / Tea, which
/// sits beside Planned Operator Shift (web `DOWNTIME_BOXES`).
final List<(String, String)> mfdDowntimeBoxes = [
  for (final f in mfdStoppageFields)
    if (f.$1 != 'lunchMin') f,
];

/// Lunch / Tea's label (web `LUNCH_LABEL`).
final String mfdLunchLabel = mfdStoppageFields.firstWhere((f) => f.$1 == 'lunchMin').$2;


/// The MODULAR FRAME DRILLING entry form: Date / MC NO. / Operator / Working
/// Status; Part Name + Total Cycle Time with the Part's own Drawing No., Process,
/// Holes and Stroke (grey); Machine Time ON–OFF with the Machine Shift; Setting
/// Time ON–OFF (optional); the Production Master (Actual and ACTUAL OK typed,
/// Rejected = Actual − OK) with the sheet's grey figures; Planned Operator Shift +
/// Lunch / Tea; the nine other downtime boxes; REMARKS. No Rejection Master.
/// Reading order (left column, then right) is the web's.
class MfdEntryLines extends EntryLines {
  const MfdEntryLines();

  @override
  List<Widget> left(EntryLineContext c) => [
        mfdHeadLine(c),
        if (!isNonWorking(c.values)) ...[
          mfdPartLine(c),
          mfdTimeLine(c),
          mfdSettingLine(c),
          mfdQuantityLine(c),
        ],
      ];

  @override
  List<Widget> right(EntryLineContext c) => [
        if (!isNonWorking(c.values)) ...[
          mfdShiftLine(c),
          mfdDowntimeLine(c),
        ],
        mfdRemarksLine(c),
      ];

  @override
  String collapsedSummary(Map<String, dynamic> v) => [
        if (entryText(v['itemName']).isNotEmpty) entryText(v['itemName']),
        if (entryText(v['actualQty']).isNotEmpty) 'Actual ${entryText(v['actualQty'])}',
        if (entryText(v['okQty']).isNotEmpty) 'OK ${entryText(v['okQty'])}',
      ].join(' · ');
}

/// Date, MC No., Operator and the Working Status (Working / Non Working, and
/// the Reasons For Not Working of a Non Working day).
Widget mfdHeadLine(EntryLineContext c) {
  final nonWorking = isNonWorking(c.values);
  return EntryLineCard(
    title: 'Date, MC NO., Operator, Working Status',
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
            label: 'MC NO.',
            required: true,
            error: c.err('machine'),
            // Web: the select is just disabled while editing (no note under it).
            child: c.keyed('machine', c.machineBox(enabled: !c.isEdit)),
          ),
          EntryCell(
            label: 'Operator',
            required: !nonWorking,
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
      if (nonWorking) _nonWorkingNote(c),
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

/// The web's note under a Non Working day (shown in place of the other lines).
Widget _nonWorkingNote(EntryLineContext c) {
  final s = c.theme.colorScheme;
  return Padding(
    key: ValueKey('entry${c.index}/nonWorkingNote'),
    padding: const EdgeInsets.only(top: 8),
    child: Text.rich(
      TextSpan(
        style: TextStyle(fontSize: 12.5, height: 1.35, color: s.onSurfaceVariant),
        children: const [
          TextSpan(text: 'Non Working', style: TextStyle(fontWeight: FontWeight.w700)),
          TextSpan(
            text: ' — the machine did not run, so nothing else is needed. Pick a reason if you like (W.OFF and the like go in REMARKS) and press Save.',
          ),
        ],
      ),
    ),
  );
}

/// A Part figure copied onto the entry, as the grey box shows it (web
/// `fmtNum(v === "" ? null : Number(v))`).
String _partFigure(Object? v) => isBlankValue(v) ? '' : fmtNum(jsToNumber(v));

/// Part Name, Total Cycle Time (filled in from the Part, can be changed for the
/// day), the Part's own Drawing No., Process, No. of Holes and Stroke Required
/// (grey, read-only) and — when the machine's process has vendors — Vendor Name.
Widget mfdPartLine(EntryLineContext c) {
  final item = entryItemFor(c.values, c.items);
  final raw = item?['totalCycleSec'];
  // The picked Part's own time — shown as a hint once the box differs from it.
  final partCycle = (raw == null || raw == '') ? null : entryNum(raw);
  final typed = jsToNumber(c.values['totalCycleSec']);
  final usualHint = c.err('totalCycleSec') == null && partCycle != null && typed != partCycle
      ? "Part's usual: ${fmtNum(partCycle)} sec"
      : null;
  return EntryLineCard(
    title: 'Part Name, Drawing No., Process, Holes, Stroke, Total Cycle Time',
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
                // Web `partCycleLabel`: "24 PIN FRAME — 20 sec"; an old record's own
                // name when the part is not in the live list.
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
            label: 'Total Cycle Time (Sec)',
            required: true,
            error: c.err('totalCycleSec'),
            hint: usualHint,
            child: c.keyed(
              'totalCycleSec',
              c.numBox('totalCycleSec', decimals: true, label: 'Total Cycle Time (Sec)'),
            ),
          ),
        ],
      ),
      const SizedBox(height: EntryStyle.rowGap),
      // The Part's own figures, copied when it was picked — change them in Production › Parts.
      EntryGrid(
        cells: [
          EntryCell(label: 'Drawing No.', child: c.calcBox('drawingNo', c.text('drawingNo'), 'Drawing No.')),
          EntryCell(label: 'Process', child: c.calcBox('operation', c.text('operation'), 'Process')),
          EntryCell(
            label: 'No. of Holes in One Piece',
            child: c.calcBox('noOfHoles', _partFigure(c.values['noOfHoles']), 'No. of Holes in One Piece'),
          ),
          EntryCell(
            label: 'Stroke Required for One Piece',
            child: c.calcBox('strokeRequired', _partFigure(c.values['strokeRequired']), 'Stroke Required for One Piece'),
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
Widget mfdTimeLine(EntryLineContext c) {
  final shift = c.metrics.calc['shiftHours'];
  return EntryLineCard(
    title: 'Machine Time ON – OFF, Machine Shift Time',
    icon: Icons.schedule_rounded,
    hasError: c.lineHasError(_line3),
    children: [
      EntryGrid(
        maxCols: 3,
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
          EntryCell(
            label: 'Machine Shift Time (Hour)',
            child: c.calcBox(
              'shiftHours',
              isNum(shift) ? '${fmtNum(shift)} (${hoursToHm(shift)} hr)' : '',
              'Machine Shift Time (Hour)',
            ),
          ),
        ],
      ),
      if (c.booked.isNotEmpty)
        EntryHintText(
          'This machine already has on this date: ${c.booked.join(', ')} — times may overlap on this sheet (up to $mfdMaxSlots entries a day).',
        ),
    ],
  );
}

/// The earliest the Setting Time OFF picker offers: a minute after Setting Time
/// ON (web `settingOffEarliest`).
String? _settingOffEarliest(EntryLineContext c) {
  final on = normalizeTime(c.values['settingOnTime']);
  if (on == null) return null;
  final next = int.parse(on.substring(0, 2)) * 60 + int.parse(on.substring(3, 5)) + 1;
  if (next >= 1440) return null;
  return '${(next ~/ 60).toString().padLeft(2, '0')}:${(next % 60).toString().padLeft(2, '0')}';
}

/// Setting Time ON / OFF — optional, informational only.
Widget mfdSettingLine(EntryLineContext c) => EntryLineCard(
      title: 'Setting Time ON – OFF',
      icon: Icons.tune_rounded,
      hasError: c.lineHasError(_line4),
      optional: true,
      hasValue: c.anyFilled(_line4),
      children: [
        EntryGrid(
          cells: [
            EntryCell(
              label: 'Setting Time ON',
              error: c.err('settingOnTime'),
              child: c.keyed(
                'settingOnTime',
                WebTimeField(
                  key: ValueKey('entry${c.index}/settingOnTime'),
                  value: c.text('settingOnTime'),
                  semanticsLabel: 'Setting Time ON',
                  invalid: c.err('settingOnTime') != null,
                  focusNode: c.nodeFor('settingOnTime'),
                  onChanged: (t) => c.set('settingOnTime', t),
                ),
              ),
            ),
            EntryCell(
              label: 'Setting Time OFF',
              error: c.err('settingOffTime'),
              child: c.keyed(
                'settingOffTime',
                WebTimeField(
                  key: ValueKey('entry${c.index}/settingOffTime'),
                  value: c.text('settingOffTime'),
                  semanticsLabel: 'Setting Time OFF',
                  minTime: _settingOffEarliest(c),
                  invalid: c.err('settingOffTime') != null,
                  focusNode: c.nodeFor('settingOffTime'),
                  onChanged: (t) => c.set('settingOffTime', t),
                ),
              ),
            ),
          ],
        ),
      ],
    );

/// The Production Master in the sheet's words — Actual Quantity (never more
/// than the IDEAL Quantity rounded down) and ACTUAL OK Quantity typed, the grey
/// Rejected Quantity — and the sheet's grey figures under it: % OK Quantity,
/// IDEAL Quantity (0 decimals), IDEAL Quantity/Hour (1 decimal), Effective
/// Machine Run Time (Hour) and Efficiency (%).
Widget mfdQuantityLine(EntryLineContext c) {
  final m = c.metrics;
  final x = m is MfdMetrics ? m : MfdMetrics(c.values);
  final effective = m.calc['effectiveHours'];
  return EntryLineCard(
    title: 'Production Master — Actual, ACTUAL OK, Rejected Quantity',
    icon: Icons.inventory_2_outlined,
    hasError: c.lineHasError(_line5),
    children: [
      EntryGrid(
        maxCols: 3,
        cells: [
          EntryCell(
            label: mfdActualLabel,
            required: true,
            error: c.err('actualQty'),
            // Phone-only: says why the box takes nothing (the web raises a popup when you type).
            hint: c.locked('actualQty', m.idealQty)
                ? 'IDEAL Quantity is 0, so $mfdActualLabel can only be 0 — check the Machine Time ON/OFF, Lunch / Tea and the Total Cycle Time.'
                : null,
            child: c.keyed(
              'actualQty',
              c.numBox(
                'actualQty',
                max: m.idealQty,
                label: mfdActualLabel,
                // Past the IDEAL Quantity: the web's popup with the figures (Lunch / Tea it took out included).
                onExceedTyped: c.onLimit(
                  (typed) => qtyNotice(calc: m.calc, entered: typed, label: mfdActualLabel),
                  (max) => "$mfdActualLabel can't be more than Ideal Quantity (${fmtNum(max)})",
                ),
              ),
            ),
          ),
          EntryCell(
            label: mfdOkLabel,
            required: true,
            error: c.err('okQty'),
            hint: c.locked('okQty', m.okMax) ? '$mfdActualLabel is 0, so $mfdOkLabel can only be 0.' : null,
            child: c.keyed(
              'okQty',
              c.numBox(
                'okQty',
                max: m.okMax,
                label: mfdOkLabel,
                onExceed: (max) => EntryFormToast.warn("$mfdOkLabel can't be more than $mfdActualLabel (${fmtNum(max)})"),
              ),
            ),
          ),
          EntryCell(
            label: mfdRejectedLabel,
            child: c.calcBox('rejectedQty', entryFmt(m.calc['rejectedQty']), mfdRejectedLabel),
          ),
        ],
      ),
      const SizedBox(height: EntryStyle.rowGap),
      EntryGrid(
        maxCols: 3,
        cells: [
          EntryCell(label: '% OK Quantity', child: c.calcBox('pctOk', fmtPct(m.calc['pctOk']), '% OK Quantity')),
          EntryCell(label: 'IDEAL Quantity', child: c.calcBox('idealQtyExact', fmtIdeal(x.idealQtyExact), 'IDEAL Quantity')),
          EntryCell(
            label: 'IDEAL Quantity/Hour',
            child: c.calcBox('idealQtyPerHour', fmtIdealPerHour(x.idealQtyPerHour), 'IDEAL Quantity/Hour'),
          ),
          EntryCell(
            label: 'Effective Machine Run Time (Hour)',
            child: c.calcBox(
              'effectiveHours',
              isNum(effective) ? '${fmtNum(effective)} (${hoursToHm(effective)} hr)' : '',
              'Effective Machine Run Time (Hour)',
            ),
          ),
          EntryCell(label: 'Efficiency (%)', child: c.calcBox('efficiency', fmtPct(x.efficiency), 'Efficiency (%)')),
        ],
      ),
      // Availability / Performance / Quality above 100% -> goes to Admin review.
      oeeCheck(c),
    ],
  );
}

/// Planned Operator Shift (decimal hours, or fixed by Process Master's lock),
/// Lunch / Tea / Washroom (which the IDEAL Quantity takes out) and the Downtime
/// allowance.
Widget mfdShiftLine(EntryLineContext c) {
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
            label: mfdLunchLabel,
            error: c.err('lunchMin'),
            // Phone-only: says why the box takes nothing (the web raises a popup when you type).
            hint: c.locked('lunchMin', lunch.max) ? 'No downtime left, so Lunch / Tea can only be 0.' : null,
            child: c.keyed('lunchMin', c.minutesBox('lunchMin', mfdLunchLabel)),
          ),
          EntryCell(
            label: 'Downtime Allowed (min)',
            child: c.calcBox('stoppageAllowed', limit == null ? '' : jsNumStr(limit), 'Downtime Allowed (min)'),
          ),
        ],
      ),
    ],
  );
}

/// The nine other downtime boxes, the running Total stoppage against its
/// allowance, and the "Others" remark once Others downtime is used.
Widget mfdDowntimeLine(EntryLineContext c) {
  final m = c.metrics;
  final keys = [for (final b in mfdDowntimeBoxes) b.$1, 'stoppageTotal', 'otherMinRemark'];
  final anyLocked = mfdDowntimeBoxes.any((b) => c.locked(b.$1, m.minutesLimit(b.$1).max));
  return EntryLineCard(
    title: 'Downtime (min)',
    icon: Icons.build_circle_outlined,
    hasError: c.lineHasError(keys),
    optional: true,
    hasValue: c.anyFilled([for (final k in keys) if (k != 'stoppageTotal') k]),
    children: [
      EntryGrid(
        maxCols: 3,
        cells: [
          for (final (key, label) in mfdDowntimeBoxes)
            EntryCell(label: label, error: c.err(key), child: c.keyed(key, c.minutesBox(key, label))),
        ],
      ),
      // Phone-only: why some boxes take nothing (the web raises a popup when you type).
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

/// Every downtime box, Lunch / Tea included, has to fit inside the machine's own
/// run, so the running total sits next to that allowance — with a bar that
/// fills as it is used up.
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
            TextSpan(text: 'Total stoppage (with Lunch / Tea): ', style: TextStyle(color: s.onSurfaceVariant)),
            TextSpan(
              text: '${totalText.isEmpty ? '0' : totalText} min',
              style: TextStyle(fontWeight: FontWeight.w700, color: over ? s.error : null),
            ),
            TextSpan(
              text: limit == null ? ' — enter Machine Time ON/OFF to see the allowance' : ' of ${jsNumStr(limit)} min allowed',
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

/// REMARKS (optional): the web's label over a plain textarea (no placeholder).
Widget mfdRemarksLine(EntryLineContext c) => EntryLineCard(
      title: 'REMARKS',
      icon: Icons.notes_rounded,
      hasError: c.lineHasError(_line12),
      optional: true,
      hasValue: c.anyFilled(_line12),
      revealKey: 'entry${c.index}/remarks',
      children: [
        EntryGrid(
          cells: [
            EntryCell(
              label: 'REMARKS',
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
                  semanticsLabel: 'REMARKS',
                  onChanged: (t) => c.set('remarks', t),
                ),
              ),
            ),
          ],
        ),
      ],
    );
