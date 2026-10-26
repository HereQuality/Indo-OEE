import 'package:flutter/material.dart';

import '../shared/limit_notice.dart';
import '../shared/planned_shift.dart' show ShiftSetting;
import '../shared/production_entry_validation.dart' show isLiveMessage;
import '../shared/production_sheet_calc.dart' show normalizeTime;
import 'entry_fields.dart';
import 'entry_layout.dart' show EntryLineCard;
import 'entry_form_logic.dart';
import 'entry_form_toast.dart';
import 'entry_notice_dialog.dart';
import 'entry_number_input.dart';

/// The cards of one open machine block, as a process composes them. The form
/// lays them out — the left list then the right list is also the order "next"
/// walks the boxes; a narrow screen stacks left then right, from 700 px wide
/// they sit in two columns. Build each card with the shared lines in
/// `common_lines.dart` and/or your own, from the [EntryLineContext].
abstract class EntryLines {
  const EntryLines();

  List<Widget> left(EntryLineContext c);
  List<Widget> right(EntryLineContext c);

  /// The one-line summary a collapsed block shows under its status
  /// ("Flange 40 · Actual 400 · OK 390"); '' when there is nothing to say.
  String collapsedSummary(Map<String, dynamic> values);
}

/// What a line needs from the block it sits in: the block's values / errors,
/// the master lists, and the small helpers every card uses (a typed number box,
/// a grey calculated box, the error lookup, the setter, the keys and focus nodes
/// a failed Save scrolls to). Built by `EntryBlock` on every (non-cached) build;
/// lines never keep it.
class EntryLineContext {
  EntryLineContext({
    required this.buildContext,
    required this.index,
    required this.values,
    required this.errors,
    required this.isSubmit,
    required this.isEdit,
    required this.booked,
    required this.machines,
    required this.items,
    required this.operators,
    required this.extra,
    required this.metrics,
    required this.onChange,
    required this.onItemSelect,
    required this.onRejectChange,
    required this.keyFor,
    required this.nodeFor,
    required this.pickOperator,
    required this.pickItem,
    required this.machineBox,
    this.plannedShift,
    this.popups = false,
  });

  /// The Planned Operator Shift Process Master sets for this block's machine
  /// (null = typed by hand): `shiftLine` fills/locks its box from it. Only
  /// non-null for a spec with `usesPlannedShiftSetting`.
  final ShiftSetting? plannedShift;

  /// The spec's `showLimitPopups`: limit hits raise the web's popup (with the
  /// figures) instead of a toast.
  final bool popups;

  /// For Theme / MediaQuery lookups while building a card.
  final BuildContext buildContext;

  /// Block number in the form (0-based) — part of every widget key
  /// (`entry$index/<field>`), so tests and focus find them.
  final int index;
  final Map<String, dynamic> values;
  final Map<String, String> errors;

  /// True once Save has been pressed: errors show then (time rules always).
  final bool isSubmit;
  final bool isEdit;

  /// What this block's machine already has saved on its date, as ranges.
  final List<String> booked;
  final List<Map<String, dynamic>> machines;
  final List<Map<String, dynamic>> items;
  final List<Map<String, dynamic>> operators;

  /// The spec's `extraReference` lists by name.
  final Map<String, List<Map<String, dynamic>>> extra;

  /// The spec's [EntryMetrics] for [values] (calc + caps).
  final EntryMetrics metrics;

  final void Function(int index, String name, dynamic value) onChange;
  final void Function(int index, String itemId) onItemSelect;
  final void Function(int index, String reason, dynamic value) onRejectChange;

  /// The key / focus node of a field — what Save scrolls to and focuses.
  final GlobalKey Function(String field) keyFor;
  final FocusNode Function(String field) nodeFor;

  final Future<void> Function() pickOperator;
  final Future<void> Function() pickItem;

  /// The machine picker box ([enabled] false = locked while editing).
  final Widget Function({required bool enabled}) machineBox;

  // ── helpers ───────────────────────────────────────────────────────────────

  Map<String, dynamic> get v => values;
  ThemeData get theme => Theme.of(buildContext);

  /// A stored value as the text a box shows.
  String text(String field) => entryText(values[field]);

  /// [field]'s error message as it should show right now: the live ones (the
  /// time rules, a full date — web `isLiveMessage`) at once, everything else
  /// only after Save was pressed.
  String? err(String field) {
    final e = errors[field];
    if (e == null || e.isEmpty) return null;
    return (isSubmit || isLiveMessage(e)) ? e : null;
  }

  /// Whether any of [fields] has an error to show ("Check this line").
  bool lineHasError(List<String> fields) =>
      isSubmit && fields.any((f) => (errors[f] ?? '').isNotEmpty);

  /// The web FormLine's `filled`: whether any of [fields] holds something
  /// (text, a non-empty list, or a map with a non-blank entry).
  bool anyFilled(List<String> fields) => fields.any((f) {
    final v = values[f];
    if (v is List) return v.isNotEmpty;
    if (v is Map) return v.values.any((n) => n != null && '$n' != '');
    return v != null && '$v' != '';
  });

  void set(String name, dynamic value) => onChange(index, name, value);

  /// Wraps [child] so a failed Save can scroll to [field].
  Widget keyed(String field, Widget child) =>
      KeyedSubtree(key: keyFor(field), child: child);

  String get machineName {
    final id = text('machine');
    for (final m in machines) {
      if ('${m['_id']}' == id) return '${m['machineName'] ?? ''}';
    }
    return '';
  }

  /// The typed-number box every numeric field shares.
  Widget numBox(
    String field, {
    bool decimals = false,
    double? max,
    void Function(double max)? onExceed,
    bool? invalid,
    FocusNode? node,
    String? label,
    int maxLength = 7,
    void Function(double max, double typed)? onExceedTyped,
    bool enabled = true,
  }) => EntryTextField(
    key: ValueKey('entry$index/$field'),
    value: text(field),
    numeric: true,
    decimals: decimals,
    maxLength: maxLength,
    max: max,
    onExceedMax: onExceed,
    onExceedTyped: onExceedTyped,
    enabled: enabled,
    invalid: invalid ?? err(field) != null,
    focusNode: node ?? nodeFor(field),
    semanticsLabel: label,
    onChanged: (t) => set(field, t),
  );

  /// A downtime box: capped to what the planned shift still allows.
  ///
  /// With [popups] (the spec's `showLimitPopups`) a keystroke past the Machine
  /// Shift raises the web's stoppage popup with the figures; the one-day cap
  /// before the times are in (and every spec without popups) stays a toast.
  Widget minutesBox(String field, String label) {
    final limit = metrics.minutesLimit(field);
    final shiftLimit = metrics.stoppageLimit;
    if (popups && shiftLimit != null) {
      return numBox(
        field,
        max: limit.max,
        label: label,
        onExceedTyped: (_, typed) {
          final others = metrics.totalStoppage - (entryNum(values[field]) ?? 0);
          notice(stoppageNotice(limitMin: shiftLimit, totalMin: others + typed));
        },
      );
    }
    return numBox(
      field,
      max: limit.max,
      onExceed: (_) => EntryFormToast.warn(limit.message),
      label: label,
    );
  }

  /// Raises [n] as a modal notice (the web's `notice(...)`), once however many
  /// keystrokes ask for it. Safe to call from a box's `onExceed*` callback.
  Future<void> notice(EntryNotice n) {
    final ctx = buildContext;
    if (!ctx.mounted) return Future<void>.value();
    return EntryNotices.show(ctx, n);
  }

  /// The `onExceedTyped` of a capped quantity box, said the way the spec wants:
  /// with [popups] the web's modal [popup] built from the typed figure, else a
  /// plain toast of [toast] (given the ceiling).
  void Function(double max, double typed) onLimit(
    EntryNotice Function(double typed) popup,
    String Function(double max) toast,
  ) =>
      (max, typed) {
        if (popups) {
          notice(popup(typed));
        } else {
          EntryFormToast.warn(toast(max));
        }
      };

  /// Scrolls [field]'s box into view and puts the cursor in it (what the
  /// Machine Status "Remarks" tick does to the Remarks box).
  void focusField(String field) {
    // An optional (folded) card that holds the box opens first.
    if (EntryLineCard.reveal('entry$index/$field')) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final ctx = keyFor(field).currentContext;
        if (ctx != null && ctx.mounted) {
          Scrollable.ensureVisible(ctx, alignment: 0.25, duration: const Duration(milliseconds: 280), curve: Curves.easeOutCubic)
              .then((_) => nodeFor(field).requestFocus());
        } else {
          nodeFor(field).requestFocus();
        }
      });
      return;
    }
    final ctx = keyFor(field).currentContext;
    final node = nodeFor(field);
    if (ctx != null && ctx.mounted) {
      Scrollable.ensureVisible(
        ctx,
        alignment: 0.25,
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOutCubic,
      ).then((_) => node.requestFocus());
    } else {
      node.requestFocus();
    }
  }

  /// Whether a capped box can only hold 0 right now.
  bool locked(String field, double? max) =>
      EntryTextField.capLocks(text(field), max);

  /// A grey, calculated box.
  Widget calcBox(String key, String value, String label) => EntryCalcBox(
    key: ValueKey('entry$index/calc/$key'),
    value: value,
    semanticsLabel: label,
  );

  /// The earliest the OFF / End picker offers: a minute after ON (the web's
  /// `offEarliest`), or null with no ON time yet or when ON is 23:59.
  String? get offEarliest {
    final on = normalizeTime(values['machineOnTime']);
    if (on == null) return null;
    final next =
        int.parse(on.substring(0, 2)) * 60 + int.parse(on.substring(3, 5)) + 1;
    if (next >= 1440) return null;
    return '${(next ~/ 60).toString().padLeft(2, '0')}:${(next % 60).toString().padLeft(2, '0')}';
  }
}
