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
import '../../entry_form/machine_status.dart';
import '../../entry_form/web_parity_lines.dart';
import '../../shared/limit_notice.dart' show bpcWords, stoppageNotice;
import '../../shared/planned_shift.dart' show plannedShiftReason;
import '../../shared/production_sheet_calc.dart';
import '../../shared/shift_hours.dart';
import '../../shared/vendors.dart';
import '../cnc/cnc_lines.dart' show QtyLabels, quantityLine, rejectLine;
import 'bpc_calc.dart';
import 'bpc_metrics.dart';

const List<String> _line1 = ['date', 'machine', 'machineStatus'];
const List<String> _line2 = ['itemName', 'vendor', 'totalCycleSec'];
const List<String> _line3 = ['machineOnTime', 'machineOffTime'];
const List<String> _line7 = ['plannedOperatorShiftHours', 'lunchMin'];
const List<String> _line8 = ['setupMin', 'bdMechMin', 'otherMin', 'stoppageTotal', 'otherMinRemark'];
const List<String> _line12 = ['remarks'];

/// The sheet's own names for the three Production Master boxes (web `QTY_LABELS`).
const QtyLabels bpcQtyLabels = QtyLabels(actual: 'TOTAL QTY', ok: 'OK QTY', rejected: 'Rejected QTY', okShort: 'OK QTY');

/// The idle boxes in their own line — every one but Lunch / Tea, which sits
/// beside Planned Operator Shift (web `IDLE_BOXES`).
final List<(String, String)> _idleBoxes = [
  for (final f in bpcStoppageFields)
    if (f.$1 != 'lunchMin') f,
];

/// The BEFORE POWDER COATING form (port of BpcEntryForm.jsx), kept per OPERATOR
/// instead of per machine: the operator's id sits in `machine`. Its lines, in
/// the sheet's order: Date / Operator / Working Status, Item Name / Standard
/// Time per Piece, Machine ON – OFF, Production Master, Rejection Master, Planned
/// Operator Shift / Lunch, Idle Time, Reason/Remarks. Any Working Status but
/// PRESENT (or Non Working) leaves only the first line and Reason/Remarks.
class BpcEntryLines extends EntryLines {
  const BpcEntryLines();

  @override
  List<Widget> left(EntryLineContext c) => [
        dateOperatorStatusLine(c),
        if (!_statusOnly(c)) ...[
          itemLine(c),
          machineTimeLine(c),
          bpcQuantityLine(c),
        ],
      ];

  @override
  List<Widget> right(EntryLineContext c) => [
        if (!_statusOnly(c)) ...[
          rejectLine(c, reasons: bpcRejectReasons, labels: bpcQtyLabels),
          plannedShiftLine(c),
          idleLine(c),
        ],
        bpcRemarksLine(c),
      ];

  @override
  String collapsedSummary(Map<String, dynamic> v) => [
        if (entryText(v['itemName']).isNotEmpty) entryText(v['itemName']),
        if (entryText(v['actualQty']).isNotEmpty) 'TOTAL ${entryText(v['actualQty'])}',
        if (entryText(v['okQty']).isNotEmpty) 'OK ${entryText(v['okQty'])}',
      ].join(' · ');
}

bool _statusOnly(EntryLineContext c) => bpcIsStatusOnly(c.values) || isNonWorking(c.values);

BpcMetrics _m(EntryLineContext c) {
  final m = c.metrics;
  return m is BpcMetrics ? m : BpcMetrics(c.values);
}

/// Decimal hours as the sheet shows them: "6.75 hr".
String _hrs(Object? v) => isNum(v) ? '${fmtNum(v)} hr' : '';

/// Date, Operator, Working Status (+ the reasons of a Non Working day).
Widget dateOperatorStatusLine(EntryLineContext c) {
  final nonWorking = isNonWorking(c.values);
  final statusOnly = _statusOnly(c);
  final s = c.theme.colorScheme;
  final mode = c.text('workingMode').isEmpty ? 'Working' : c.text('workingMode');
  return EntryLineCard(
    title: 'Date, Operator, Working Status',
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
            label: 'Operator',
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
                // This sheet has a B.D. (Breakdown) column, so Machine Breakdown stays on offer.
                MachineStatusSelect(
                  index: c.index,
                  ticked: machineStatusList(c.values),
                  remark: c.text('remarks'),
                  onChanged: (list) => c.set('machineStatus', list),
                  // "Remarks" opens the (folded) Reason/Remarks section and puts the cursor in it.
                  onOpenRemarks: () => c.focusField('remarks'),
                ),
              ),
            ),
        ],
      ),
      if (statusOnly)
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
                        text: ' — no work that day, so only Date, Operator and Working Status are saved (and Reason/Remarks, if filled in).',
                      ),
                    ],
            ),
          ),
        ),
    ],
  );
}

/// The vendors Vendor Master ticks for this page's process (`processVendors`,
/// utils/vendorsFor.js) — page-level on the web, so any operator of the page
/// carries the process (a deactivated operator stub of an edited entry doesn't).
List<Map<String, dynamic>> bpcVendors(EntryLineContext c) {
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
/// already names one), Standard Time per Piece.
Widget itemLine(EntryLineContext c) {
  final m = _m(c);
  final vendors = bpcVendors(c);
  final showVendor = vendors.isNotEmpty || c.text('vendor').isNotEmpty;
  final partCycle = m.partCycle(c.items);
  final cycleErr = c.err('totalCycleSec');
  return EntryLineCard(
    title: 'Item Name, Standard Time per Piece',
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
                // Web `partCycleLabel`: "Body — 27 sec"; an old record's own name
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
            label: 'Standard Time per Piece (Sec)',
            required: true,
            error: cycleErr,
            // Filled in from the Part when picked; today's may differ.
            hint: cycleErr == null && partCycle != null && jsToNumber(c.values['totalCycleSec']) != partCycle
                ? "Part's usual: ${fmtNum(partCycle)} sec"
                : null,
            span: EntryCell.full,
            child: c.keyed(
              'totalCycleSec',
              c.numBox('totalCycleSec', decimals: true, label: 'Standard Time per Piece (Sec)'),
            ),
          ),
        ],
      ),
    ],
  );
}

/// Machine ON / OFF Time and the Machine Shift Time they make.
Widget machineTimeLine(EntryLineContext c) {
  final shift = c.metrics.calc['shiftHours'];
  return EntryLineCard(
    title: 'Machine ON – OFF Time, Machine Shift Time',
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
              isNum(shift) ? '${_hrs(shift)} (${hoursToHm(shift)})' : '',
              'Machine Shift Time (Hours)',
            ),
          ),
        ],
      ),
      if (c.booked.isNotEmpty)
        EntryHintText('Already booked for this operator on this date: ${c.booked.join(', ')} — pick a time outside it.'),
    ],
  );
}

/// The Production Master in the sheet's words — TOTAL QTY / OK QTY typed,
/// Rejected QTY derived, TOTAL not capped at Ideal (over-Ideal goes to OEE
/// Review) — and the grey Ideal Quantity, Ideal Quantity/Hours and Effective
/// Machine Run Time under them.
Widget bpcQuantityLine(EntryLineContext c) {
  final calc = c.metrics.calc;
  return quantityLine(
    c,
    labels: bpcQtyLabels,
    capByIdeal: false,
    words: bpcWords,
    moreCells: [
      EntryCell(label: 'Ideal Quantity', child: c.calcBox('idealQty', fmtNum(calc['idealQty']), 'Ideal Quantity')),
      EntryCell(
        label: 'Ideal Quantity/Hours',
        child: c.calcBox('idealQtyPerHour', fmtNum(calc['idealQtyPerHour']), 'Ideal Quantity/Hours'),
      ),
      EntryCell(
        label: 'Effective Machine Run Time',
        child: c.calcBox('effectiveHours', _hrs(calc['effectiveHours']), 'Effective Machine Run Time'),
      ),
    ],
  );
}

bool _filled(Object? v) => v is List ? v.isNotEmpty : (v != null && v != '');

/// The web's FormLine `hasValue`: any of [keys] holds something.
bool _anyFilled(EntryLineContext c, List<String> keys) => keys.any((k) => _filled(c.values[k]));

/// An idle box: capped to what the Machine Shift Time still allows. Typing past
/// it raises the web's stoppage popup in the operator's words (`minutesBox` in
/// BpcEntryForm.jsx); before the times are in it is the one-day toast.
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
      final own = jsToNumber(c.values[field]);
      final others = m.totalStoppage - (own.isNaN ? 0 : own);
      c.notice(stoppageNotice(limitMin: limit, totalMin: others + typed, words: bpcWords));
    },
  );
}

/// Planned Operator Shift (hours), Lunch / Tea / Washroom and the minutes allowed.
/// Optional and folded — open from the start while the shift is typed by hand,
/// folded to "Shift fixed — Lunch / Tea optional" while Process Master locks it.
Widget plannedShiftLine(EntryLineContext c) {
  final m = _m(c);
  final limit = m.stoppageLimit;
  final planned = m.plannedHours;
  final shiftHm = hoursToHm(m.machineShiftMin == null ? null : m.machineShiftMin! / 60);
  // Web: not while OFF isn't after ON — that "shift" wraps past midnight and the
  // OFF box already says what's wrong.
  final endBeforeStart = (c.errors['machineOffTime'] ?? '').contains(' Time must be after ');
  // Process Master's setting for this operator's process: the box is read-only
  // and says why.
  final setting = c.plannedShift;
  final lockNote = setting == null ? null : plannedShiftReason(setting, hoursToHm(setting.hours));
  final plannedHint = [
    if (c.err('plannedOperatorShiftHours') == null)
      m.plannedBelowMachine && !endBeforeStart
          ? "Can't be less than the Machine Shift Time ($shiftHm)."
          : planned != null
              ? '= ${hoursToHm(planned)} hr'
              : "Type hours — 6.75 is 6 h 45 min. The same as the Machine Shift Time gives the sheet's own figures.",
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
            label: 'Lunch / Tea / Washroom etc (Min)',
            error: c.err('lunchMin'),
            child: c.keyed('lunchMin', _minutesBox(c, 'lunchMin', 'Lunch / Tea / Washroom etc (Min)')),
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

/// Setup / B.D. (Breakdown) / Other idle minutes, the running Total Idle Time
/// (Lunch / Tea included) against the Machine Shift Time, and the Other remark.
Widget idleLine(EntryLineContext c) {
  final m = _m(c);
  final s = c.theme.colorScheme;
  final limit = m.stoppageLimit;
  final over = m.overStoppage;
  final totalText = fmtNum(m.totalStoppage);
  final err = c.err('stoppageTotal');
  return EntryLineCard(
    title: 'Idle Time (min)',
    icon: Icons.pause_circle_outline_rounded,
    hasError: c.lineHasError(_line8),
    optional: true,
    // The running total (stoppageTotal) is not something typed.
    hasValue: _anyFilled(c, [for (final k in _line8) if (k != 'stoppageTotal') k]),
    children: [
      EntryGrid(
        maxCols: 3,
        cells: [
          for (final (key, label) in _idleBoxes)
            EntryCell(
              label: label,
              error: c.err(key),
              child: c.keyed(key, _minutesBox(c, key, label)),
            ),
        ],
      ),
      const SizedBox(height: 10),
      // All idle time, Lunch / Tea included, has to fit in the Machine Shift
      // Time, so the running total sits next to that allowance.
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
                  TextSpan(text: 'Total Idle Time (with Lunch / Tea): ', style: TextStyle(color: s.onSurfaceVariant)),
                  TextSpan(
                    text: '${totalText.isEmpty ? '0' : totalText} min',
                    style: TextStyle(fontWeight: FontWeight.w700, color: over ? s.error : null),
                  ),
                  TextSpan(
                    text: limit == null
                        ? ' — enter Machine ON / OFF Time to see the allowance'
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
      if (m.otherIdleUsed) ...[
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

/// Reason/Remarks (optional, folded). The Reasons list's "Remarks" tick opens it
/// and puts the cursor in the box.
Widget bpcRemarksLine(EntryLineContext c) => EntryLineCard(
      title: 'Reason/Remarks',
      icon: Icons.notes_rounded,
      hasError: c.lineHasError(_line12),
      optional: true,
      hasValue: _anyFilled(c, _line12),
      revealKey: 'entry${c.index}/remarks',
      children: [
        EntryGrid(
          cells: [
            // Web: the same words as the line title, over a plain textarea (no placeholder).
            EntryCell(
              label: 'Reason/Remarks',
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
                  semanticsLabel: 'Reason/Remarks',
                  onChanged: (t) => c.set('remarks', t),
                ),
              ),
            ),
          ],
        ),
      ],
    );
