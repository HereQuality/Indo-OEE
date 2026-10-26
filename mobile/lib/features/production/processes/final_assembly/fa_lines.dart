import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/widgets/form_widgets.dart';
import '../../../../core/widgets/web_time_field.dart';
import '../../entry_form/entry_fields.dart';
import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_form_toast.dart';
import '../../entry_form/entry_layout.dart';
import '../../entry_form/entry_line_context.dart';
import '../../entry_form/entry_number_input.dart';
import '../../entry_form/machine_status.dart' show machineStatusList;
import '../../entry_form/web_parity_lines.dart';
import '../../shared/limit_notice.dart' show faWords, stoppageNotice;
import '../../shared/planned_shift.dart' show plannedShiftReason;
import '../../shared/production_sheet_calc.dart';
import '../../shared/shift_hours.dart';
import '../../shared/vendors.dart';
import '../powder_coating/powder_reasons.dart' show PowderReasonSelect;
import 'fa_calc.dart';
import 'fa_metrics.dart';

const List<String> _line1 = ['date', 'machine', 'workingMode', 'machineStatus'];
const List<String> _line2 = ['itemName', 'vendor', 'totalCycleSec'];
const List<String> _line3 = ['machineOnTime', 'machineOffTime'];
const List<String> _line5 = ['actualQty', 'rejectBreakdown', 'rejectOtherRemark'];
const List<String> _line6 = ['otherActivity', 'otherActivityMin'];
const List<String> _line7 = ['plannedOperatorShiftHours', 'lunchMin'];
const List<String> _line8 = ['otherMin', 'stoppageTotal', 'otherMinRemark'];

/// The FINAL ASSEMBLY form (port of FinalAssemblyEntryForm.jsx), kept per
/// WORKER: the worker's id sits in `machine`. Any Working Status but PRESENT (or
/// Non Working) hides every work card.
class FaEntryLines extends EntryLines {
  const FaEntryLines();

  @override
  List<Widget> left(EntryLineContext c) => [
        faDateWorkerLine(c),
        if (!_statusOnly(c)) ...[
          faItemLine(c),
          faTimeLine(c),
          faQtyLine(c),
        ],
      ];

  @override
  List<Widget> right(EntryLineContext c) => [
        if (!_statusOnly(c)) ...[
          faOtherActivityLine(c),
          faShiftLine(c),
          faIdleLine(c),
        ],
        faRemarksLine(c),
      ];

  @override
  String collapsedSummary(Map<String, dynamic> v) => [
        if (entryText(v['itemName']).isNotEmpty) entryText(v['itemName']),
        if (entryText(v['actualQty']).isNotEmpty) '${FaLabels.totalQty} ${entryText(v['actualQty'])}',
        if (entryText(v['actualQty']).isNotEmpty) '${FaLabels.okQty} ${entryFmt(faRowCalc(v)['okQty'])}',
      ].join(' · ');
}

bool _statusOnly(EntryLineContext c) => isStatusOnly(c.values) || isNonWorking(c.values);

FaMetrics _m(EntryLineContext c) {
  final m = c.metrics;
  return m is FaMetrics ? m : FaMetrics(c.values);
}

/// "1.5 hr" (web `hrs`).
String _hrs(Object? v) => isNum(v) ? '${fmtNum(v)} hr' : '';

bool _filled(Object? v) => v is List ? v.isNotEmpty : (v != null && v != '');
bool _anyFilled(EntryLineContext c, List<String> keys) => keys.any((k) => _filled(c.values[k]));

/// Line 1 — Date, Worker Name, Working Status (+ the reasons of a Non Working day).
Widget faDateWorkerLine(EntryLineContext c) {
  final nonWorking = isNonWorking(c.values);
  final s = c.theme.colorScheme;
  final mode = c.text('workingMode').isEmpty ? 'Working' : c.text('workingMode');
  return EntryLineCard(
    title: 'Date, ${FaLabels.worker}, ${FaLabels.workingStatus}',
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
            label: FaLabels.worker,
            required: true,
            error: c.err('machine'),
            child: c.keyed('machine', c.machineBox(enabled: !c.isEdit)),
          ),
          EntryCell(
            label: FaLabels.workingStatus,
            error: c.err('workingMode'),
            span: EntryCell.full,
            child: c.keyed(
              'workingMode',
              EntryPickerBox(
                key: ValueKey('entry${c.index}/workingMode'),
                text: mode,
                hint: 'Working',
                focusNode: c.nodeFor('workingMode'),
                semanticsLabel: FaLabels.workingStatus,
                onTap: () async {
                  final r = await showPicker<String>(
                    c.buildContext,
                    title: FaLabels.workingStatus,
                    options: const [PickOption('Working', 'Working'), PickOption('Non Working', 'Non Working')],
                    selected: mode,
                    searchable: false,
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
              label: FaLabels.reasons,
              error: c.err('machineStatus'),
              span: EntryCell.full,
              child: c.keyed(
                'machineStatus',
                // A worker has no machine to break down (web WORKER_STATUSES).
                PowderReasonSelect(
                  index: c.index,
                  ticked: machineStatusList(c.values),
                  remark: c.text('remarks'),
                  onChanged: (list) => c.set('machineStatus', list),
                  onOpenRemarks: () => c.focusField('remarks'),
                ),
              ),
            ),
        ],
      ),
      if (_statusOnly(c))
        Padding(
          key: ValueKey('entry${c.index}/statusOnlyNote'),
          padding: const EdgeInsets.only(top: 8),
          child: Text.rich(
            TextSpan(
              style: TextStyle(fontSize: 12.5, height: 1.3, color: s.onSurfaceVariant),
              children: nonWorking
                  ? const [
                      TextSpan(text: 'Non Working', style: TextStyle(fontWeight: FontWeight.w700)),
                      TextSpan(text: ' — no work that day, so nothing else is needed. Pick a reason if you like and press Save.'),
                    ]
                  : [
                      TextSpan(text: c.text('workingStatus'), style: const TextStyle(fontWeight: FontWeight.w700)),
                      const TextSpan(
                        text:
                            ' — no work that day, so only Date, ${FaLabels.worker} and ${FaLabels.workingStatus} are saved (and ${FaLabels.remarks}, if filled in).',
                      ),
                    ],
            ),
          ),
        ),
    ],
  );
}

Object? _pageProcess(EntryLineContext c) {
  for (final m in c.machines) {
    final p = m['process'];
    if (p != null && '$p'.isNotEmpty) return p;
  }
  return null;
}

/// Line 2 — Item Name, Vendor Name (when the process has vendors, or the entry
/// names one), Standard Time per Piece (optional).
Widget faItemLine(EntryLineContext c) {
  final vendors = vendorsForProcess(c.extra['vendors'] ?? const <Map<String, dynamic>>[], _pageProcess(c));
  final showVendor = vendors.isNotEmpty || c.text('vendor').isNotEmpty;
  final item = entryItemFor(c.values, c.items);
  final partCycle = () {
    final n = item?['totalCycleSec'];
    if (n == null || n == '') return null;
    final d = jsNumber(n);
    return (d == null || !d.isFinite) ? null : d;
  }();
  final cycleErr = c.err('totalCycleSec');
  final raw = c.values['totalCycleSec'];
  final cycleHint = partCycle != null && jsToNumber(raw) != partCycle
      ? "Part's usual: ${fmtNum(partCycle)} sec"
      : (raw == '' || raw == null)
          ? 'Blank (e.g. PACKING): no Ideal, Effective 0'
          : '';
  return EntryLineCard(
    title: '${FaLabels.itemName}, Standard Time per Piece',
    icon: Icons.inventory_2_outlined,
    hasError: c.lineHasError(_line2),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: FaLabels.itemName,
            required: true,
            error: c.err('itemName'),
            span: EntryCell.full,
            child: c.keyed(
              'itemName',
              EntryPickerBox(
                key: ValueKey('entry${c.index}/itemName'),
                text: partBoxText(c),
                hint: 'Select part',
                maxLines: 2,
                invalid: c.err('itemName') != null,
                focusNode: c.nodeFor('itemName'),
                semanticsLabel: FaLabels.itemName,
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
                    c.set('vendor', r.value ?? '');
                  },
                ),
              ),
            ),
          EntryCell(
            label: FaLabels.std,
            error: cycleErr,
            hint: cycleErr == null && cycleHint.isNotEmpty ? cycleHint : null,
            child: c.keyed(
              'totalCycleSec',
              EntryTextField(
                key: ValueKey('entry${c.index}/totalCycleSec'),
                value: c.text('totalCycleSec'),
                numeric: true,
                decimals: true,
                hint: 'Optional',
                invalid: cycleErr != null,
                focusNode: c.nodeFor('totalCycleSec'),
                semanticsLabel: FaLabels.std,
                onChanged: (t) => c.set('totalCycleSec', t),
              ),
            ),
          ),
        ],
      ),
    ],
  );
}

/// Line 3 — Start / End Time and the Working Hours they make; what the worker
/// already has on the date (overlap is fine on this sheet).
Widget faTimeLine(EntryLineContext c) {
  final s = c.theme.colorScheme;
  final shift = _m(c).shiftHours;
  return EntryLineCard(
    title: 'Start – End Time, ${FaLabels.hours}',
    icon: Icons.schedule_rounded,
    hasError: c.lineHasError(_line3),
    children: [
      EntryGrid(
        maxCols: 3,
        cells: [
          for (final (field, label) in const [('machineOnTime', FaLabels.start), ('machineOffTime', FaLabels.end)])
            EntryCell(
              label: label,
              required: true,
              error: c.err(field),
              child: c.keyed(
                field,
                WebTimeField(
                  key: ValueKey('entry${c.index}/$field'),
                  value: c.text(field),
                  semanticsLabel: label,
                  minTime: field == 'machineOffTime' ? c.offEarliest : null,
                  invalid: c.err(field) != null,
                  focusNode: c.nodeFor(field),
                  onChanged: (t) => c.set(field, t),
                ),
              ),
            ),
          EntryCell(
            label: FaLabels.hours,
            child: c.calcBox('shiftHours', shift == null ? '' : '${_hrs(shift)} (${hoursToHm(shift)})', FaLabels.hours),
          ),
        ],
      ),
      if (c.booked.isNotEmpty)
        Padding(
          key: ValueKey('entry${c.index}/booked'),
          padding: const EdgeInsets.only(top: 6),
          child: Text.rich(
            TextSpan(
              style: TextStyle(fontSize: 12.5, height: 1.3, color: s.onSurfaceVariant),
              children: [
                const TextSpan(text: 'Already entered for this worker on this date: '),
                TextSpan(text: c.booked.join(', '), style: const TextStyle(fontWeight: FontWeight.w700)),
                const TextSpan(text: ' — overlapping times are fine on this sheet.'),
              ],
            ),
          ),
        ),
    ],
  );
}

/// Line 5 — Total QTY (NOT capped at Ideal: over-Ideal goes to OEE Review), the
/// sheet's grey figures, the four Types of Defects, Total Defects and OK QTY.
Widget faQtyLine(EntryLineContext c) {
  final m = _m(c);
  final calc = m.calc;
  final split = c.values['rejectBreakdown'];
  final splitErr = c.err('rejectBreakdown');
  return EntryLineCard(
    title: '${FaLabels.totalQty}, ${FaLabels.defects}',
    icon: Icons.fact_check_outlined,
    hasError: c.lineHasError(_line5),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: FaLabels.totalQty,
            required: true,
            error: c.err('actualQty'),
            child: c.keyed('actualQty', c.numBox('actualQty', label: FaLabels.totalQty)),
          ),
          EntryCell(label: FaLabels.idealQty, child: c.calcBox('idealQty', fmtNum(calc['idealQty']), FaLabels.idealQty)),
          EntryCell(
            label: FaLabels.idealQtyPerHour,
            child: c.calcBox('idealQtyPerHour', fmtNum(calc['idealQtyPerHour']), FaLabels.idealQtyPerHour),
          ),
          EntryCell(label: FaLabels.effective, child: c.calcBox('effectiveHours', _hrs(calc['effectiveHours']), FaLabels.effective)),
        ],
      ),
      const SizedBox(height: 10),
      c.keyed(
        'rejectBreakdown',
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            EntryGrid(
              cells: [
                for (var r = 0; r < faDefectReasons.length; r++)
                  EntryCell(
                    label: '${faDefectReasons[r]} (Qty)',
                    child: EntryTextField(
                      key: ValueKey('entry${c.index}/reject/${faDefectReasons[r]}'),
                      value: entryText(split is Map ? split[faDefectReasons[r]] : null),
                      numeric: true,
                      decimals: false,
                      max: m.totalQtyTyped ? m.defectRoom(faDefectReasons[r]) : null,
                      onExceedMax: (_) => EntryFormToast.warn(
                        "${FaLabels.defects} can't add up to more than ${FaLabels.totalQty} (${fmtNum(m.totalQty)}).",
                      ),
                      invalid: splitErr != null,
                      focusNode: r == 0 ? c.nodeFor('rejectBreakdown') : null,
                      semanticsLabel: '${faDefectReasons[r]} (Qty)',
                      onChanged: (t) => c.onRejectChange(c.index, faDefectReasons[r], t),
                    ),
                  ),
              ],
            ),
            if (splitErr != null) EntryErrorText(splitErr),
          ],
        ),
      ),
      const SizedBox(height: 10),
      EntryGrid(
        cells: [
          EntryCell(label: FaLabels.totalDefects, child: c.calcBox('totalDefect', fmtNum(calc['totalDefect']), FaLabels.totalDefects)),
          EntryCell(label: FaLabels.okQty, child: c.calcBox('okQty', fmtNum(calc['okQty']), FaLabels.okQty)),
        ],
      ),
      if (m.otherDefectUsed) ...[
        const SizedBox(height: 10),
        EntryGrid(
          cells: [
            EntryCell(
              label: 'Remark for “Other” defects',
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
                  hint: 'What were the “Other” defects?',
                  invalid: c.err('rejectOtherRemark') != null,
                  focusNode: c.nodeFor('rejectOtherRemark'),
                  semanticsLabel: 'Remark for “Other” defects',
                  onChanged: (t) => c.set('rejectOtherRemark', t),
                ),
              ),
            ),
          ],
        ),
      ],
      // Availability / Performance / Quality above 100% -> goes to Admin review.
      oeeCheck(c),
    ],
  );
}

/// An idle / other-activity box: capped to what the Working Hours still allow;
/// past it the web's stoppage popup in this sheet's words (FA_WORDS).
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
      final own = jsNumber(c.values[field]);
      final others = m.away - ((own == null || own.isNaN) ? 0.0 : own);
      c.notice(stoppageNotice(limitMin: limit, totalMin: others + typed, words: faWords));
    },
  );
}

/// Line 6 — Other Activity Carried out and its minutes (optional, folded).
Widget faOtherActivityLine(EntryLineContext c) {
  final minutes = jsNumber(c.values['otherActivityMin']);
  return EntryLineCard(
    title: FaLabels.otherActivity,
    icon: Icons.work_outline_rounded,
    hasError: c.lineHasError(_line6),
    optional: true,
    hasValue: _anyFilled(c, _line6),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: FaLabels.otherActivity,
            required: minutes != null && minutes > 0,
            error: c.err('otherActivity'),
            span: EntryCell.full,
            child: c.keyed(
              'otherActivity',
              EntryTextField(
                key: ValueKey('entry${c.index}/otherActivity'),
                value: c.text('otherActivity'),
                maxLength: 200,
                hint: 'e.g. Material Shifting',
                invalid: c.err('otherActivity') != null,
                focusNode: c.nodeFor('otherActivity'),
                semanticsLabel: FaLabels.otherActivity,
                onChanged: (t) => c.set('otherActivity', t),
              ),
            ),
          ),
          EntryCell(
            label: FaLabels.otherActivityMin,
            error: c.err('otherActivityMin'),
            child: c.keyed('otherActivityMin', _minutesBox(c, 'otherActivityMin', FaLabels.otherActivityMin)),
          ),
        ],
      ),
    ],
  );
}

/// Line 7 — Planned Operator Shift (decimal hours; read-only with its reason
/// while Process Master fixes it), Lunch / Tea and the minutes allowed.
Widget faShiftLine(EntryLineContext c) {
  final m = _m(c);
  final s = c.theme.colorScheme;
  final limit = m.stoppageLimit;
  final planned = m.plannedHours;
  final shiftMin = m.shiftHours == null ? null : jsRound(m.shiftHours! * 60);
  final endBeforeStart = (c.errors['machineOffTime'] ?? '').contains(' Time must be after ');
  final below = !endBeforeStart && planned != null && shiftMin != null && jsRound(planned * 60) < shiftMin;
  final setting = c.plannedShift;
  final err = c.err('plannedOperatorShiftHours');
  return EntryLineCard(
    title: 'Planned Operator Shift, Lunch / Tea',
    icon: Icons.timelapse_rounded,
    hasError: c.lineHasError(_line7),
    // Web `<Line id={7} optional openByDefault={!plannedLock} countFields={["lunchMin"]}>`.
    optional: true,
    hasValue: _anyFilled(c, const ['lunchMin']),
    openByDefault: setting == null,
    summary: setting != null ? 'Shift fixed — Lunch / Tea optional' : '',
    children: [
      EntryGrid(
        maxCols: 3,
        cells: [
          EntryCell(
            label: 'Planned Operator Shift (hours)',
            required: true,
            error: err,
            hint: setting == null ? null : plannedShiftReason(setting, hoursToHm(setting.hours)),
            child: c.keyed(
              'plannedOperatorShiftHours',
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  c.numBox(
                    'plannedOperatorShiftHours',
                    decimals: true,
                    maxLength: 5,
                    max: 24,
                    enabled: setting == null,
                    label: 'Planned Operator Shift (hours)',
                    onExceed: (_) => EntryFormToast.warn("Planned Operator Shift can't be more than 24 hours."),
                  ),
                  if (err == null)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        below
                            ? "Can't be less than the ${FaLabels.hours} (${hoursToHm(shiftMin / 60)})."
                            : planned != null
                                ? '= ${hoursToHm(planned)} hr'
                                : "Type hours — 1.5 is 1 h 30 min. The same as the ${FaLabels.hours} gives the sheet's own figures.",
                        key: ValueKey('entry${c.index}/plannedHint'),
                        style: TextStyle(fontSize: 12, height: 1.3, color: below ? s.error : s.onSurfaceVariant),
                      ),
                    ),
                ],
              ),
            ),
          ),
          EntryCell(
            label: FaLabels.lunchMin,
            error: c.err('lunchMin'),
            child: c.keyed('lunchMin', _minutesBox(c, 'lunchMin', FaLabels.lunchMin)),
          ),
          EntryCell(
            label: 'Idle + Other Activity Allowed (min)',
            child: c.calcBox('stoppageAllowed', limit == null ? '' : jsNumStr(limit), 'Idle + Other Activity Allowed (min)'),
          ),
        ],
      ),
    ],
  );
}

/// Line 8 — Idle — Other (min), Total Idle, the running Idle + Other Activity
/// total against the Working Hours, and the Other remark.
Widget faIdleLine(EntryLineContext c) {
  final m = _m(c);
  final s = c.theme.colorScheme;
  final limit = m.stoppageLimit;
  final awayText = fmtNum(m.away);
  final err = c.err('stoppageTotal');
  final totalIdle = fmtNum(m.calc['totalStoppageMin']);
  return EntryLineCard(
    title: 'Idle — Other (min)',
    icon: Icons.pause_circle_outline_rounded,
    hasError: c.lineHasError(_line8),
    optional: true,
    hasValue: _anyFilled(c, const ['otherMin', 'otherMinRemark']),
    children: [
      EntryGrid(
        maxCols: 3,
        cells: [
          EntryCell(
            label: FaLabels.otherMin,
            error: c.err('otherMin'),
            child: c.keyed('otherMin', _minutesBox(c, 'otherMin', FaLabels.otherMin)),
          ),
          EntryCell(
            label: FaLabels.totalIdle,
            child: c.calcBox('totalStoppageMin', totalIdle.isEmpty ? '0' : totalIdle, FaLabels.totalIdle),
          ),
        ],
      ),
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
                  TextSpan(text: 'Idle + Other Activity: ', style: TextStyle(color: s.onSurfaceVariant)),
                  TextSpan(
                    text: '${awayText.isEmpty ? '0' : awayText} min',
                    style: TextStyle(fontWeight: FontWeight.w700, color: m.overStoppage ? s.error : null),
                  ),
                  TextSpan(
                    text: limit == null ? ' — enter Start / End Time to see the allowance' : ' of ${jsNumStr(limit)} min allowed',
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

/// Line 12 — Remarks (optional, folded). The Reasons list's "Remarks" tick
/// opens it and puts the cursor in the box.
Widget faRemarksLine(EntryLineContext c) => EntryLineCard(
      title: FaLabels.remarks,
      icon: Icons.notes_rounded,
      hasError: c.lineHasError(const ['remarks']),
      optional: true,
      hasValue: _anyFilled(c, const ['remarks']),
      revealKey: 'entry${c.index}/remarks',
      children: [
        EntryGrid(
          cells: [
            EntryCell(
              label: FaLabels.remarks,
              span: EntryCell.full,
              child: c.keyed(
                'remarks',
                EntryTextField(
                  key: ValueKey('entry${c.index}/remarks'),
                  value: c.text('remarks'),
                  maxLength: 500,
                  minLines: 2,
                  maxLines: 5,
                  hint: 'e.g. helpers: AMIT, DILIP',
                  focusNode: c.nodeFor('remarks'),
                  semanticsLabel: FaLabels.remarks,
                  onChanged: (t) => c.set('remarks', t),
                ),
              ),
            ),
          ],
        ),
      ],
    );
