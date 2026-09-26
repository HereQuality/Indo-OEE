import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/widgets/tap_to_dismiss.dart';

import '../support/fake_api.dart';

void main() {
  Future<({FocusNode node, List<String> taps})> pump(WidgetTester tester) async {
    FakeApi.install();
    final node = FocusNode();
    addTearDown(node.dispose);
    final taps = <String>[];
    await pumpScreen(
      tester,
      Scaffold(
        body: TapToDismiss(
          child: Column(
            children: [
              TextField(focusNode: node),
              TextButton(onPressed: () => taps.add('button'), child: const Text('Go')),
              const Expanded(child: SizedBox.expand()),
            ],
          ),
        ),
      ),
    );
    return (node: node, taps: taps);
  }

  testWidgets('tapping empty space puts the keyboard away', (tester) async {
    final t = await pump(tester);
    await tester.tap(find.byType(TextField));
    await tester.pump();
    expect(t.node.hasFocus, isTrue);

    await tester.tapAt(const Offset(200, 600));
    await tester.pump();
    expect(t.node.hasFocus, isFalse);
  });

  testWidgets('a button under the finger still gets its tap and keeps working', (tester) async {
    final t = await pump(tester);
    await tester.tap(find.text('Go'));
    await tester.pump();
    expect(t.taps, ['button']);
  });

  testWidgets('tapping inside the field does not dismiss it', (tester) async {
    final t = await pump(tester);
    await tester.tap(find.byType(TextField));
    await tester.pump();
    await tester.tap(find.byType(TextField));
    await tester.pump();
    expect(t.node.hasFocus, isTrue);
  });
}
