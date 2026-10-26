import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/form_widgets.dart';
import '../shared/limit_notice.dart' show adminReviewText;
import '../shared/production_sheet_calc.dart' show oeeMetricLabels;
import '../shared/vendors.dart';
import 'entry_fields.dart';
import 'entry_form_logic.dart';
import 'entry_layout.dart';
import 'entry_line_context.dart';

// Shared pieces of the web forms that only some sheets have, as small cards /
// cells a process's `EntryLines` drops into its own cards:
//
//   vendorCell(c)      Vendor Name picker  (VendorSelect.jsx + vendorsFor.js)
//   partBoxText(c)     what the Part Name box reads (partCycleLabel: "Name — 60 sec")
//   oeeCheck(c)        the "above 100% … goes to Admin review" banner (OeeCheck.jsx)
//
// The Machine Working Status lives in `machine_status.dart`, the planned-shift
// lock in `shiftLine`, the limit popups in `EntryLineContext.notice/limitHit`.

/// The vendors this block's machine's process offers (Vendor Master, active,
/// ticked for the process) — from `c.extra['vendors']`, which the list loads for
/// a spec with `usesVendors`.
List<Map<String, dynamic>> blockVendors(EntryLineContext c) =>
    vendorsForMachine(c.extra['vendors'] ?? const [], c.machines, c.text('machine'));

/// The web's `showVendor`: the process has vendors, or the entry already names one
/// (so editing never hides it).
bool showVendorFor(EntryLineContext c) => blockVendors(c).isNotEmpty || c.text('vendor').isNotEmpty;

/// What the Part Name box shows once a part is picked — the web's
/// `partCycleLabel` (`SearchablePartSelect label=`): "Flange 40 — 60 sec", the
/// name alone when the part has no usable Total Cycle Time (never "— null sec"),
/// and the entry's own saved name when the part is not in the live list (an old
/// record). Pass [withCycle] false for a form whose web picker has no `label`
/// (Press shows the bare name).
String partBoxText(EntryLineContext c, {bool withCycle = true}) {
  final saved = c.text('itemName');
  if (!withCycle) return saved;
  final item = entryItemFor(c.values, c.items);
  if (item == null) return saved;
  final name = entryText(item['itemName']);
  final raw = item['totalCycleSec'];
  final cycle = (raw == null || raw == '') ? null : entryNum(raw);
  return cycle == null ? name : '$name — ${entryFmt(cycle)} sec';
}

/// The Vendor Name picker cell, or null while the box is not shown (no vendors
/// for the process and none on the entry). Put it in the Part card's grid:
/// `EntryGrid(cells: [partCell, ?vendorCell(c), …])`. Picking writes `vendor`
/// (the id) only — the server derives `vendorName`, like the web; a vendor no
/// longer in the live list still shows by its saved `vendorName`.
EntryCell? vendorCell(EntryLineContext c) {
  if (!showVendorFor(c)) return null;
  final vendors = blockVendors(c);
  final id = c.text('vendor');
  return EntryCell(
    label: 'Vendor Name',
    error: c.err('vendor'),
    span: EntryCell.full,
    child: c.keyed(
      'vendor',
      EntryPickerBox(
        key: ValueKey('entry${c.index}/vendor'),
        text: vendorLabelFor(vendors, id, c.text('vendorName')),
        hint: 'Select vendor',
        invalid: c.err('vendor') != null,
        focusNode: c.nodeFor('vendor'),
        semanticsLabel: 'Vendor Name',
        onTap: () => pickVendor(c),
      ),
    ),
  );
}

/// Opens the vendor list (searchable, clearable) and writes the choice.
Future<void> pickVendor(EntryLineContext c) async {
  final ctx = c.buildContext;
  if (!ctx.mounted) return;
  final vendors = blockVendors(c);
  final id = c.text('vendor');
  final r = await showPicker<String>(
    ctx,
    title: 'Vendor Name',
    options: [for (final v in vendors) PickOption<String>('${v['_id']}', '${v['name'] ?? ''}')],
    selected: id.isEmpty ? null : id,
    allowClear: true,
  );
  if (r == null) return;
  HapticFeedback.selectionClick();
  c.set('vendor', r.value ?? '');
}

/// The live warning under the quantities when this entry's Availability /
/// Performance / Quality — as Save will work them out — goes above 100%: the
/// entry still saves, but is held for Admin review. Empty while all are fine.
Widget oeeCheck(EntryLineContext c) {
  final over = c.metrics.oeeOver100;
  if (over.isEmpty) return SizedBox.shrink(key: ValueKey('entry${c.index}/oeeCheck/none'));
  final amber = AppColors.readable(c.buildContext, AppColors.warn);
  final s = c.theme.colorScheme;
  return Container(
    key: ValueKey('entry${c.index}/oeeCheck'),
    margin: const EdgeInsets.only(top: 8),
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
    decoration: BoxDecoration(
      color: AppColors.warn.withValues(alpha: 0.14),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 1),
          child: Icon(Icons.warning_amber_rounded, size: 18, color: amber),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            adminReviewText([for (final k in over) oeeMetricLabels[k] ?? k]),
            style: TextStyle(fontSize: 12.5, height: 1.35, color: s.onSurface),
          ),
        ),
      ],
    ),
  );
}
