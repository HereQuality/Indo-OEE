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
const VendorSelect = ({ vendors, value, vendorName, onSelect, invalid, id, ariaLabel = "Vendor name" }) => {
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
      inputId={id}
      aria-label={ariaLabel}
      options={options}
      value={selected}
      onChange={(opt) => onSelect(opt ? opt.value : "")}
      isClearable
      placeholder="Select vendor"
      noOptionsMessage={() => "No matching vendor — add it in Vendor Master"}
      menuPlacement="auto"
      // The list opens in a fixed layer on <body> (not inside the modal's
      // scrolling body, which clipped it) and is never taller than ~40% of the
      // visible screen, so it fits on a landscape phone too.
      menuPortalTarget={typeof document !== "undefined" ? document.body : null}
      menuPosition="fixed"
      maxMenuHeight={Math.min(280, Math.round((typeof window !== "undefined" ? window.visualViewport?.height || window.innerHeight : 700) * 0.4))}
      styles={{
        menuPortal: (base) => ({ ...base, zIndex: 2000 }),
        control: (base) => (invalid ? { ...base, borderColor: "#dc3545" } : base),
        option: (base) => ({ ...base, padding: "8px 12px" }),
      }}
    />
  );
};

export default VendorSelect;
