/**
 * utils/vendorsFor.js
 * ─────────────────────
 * The vendors an entry form offers: the active ones ticked (Vendor Master) for
 * the entry's process. A form shows its Vendor Name box only while that list
 * has someone in it — or the entry already names a vendor — so a process with
 * no vendors never sees the box at all. Unlike operators, a vendor in no
 * process is offered nowhere.
 */
const idOf = (v) => (v && typeof v === "object" ? String(v._id) : String(v ?? ""));

export const vendorsForProcess = (vendors = [], processId) => {
  if (!processId) return [];
  const id = idOf(processId);
  return vendors.filter((v) => v.isActive !== false && (v.processes || []).some((p) => idOf(p) === id));
};

// By a machine's process (Machine.process).
export const vendorsForMachine = (vendors = [], machines = [], machineId) => {
  const machine = machines.find((m) => String(m._id) === String(machineId));
  return vendorsForProcess(vendors, machine?.process);
};

// Any of these processes has a vendor — whether a sheet shows its Vendor Name column.
export const anyVendorFor = (vendors = [], processIds = []) => processIds.some((p) => vendorsForProcess(vendors, p).length > 0);
