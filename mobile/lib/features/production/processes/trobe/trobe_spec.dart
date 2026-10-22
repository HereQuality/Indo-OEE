import '../cnc_twin.dart';

/// The TROBE Data Entry page (client/src/pages/TrobeDataEntry.jsx,
/// TrobeEntryForm.jsx, trobeColumns.jsx, utils/trobe{Sheet,Validation}.js,
/// server /trobe-sheet) — Contact's twin without the Working Status column.
class TrobeSpec extends CncTwinSpec {
  const TrobeSpec();

  @override
  String get key => 'trobe';
  @override
  String get displayName => 'TROBE';
  @override
  String get segment => 'trobe-sheet';
  @override
  String get routePath => '/production/trobe-data-entry';
  @override
  List<String> get routeAliases => const [];
  @override
  String get draftKey => 'trobeEntryDraft';
  @override
  TwinStyle get style => TwinStyle.trobe;
}

const TrobeSpec trobeSpec = TrobeSpec();
