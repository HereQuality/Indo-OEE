import '../cnc_twin.dart';

/// The Contact Data Entry page (client/src/pages/ContactDataEntry.jsx,
/// ContactEntryForm.jsx, contactColumns.jsx, utils/contact{Sheet,Validation}.js,
/// server /contact-sheet). CNC's formulas; OK / Rejected typed; Working Status
/// column in the table.
class ContactSpec extends CncTwinSpec {
  const ContactSpec();

  @override
  String get key => 'contact';
  @override
  String get displayName => 'Contact';
  @override
  String get segment => 'contact-sheet';
  @override
  String get routePath => '/production/contact-data-entry';
  @override
  List<String> get routeAliases => const [];
  @override
  String get draftKey => 'contactEntryDraft';
  @override
  TwinStyle get style => TwinStyle.contact;
}

const ContactSpec contactSpec = ContactSpec();
