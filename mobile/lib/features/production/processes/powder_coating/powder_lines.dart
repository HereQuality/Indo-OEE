import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/widgets/form_widgets.dart';
import '../../../../core/widgets/web_time_field.dart';
import '../../entry_form/entry_fields.dart';
import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_form_toast.dart';
import '../../entry_form/entry_layout.dart';
import '../../entry_form/entry_number_input.dart';
import '../../entry_form/entry_line_context.dart';
import '../../entry_form/machine_status.dart';
import '../../entry_form/web_parity_lines.dart';
import '../../shared/limit_notice.dart' show stoppageNotice, workerWords;
import '../../shared/planned_shift.dart' show plannedShiftReason;
import '../../shared/production_sheet_calc.dart';
import '../../shared/shift_hours.dart';
import '../../shared/vendors.dart';
import 'powder_calc.dart';
import 'powder_fold_card.dart';
import 'powder_metrics.dart';

const List<String> _line1 = ['date', 'machine', 'workingMode', 'machineStatus'];
const List<String> _line2 = ['itemName', 'vendor', 'totalCycleSec'];
const List<String> _line3 = ['machineOnTime', 'machineOffTime'];
final List<String> _line5 = ['actualQty', ...powderDefectKeys];
const List<String> _line6 = ['otherActivity', 'otherActivityMin'];
const List<String> _line7 = ['plannedOperatorShiftHours', 'lunchMin'];
const List<String> _line8 = ['otherMin', 'stoppageTotal', 'otherMinRemark'];

/// The After Powder Coating inspection form (port of PowderCoatingEntryForm.jsx),
/// kept per WORKER instead of per machine: the worker's id sits in `machine`.
/// Any Working Status but PRESENT (or Non Working) hides every inspection line.
class PowderEntryLines extends EntryLines {
  const PowderEntryLines();

  @override
  List<Widget> left(EntryLineContext c) => [
    dateWorkerStatusLine(c),
    if (!_statusOnly(c)) ...[
      itemLine(c),
      inspectionTimeLine(c),
      inspectionQtyLine(c),
    ],
  ];

  @override
  List<Widget> right(EntryLineContext c) => [
    if (!_statusOnly(c)) ...[
      otherActivityLine(c),
      plannedShiftLine(c),
      idleLine(c),
    ],
    powderRemarksLine(c),
  ];

  @override
  String collapsedSummary(Map<String, dynamic> v) => [
    if (entryText(v['itemName']).isNotEmpty) entryText(v['itemName']),
    if (entryText(v['actualQty']).isNotEmpty)
      'Total ${entryText(v['actualQty'])}',
    if (entryText(v['actualQty']).isNotEmpty)
      'OK ${entryFmt(powderRowCalc(v)['okQty'])}',
  ].join(' · ');
}

bool _statusOnly(EntryLineContext c) =>
    isStatusOnly(c.values) || isNonWorking(c.values);

PowderMetrics _m(EntryLineContext c) {
  final m = c.metrics;
  return m is PowderMetrics ? m : PowderMetrics(c.values);
}

/// Date, Worker Name, Working Status (+ the reasons of a Non Working day).
Widget dateWorkerStatusLine(EntryLineContext c) {
  final nonWorking = isNonWorking(c.values);
  final statusOnly = _statusOnly(c);
  final s = c.theme.colorScheme;
  final reasons = machineStatusList(c.values);
  final mode = c.text('workingMode').isEmpty
      ? 'Working'
      : c.text('workingMode');
  return EntryLineCard(
    title: 'Date, Worker Name, Working Status',
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
            label: 'Worker Name',
            required: true,
            error: c.err('machine'),
            hint: c.isEdit ? "Can't be changed while editing" : null,
            child: c.keyed('machine', c.machineBox(enabled: !c.isEdit)),
          ),
          EntryCell(
            label: 'Working Status',
            error: c.err('workingMode'),
            span: EntryCell.full,
            child: c.keyed(
              'workingMode',
              EntryPickerBox(
                key: ValueKey('entry${c.index}/workingMode'),
                text: mode,
                hint: 'Working',
                focusNode: c.nodeFor('workingMode'),
                semanticsLabel: 'Working Status',
                onTap: () async {
                  final r = await showPicker<String>(
                    c.buildContext,
                    title: 'Working Status',
                    options: const [
                      PickOption('Working', 'Working'),
                      PickOption('Non Working', 'Non Working'),
                    ],
                    selected: mode,
                  );
                  if (r == null || r.value == null) return;
                  HapticFeedback.selectionClick();
                  c.set('workingMode', r.value);
                  // Working has no reason — drop any picked while it was Non Working.
                  if (r.value == 'Working') c.set('machineStatus', <dynamic>[]);
                },
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
                  ticked: reasons,
                  remark: c.text('remarks'),
                  onChanged: (list) => c.set('machineStatus', list),
                  // "Remarks" opens the (folded) Remarks section and puts the cursor in it.
                  onOpenRemarks: () => requestOpenRemarks(c.index),
                ),
              ),
            ),
        ],
      ),
      if (statusOnly)
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Text.rich(
            TextSpan(
              style: TextStyle(
                fontSize: 12.5,
                height: 1.3,
                color: s.onSurfaceVariant,
              ),
              children: nonWorking
                  ? const [
                      TextSpan(
                        text: 'Non Working',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                      TextSpan(
                        text: ' — no inspection that day, so nothing else is needed. Pick a reason if you like and press Save.',
                      ),
                    ]
                  : [
                      TextSpan(
                        text: c.text('workingStatus'),
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      const TextSpan(
                        text: ' — no inspection that day, so only Date, Worker Name and Working Status are saved (and Remarks, if filled in).',
                      ),
                    ],
            ),
          ),
        ),
    ],
  );
}

/// The vendors Vendor Master ticks for this page's process (`processVendors`,
/// utils/vendorsFor.js) — page-level on the web, so any worker of the page
/// carries the process (a deactivated worker stub of an edited entry doesn't).
List<Map<String, dynamic>> powderVendors(EntryLineContext c) {
  Object? processId;
  for (final m in c.machines) {
    final p = m['process'];
    if (p != null && '$p'.isNotEmpty) {
      processId = p;
      break;
    }
  }
  return vendorsForProcess(c.extra['vendors'] ?? const <Map<String, dynamic>>[], processId);
}

/// Item Name, Vendor Name (only when this process has vendors — or the entry
/// already names one), Standard Inspection Time per Piece.
Widget itemLine(EntryLineContext c) {
  final vendors = powderVendors(c);
  final showVendor = vendors.isNotEmpty || c.text('vendor').isNotEmpty;
  final item = entryItemFor(c.values, c.items);
  final partCycle = () {
    final n = item?['totalCycleSec'];
    if (n == null || n == '') return null;
    final d = jsNumber(n);
    return (d == null || !d.isFinite) ? null : d;
  }();
  final cycleNow = jsNumber(c.values['totalCycleSec']);
  final cycleErr = c.err('totalCycleSec');
  return EntryLineCard(
    title: 'Item Name, Vendor Name, Standard Inspection Time',
    icon: Icons.inventory_2_outlined,
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
                text: c.text('itemName'),
                hint: 'Select item',
                maxLines: 2,
                invalid: c.err('itemName') != null,
                focusNode: c.nodeFor('itemName'),
                semanticsLabel: 'Item Name',
                onTap: c.pickItem,
              ),
            ),
          ),
          if (showVendor)
            EntryCell(
              label: 'Vendor Name',
              error: c.err('vendor'),
              span: EntryCell.full,
              child: c.keyed(
                'vendor',
                EntryPickerBox(
                  key: ValueKey('entry${c.index}/vendor'),
                  // A vendor no longer in the live list still shows by its saved name.
                  text: vendorLabelFor(vendors, c.text('vendor'), c.text('vendorName')),
                  hint: 'Select vendor',
                  invalid: c.err('vendor') != null,
                  focusNode: c.nodeFor('vendor'),
                  semanticsLabel: 'Vendor Name',
                  onTap: () async {
                    final r = await showPicker<String>(
                      c.buildContext,
                      title: 'Vendor Name',
                      options: [for (final v in vendors) PickOption<String>('${v['_id']}', '${v['name'] ?? ''}')],
                      selected: c.text('vendor').isEmpty ? null : c.text('vendor'),
                      allowClear: true,
                    );
                    if (r == null) return;
                    HapticFeedback.selectionClick();
                    // Picking writes the id only; the server derives the name (VendorSelect onSelect).
                    c.set('vendor', r.value ?? '');
                  },
                ),
              ),
            ),
          EntryCell(
            label: 'Standard Inspection Time per Piece (Sec)',
            required: true,
            error: cycleErr,
            // Filled in from the Part when picked; today's may differ.
            hint: cycleErr == null && partCycle != null && cycleNow != partCycle
                ? "Part's usual: ${fmtNum(partCycle)} sec"
                : null,
            span: EntryCell.full,
            child: c.keyed(
              'totalCycleSec',
              c.numBox(
                'totalCycleSec',
                decimals: true,
                label: 'Standard Inspection Time per Piece (Sec)',
              ),
            ),
          ),
        ],
      ),
    ],
  );
}

/// Inspection Start / End Time and the Inspection Working Hours they make.
Widget inspectionTimeLine(EntryLineContext c) {
  final m = c.metrics;
  final shift = m.calc['shiftHours'];
  return EntryLineCard(
    title: 'Inspection Start – End Time, Working Hours',
    icon: Icons.schedule_rounded,
    hasError: c.lineHasError(_line3),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Inspection Start Time',
            required: true,
            error: c.err('machineOnTime'),
            child: c.keyed(
              'machineOnTime',
              WebTimeField(
                key: ValueKey('entry${c.index}/machineOnTime'),
                value: c.text('machineOnTime'),
                semanticsLabel: 'Inspection Start Time',
                invalid: c.err('machineOnTime') != null,
                focusNode: c.nodeFor('machineOnTime'),
                onChanged: (t) => c.set('machineOnTime', t),
              ),
            ),
          ),
          EntryCell(
            label: 'Inspection End Time',
            required: true,
            error: c.err('machineOffTime'),
            child: c.keyed(
              'machineOffTime',
              WebTimeField(
                key: ValueKey('entry${c.index}/machineOffTime'),
                value: c.text('machineOffTime'),
                semanticsLabel: 'Inspection End Time',
                minTime: c.offEarliest,
                invalid: c.err('machineOffTime') != null,
                focusNode: c.nodeFor('machineOffTime'),
                onChanged: (t) => c.set('machineOffTime', t),
              ),
            ),
          ),
          EntryCell(
            label: 'Inspection Working Hours',
            child: c.calcBox(
              'shiftHours',
              shift == null ? '' : '${hoursToHm(shift)} hr',
              'Inspection Working Hours',
            ),
          ),
        ],
      ),
      if (c.booked.isNotEmpty)
        EntryHintText(
          'Already booked for this worker on this date: ${c.booked.join(', ')} — pick a time outside it.',
        ),
    ],
  );
}

/// Total Qty, the four Types of Defect / Rework and what they make.
Widget inspectionQtyLine(EntryLineContext c) {
  final m = _m(c);
  final idealHours = m.calc['effectiveHours'];
  return EntryLineCard(
    title: 'Inspection (Qty), Types of Defect / Rework',
    icon: Icons.fact_check_outlined,
    hasError: c.lineHasError(_line5),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Total Qty',
            required: true,
            error: c.err('actualQty'),
            child: c.keyed(
              'actualQty',
              c.numBox('actualQty', label: 'Total Qty'),
            ),
          ),
          EntryCell(
            label: 'Ideal Inspection Quantity',
            child: c.calcBox(
              'idealQty',
              entryFmt(m.calc['idealQty']),
              'Ideal Inspection Quantity',
            ),
          ),
          EntryCell(
            label: 'Ideal Inspection Qty / Hour',
            child: c.calcBox(
              'idealQtyPerHour',
              entryFmt(m.calc['idealQtyPerHour']),
              'Ideal Inspection Qty / Hour',
            ),
          ),
          EntryCell(
            label: 'Ideal Inspection Time',
            child: c.calcBox(
              'effectiveHours',
              idealHours == null ? '' : '${hoursToHm(idealHours)} hr',
              'Ideal Inspection Time',
            ),
          ),
        ],
      ),
      const SizedBox(height: 10),
      EntryGrid(
        cells: [
          for (final (key, label) in powderDefectFields)
            EntryCell(
              label: '$label (Qty)',
              error: c.err(key),
              child: c.keyed(
                key,
                c.numBox(
                  key,
                  label: '$label (Qty)',
                  max: m.totalQtyTyped ? m.defectRoom(key) : null,
                  onExceed: (_) => EntryFormToast.warn(
                    "Defect / Rework can't add up to more than Total Qty (${fmtNum(m.totalQty)}).",
                  ),
                ),
              ),
            ),
        ],
      ),
      const SizedBox(height: 10),
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Total Defect / Rework',
            child: c.calcBox(
              'totalDefect',
              entryFmt(m.calc['totalDefect']),
              'Total Defect / Rework',
            ),
          ),
          EntryCell(
            label: 'OK Qty',
            child: c.calcBox('okQty', entryFmt(m.calc['okQty']), 'OK Qty'),
          ),
        ],
      ),
      // Availability / Performance / Quality above 100% -> goes to Admin review (OeeCheck.jsx).
      oeeCheck(c),
    ],
  );
}

bool _filled(Object? v) => v is List ? v.isNotEmpty : (v != null && v != '');

/// The web's FormLine `hasValue`: any of [keys] holds something.
bool _anyFilled(EntryLineContext c, List<String> keys) => keys.any((k) => _filled(c.values[k]));

/// A minutes box (Other Activity, Lunch / Tea, Other idle): capped to what the
/// Inspection Working Hours still allow. Typing past it raises the web's
/// stoppage popup in the worker's words (`minutesBox` in PowderCoatingEntryForm.jsx);
/// before the times are in it is the one-day toast.
Widget _minutesBox(EntryLineContext c, String field, String label) {
  final m = _m(c);
  final limit = m.stoppageLimit;
  final room = m.minutesLimit(field);
  return c.numBox(
    field,
    max: room.max,
    label: label,
    onExceedTyped: (max, typed) {
      if (limit == null || !c.popups) {
        EntryFormToast.warn(room.message);
        return;
      }
      final others = m.away - (jsNumber(c.values[field]) ?? 0).clamp(0, double.infinity);
      c.notice(stoppageNotice(limitMin: limit, totalMin: others + typed, words: workerWords));
    },
  );
}

/// Other Activity Carried Out, and the minutes spent on it (optional, folded).
Widget otherActivityLine(EntryLineContext c) {
  final minutes = jsNumber(c.values['otherActivityMin']);
  return PowderFoldCard(
    id: 'otherActivity',
    index: c.index,
    title: 'Other Activity Carried Out',
    icon: Icons.work_outline_rounded,
    hasError: c.lineHasError(_line6),
    hasValue: _anyFilled(c, _line6),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Other Activity Carried Out',
            required: minutes != null && minutes > 0,
            error: c.err('otherActivity'),
            span: EntryCell.full,
            child: c.keyed(
              'otherActivity',
              EntryTextField(
                key: ValueKey('entry${c.index}/otherActivity'),
                value: c.text('otherActivity'),
                maxLength: 200,
                hint: 'e.g. Packing, Material shifting',
                invalid: c.err('otherActivity') != null,
                focusNode: c.nodeFor('otherActivity'),
                semanticsLabel: 'Other Activity Carried Out',
                onChanged: (t) => c.set('otherActivity', t),
              ),
            ),
          ),
          EntryCell(
            label: 'Time in Other Activity (min)',
            error: c.err('otherActivityMin'),
            child: c.keyed(
              'otherActivityMin',
              _minutesBox(c, 'otherActivityMin', 'Time in Other Activity (min)'),
            ),
          ),
        ],
      ),
    ],
  );
}

/// Planned Operator Shift (hours), Lunch / Tea / Washroom and the minutes allowed.
/// Optional and folded — open from the start while the shift is typed by hand,
/// folded to "Fixed — nothing to enter" while Process Master locks it.
Widget plannedShiftLine(EntryLineContext c) {
  final m = c.metrics;
  final limit = m.stoppageLimit;
  final planned = m.plannedHours;
  final workingHm = hoursToHm(
    m.machineShiftMin == null ? null : m.machineShiftMin! / 60,
  );
  // Process Master's setting for this worker's process: the box is read-only
  // and says why.
  final setting = c.plannedShift;
  final lockNote = setting == null ? null : plannedShiftReason(setting, hoursToHm(setting.hours));
  final plannedHint = [
    if (c.err('plannedOperatorShiftHours') == null)
      m.plannedBelowMachine
          ? "Can't be less than the Inspection Working Hours ($workingHm)."
          : planned != null
          ? '= ${hoursToHm(planned)} hr'
          : 'Type hours as on the sheet — 3.5 is 3 h 30 min.',
    ?lockNote,
  ];
  return PowderFoldCard(
    id: 'plannedShift',
    index: c.index,
    title: 'Planned Operator Shift, Lunch / Tea',
    icon: Icons.timelapse_rounded,
    hasError: c.lineHasError(_line7),
    // Only Lunch / Tea counts as typed: a pre-filled, locked shift must not open it.
    hasValue: _anyFilled(c, const ['lunchMin']),
    openByDefault: setting == null,
    summary: setting != null ? 'Fixed — nothing to enter' : '',
    children: [
      EntryGrid(
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
                onExceed: (_) => EntryFormToast.warn(
                  "Planned Operator Shift can't be more than 24 hours.",
                ),
              ),
            ),
          ),
          EntryCell(
            label: 'Lunch / Tea / Washroom (min)',
            error: c.err('lunchMin'),
            child: c.keyed(
              'lunchMin',
              _minutesBox(c, 'lunchMin', 'Lunch / Tea / Washroom (min)'),
            ),
          ),
          EntryCell(
            label: 'Minutes Allowed',
            child: c.calcBox(
              'stoppageAllowed',
              limit == null ? '' : jsNumStr(limit),
              'Minutes Allowed',
            ),
          ),
        ],
      ),
    ],
  );
}

/// The Other idle box, Total Idle Time, the running Idle + Other Activity total
/// against the working hours, and the Other remark.
Widget idleLine(EntryLineContext c) {
  final m = _m(c);
  final s = c.theme.colorScheme;
  final limit = m.stoppageLimit;
  final over = m.overStoppage;
  final away = m.away;
  final awayText = fmtNum(away);
  final err = c.err('stoppageTotal');
  return PowderFoldCard(
    id: 'idle',
    index: c.index,
    title: 'Idle Time — Other (min)',
    icon: Icons.pause_circle_outline_rounded,
    hasError: c.lineHasError(_line8),
    // The running total (stoppageTotal) is not something typed.
    hasValue: _anyFilled(c, const ['otherMin', 'otherMinRemark']),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Other (min)',
            error: c.err('otherMin'),
            child: c.keyed('otherMin', _minutesBox(c, 'otherMin', 'Other (min)')),
          ),
          EntryCell(
            label: 'Total Idle Time (min)',
            child: c.calcBox(
              'totalStoppageMin',
              entryFmt(m.calc['totalStoppageMin']).isEmpty
                  ? '0'
                  : entryFmt(m.calc['totalStoppageMin']),
              'Total Idle Time (min)',
            ),
          ),
        ],
      ),
      const SizedBox(height: 10),
      // Idle Time and Other Activity both have to fit in the working hours, so
      // their running total sits next to that allowance.
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
                  TextSpan(
                    text: 'Idle Time + Other Activity: ',
                    style: TextStyle(color: s.onSurfaceVariant),
                  ),
                  TextSpan(
                    text: '${awayText.isEmpty ? '0' : awayText} min',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      color: over ? s.error : null,
                    ),
                  ),
                  TextSpan(
                    text: limit == null
                        ? ' — enter Inspection Start / End Time to see the allowance'
                        : ' of ${jsNumStr(limit)} min allowed',
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
              label: 'Remark for Other idle time',
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
                  hint: 'What was the “Other” idle time?',
                  invalid: c.err('otherMinRemark') != null,
                  focusNode: c.nodeFor('otherMinRemark'),
                  semanticsLabel: 'Remark for Other idle time',
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

/// Reason / Remarks for Rejection / Rework (optional, folded). The Status
/// list's "Remarks" tick opens it and puts the cursor in the box.
Widget powderRemarksLine(EntryLineContext c) => PowderFoldCard(
  id: 'remarks',
  index: c.index,
  title: 'Reason / Remarks for Rejection / Rework',
  icon: Icons.notes_rounded,
  hasError: c.lineHasError(const ['remarks']),
  hasValue: _anyFilled(c, const ['remarks']),
  openSignal: remarksOpenSignal(c.index),
  onSignalOpened: () => c.focusField('remarks'),
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
              focusNode: c.nodeFor('remarks'),
              semanticsLabel: 'Reason / Remarks for Rejection / Rework',
              onChanged: (t) => c.set('remarks', t),
            ),
          ),
        ),
      ],
    ),
  ],
);
