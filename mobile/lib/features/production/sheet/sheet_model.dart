import 'package:flutter/foundation.dart';

import '../shared/production_sheet_calc.dart';

typedef Json = Map<String, dynamic>;

/// An entry's slot (1..3) as an int; junk (null, "abc", NaN, Infinity) reads as
/// 0 instead of throwing the way `NaN.toInt()` does.
int slotOf(Object? v) {
  final n = jsNumber(v);
  return (n == null || !n.isFinite || n.abs() > 1e9) ? 0 : n.truncate();
}

/// The three slicers of the sheet besides the period: machine ids, operator
/// names and part (item) names — the `machine` / `operator` / `item` params of
/// GET /production-sheet.
@immutable
class SheetFilters {
  const SheetFilters({this.machine = const [], this.operator = const [], this.item = const []});

  static const SheetFilters empty = SheetFilters();

  static const List<String> dims = ['machine', 'operator', 'item'];

  final List<String> machine;
  final List<String> operator;
  final List<String> item;

  bool get isEmpty => machine.isEmpty && operator.isEmpty && item.isEmpty;
  bool get isNotEmpty => !isEmpty;

  /// How many of the three slicers are in use.
  int get activeDims => [machine, operator, item].where((l) => l.isNotEmpty).length;

  List<String> of(String dim) => switch (dim) {
        'machine' => machine,
        'operator' => operator,
        'item' => item,
        _ => const [],
      };

  SheetFilters withDim(String dim, List<String> values) => SheetFilters(
        machine: dim == 'machine' ? List.unmodifiable(values) : machine,
        operator: dim == 'operator' ? List.unmodifiable(values) : operator,
        item: dim == 'item' ? List.unmodifiable(values) : item,
      );

  @override
  bool operator ==(Object other) =>
      other is SheetFilters && listEquals(machine, other.machine) && listEquals(operator, other.operator) && listEquals(item, other.item);

  @override
  int get hashCode => Object.hash(Object.hashAll(machine), Object.hashAll(operator), Object.hashAll(item));
}

/// JS `a.localeCompare(b, undefined, {numeric: true})` closely enough for
/// machine numbers and names: digit runs compare as numbers ("7A" < "10A"),
/// the rest case-insensitively.
int naturalCompare(String a, String b) {
  final ta = _tokens(a);
  final tb = _tokens(b);
  final n = ta.length < tb.length ? ta.length : tb.length;
  for (var i = 0; i < n; i++) {
    final x = ta[i];
    final y = tb[i];
    final xd = int.tryParse(x);
    final yd = int.tryParse(y);
    int c;
    if (xd != null && yd != null) {
      c = xd.compareTo(yd);
    } else {
      c = x.toLowerCase().compareTo(y.toLowerCase());
    }
    if (c != 0) return c;
  }
  final byLength = ta.length.compareTo(tb.length);
  return byLength != 0 ? byLength : a.compareTo(b);
}

List<String> _tokens(String s) => RegExp(r'\d+|\D+').allMatches(s).map((m) => m.group(0)!).toList();

/// One machine's entries on one date (up to three, slot order) — the unit the
/// list draws as a card.
class SheetMachineDay {
  SheetMachineDay({
    required this.date,
    required this.machineId,
    required this.machineName,
    required this.rank,
    required this.entries,
    required this.totalEntries,
  });

  final String date;
  final String machineId;
  final String machineName;
  final int rank;

  /// The entries that pass the operator/part filters and the search.
  final List<Map<String, dynamic>> entries;

  /// Every entry the machine has that date, whatever the filters (the day
  /// figures always combine all of them).
  final int totalEntries;

  String get key => '$date|$machineId';
}

/// One date's machine cards.
class SheetDay {
  SheetDay({required this.date, required this.machines});

  final String date;
  final List<SheetMachineDay> machines;

  String get key => date;

  int get entryCount => machines.fold(0, (s, m) => s + m.entries.length);
}

/// The date/machine grouping of the loaded rows, in the order the web sheet
/// sorts them: newest date first, then the machine's place in the sheet order,
/// then its name, then the entry slot.
List<SheetDay> buildSheetDays({
  required List<Map<String, dynamic>> rows,
  required SheetFilters filters,
  required String search,
  required Map<String, String> machineName,
  required int Function(String machineId) rankOf,
}) {
  String nameOf(String id) => machineName[id] ?? '—';

  final sorted = [...rows]..sort((a, b) {
      final byDate = '${b['date']}'.compareTo('${a['date']}');
      if (byDate != 0) return byDate;
      final byRank = rankOf('${a['machine']}').compareTo(rankOf('${b['machine']}'));
      if (byRank != 0) return byRank;
      final byName = naturalCompare(nameOf('${a['machine']}'), nameOf('${b['machine']}'));
      if (byName != 0) return byName;
      // Machines that are no longer listed all rank and read alike: the id keeps
      // one machine's entries together (else its card would be split in two).
      final byId = '${a['machine']}'.compareTo('${b['machine']}');
      if (byId != 0) return byId;
      return slotOf(a['slot']).compareTo(slotOf(b['slot']));
    });

  // The full count per machine/date, before filters narrow the view.
  final totals = <String, int>{};
  for (final r in sorted) {
    final k = '${r['date']}|${r['machine']}';
    totals[k] = (totals[k] ?? 0) + 1;
  }

  final q = search.trim().toLowerCase();
  final ops = filters.operator.toSet();
  final items = filters.item.toSet();
  bool passes(Map<String, dynamic> r) {
    if (ops.isNotEmpty && !ops.contains(_text(r['operator']))) return false;
    if (items.isNotEmpty && !items.contains(_text(r['itemName']))) return false;
    if (q.isNotEmpty) {
      final hit = [r['itemName'], r['operator'], r['drawingNo']].any((v) => _text(v).toLowerCase().contains(q));
      if (!hit) return false;
    }
    return true;
  }

  final days = <SheetDay>[];
  SheetDay? day;
  SheetMachineDay? card;
  for (final r in sorted) {
    if (!passes(r)) continue;
    final date = '${r['date']}';
    final machineId = '${r['machine']}';
    if (day == null || day.date != date) {
      day = SheetDay(date: date, machines: []);
      days.add(day);
      card = null;
    }
    if (card == null || card.machineId != machineId) {
      card = SheetMachineDay(
        date: date,
        machineId: machineId,
        machineName: nameOf(machineId),
        rank: rankOf(machineId),
        entries: [],
        totalEntries: totals['$date|$machineId'] ?? 0,
      );
      day.machines.add(card);
    }
    card.entries.add(r);
  }
  return days;
}

/// JS `r.operator || ""` / `String(v || "")`.
String _text(Object? v) => v == null ? '' : '$v';
