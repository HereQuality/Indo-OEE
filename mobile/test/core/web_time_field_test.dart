import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/theme/app_theme.dart';
import 'package:indo/core/widgets/web_time_field.dart';

// Port of the web's Components/Common/TimePicker.jsx: parse rules, the inline
// Hour / Minute panel, minTime, commit-on-blur.

class _Host extends StatefulWidget {
  const _Host({this.on = '', this.off = '', this.offMin, this.invalid = false, super.key});
  final String on;
  final String off;
  final String? offMin;
  final bool invalid;
  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  late String on = widget.on;
  late String off = widget.off;
  final onNode = FocusNode();
  final offNode = FocusNode();
  final after = TextEditingController();
  final nextNode = FocusNode();
  final changes = <String>[];

  void setOn(String v) => setState(() => on = v);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            WebTimeField(
              key: const ValueKey('on'),
              value: on,
              focusNode: onNode,
              invalid: widget.invalid,
              onChanged: (v) => setState(() {
                on = v;
                changes.add('on=$v');
              }),
            ),
            const SizedBox(height: 10),
            WebTimeField(
              key: const ValueKey('off'),
              value: off,
              focusNode: offNode,
              minTime: widget.offMin,
              onChanged: (v) => setState(() {
                off = v;
                changes.add('off=$v');
              }),
            ),
            const SizedBox(height: 10),
            TextField(key: const ValueKey('next'), controller: after, focusNode: nextNode),
          ],
        ),
      ),
    );
  }
}

Future<GlobalKey<_HostState>> _pump(
  WidgetTester tester, {
  String on = '',
  String off = '',
  String? offMin,
  bool invalid = false,
  Size size = const Size(390, 844),
  bool dark = false,
  double scale = 1.0,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final key = GlobalKey<_HostState>();
  await tester.pumpWidget(
    MaterialApp(
      theme: dark ? AppTheme.dark() : AppTheme.light(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: _Host(key: key, on: on, off: off, offMin: offMin, invalid: invalid),
    ),
  );
  await tester.pumpAndSettle();
  return key;
}

Finder _box(String k) => find.descendant(of: find.byKey(ValueKey(k)), matching: find.byType(TextField));
Finder _toggle(String k) => find.descendant(of: find.byKey(ValueKey(k)), matching: find.byKey(const ValueKey('time-toggle')));
Finder _hour(String k, int h) => find.descendant(of: find.byKey(ValueKey(k)), matching: find.byKey(ValueKey('time-hour-${h.toString().padLeft(2, '0')}')));
Finder _minute(String k, int m) => find.descendant(of: find.byKey(ValueKey(k)), matching: find.byKey(ValueKey('time-minute-${m.toString().padLeft(2, '0')}')));

/// Scrolls the column to the item (the lists build lazily) and returns it.
Future<Finder> _show(WidgetTester tester, String k, String col, int n) async {
  final item = col == 'hour' ? _hour(k, n) : _minute(k, n);
  final list = find.descendant(of: find.byKey(ValueKey(k)), matching: find.byKey(ValueKey('time-list-$col')));
  final pos = tester.state<ScrollableState>(find.descendant(of: list, matching: find.byType(Scrollable))).position;
  final index = col == 'hour' ? n : n ~/ 5;
  pos.jumpTo((index * kTimeRowHeight - kTimeRowHeight).clamp(0, pos.maxScrollExtent).toDouble());
  await tester.pumpAndSettle();
  return item;
}
String _text(WidgetTester t, String k) => t.widget<TextField>(_box(k)).controller!.text;

Future<void> _type(WidgetTester tester, String k, String text, {bool enter = false}) async {
  await tester.enterText(_box(k), text);
  await tester.pump();
  if (enter) {
    await tester.testTextInput.receiveAction(TextInputAction.done);
  } else {
    await tester.tap(find.byKey(const ValueKey('next')));
  }
  await tester.pumpAndSettle();
}

void main() {
  group('parseTypedTime (the web parseTyped cases)', () {
    const ok = {
      '9': '09:00',
      '09': '09:00',
      '930': '09:30',
      '0930': '09:30',
      '9:30': '09:30',
      '9.30': '09:30',
      '21:05': '21:05',
      '2105': '21:05',
      '0': '00:00',
      '000': '00:00',
      '23:59': '23:59',
      '9:5': '09:05',
      ' 9:30 ': '09:30',
      '': '',
      '   ': '',
    };
    ok.forEach((raw, out) => test('"$raw" -> "$out"', () => expect(parseTypedTime(raw), out)));
    for (final bad in ['24', '2400', '24:00', '9:60', '0960', '99', 'ab', '9:3:0', '12345', '9,30', '-1', '1 30', '9:']) {
      test('"$bad" is not a time', () => expect(parseTypedTime(bad), isNull));
    }
    test('null is blank', () => expect(parseTypedTime(null), ''));
  });

  group('hour / minute picks', () {
    test('an hour with no minute yet gets 00, or the smallest minTime allows', () {
      expect(pickTimeHour(9), '09:00');
      expect(pickTimeHour(9, value: ''), '09:00');
      expect(pickTimeHour(8, minTime: '08:01'), '08:01');
      expect(pickTimeHour(9, minTime: '08:01'), '09:00');
      expect(pickTimeHour(8, minTime: '08:30'), '08:30');
    });
    test('an hour keeps the minute already set', () => expect(pickTimeHour(14, value: '09:35'), '14:35'));
    test('a minute with no hour yet uses 00', () {
      expect(pickTimeMinute(15), '00:15');
      expect(pickTimeMinute(55, value: '21:10'), '21:55');
    });
  });

  group('the field', () {
    testWidgets('shows hh:mm hint, 24-hour text, no AM/PM, max 5 chars, numeric keyboard', (tester) async {
      await _pump(tester, on: '21:05');
      expect(find.text('hh:mm'), findsWidgets);
      expect(_text(tester, 'on'), '21:05');
      expect(find.text('AM'), findsNothing);
      expect(find.text('PM'), findsNothing);
      final tf = tester.widget<TextField>(_box('on'));
      expect(tf.keyboardType, const TextInputType.numberWithOptions(decimal: true));
      await tester.enterText(_box('off'), '123456789');
      expect(_text(tester, 'off'), '12345');
    });

    testWidgets('typed values commit on blur and on Enter; invalid keeps the old value', (tester) async {
      final key = await _pump(tester, on: '08:00');
      await _type(tester, 'on', '930');
      expect(key.currentState!.on, '09:30');
      expect(_text(tester, 'on'), '09:30');

      await _type(tester, 'off', '9.45', enter: true);
      expect(key.currentState!.off, '09:45');
      expect(find.byKey(const ValueKey('time-panel')), findsNothing, reason: 'Enter closes the panel');

      await _type(tester, 'on', '2575');
      expect(key.currentState!.on, '09:30', reason: 'invalid input keeps the old value');
      expect(_text(tester, 'on'), '09:30');

      await _type(tester, 'on', 'ab');
      expect(key.currentState!.on, '09:30');

      await _type(tester, 'on', '');
      expect(key.currentState!.on, '', reason: 'blank clears');
    });

    testWidgets('nothing is emitted while typing, only on commit', (tester) async {
      final key = await _pump(tester);
      await tester.enterText(_box('on'), '9');
      await tester.pump();
      expect(key.currentState!.changes, isEmpty);
      await tester.enterText(_box('on'), '930');
      await tester.pump();
      expect(key.currentState!.changes, isEmpty);
    });

    testWidgets('typed time earlier than minTime is refused (old value kept)', (tester) async {
      final key = await _pump(tester, off: '10:00', offMin: '08:01');
      await _type(tester, 'off', '0800');
      expect(key.currentState!.off, '10:00');
      expect(_text(tester, 'off'), '10:00');
      await _type(tester, 'off', '0801');
      expect(key.currentState!.off, '08:01');
    });

    testWidgets('the clock button toggles an inline panel; Done and an outside tap close it', (tester) async {
      await _pump(tester, on: '14:35');
      expect(find.byKey(const ValueKey('time-panel')), findsNothing);
      await tester.tap(_toggle('on'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('time-panel')), findsOneWidget);
      expect(find.byType(Dialog), findsNothing, reason: 'inline, not a floating dialog');
      expect(find.text('Hour'), findsOneWidget);
      expect(find.text('Minute'), findsOneWidget);
      await tester.tap(_toggle('on'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('time-panel')), findsNothing);

      await tester.tap(_toggle('on'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('time-done')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('time-panel')), findsNothing);

      await tester.tap(_toggle('on'));
      await tester.pumpAndSettle();
      await tester.tapAt(const Offset(2, 700));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('time-panel')), findsNothing);

      await tester.tap(_toggle('on'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('next')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('time-panel')), findsNothing, reason: 'tapping another field closes it');
    });

    testWidgets('Escape closes the panel', (tester) async {
      await _pump(tester);
      await tester.tap(_box('on'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('time-panel')), findsOneWidget, reason: 'focusing the box opens it, like the web');
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('time-panel')), findsNothing);
    });

    testWidgets('the chosen value is highlighted and scrolled into view when the panel opens', (tester) async {
      await _pump(tester, on: '21:35');
      await tester.tap(_toggle('on'));
      await tester.pumpAndSettle();
      // Hour 21 and minute 35 are built (scrolled to) and are the only selected ones.
      expect(_hour('on', 21), findsOneWidget);
      expect(_minute('on', 35), findsOneWidget);
      expect(_hour('on', 0), findsNothing, reason: 'the top of the list is scrolled out of view');
      expect(_minute('on', 0), findsNothing);
      final sel = tester.widget<Material>(_hour('on', 21));
      expect(sel.color, AppTheme.light().colorScheme.primary);
      final other = tester.widget<Material>(_hour('on', 20));
      expect(other.color, Colors.transparent);
    });

    testWidgets('picking an hour with no minute defaults to :00, then a minute completes it', (tester) async {
      final key = await _pump(tester);
      await tester.tap(_toggle('on'));
      await tester.pumpAndSettle();
      await tester.tap(await _show(tester, 'on', 'hour', 7));
      await tester.pumpAndSettle();
      expect(key.currentState!.on, '07:00');
      expect(_text(tester, 'on'), '07:00');
      await tester.tap(await _show(tester, 'on', 'minute', 45));
      await tester.pumpAndSettle();
      expect(key.currentState!.on, '07:45');
      await tester.tap(await _show(tester, 'on', 'hour', 13));
      await tester.pumpAndSettle();
      expect(key.currentState!.on, '13:45', reason: 'the minute is kept');
      expect(key.currentState!.changes, ['on=07:00', 'on=07:45', 'on=13:45']);
    });

    testWidgets('a minute picked before any hour uses hour 00; Clear empties and closes', (tester) async {
      final key = await _pump(tester);
      await tester.tap(_toggle('on'));
      await tester.pumpAndSettle();
      await tester.tap(await _show(tester, 'on', 'minute', 20));
      await tester.pumpAndSettle();
      expect(key.currentState!.on, '00:20');
      await tester.tap(find.byKey(const ValueKey('time-clear')));
      await tester.pumpAndSettle();
      expect(key.currentState!.on, '');
      expect(_text(tester, 'on'), '');
      expect(find.byKey(const ValueKey('time-panel')), findsNothing);
    });

    testWidgets('minTime greys out and blocks earlier hours and minutes', (tester) async {
      final key = await _pump(tester, off: '', offMin: '08:01');
      await tester.tap(_toggle('off'));
      await tester.pumpAndSettle();
      await tester.tap(await _show(tester, 'off', 'hour', 5)); // scrolled to the top: hour 05 is built
      await tester.pumpAndSettle();
      expect(key.currentState!.off, '', reason: 'hour 05 < 08 is blocked');
      expect(tester.widget<InkWell>(find.descendant(of: _hour('off', 5), matching: find.byType(InkWell))).onTap, isNull);

      await tester.tap(await _show(tester, 'off', 'hour', 8)); // allowed: minute defaults to the smallest allowed
      await tester.pumpAndSettle();
      expect(key.currentState!.off, '08:01');
      expect(tester.widget<InkWell>(find.descendant(of: _minute('off', 0), matching: find.byType(InkWell))).onTap, isNull, reason: '08:00 < 08:01');
      await tester.tap(await _show(tester, 'off', 'minute', 0));
      await tester.pumpAndSettle();
      expect(key.currentState!.off, '08:01');
      await tester.tap(await _show(tester, 'off', 'minute', 5));
      await tester.pumpAndSettle();
      expect(key.currentState!.off, '08:05');
    });

    testWidgets('minTime is inclusive: exactly the min time can be typed', (tester) async {
      final key = await _pump(tester, offMin: '08:00');
      await _type(tester, 'off', '8:00');
      expect(key.currentState!.off, '08:00');
    });

    testWidgets('error state: red border; clean otherwise', (tester) async {
      await _pump(tester, invalid: true);
      final err = tester.widget<TextField>(_box('on')).decoration!;
      expect(err.enabledBorder, isNotNull);
      expect((err.enabledBorder as OutlineInputBorder).borderSide.color, AppTheme.light().colorScheme.error);
      expect(tester.widget<TextField>(_box('off')).decoration!.enabledBorder, isNull);
    });

    testWidgets('an outside change of value shows in the box', (tester) async {
      final key = await _pump(tester, on: '08:00');
      key.currentState!.setOn('10:15');
      await tester.pump();
      expect(_text(tester, 'on'), '10:15');
    });

    testWidgets('focus order: tab goes ON -> OFF -> next field; focus node can be requested', (tester) async {
      final key = await _pump(tester);
      key.currentState!.offNode.requestFocus();
      await tester.pumpAndSettle();
      expect(key.currentState!.offNode.hasFocus, isTrue);
      expect(find.byKey(const ValueKey('time-panel')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('next')));
      await tester.pumpAndSettle();
      expect(key.currentState!.offNode.hasFocus, isFalse);
      key.currentState!.onNode.requestFocus();
      await tester.pumpAndSettle();
      expect(key.currentState!.onNode.hasFocus, isTrue);
      // Reading order: ON, OFF, then the field after them (the clock buttons sit between).
      final order = <String>[];
      for (var i = 0; i < 12; i++) {
        FocusManager.instance.primaryFocus!.nextFocus();
        await tester.pumpAndSettle();
        final st = key.currentState!;
        final now = st.offNode.hasFocus
            ? 'off'
            : tester.widget<TextField>(find.byKey(const ValueKey('next'))).focusNode?.hasFocus == true
                ? 'next'
                : null;
        if (now != null && (order.isEmpty || order.last != now)) order.add(now);
      }
      expect(order.take(2), ['off', 'next'], reason: 'ON, then OFF, then the next field');
    });
  });

  group('in a long scrolling page', () {
    testWidgets('opening near the bottom scrolls the whole panel into view and a pick does not move the page', (tester) async {
      tester.view.physicalSize = const Size(390, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      var value = '';
      final scroll = ScrollController();
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(
            body: StatefulBuilder(
              builder: (context, set) => SingleChildScrollView(
                controller: scroll,
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    const SizedBox(height: 1500),
                    WebTimeField(key: const ValueKey('t'), value: value, onChanged: (v) => set(() => value = v)),
                    const SizedBox(height: 900),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
      scroll.jumpTo(1500 + 16 - 600); // the box sits near the bottom of the screen
      await tester.pumpAndSettle();
      await tester.tap(_toggle('t'));
      await tester.pumpAndSettle();
      final panel = tester.getRect(find.byKey(const ValueKey('time-panel')));
      expect(panel.bottom, lessThanOrEqualTo(700), reason: 'the page scrolled so the whole panel is on screen');
      expect(panel.top, greaterThanOrEqualTo(0));
      final offset = scroll.offset;
      await tester.tap(await _show(tester, 't', 'hour', 9));
      await tester.pumpAndSettle();
      expect(value, '09:00');
      expect(scroll.offset, offset, reason: 'picking does not jump the page');
    });
  });

  group('layout', () {
    for (final c in [
      (name: '320 px phone', size: const Size(320, 640), dark: false, scale: 1.0),
      (name: '320 px, text 1.3, dark', size: const Size(320, 640), dark: true, scale: 1.3),
      (name: 'tablet dark', size: const Size(820, 1180), dark: true, scale: 1.0),
      (name: '390 px, text 1.3', size: const Size(390, 844), dark: false, scale: 1.3),
    ]) {
      testWidgets('${c.name}: panel opens without overflow and pushes the next field down', (tester) async {
        await _pump(tester, on: '09:30', off: '17:00', size: c.size, dark: c.dark, scale: c.scale);
        final before = tester.getTopLeft(find.byKey(const ValueKey('off'))).dy;
        await tester.tap(_toggle('on'));
        await tester.pumpAndSettle();
        final panel = tester.getRect(find.byKey(const ValueKey('time-panel')));
        final offTop = tester.getTopLeft(find.byKey(const ValueKey('off'))).dy;
        expect(offTop, greaterThan(before), reason: 'content is pushed down');
        expect(offTop, greaterThanOrEqualTo(panel.bottom), reason: 'never covers the next field');
        expect(panel.right, lessThanOrEqualTo(c.size.width - 16 + 0.5));
        expect(tester.takeException(), isNull);

        await tester.tap(_toggle('off'));
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('time-panel')), findsOneWidget, reason: 'one open at a time');
        expect(tester.takeException(), isNull);
      });
    }
  });
}
