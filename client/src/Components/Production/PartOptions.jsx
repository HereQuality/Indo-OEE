import React from "react";

/**
 * components/Production/PartOptions.jsx
 * ───────────────────────────────────────
 * The <option>s of a data entry form's Part Name picker. The page hands the form
 * only the parts its process runs (plus any not yet given a process), so this
 * just lays them out:
 *
 *   - parts of a process first, in the order given;
 *   - parts not in any process in a group of their own, so they read as "not
 *     classified yet" rather than as part of the list;
 *   - the part a saved record already points at, even when it is no longer in the
 *     list (moved to another process, or deactivated), so editing the record
 *     doesn't look like its part was lost.
 *
 * `label(item)` is the option text — each sheet adds its own cycle-time hint so
 * two parts sharing a name can still be told apart.
 */
const PartOptions = ({ items, selectedId, selectedName, label }) => {
  const option = (it) => (
    <option key={it._id} value={it._id}>
      {label(it)}
    </option>
  );
  const inProcess = items.filter((it) => it.process);
  const unassigned = items.filter((it) => !it.process);
  const selectedMissing = !!selectedId && !items.some((it) => it._id === selectedId);

  return (
    <>
      {/* A record typed into the old grid has a part name but no link to the Item
          master — show that name rather than an empty box. */}
      <option value="">{selectedName && !selectedId ? selectedName : "Select part"}</option>
      {selectedMissing && <option value={selectedId}>{selectedName}</option>}
      {inProcess.map(option)}
      {unassigned.length > 0 &&
        (inProcess.length > 0 ? <optgroup label="Not in any process">{unassigned.map(option)}</optgroup> : unassigned.map(option))}
    </>
  );
};

export default PartOptions;
