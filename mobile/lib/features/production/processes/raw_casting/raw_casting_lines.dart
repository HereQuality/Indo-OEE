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
import '../powder_coating/powder_reasons.dart' show PowderReasonSelect;
import 'raw_casting_calc.dart';
import 'raw_casting_metrics.dart';

const List<String> _line1 = ['date', 'machine', 'workingMode', 'machineStatus'];
const List<String> _line2 = ['itemName', 'vendor', 'challanNo', 'totalCycleSec'];
const List<String> _line3 = ['machineOnTime', 'machineOffTime'];
const List<String> _line5 = ['actualQty', 'rejectBreakdown'];
const List<String> _line6 = ['otherActivity', 'otherActivityMin'];
const List<String> _line7 = ['plannedOperatorShiftHours', 'lunchMin'];
const List<String> _line8 = ['otherMin', 'stoppageTotal', 'otherMinRemark'];

/// The RAW CASTING inspection form (port of RawCastingEntryForm.jsx), kept per
/// WORKER instead of per machine: the worker's id sits in `machine`. Any Working
/// Status but PRESENT (or Non Working) hides every inspection line.
class RawCastingEntryLines extends EntryLines {
  const RawCastingEntryLines();

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
    rawCastingRemarksLine(c),
  ];

  @override
  String collapsedSummary(Map<String, dynamic> v) => [
    if (entryText(v['itemName']).isNotEmpty) entryText(v['itemName']),
    if (entryText(v['actualQty']).isNotEmpty)
      'TOTAL ${entryText(v['actualQty'])}',
    if (entryText(v['actualQty']).isNotEmpty)
      'OK ${entryFmt(rawCastingRowCalc(v)['okQty'])}',
  ].join(' · ');
}

bool _statusOnly(EntryLineContext c) =>
    rawCastingIsStatusOnly(c.values) || isNonWorking(c.values);

RawCastingMetrics _m(EntryLineContext c) {
  final m = c.metrics;
  return m is RawCastingMetrics ? m : RawCastingMetrics(c.values);
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
            // Web: the select is just disabled while editing (no note under it).
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
                PowderReasonSelect(
                  index: c.index,
                  ticked: reasons,
                  remark: c.text('remarks'),
                  onChanged: (list) => c.set('machineStatus', list),
                  // "Remarks" opens the (folded) Remarks section and puts the cursor in it.
                  onOpenRemarks: () => c.focusField('remarks'),
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
                        text: ' — no inspection that day, so nothing else is needed. Pick a reason (or write one, like W.OFF, in Remarks) and press Save.',
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
List<Map<String, dynamic>> rawCastingVendors(EntryLineContext c) {
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
  final vendors = rawCastingVendors(c);
  final showVendor = vendors.isNotEmpty || c.text('vendor').isNotEmpty;
  final item = entryItemFor(c.values, c.items);
  final partCycle = () {
    final n = item?['totalCycleSec'];
    if (n == null || n == '') return null;
    final d = jsNumber(n);
    return (d == null || !d.isFinite) ? null : d;
  }();
  final cycleNow = jsToNumber(c.values['totalCycleSec']);
  final cycleErr = c.err('totalCycleSec');
  return EntryLineCard(
    title: 'Item Name, Vendor Name, Challan No., Standard Inspection Time',
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
                // Web `partCycleLabel`: "Flange 40 — 60 sec"; an old record's own name
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
            label: 'Challan No.',
            error: c.err('challanNo'),
            child: c.keyed(
              'challanNo',
              EntryTextField(
                key: ValueKey('entry${c.index}/challanNo'),
                value: c.text('challanNo'),
                maxLength: 40,
                hint: 'e.g. DC/28',
                invalid: c.err('challanNo') != null,
                focusNode: c.nodeFor('challanNo'),
                semanticsLabel: 'Challan No.',
                onChanged: (t) => c.set('challanNo', t),
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
              _hoursText(shift),
              'Inspection Working Hours',
            ),
          ),
        ],
      ),
      if (c.booked.isNotEmpty)
        EntryHintText(
          'Already entered for this worker on this date: ${c.booked.join(', ')} — overlapping times are fine on this sheet.',
        ),
    ],
  );
}

/// Decimal hours as the sheet shows them: "7.75 hr (7:45)".
String _hoursText(Object? h) => isNum(h) ? '${fmtNum(h)} hr (${hoursToHm(h)})' : '';

/// TOTAL QTY, the Ideal figures, the three Types of Defects and what they make.
Widget inspectionQtyLine(EntryLineContext c) {
  final m = _m(c);
  final split = c.values['rejectBreakdown'];
  final defectErr = c.err('rejectBreakdown');
  return EntryLineCard(
    title: 'TOTAL QTY, Types of Defects',
    icon: Icons.fact_check_outlined,
    hasError: c.lineHasError(_line5),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'TOTAL QTY',
            required: true,
            error: c.err('actualQty'),
            child: c.keyed('actualQty', c.numBox('actualQty', label: 'TOTAL QTY')),
          ),
          EntryCell(
            label: 'Ideal Inspection Quantity',
            child: c.calcBox('idealQty', entryFmt(m.calc['idealQty']), 'Ideal Inspection Quantity'),
          ),
          EntryCell(
            label: 'Ideal Inspection Qty/Hour',
            child: c.calcBox('idealQtyPerHour', entryFmt(m.calc['idealQtyPerHour']), 'Ideal Inspection Qty/Hour'),
          ),
          EntryCell(
            label: 'Ideal Inspection Time',
            child: c.calcBox('effectiveHours', _hoursText(m.calc['effectiveHours']), 'Ideal Inspection Time'),
          ),
        ],
      ),
      const SizedBox(height: 10),
      c.keyed(
        'rejectBreakdown',
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Types of Defects (Qty)', style: TextStyle(fontSize: 12.5, color: c.theme.colorScheme.onSurfaceVariant)),
            const SizedBox(height: 6),
            EntryGrid(
              maxCols: 3,
              cells: [
                for (var i = 0; i < rawCastingDefects.length; i++)
                  EntryCell(
                    label: rawCastingDefects[i],
                    child: EntryTextField(
                      key: ValueKey('entry${c.index}/reject/${rawCastingDefects[i]}'),
                      value: entryText(split is Map ? split[rawCastingDefects[i]] : null),
                      numeric: true,
                      decimals: false,
                      // The first box is where a failed Save puts the cursor.
                      focusNode: i == 0 ? c.nodeFor('rejectBreakdown') : null,
                      invalid: defectErr != null,
                      max: m.totalQtyTyped ? m.defectRoom(rawCastingDefects[i]) : null,
                      semanticsLabel: rawCastingDefects[i],
                      onExceedMax: (_) => EntryFormToast.warn("Defects can't add up to more than TOTAL QTY (${fmtNum(m.totalQty)})."),
                      onChanged: (t) => c.onRejectChange(c.index, rawCastingDefects[i], t),
                    ),
                  ),
              ],
            ),
            if (defectErr != null) EntryErrorText(defectErr),
          ],
        ),
      ),
      const SizedBox(height: 10),
      EntryGrid(
        cells: [
          EntryCell(label: 'Total Defects', child: c.calcBox('totalDefect', entryFmt(m.calc['totalDefect']), 'Total Defects')),
          EntryCell(label: 'OK QTY', child: c.calcBox('okQty', entryFmt(m.calc['okQty']), 'OK QTY')),
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
/// stoppage popup in the worker's words (`minutesBox` in RawCastingEntryForm.jsx);
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
  return EntryLineCard(
    title: 'Other Activity Carried Out',
    icon: Icons.work_outline_rounded,
    hasError: c.lineHasError(_line6),
    optional: true,
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
                hint: 'e.g. M-Seal filing, Drilling',
                invalid: c.err('otherActivity') != null,
                focusNode: c.nodeFor('otherActivity'),
                semanticsLabel: 'Other Activity Carried Out',
                onChanged: (t) => c.set('otherActivity', t),
              ),
            ),
          ),
          EntryCell(
            label: 'Time consume in Other Activity (min)',
            error: c.err('otherActivityMin'),
            child: c.keyed(
              'otherActivityMin',
              _minutesBox(c, 'otherActivityMin', 'Time consume in Other Activity (min)'),
            ),
          ),
        ],
      ),
    ],
  );
}

/// Planned Operator Shift (hours), Lunch / Tea / Washroom and the minutes allowed.
/// Optional and folded — open from the start while the shift is typed by hand,
/// folded to "Shift fixed — Lunch / Tea optional" while Process Master locks it.
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
      m.plannedBelowMachine && !(c.errors['machineOffTime'] ?? '').contains(' Time must be after ')
          ? "Can't be less than the Inspection Working Hours ($workingHm)."
          : planned != null
          ? '= ${hoursToHm(planned)} hr'
          : "Type hours — 7.75 is 7 h 45 min. The same as the Inspection Working Hours gives the sheet's own figures.",
    ?lockNote,
  ];
  return EntryLineCard(
    title: 'Planned Operator Shift, Lunch / Tea',
    icon: Icons.timelapse_rounded,
    hasError: c.lineHasError(_line7),
    // Web `<Line id={7} optional openByDefault={!plannedLock} countFields={["lunchMin"]}
    // summary={plannedLock ? "Shift fixed — Lunch / Tea optional" : ""}>`: only Lunch / Tea
    // counts as typed (a pre-filled, locked shift must not open it).
    optional: true,
    hasValue: _anyFilled(c, const ['lunchMin']),
    openByDefault: setting == null,
    summary: setting != null ? 'Shift fixed \u2014 Lunch / Tea optional' : '',
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
            label: 'Lunch / Tea / Washroom etc (Min)',
            error: c.err('lunchMin'),
            child: c.keyed(
              'lunchMin',
              _minutesBox(c, 'lunchMin', 'Lunch / Tea / Washroom etc (Min)'),
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
  return EntryLineCard(
    title: 'Idle Time — Other (Min)',
    icon: Icons.pause_circle_outline_rounded,
    hasError: c.lineHasError(_line8),
    optional: true,
    // The running total (stoppageTotal) is not something typed.
    hasValue: _anyFilled(c, const ['otherMin', 'otherMinRemark']),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Other (Min)',
            error: c.err('otherMin'),
            child: c.keyed('otherMin', _minutesBox(c, 'otherMin', 'Other (Min)')),
          ),
          EntryCell(
            label: 'Total Idle Time (Min)',
            child: c.calcBox(
              'totalStoppageMin',
              entryFmt(m.calc['totalStoppageMin']).isEmpty
                  ? '0'
                  : entryFmt(m.calc['totalStoppageMin']),
              'Total Idle Time (Min)',
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

/// Reason/Remarks for Rejection (optional, folded). The Reasons
/// list's "Remarks" tick opens it and puts the cursor in the box.
Widget rawCastingRemarksLine(EntryLineContext c) => EntryLineCard(
  title: 'Reason/Remarks for Rejection',
  icon: Icons.notes_rounded,
  hasError: c.lineHasError(const ['remarks']),
  optional: true,
  hasValue: _anyFilled(c, const ['remarks']),
  revealKey: 'entry${c.index}/remarks',
  children: [
    EntryGrid(
      cells: [
        // Web: the same words as the line title, over a plain textarea (no placeholder).
        EntryCell(
          label: 'Reason/Remarks for Rejection',
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
              semanticsLabel: 'Reason/Remarks for Rejection',
              onChanged: (t) => c.set('remarks', t),
            ),
          ),
        ),
      ],
    ),
  ],
);
