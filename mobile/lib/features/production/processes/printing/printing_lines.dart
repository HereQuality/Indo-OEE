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
import '../../shared/limit_notice.dart' show printingWords, qtyNotice, stoppageNotice;
import '../../shared/planned_shift.dart' show plannedShiftReason;
import '../../shared/production_sheet_calc.dart';
import '../../shared/shift_hours.dart';
import '../../shared/vendors.dart';
import 'printing_calc.dart';
import 'printing_metrics.dart';

const List<String> _line1 = ['date', 'machine', 'workingMode', 'machineStatus'];
const List<String> _line2 = ['mcMachine', 'itemName', 'vendor', 'totalCycleSec'];
const List<String> _line3 = ['machineOnTime', 'machineOffTime'];
const List<String> _line5 = ['actualQty', 'okQty'];
const List<String> _line7 = ['plannedOperatorShiftHours'];
final List<String> _line8 = [...printingStoppageKeys, 'stoppageTotal', 'otherMinRemark'];
const List<String> _line12 = ['remarks'];

/// The quantity boxes in the paper sheet's own words (web QTY_LABELS).
const String _actualLabel = 'TOTAL QTY';
const String _okLabel = 'OK QTY';
const String _rejectedLabel = 'Rejected QTY';

/// The PRINTING form (port of PrintingEntryForm.jsx), kept per OPERATOR: the
/// operator's id sits in `machine`. MC No. is optional (`mcMachine`); there is
/// no Rejection Master, only the free-text Reason/Remarks; thirteen downtime
/// boxes sit in one "Idle Time (min)" card in the sheet's order. A Non Working
/// day (or an older status-only one) hides every work card.
class PrintingEntryLines extends EntryLines {
  const PrintingEntryLines();

  @override
  List<Widget> left(EntryLineContext c) => [
        printingDateOperatorLine(c),
        if (!_statusOnly(c)) ...[
          printingItemLine(c),
          printingTimeLine(c),
          printingQtyLine(c),
        ],
      ];

  @override
  List<Widget> right(EntryLineContext c) => [
        if (!_statusOnly(c)) ...[
          printingShiftLine(c),
          printingIdleLine(c),
        ],
        printingRemarksLine(c),
      ];

  @override
  String collapsedSummary(Map<String, dynamic> v) => [
        if (entryText(v['itemName']).isNotEmpty) entryText(v['itemName']),
        if (entryText(v['actualQty']).isNotEmpty) '$_actualLabel ${entryText(v['actualQty'])}',
        if (entryText(v['okQty']).isNotEmpty) '$_okLabel ${entryText(v['okQty'])}',
      ].join(' · ');
}

bool _statusOnly(EntryLineContext c) => isStatusOnly(c.values) || isNonWorking(c.values);

PrintingMetrics _m(EntryLineContext c) {
  final m = c.metrics;
  return m is PrintingMetrics ? m : PrintingMetrics(c.values);
}

/// Decimal hours as the sheet writes them, with the clock reading beside:
/// "7.75 hr (7:45)" (web `hoursText`).
String printingHoursText(Object? h) => isNum(h) ? '${fmtNum(h)} hr (${hoursToHm(h)})' : '';

bool _filled(Object? v) => v is List ? v.isNotEmpty : (v != null && v != '');

bool _anyFilled(EntryLineContext c, List<String> keys) => keys.any((k) => _filled(c.values[k]));

/// Line 1 — Date, Operator, Working Status (+ the reasons of a Non Working day).
Widget printingDateOperatorLine(EntryLineContext c) {
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
                  // "Remarks" opens the (folded) Remarks section and puts the cursor in it.
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
                      TextSpan(
                        text:
                            ' — no work that day (W.OFF and the like), so nothing else is needed. Pick a reason or add a remark if you like and press Save.',
                      ),
                    ]
                  : [
                      TextSpan(text: c.text('workingStatus'), style: const TextStyle(fontWeight: FontWeight.w700)),
                      const TextSpan(
                        text: ' — no work that day, so only Date, Operator and Working Status are saved (and Remarks, if filled in).',
                      ),
                    ],
            ),
          ),
        ),
    ],
  );
}

/// The id of the process this page's operators belong to (each operator stands
/// in as a "machine" of it — see PrintingSpec.scopeMachines); null while the
/// page is not linked to a process.
Object? _pageProcess(EntryLineContext c) {
  for (final m in c.machines) {
    final p = m['process'];
    if (p != null && '$p'.isNotEmpty) return p;
  }
  return null;
}

/// MC No. choices: this process's active machines (every active machine while
/// the page isn't linked to a process yet), plus — on the entry that has it —
/// an MC No. no longer offered, by its saved name (web `formMachines`).
List<Map<String, dynamic>> printingMcMachines(EntryLineContext c) {
  String idOf(Object? v) => v is Map ? '${v['_id'] ?? ''}' : '${v ?? ''}';
  final pid = _pageProcess(c);
  final list = [
    for (final m in c.extra['machines'] ?? const <Map<String, dynamic>>[])
      if (m['isActive'] != false && (pid == null || idOf(m['process']) == '$pid')) m,
  ];
  final id = c.text('mcMachine');
  if (id.isNotEmpty && !list.any((m) => '${m['_id']}' == id)) {
    String? name;
    for (final m in c.extra['machines'] ?? const <Map<String, dynamic>>[]) {
      if ('${m['_id']}' == id) name = '${m['machineName'] ?? ''}';
    }
    final saved = c.text('mcName');
    list.add({'_id': id, 'machineName': (name != null && name.isNotEmpty) ? name : (saved.isNotEmpty ? saved : '—')});
  }
  return list;
}

/// The vendors Vendor Master ticks for this page's process (`processVendors`) —
/// page-level on the web, so any operator of the page carries the process.
List<Map<String, dynamic>> printingVendors(EntryLineContext c) =>
    vendorsForProcess(c.extra['vendors'] ?? const <Map<String, dynamic>>[], _pageProcess(c));

/// Line 2 — MC No. (optional), Item Name, Vendor Name (only when this process
/// has vendors — or the entry already names one), Standard Time per Piece.
Widget printingItemLine(EntryLineContext c) {
  final vendors = printingVendors(c);
  final showVendor = vendors.isNotEmpty || c.text('vendor').isNotEmpty;
  final machines = printingMcMachines(c);
  final mcId = c.text('mcMachine');
  var mcName = '';
  for (final m in machines) {
    if ('${m['_id']}' == mcId) mcName = '${m['machineName'] ?? ''}';
  }
  final item = entryItemFor(c.values, c.items);
  final partCycle = () {
    final n = item?['totalCycleSec'];
    if (n == null || n == '') return null;
    final d = jsNumber(n);
    return (d == null || !d.isFinite) ? null : d;
  }();
  final cycleErr = c.err('totalCycleSec');
  return EntryLineCard(
    title: 'MC No., Item Name, Standard Time per Piece',
    icon: Icons.inventory_2_outlined,
    hasError: c.lineHasError(_line2),
    children: [
      EntryGrid(
        cells: [
          EntryCell(
            label: 'MC No.',
            error: c.err('mcMachine'),
            child: c.keyed(
              'mcMachine',
              EntryPickerBox(
                key: ValueKey('entry${c.index}/mcMachine'),
                text: mcName,
                hint: '— None —',
                focusNode: c.nodeFor('mcMachine'),
                semanticsLabel: 'MC No.',
                onTap: () async {
                  final r = await showPicker<String>(
                    c.buildContext,
                    title: 'MC No.',
                    options: [
                      const PickOption<String>('', '— None —'),
                      for (final m in machines) PickOption<String>('${m['_id']}', '${m['machineName'] ?? ''}'),
                    ],
                    selected: mcId,
                  );
                  if (r == null) return;
                  HapticFeedback.selectionClick();
                  c.set('mcMachine', r.value ?? '');
                },
              ),
            ),
          ),
          EntryCell(
            label: 'Item Name',
            required: true,
            error: c.err('itemName'),
            span: EntryCell.full,
            child: c.keyed(
              'itemName',
              EntryPickerBox(
                key: ValueKey('entry${c.index}/itemName'),
                // Web `partCycleLabel`: "Label 40 — 7 sec"; an old record's own name
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
            label: 'Standard Time per Piece (in Sec)',
            required: true,
            error: cycleErr,
            // Filled in from the Part when picked; today's may differ.
            hint: cycleErr == null && partCycle != null && jsToNumber(c.values['totalCycleSec']) != partCycle
                ? "Part's usual: ${fmtNum(partCycle)} sec"
                : null,
            child: c.keyed(
              'totalCycleSec',
              c.numBox('totalCycleSec', decimals: true, invalid: cycleErr != null, label: 'Standard Time per Piece (in Sec)'),
            ),
          ),
        ],
      ),
    ],
  );
}

/// Line 3 — Machine ON / OFF Time and the Machine Shift Time they make; what the
/// operator already has on the date (overlap is fine on this sheet).
Widget printingTimeLine(EntryLineContext c) {
  final s = c.theme.colorScheme;
  final m = _m(c);
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
            child: c.calcBox('shiftHours', printingHoursText(m.shiftHours), 'Machine Shift Time (Hours)'),
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
                const TextSpan(text: 'Already entered for this operator on this date: '),
                TextSpan(text: c.booked.join(', '), style: const TextStyle(fontWeight: FontWeight.w700)),
                const TextSpan(text: ' — overlapping times are fine on this sheet.'),
              ],
            ),
          ),
        ),
    ],
  );
}

/// Line 5 — Production Master: TOTAL QTY (capped at the Ideal Quantity rounded
/// down, the popup explaining it), OK QTY (not more than TOTAL), Rejected QTY,
/// then the sheet's grey figures and the over-100% banner.
Widget printingQtyLine(EntryLineContext c) {
  final m = _m(c);
  final calc = m.calc;
  final ideal = m.idealQty;
  return EntryLineCard(
    title: 'Production Master',
    icon: Icons.inventory_outlined,
    hasError: c.lineHasError(_line5),
    children: [
      EntryGrid(
        maxCols: 3,
        cells: [
          EntryCell(
            label: _actualLabel,
            required: true,
            error: c.err('actualQty'),
            child: c.keyed(
              'actualQty',
              c.numBox(
                'actualQty',
                max: ideal,
                label: _actualLabel,
                onExceedTyped: c.onLimit(
                  (typed) => qtyNotice(calc: calc, entered: typed, label: _actualLabel, words: printingWords),
                  (max) => "$_actualLabel can't be more than Ideal Quantity (${fmtNum(max)})",
                ),
              ),
            ),
          ),
          EntryCell(
            label: _okLabel,
            required: true,
            error: c.err('okQty'),
            child: c.keyed(
              'okQty',
              c.numBox(
                'okQty',
                max: m.okMax,
                label: _okLabel,
                onExceed: (max) => EntryFormToast.warn("$_okLabel can't be more than $_actualLabel (${fmtNum(max)})"),
              ),
            ),
          ),
          EntryCell(
            label: _rejectedLabel,
            child: c.calcBox('rejectedQty', fmtNum(calc['rejectedQty']), _rejectedLabel),
          ),
        ],
      ),
      const SizedBox(height: 10),
      EntryGrid(
        cells: [
          EntryCell(
            label: 'Ok Quantity (%)',
            child: c.calcBox('pctOk', fmtPct(calc['pctOk']), 'Ok Quantity (%)'),
          ),
          EntryCell(
            label: 'Effective Machine Run Time',
            child: c.calcBox('effectiveHours', printingHoursText(calc['effectiveHours']), 'Effective Machine Run Time'),
          ),
          EntryCell(
            label: 'Ideal Quantity',
            child: c.calcBox('idealQtyExact', fmtNum(calc['idealQtyExact']), 'Ideal Quantity'),
          ),
          EntryCell(
            label: 'Ideal Quantity/Hours',
            child: c.calcBox('idealQtyPerHour', fmtNum(calc['idealQtyPerHour']), 'Ideal Quantity/Hours'),
          ),
        ],
      ),
      // Availability / Performance / Quality above 100% -> goes to Admin review (OeeCheck.jsx).
      oeeCheck(c),
    ],
  );
}

/// Line 7 — Planned Operator Shift (decimal hours as on the sheet, read-only
/// with its reason while Process Master fixes it), the Idle Time it allows and
/// the Total Idle Time.
Widget printingShiftLine(EntryLineContext c) {
  final m = _m(c);
  final s = c.theme.colorScheme;
  final limit = m.stoppageLimit;
  final planned = m.plannedHours;
  final shiftMin = m.shiftHours == null ? null : jsRound(m.shiftHours! * 60);
  // Not while OFF isn't after ON — that "shift" wraps past midnight, and the
  // OFF box already says what's wrong.
  final endBeforeStart = (c.errors['machineOffTime'] ?? '').contains(' Time must be after ');
  final below = !endBeforeStart && planned != null && shiftMin != null && jsRound(planned * 60) < shiftMin;
  final setting = c.plannedShift;
  final err = c.err('plannedOperatorShiftHours');
  final stoppageText = fmtNum(m.totalStoppage);
  return EntryLineCard(
    title: 'Planned Operator Shift',
    icon: Icons.timelapse_rounded,
    hasError: c.lineHasError(_line7),
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
                            ? "Can't be less than the Machine Shift (${hoursToHm(shiftMin / 60)})."
                            : planned != null
                                ? '= ${hoursToHm(planned)} hr'
                                : "Type hours as on the sheet — the Machine Shift Time gives the sheet's own figures.",
                        key: ValueKey('entry${c.index}/plannedHint'),
                        style: TextStyle(fontSize: 12, height: 1.3, color: below ? s.error : s.onSurfaceVariant),
                      ),
                    ),
                ],
              ),
            ),
          ),
          EntryCell(
            label: 'Idle Time Allowed (min)',
            child: c.calcBox('stoppageAllowed', limit == null ? '' : jsNumStr(limit), 'Idle Time Allowed (min)'),
          ),
          EntryCell(
            label: 'Total Idle Time (Min)',
            child: c.calcBox('totalStoppageMin', stoppageText.isEmpty ? '0' : stoppageText, 'Total Idle Time (Min)'),
          ),
        ],
      ),
    ],
  );
}

/// A downtime box: capped to what the Machine Shift Time still allows. Typing
/// past it raises the web's stoppage popup in this sheet's words (`minutesBox`
/// in PrintingEntryForm.jsx); before the times are in it is the one-day toast.
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
      final others = m.totalStoppage - ((own == null || own.isNaN) ? 0.0 : own);
      c.notice(stoppageNotice(limitMin: limit, totalMin: others + typed, words: printingWords));
    },
  );
}

/// Line 8 — Idle Time (min), optional: the thirteen downtime boxes in the
/// sheet's order, the running total against the Machine Shift Time, and the
/// "Other" remark once Other is used.
Widget printingIdleLine(EntryLineContext c) {
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
          for (final (key, label) in printingStoppageFields)
            EntryCell(
              label: label,
              error: c.err(key),
              child: c.keyed(key, _minutesBox(c, key, label)),
            ),
        ],
      ),
      const SizedBox(height: 10),
      // All downtime, Lunch / Tea included, has to fit in the Machine Shift
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
                  TextSpan(text: 'Total Idle Time: ', style: TextStyle(color: s.onSurfaceVariant)),
                  TextSpan(
                    text: '${totalText.isEmpty ? '0' : totalText} min',
                    style: TextStyle(fontWeight: FontWeight.w700, color: over ? s.error : null),
                  ),
                  TextSpan(
                    text: limit == null ? ' — enter Machine ON / OFF Time to see the allowance' : ' of ${jsNumStr(limit)} min allowed',
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

/// Line 12 — Reason/Remarks for Rejection/Rework (optional, folded). The
/// Reasons list's "Remarks" tick opens it and puts the cursor in the box.
Widget printingRemarksLine(EntryLineContext c) => EntryLineCard(
      title: 'Reason/Remarks for Rejection/Rework',
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
              label: 'Reason/Remarks for Rejection/Rework',
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
                  semanticsLabel: 'Reason/Remarks for Rejection/Rework',
                  onChanged: (t) => c.set('remarks', t),
                ),
              ),
            ),
          ],
        ),
      ],
    );
