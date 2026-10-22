import 'dart:async';

import 'package:indo/features/production/entry_form/entry_layout.dart';

/// Every test file runs through this. Optional form cards (the web FormLine
/// `optional`) fold in the real app; tests about the boxes inside them would
/// otherwise each have to tap the card open first, so folding is off by default
/// here and the folding tests (test/production/web_parity/line_fold_test.dart)
/// switch it on.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  EntryLineCard.foldOptional = false;
  await testMain();
}
