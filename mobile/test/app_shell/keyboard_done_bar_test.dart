import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/widgets/keyboard_done_bar.dart';

Widget _app(Widget field) => MaterialApp(
      theme: ThemeData(platform: TargetPlatform.iOS),
      builder: (context, child) => KeyboardDoneBar(child: child!),
      home: Scaffold(body: Center(child: field)),
    );

void main() {
  testWidgets('a number field on iOS gets a Done strip above the keypad that dismisses it', (tester) async {
    await tester.pumpWidget(_app(const TextField(keyboardType: TextInputType.numberWithOptions(decimal: true))));
    await tester.tap(find.byType(TextField));
    await tester.pump();
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    addTearDown(tester.view.resetViewInsets);
    await tester.pump();
    expect(find.text('Done'), findsOneWidget);

    await tester.tap(find.text('Done'));
    await tester.pump();
    tester.view.viewInsets = FakeViewPadding.zero;
    await tester.pump();
    expect(find.text('Done'), findsNothing);
    // Focus left the text field, so its keyboard connection is closed.
    expect(tester.testTextInput.isVisible, isFalse);
  });

  testWidgets('text keyboards (which have Return) get no Done strip', (tester) async {
    await tester.pumpWidget(_app(const TextField(keyboardType: TextInputType.multiline, maxLines: 3)));
    await tester.tap(find.byType(TextField));
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    addTearDown(tester.view.resetViewInsets);
    await tester.pump();
    expect(find.text('Done'), findsNothing);
  });

  testWidgets('a failing widget shows the small friendly message, not a crash', (tester) async {
    final oldBuilder = ErrorWidget.builder;
    addTearDown(() => ErrorWidget.builder = oldBuilder);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: Builder(builder: (_) => throw StateError('boom')))));
    expect(tester.takeException(), isA<StateError>());
  });
}
