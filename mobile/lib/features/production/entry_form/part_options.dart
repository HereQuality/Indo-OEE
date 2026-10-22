import '../../../core/widgets/form_widgets.dart' show PickOption;

/// The web `SearchablePartSelect` options: parts that already have a process
/// first, then those with none under a "Not in any process" header (only when
/// there are any). A search matches the part name or its Drawing No. only, and
/// the menu shows "Drawing No.: x" as a smaller line under each part.
List<PickOption<String>> partPickOptions(
  List<Map<String, dynamic>> items,
  String? Function(Map<String, dynamic> item) subtitle,
) {
  bool inProcess(Map<String, dynamic> it) {
    final p = it['process'];
    return p != null && p != '' && p != false && p != 0;
  }

  PickOption<String> opt(Map<String, dynamic> it, String? group) {
    final name = '${it['itemName'] ?? ''}';
    final dn = it['drawingNo'];
    final drawing = dn == null ? '' : '$dn';
    return PickOption<String>(
      '${it['_id']}',
      name,
      subtitle: subtitle(it),
      detail: drawing.isEmpty ? null : 'Drawing No.: $drawing',
      group: group,
      searchTerms: [name, drawing],
    );
  }

  final assigned = [for (final it in items) if (inProcess(it)) it];
  final unassigned = [for (final it in items) if (!inProcess(it)) it];
  return [
    for (final it in assigned) opt(it, null),
    for (final it in unassigned) opt(it, 'Not in any process'),
  ];
}

/// Group header text of the web picker.
const String notInAnyProcess = 'Not in any process';
