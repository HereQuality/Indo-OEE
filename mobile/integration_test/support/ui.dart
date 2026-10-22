// UI helpers for the e2e tests: drive the REAL app like a person would.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:indo/features/production/data_entry_hub/data_entry_hub_card.dart';

import 'e2e.dart';

/// Pumps for [d] of real time in 100 ms frames (no pumpAndSettle: the app polls/animates forever).
Future<void> pumpFor(WidgetTester t, [Duration d = const Duration(milliseconds: 600)]) async {
  final end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

Finder inNav(String label) => find.descendant(of: find.byType(NavigationBar), matching: find.text(label));

Future<void> tapNav(WidgetTester t, String label) async {
  await t.tap(inNav(label));
  await pumpFor(t, const Duration(seconds: 1));
}

Future<void> tapKey(WidgetTester t, String key, {bool scroll = true}) async {
  final f = find.byKey(ValueKey<String>(key)).first;
  await pumpUntilFound(t, find.byKey(ValueKey<String>(key)), reason: 'key $key');
  if (scroll) await t.ensureVisible(f);
  await t.pump(const Duration(milliseconds: 100));
  await t.tap(f);
  await pumpFor(t, const Duration(milliseconds: 400));
}

Future<void> tapText(WidgetTester t, String text, {Finder? within, bool last = false}) async {
  var f = within == null ? find.text(text) : find.descendant(of: within, matching: find.text(text));
  await pumpUntilFound(t, f, reason: 'text "$text"');
  f = last ? f.last : f.first;
  await t.ensureVisible(f);
  await t.pump(const Duration(milliseconds: 100));
  await t.tap(f);
  await pumpFor(t, const Duration(milliseconds: 400));
}

/// Waits for a snack-bar / text containing [part].
Future<void> expectToast(WidgetTester t, String part, {Duration timeout = const Duration(seconds: 20)}) async {
  await pumpUntilFound(t, find.textContaining(part), timeout: timeout, reason: 'a message containing "$part"');
}

/// The TextField inside the form box `entry<block>/<name>`.
Finder boxField(String name, {int block = 0}) =>
    find.descendant(of: find.byKey(ValueKey<String>('entry$block/$name')), matching: find.byType(TextField));

bool hasBox(String name, {int block = 0}) => find.byKey(ValueKey<String>('entry$block/$name')).evaluate().isNotEmpty;

String boxText(WidgetTester t, String name, {int block = 0}) => t.widget<TextField>(boxField(name, block: block)).controller!.text;

/// Scrolls the editor down until [f] is built (long forms build their lower cards lazily).
Future<void> ensureBuilt(WidgetTester t, Finder f) async {
  for (var i = 0; i < 12 && f.evaluate().isEmpty; i++) {
    await scrollForm(t, 450);
  }
  // Optional cards (Planned Shift, Downtime, Remarks, ...) are folded: open the folded ones, as a person would.
  if (f.evaluate().isEmpty) await expandFolds(t);
  for (var i = 0; i < 12 && f.evaluate().isEmpty; i++) {
    await scrollForm(t, -450);
  }
}

/// Taps every folded optional card header ("Optional - tap to add" / a summary line) open.
Future<void> expandFolds(WidgetTester t) async {
  for (var round = 0; round < 3; round++) {
    var opened = false;
    final toggles = find.byWidgetPredicate((w) => w.key is ValueKey && '${(w.key as ValueKey).value}'.startsWith('line-toggle/'));
    for (final e in toggles.evaluate().toList()) {
      final arrow = find.descendant(of: find.byWidget(e.widget), matching: find.byIcon(Icons.expand_more_rounded));
      if (arrow.evaluate().isEmpty) continue;
      final rot = t.widget<AnimatedRotation>(find.ancestor(of: arrow.first, matching: find.byType(AnimatedRotation)).first);
      if (rot.turns != 0) continue; // already open
      final f = find.byWidget(e.widget);
      await t.ensureVisible(f);
      await t.pump(const Duration(milliseconds: 100));
      await t.tap(f, warnIfMissed: false);
      await pumpFor(t, const Duration(milliseconds: 300));
      opened = true;
    }
    if (!opened) break;
  }
}

/// Types [text] into a numeric / text box of the entry form.
Future<void> typeBox(WidgetTester t, String name, String text, {int block = 0}) async {
  final f = boxField(name, block: block);
  await ensureBuilt(t, f);
  await pumpUntilFound(t, f, reason: 'form box entry$block/$name');
  await t.ensureVisible(f.first);
  await t.pump(const Duration(milliseconds: 100));
  await t.enterText(f.first, text);
  await t.pump(const Duration(milliseconds: 250));
}

/// Types a 24h time ("08:00") in a WebTimeField: focus the box, type, press Done.
Future<void> typeTime(WidgetTester t, String name, String hhmm, {int block = 0}) async {
  final f = boxField(name, block: block);
  await ensureBuilt(t, f);
  await pumpUntilFound(t, f, reason: 'time box entry$block/$name');
  await t.ensureVisible(f.first);
  await t.pump(const Duration(milliseconds: 100));
  await t.tap(f.first);
  await pumpFor(t, const Duration(milliseconds: 300));
  await t.enterText(f.first, hhmm.replaceAll(':', ''));
  await t.pump(const Duration(milliseconds: 100));
  await t.testTextInput.receiveAction(TextInputAction.done);
  await pumpFor(t, const Duration(milliseconds: 400));
}

/// Opens the picker box `entry<block>/<name>` and chooses the row whose title is [option].
Future<void> pickOption(WidgetTester t, String name, String option, {int block = 0}) async {
  final box = find.byKey(ValueKey<String>('entry$block/$name'));
  await ensureBuilt(t, box);
  await pumpUntilFound(t, box, reason: 'picker entry$block/$name');
  await t.ensureVisible(box.first);
  await t.pump(const Duration(milliseconds: 100));
  await t.tap(box.first);
  await pumpFor(t, const Duration(milliseconds: 700));
  final row = find.descendant(of: find.byType(ListTile), matching: find.text(option));
  if (row.evaluate().isEmpty) {
    // a long list has a search box
    final search = find.widgetWithText(TextField, 'Search').evaluate().isEmpty ? find.byType(TextField).last : find.byType(TextField).last;
    if (find.byIcon(Icons.search).evaluate().isNotEmpty) {
      await t.enterText(search, option);
      await pumpFor(t, const Duration(milliseconds: 400));
    }
  }
  await pumpUntilFound(t, row, reason: 'picker option "$option"');
  await t.tap(row.first);
  await pumpFor(t, const Duration(milliseconds: 600));
}

/// Taps Save / Update in the editor's bottom bar.
Future<void> tapSave(WidgetTester t, {bool update = false}) async {
  final label = update ? 'Update' : 'Save';
  // The save bar folds away while the keyboard is up (by design): put the keyboard away first.
  FocusManager.instance.primaryFocus?.unfocus();
  await t.testTextInput.receiveAction(TextInputAction.done);
  await pumpFor(t, const Duration(milliseconds: 500));
  final btn = find.widgetWithText(FilledButton, label);
  await pumpUntilFound(t, btn, reason: 'the $label button');
  await t.tap(btn.first);
  await pumpFor(t, const Duration(milliseconds: 600));
}

/// All `entry<block>/...` string keys currently in the tree (for exploring a form).
List<String> formKeys({int block = 0}) => [
      for (final e in find.byWidgetPredicate((w) => w.key is ValueKey && '${(w.key as ValueKey).value}'.startsWith('entry$block/')).evaluate())
        '${(e.widget.key as ValueKey).value}',
    ];

/// Asks the runner (mobile/e2e/dev_run.sh / run_e2e.sh) to grab the emulator screen
/// into mobile/e2e/shots/<name>.png (it reacts to the printed marker).
Future<void> shot(WidgetTester t, String name) async {
  await pumpFor(t, const Duration(milliseconds: 400));
  // ignore: avoid_print
  print('E2E_SHOT:$name');
  await pumpFor(t, const Duration(milliseconds: 1800));
}

/// Scrolls the editor down to the bottom, to reveal late fields.
Future<void> scrollForm(WidgetTester t, double dy) async {
  // the form's vertical scroller (not a text field's horizontal one)
  final vertical = find.byWidgetPredicate((w) => w is Scrollable && w.axis == Axis.vertical && w.restorationId != 'editable');
  final s = vertical.evaluate().isNotEmpty ? vertical.first : find.byType(Scrollable).first;
  await t.drag(s, Offset(0, -dy), warnIfMissed: false);
  await pumpFor(t, const Duration(milliseconds: 300));
}

/// App-bar back arrow (flutter_test's pageBack only knows Cupertino's).
Future<void> goBack(WidgetTester t) async {
  final f = find.byWidgetPredicate((w) =>
      (w is Icon && (w.icon == Icons.arrow_back || w.icon == Icons.arrow_back_rounded || w.icon == Icons.arrow_back_ios_new_rounded)) ||
      w is BackButton);
  await pumpUntilFound(t, f, reason: 'a back arrow');
  await t.tap(f.first);
  await pumpFor(t, const Duration(milliseconds: 900));
}

/// Data entry tab -> the hub card named [process] -> its entry list (waits for the Add button).
Future<void> openProcess(WidgetTester t, String process) async {
  for (var i = 0; i < 4 && find.byType(HubCard).evaluate().isEmpty; i++) {
    await tapNav(t, 'Data entry');
    await pumpFor(t, const Duration(milliseconds: 800));
  }
  final card = find.descendant(of: find.byType(HubCard), matching: find.text(process));
  try {
    await pumpUntilFound(t, card, reason: 'hub card $process', timeout: const Duration(seconds: 15));
  } catch (_) {
    await shot(t, 'fail_hub_$process');
    // ignore: avoid_print
    print('HUB DEBUG texts=${find.byType(Text).evaluate().map((e) => (e.widget as Text).data).toList()} cards=${find.byType(HubCard).evaluate().length}');
    rethrow;
  }
  await t.tap(card.first);
  await pumpUntilFound(t, find.byKey(const ValueKey<String>('sheet-add')), reason: '$process list (Add entry button)');
  await pumpFor(t, const Duration(milliseconds: 600));
}

/// Leaves the add/edit editor with its Cancel button, confirming the "leave / discard" dialog if it shows.
/// NOTE: leaving an add form with typed data keeps it as a draft for a minute (EntryDraftStore).
Future<void> leaveEditor(WidgetTester t) async {
  final cancel = find.widgetWithText(TextButton, 'Cancel');
  await pumpUntilFound(t, cancel, reason: 'the editor Cancel button');
  await t.tap(cancel.first);
  await pumpFor(t, const Duration(milliseconds: 700));
  final dlg = find.byType(AlertDialog);
  if (dlg.evaluate().isNotEmpty) {
    await t.tap(find.descendant(of: dlg, matching: find.byType(FilledButton)).first);
    await pumpFor(t, const Duration(milliseconds: 800));
  }
}
