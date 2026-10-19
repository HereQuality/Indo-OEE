import React, { useMemo } from "react";
import Select from "react-select";

/**
 * components/Production/VendorSelect.jsx
 * ─────────────────────────────────────────
 * The Vendor Name picker on the After Powder Coating form: one searchable box
 * over Vendor Master's active vendors — typing narrows the list, the same way
 * the Part Name picker works. A vendor this entry already names but that's no
 * longer in the live list (deactivated since) still shows as its own option,
 * so editing an old entry never silently loses it.
 */
const VendorSelect = ({ vendors, value, vendorName, onSelect, invalid }) => {
  const { options, selected } = useMemo(() => {
    const list = vendors.map((v) => ({ value: v._id, label: v.name }));
    let picked = value ? list.find((o) => o.value === value) : null;
    if (value && !picked) {
      picked = { value, label: vendorName || "" };
      list.unshift(picked);
    }
    return { options: list, selected: picked || null };
  }, [vendors, value, vendorName]);

  return (
    <Select
      classNamePrefix="select"
      options={options}
      value={selected}
      onChange={(opt) => onSelect(opt ? opt.value : "")}
      isClearable
      placeholder="Select vendor"
      noOptionsMessage={() => "No matching vendor — add it in Vendor Master"}
      menuPlacement="auto"
      maxMenuHeight={280}
      styles={{
        control: (base) => (invalid ? { ...base, borderColor: "#dc3545" } : base),
        option: (base) => ({ ...base, padding: "8px 12px" }),
      }}
    />
  );
};

export default VendorSelect;
