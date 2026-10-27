import React, { useMemo } from "react";
import Select from "react-select";

/**
 * components/Production/SearchablePartSelect.jsx
 * ─────────────────────────────────────────────────
 * The Part Name picker every Data Entry form uses — one searchable box where
 * typing either the part's name OR its Drawing No. finds it (a plain
 * <select>, PartOptions.jsx's old job, only jumped to options starting with
 * the letter typed, and never looked at Drawing No. at all).
 *
 * Same business rules PartOptions.jsx had: a part not yet given a process
 * groups under "Not in any process", under everything else; a part this
 * entry already names but that's missing from the live list (deleted or
 * deactivated since) still shows as its own option, so editing an old entry
 * never silently loses what it was pointed at; blank reads "Select part".
 */
const SearchablePartSelect = ({ items, value, itemName, onSelect, label, invalid, id, ariaLabel = "Part name", placeholder = "Select part" }) => {
  const toOption = (it) => ({
    value: it._id,
    itemName: it.itemName,
    drawingNo: it.drawingNo || "",
    label: label ? label(it) : it.itemName,
  });

  const { options, selected } = useMemo(() => {
    const inProcess = items.filter((it) => it.process).map(toOption);
    const unassigned = items.filter((it) => !it.process).map(toOption);
    const flat = [...inProcess, ...unassigned];
    let groups = unassigned.length ? [...inProcess, { label: "Not in any process", options: unassigned }] : inProcess;
    let selectedOption = value ? flat.find((o) => o.value === value) : null;
    if (value && !selectedOption) {
      selectedOption = { value, itemName: itemName || "", drawingNo: "", label: itemName || "" };
      groups = [selectedOption, ...groups];
    }
    return { options: groups, selected: selectedOption || null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, value, itemName, label]);

  // Matches either field — not just the composed label — so "PG21" finds the
  // part by Drawing No. even though the visible label leads with its name.
  const filterOption = (option, input) => {
    const q = input.trim().toLowerCase();
    if (!q) return true;
    const d = option.data || {};
    return (d.itemName || "").toLowerCase().includes(q) || (d.drawingNo || "").toLowerCase().includes(q);
  };

  return (
    <Select
      classNamePrefix="select"
      inputId={id}
      aria-label={ariaLabel}
      options={options}
      value={selected}
      onChange={(picked) => onSelect(picked ? picked.value : "")}
      isClearable
      // A record saved with just a name and no live item id (older data)
      // shows that name here rather than the generic placeholder.
      placeholder={!value && itemName ? itemName : placeholder}
      filterOption={filterOption}
      // The collapsed box shows just the part (what's already picked); the
      // open menu adds Drawing No. as its own smaller line underneath, so
      // skimming a long list doesn't mean reading one run-on line per part.
      formatOptionLabel={(opt, { context }) =>
        context === "value" ? (
          <span>{opt.label}</span>
        ) : (
          <div>
            <div>{opt.label}</div>
            {opt.drawingNo && (
              <div className="text-muted" style={{ fontSize: "0.78rem" }}>
                Drawing No.: {opt.drawingNo}
              </div>
            )}
          </div>
        )
      }
      noOptionsMessage={() => "No matching part"}
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

export default SearchablePartSelect;
