import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';

/// Vendor Master on the phone — a port of client/src/utils/vendorsFor.js and
/// hooks/useVendors.js (the model: pages/VendorMaster.jsx).
///
/// A vendor is `{_id, name, isActive, processes: [processId | {_id}]}`. The
/// entry forms offer the ACTIVE vendors ticked for the entry's process, and show
/// their Vendor Name box only while that list has someone in it — or the entry
/// already names a vendor (`vendor` id + `vendorName`), so editing never hides
/// it. Unlike operators, a vendor in no process is offered nowhere.
///
/// Wiring (see `PROCESS_PORTING.md`, "Wave 2 checklist"): a spec returns
/// `usesVendors => true`; the list controller then loads `/vendors` into
/// `extra['vendors']`, the form reads it as `c.extra['vendors']`, and
/// `vendorLine` / `vendorColumn` do the rest.


String _idOf(Object? v) => v is Map ? '${v['_id']}' : '${v ?? ''}';

// JS `!processId`: null, undefined, '' (and 0 / false) are "no process".
bool _noProcess(Object? v) => v == null || v == '' || v == 0 || v == false;

/// The active vendors ticked for [processId] (a process id or a `{_id}` map).
List<Map<String, dynamic>> vendorsForProcess(List<Map<String, dynamic>> vendors, Object? processId) {
  if (_noProcess(processId)) return const [];
  final id = _idOf(processId);
  return [
    for (final v in vendors)
      if (v['isActive'] != false && (v['processes'] is List) && (v['processes'] as List).any((p) => _idOf(p) == id)) v,
  ];
}

/// By a machine's process (`Machine.process`).
List<Map<String, dynamic>> vendorsForMachine(List<Map<String, dynamic>> vendors, List<Map<String, dynamic>> machines, Object? machineId) {
  for (final m in machines) {
    if ('${m['_id']}' == '${machineId ?? ''}') return vendorsForProcess(vendors, m['process']);
  }
  return vendorsForProcess(vendors, null);
}

/// Any of [processIds] has a vendor — whether a sheet shows its Vendor Name column.
bool anyVendorFor(List<Map<String, dynamic>> vendors, Iterable<Object?> processIds) =>
    processIds.any((p) => vendorsForProcess(vendors, p).isNotEmpty);

/// The name to show for the vendor an entry holds: the live master's name, else
/// the name saved on the entry (a vendor deactivated since keeps showing).
String vendorLabelFor(List<Map<String, dynamic>> vendors, String vendorId, String savedName) {
  if (vendorId.isEmpty) return '';
  for (final v in vendors) {
    if ('${v['_id']}' == vendorId) return '${v['name'] ?? ''}';
  }
  return savedName;
}

/// Reads `GET /vendors` (Vendor Master). A failure is the caller's to swallow:
/// the page treats "no vendors" as "no Vendor Name box".
class VendorsRepository {
  const VendorsRepository();

  Future<List<Map<String, dynamic>>> load() async => asList(await Api.get(Endpoints.vendors));
}
