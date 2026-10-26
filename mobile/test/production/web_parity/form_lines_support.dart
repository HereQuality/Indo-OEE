// Shared by the "same lines as the web" tests of every process: reads the open
// block of a pumped entry form back as the web modal lists it - each line's title
// and the label of every box in it (a trailing " *" is the red required star).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:indo/core/widgets/form_widgets.dart' show FieldLabel;
import 'package:indo/features/production/entry_form/entry_layout.dart';

/// One line of the form: its title and the labels of its boxes, in order.
typedef FormLineLabels = (String title, List<String> labels);

/// The lines of the first open block in READING order: a single column top to
/// bottom on a phone; on a tablet (two columns) the left column top to bottom,
/// then the right one - which has to be the web's order.
///
/// Folded optional lines are included (their boxes stay mounted).
List<FormLineLabels> openFormLines(WidgetTester tester) {
  final cards = find.byType(EntryLineCard, skipOffstage: false).evaluate().toList();
  final entries = <({EntryLineCard card, Offset at, Element el})>[
    for (final el in cards) (card: el.widget as EntryLineCard, at: tester.getTopLeft(find.byElementPredicate((e) => e == el)), el: el),
  ];
  if (entries.isEmpty) return const [];
  final leftX = entries.map((e) => e.at.dx).reduce((a, b) => a < b ? a : b);
  bool isLeft(Offset o) => o.dx - leftX < 100;
  int byTop(({EntryLineCard card, Offset at, Element el}) a, ({EntryLineCard card, Offset at, Element el}) b) => a.at.dy.compareTo(b.at.dy);
  final left = entries.where((e) => isLeft(e.at)).toList()..sort(byTop);
  final right = entries.where((e) => !isLeft(e.at)).toList()..sort(byTop);
  return [
    for (final e in [...left, ...right])
      (
        e.card.title,
        [
          for (final f in find
              .descendant(of: find.byElementPredicate((x) => x == e.el), matching: find.byType(FieldLabel), skipOffstage: false)
              .evaluate())
            '${(f.widget as FieldLabel).text}${(f.widget as FieldLabel).required ? ' *' : ''}',
        ],
      ),
  ];
}

/// [openFormLines] as one string per line ("Title: label | label"), for a readable failure.
List<String> describeLines(List<FormLineLabels> lines) => [for (final l in lines) '${l.$1}: ${l.$2.join(' | ')}'];
