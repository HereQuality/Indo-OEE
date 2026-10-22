import '../cnc_twin.dart';

/// The SPRING FOR PINS Data Entry page (client/src/pages/SpringDataEntry.jsx,
/// SpringEntryForm.jsx, springColumns.jsx, utils/spring{Sheet,Validation}.js,
/// server /spring-sheet): Contact's shape with Item Name / Standard Time per
/// Piece wording, "Idle Time", its own table, and Effective Machine Run Time
/// counting OK + Rejected (`runQtyBasis: "total"`).
class SpringSpec extends CncTwinSpec {
  const SpringSpec();

  @override
  String get key => 'spring';
  @override
  String get displayName => 'SPRING FOR PINS';
  @override
  String get segment => 'spring-sheet';
  @override
  String get routePath => '/production/spring-data-entry';
  @override
  List<String> get routeAliases => const [];
  @override
  String get draftKey => 'springEntryDraft';
  @override
  TwinStyle get style => TwinStyle.springStyle;
}

const SpringSpec springSpec = SpringSpec();
