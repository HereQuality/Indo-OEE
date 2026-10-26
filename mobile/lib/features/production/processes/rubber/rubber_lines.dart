import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/widgets/form_widgets.dart';
import '../../../../core/widgets/web_time_field.dart';
import '../../entry_form/common_lines.dart' show remarksLine;
import '../../entry_form/entry_fields.dart';
import '../../entry_form/entry_form_logic.dart';
import '../../entry_form/entry_form_toast.dart';
import '../../entry_form/entry_layout.dart';
import '../../entry_form/entry_line_context.dart';
import '../../entry_form/entry_number_input.dart';
import '../../entry_form/machine_status.dart';
import '../../entry_form/web_parity_lines.dart';
import '../../shared/limit_notice.dart' show rubberWords, stoppageNotice;
import '../../shared/planned_shift.dart' show plannedShiftReason;
import '../../shared/production_sheet_calc.dart';
import '../../shared/shift_hours.dart';
import '../../shared/vendors.dart';
import '../cnc/cnc_lines.dart' show rejectLine;
import '../powder_coating/powder_reasons.dart' show PowderReasonSelect;
import 'rubber_calc.dart';
import 'rubber_metrics.dart';

const List<String> _line1 = ['date', 'machine', 'workingMode', 'machineStatus'];
const List<String> _line2 = ['itemName', 'vendor', 'totalCycleSec'];
const List<String> _line3 = ['machineOnTime', 'machineOffTime'];
const List<String> _line5 = ['actualQty', 'okQty'];
const List<String> _line7 = ['plannedOperatorShiftHours', 'lunchMin'];

/// The stoppage boxes in their own card — every one but Lunch / Tea, which sits
/// beside Planned Operator Shift.
final List<(String, String)> _stoppageBoxes = [
  for (final f in rubberStoppageFields)
    if (f.$1 != 'lunchMin') f,
];
final List<String> _line8 = [for (final f in _stoppageBoxes) f.$1, 'stoppageTotal', 'otherMinRemark'];

/// The RUBBER form (port of RubberEntryForm.jsx), kept per WORKER instead of
/// per machine: the worker's id sits in `machine`. Its quantity cards are the
/// CNC form's Production Master (Actual not capped at IDEAL — over-Ideal goes
/// to OEE Review) and Rejection Master; its stoppage boxes the Spring form's,
/// less the two machine breakdowns. Any Working Status but PRESENT (or Non
/// Working) hides every work card.
class RubberEntryLines extends EntryLines {
  const RubberEntryLines();

  @override
  List<Widget> left(EntryLineContext c) => [
        rubberDateWorkerStatusLine(c),
        if (!_statusOnly(c)) ...[
          rubberPartLine(c),
          rubberTimeLine(c),
          rubberQuantityLine(c),
        ],
      ];

  // Web order: Production Master, Rejection Master, Planned Operator Shift,
  // Stoppage, Remarks.
  @override
  List<Widget> right(EntryLineContext c) => [
        if (!_statusOnly(c)) ...[
          rejectLine(c),
          rubberPlannedShiftLine(c),
          rubberStoppageLine(c),
        ],
        remarksLine(c),
      ];

  @override
  String collapsedSummary(Map<String, dynamic> v) => [
        if (entryText(v['itemName']).isNotEmpty) entryText(v['itemName']),
        if (entryText(v['actualQty']).isNotEmpty) 'Actual ${entryText(v['actualQty'])}',
        if (entryText(v['okQty']).isNotEmpty) 'OK ${entryText(v['okQty'])}',
      ].join(' · ');
}

bool _statusOnly(EntryLineContext c) => rubberIsStatusOnly(c.values) || isNonWorking(c.values);

RubberMetrics _m(EntryLineContext c) {
  final m = c.metrics;
  return m is RubberMetrics ? m : RubberMetrics(c.values);
}

/// Date, Worker Name, Working Status (+ the reasons of a Non Working day).
Widget rubberDateWorkerStatusLine(EntryLineContext c) {
  final nonWorking = isNonWorking(c.values);
  final statusOnly = _statusOnly(c);
  final s = c.theme.colorScheme;
  final mode = c.text('workingMode').isEmpty ? 'Working' : c.text('workingMode');
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
                // A worker has no machine to break down: the web's WORKER_STATUSES.
                PowderReasonSelect(
                  index: c.index,
                  ticked: machineStatusList(c.values),
                  remark: c.text('remarks'),
                  onChanged: (list) => c.set('machineStatus', list),
                  // "Remarks" opens the (folded) Remarks card and puts the cursor in it.
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
              style: TextStyle(fontSize: 12.5, height: 1.3, color: s.onSurfaceVariant),
              children: nonWorking
                  ? const [
                      TextSpan(text: 'Non Working', style: TextStyle(fontWeight: FontWeight.w700)),
                      TextSpan(text: ' — no work that day, so nothing else is needed. Pick a reason if you like and press Save.'),
                    ]
                  : [
                      TextSpan(text: c.text('workingStatus'), style: const TextStyle(fontWeight: FontWeight.w700)),
                      const TextSpan(
                        text: ' — no work that day, so only Date, Worker Name and Working Status are saved (and Remarks, if filled in).',
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
List<Map<String, dynamic>> rubberVendors(EntryLineContext c) {
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

/// Part Name, Vendor Name (only when this process has vendors — or the entry
/// already names one), Total Cycle Time.
Widget rubberPartLine(EntryLineContext c) {
  final vendors = rubberVendors(c);
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
    title: 'Part Name, Total Cycle Time',
    icon: Icons.inventory_2_outlined,
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
                // Web `partCycleLabel`: "Seal 40 — 60 sec"; an old record's own name
                // when the part is not in the live list.
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
            label: 'Total Cycle Time (Sec)',
            required: true,
            error: cycleErr,
            // Filled in from the Part when picked; today's may differ.
            hint: cycleErr == null && partCycle != null && cycleNow != partCycle ? "Part's usual: ${fmtNum(partCycle)} sec" : null,
            child: c.keyed(
              'totalCycleSec',
              c.numBox('totalCycleSec', decimals: true, label: 'Total Cycle Time (Sec)'),
            ),
          ),
        ],
      ),
    ],
  );
}

/// Working Start / End Time and the Worker Shift Time they make.
Widget rubberTimeLine(EntryLineContext c) {
  final shift = c.metrics.calc['shiftHours'];
  return EntryLineCard(
    title: 'Working Start – End Time, Worker Shift Time',
    icon: Icons.schedule_rounded,
    hasError: c.lineHasError(_line3),
    children: [
      EntryGrid(
        maxCols: 3,
        cells: [
          EntryCell(
            label: 'Working Start Time',
            required: true,
            error: c.err('machineOnTime'),
            child: c.keyed(
              'machineOnTime',
              WebTimeField(
                key: ValueKey('entry${c.index}/machineOnTime'),
                value: c.text('machineOnTime'),
                semanticsLabel: 'Working Start Time',
                invalid: c.err('machineOnTime') != null,
                focusNode: c.nodeFor('machineOnTime'),
                onChanged: (t) => c.set('machineOnTime', t),
              ),
            ),
          ),
          EntryCell(
            label: 'Working End Time',
            required: true,
            error: c.err('machineOffTime'),
            child: c.keyed(
              'machineOffTime',
              WebTimeField(
                key: ValueKey('entry${c.index}/machineOffTime'),
                value: c.text('machineOffTime'),
                semanticsLabel: 'Working End Time',
                // An End picker offers nothing at or before its Start time.
                minTime: c.offEarliest,
                invalid: c.err('machineOffTime') != null,
                focusNode: c.nodeFor('machineOffTime'),
                onChanged: (t) => c.set('machineOffTime', t),
              ),
            ),
          ),
          EntryCell(
            label: 'Worker Shift Time',
            child: c.calcBox('shiftHours', shift == null ? '' : '${hoursToHm(shift)} hr', 'Worker Shift Time'),
          ),
        ],
      ),
      if (c.booked.isNotEmpty)
        EntryHintText('Already booked for this worker on this date: ${c.booked.join(', ')} — pick a time outside it.'),
    ],
  );
}

/// The web's Production Master on this sheet (`ProductionMasterFields
/// capByIdeal={false}`): Actual Quantity and OK Quantity typed, Rejected grey,
/// then % OK Quantity, Effective working Time and the two IDEAL figures. Actual
/// is NOT capped at IDEAL Quantity — a person can beat the standard time, and
/// such an entry goes to OEE Review (the banner under the boxes says so).
Widget rubberQuantityLine(EntryLineContext c) {
  final m = _m(c);
  final calc = m.calc;
  final effective = calc['effectiveHours'];
  final pctOk = calc['pctOk'];
  return EntryLineCard(
    title: 'Production Master',
    icon: Icons.inventory_outlined,
    hasError: c.lineHasError(_line5),
    children: [
      EntryGrid(
        // The web's three boxes in one row where there is room (a tablet column).
        maxCols: 3,
        cells: [
          EntryCell(
            label: 'Actual Quantity',
            required: true,
            error: c.err('actualQty'),
            child: c.keyed('actualQty', c.numBox('actualQty', label: 'Actual Quantity')),
          ),
          EntryCell(
            label: 'OK Quantity',
            required: true,
            error: c.err('okQty'),
            // Phone-only: says why the box takes nothing (the web warns when you type).
            hint: c.locked('okQty', m.okMax) ? 'Actual Quantity is 0, so OK can only be 0.' : null,
            child: c.keyed(
              'okQty',
              c.numBox(
                'okQty',
                max: m.okMax,
                label: 'OK Quantity',
                onExceed: (max) => EntryFormToast.warn("OK Quantity can't be more than Actual Quantity (${fmtNum(max)})"),
              ),
            ),
          ),
          EntryCell(label: 'Rejected', child: c.calcBox('rejectedQty', entryFmt(calc['rejectedQty']), 'Rejected')),
        ],
      ),
      const SizedBox(height: 10),
      EntryGrid(
        cells: [
          EntryCell(
            label: '% OK Quantity',
            child: c.calcBox('pctOk', pctOk == null ? '' : fmtPct(pctOk), '% OK Quantity'),
          ),
          EntryCell(
            label: 'Effective working Time',
            child: c.calcBox('effectiveHours', effective == null ? '' : '${hoursToHm(effective)} hr', 'Effective working Time'),
          ),
          EntryCell(
            label: 'IDEAL Quantity',
            child: c.calcBox('idealQty', entryFmt(calc['idealQty']), 'IDEAL Quantity'),
          ),
          EntryCell(
            label: 'IDEAL Quantity / Hour',
            child: c.calcBox('idealQtyPerHour', entryFmt(calc['idealQtyPerHour']), 'IDEAL Quantity / Hour'),
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

/// A stoppage box (Lunch / Tea and the Stoppage card's seven): capped to what
/// the Worker Shift Time still allows. Typing past it raises the web's stoppage
/// popup in RUBBER's words (`minutesBox` in RubberEntryForm.jsx); before the
/// times are in it is the one-day toast.
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
      final mine = jsNumber(c.values[field]);
      final others = m.totalStoppage - ((mine == null || mine.isNaN) ? 0 : mine);
      c.notice(stoppageNotice(limitMin: limit, totalMin: others + typed, words: rubberWords));
    },
  );
}

/// Planned Operator Shift (hours), Lunch / Tea / Washroom and the stoppage
/// allowed. Optional and folded — open from the start while the shift is typed
/// by hand, folded to "Shift fixed — Lunch / Tea optional" while Process Master
/// locks it.
Widget rubberPlannedShiftLine(EntryLineContext c) {
  final m = c.metrics;
  final limit = m.stoppageLimit;
  final planned = m.plannedHours;
  final workingHm = hoursToHm(m.machineShiftMin == null ? null : m.machineShiftMin! / 60);
  // Process Master's setting for this worker's process: the box is read-only
  // and says why.
  final setting = c.plannedShift;
  final lockNote = setting == null ? null : plannedShiftReason(setting, hoursToHm(setting.hours));
  // Web: not while End isn't after Start — that "shift" wraps past midnight, and
  // the End box already says what's wrong.
  final endBeforeStart = (c.errors['machineOffTime'] ?? '').contains(' Time must be after ');
  final plannedHint = [
    if (c.err('plannedOperatorShiftHours') == null)
      m.plannedBelowMachine && !endBeforeStart
          ? "Can't be less than the Worker Shift Time ($workingHm)."
          : planned != null
              ? '= ${hoursToHm(planned)} hr'
              : 'Type hours as on the sheet — 3.5 is 3 h 30 min.',
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
            label: 'Lunch / Tea / Washroom (min)',
            error: c.err('lunchMin'),
            child: c.keyed('lunchMin', _minutesBox(c, 'lunchMin', 'Lunch / Tea / Washroom (min)')),
          ),
          EntryCell(
            label: 'Stoppage Allowed (min)',
            child: c.calcBox('stoppageAllowed', limit == null ? '' : jsNumStr(limit), 'Stoppage Allowed (min)'),
          ),
        ],
      ),
    ],
  );
}

/// The stoppage boxes (every one but Lunch / Tea), the running total — Lunch /
/// Tea included — against the Worker Shift Time, and the Others remark.
Widget rubberStoppageLine(EntryLineContext c) {
  final m = _m(c);
  final s = c.theme.colorScheme;
  final limit = m.stoppageLimit;
  final totalText = fmtNum(m.totalStoppage);
  final err = c.err('stoppageTotal');
  return EntryLineCard(
    title: 'Stoppage (min)',
    icon: Icons.pause_circle_outline_rounded,
    hasError: c.lineHasError(_line8),
    optional: true,
    // The running total (stoppageTotal) is not something typed.
    hasValue: _anyFilled(c, [for (final f in _stoppageBoxes) f.$1, 'otherMinRemark']),
    children: [
      EntryGrid(
        cells: [
          for (final (key, label) in _stoppageBoxes)
            EntryCell(
              label: label,
              error: c.err(key),
              child: c.keyed(key, _minutesBox(c, key, label)),
            ),
        ],
      ),
      const SizedBox(height: 10),
      // All stoppage, Lunch / Tea included, has to fit in the Worker Shift Time,
      // so the running total sits next to that allowance.
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
                  TextSpan(text: 'Total stoppage (with Lunch / Tea): ', style: TextStyle(color: s.onSurfaceVariant)),
                  TextSpan(
                    text: '${totalText.isEmpty ? '0' : totalText} min',
                    style: TextStyle(fontWeight: FontWeight.w700, color: m.overStoppage ? s.error : null),
                  ),
                  TextSpan(
                    text: limit == null
                        ? ' — enter Working Start / End Time to see the allowance'
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
              label: 'Remark for Others stoppage',
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
                  hint: 'What was the “Others” stoppage?',
                  invalid: c.err('otherMinRemark') != null,
                  focusNode: c.nodeFor('otherMinRemark'),
                  semanticsLabel: 'Remark for Others stoppage',
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
