import React, { useContext, useMemo, useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { MenuContext } from "../context/MenuContext";
import { toRolePath } from "../utils/roleUrl";

// ── Color palette (same as Dashboard) ──────────────────────────────────────
const COLOR_PALETTE = [
  { bg: "#fef3c7", text: "#92400e" },
  { bg: "#dcfce7", text: "#166534" },
  { bg: "#fce7f3", text: "#9d174d" },
  { bg: "#e0e7ff", text: "#3730a3" },
  { bg: "#fef9c3", text: "#713f12" },
  { bg: "#ffe4e6", text: "#9f1239" },
  { bg: "#d1fae5", text: "#065f46" },
  { bg: "#e0f2fe", text: "#0c4a6e" },
  { bg: "#f3e8ff", text: "#6b21a8" },
  { bg: "#ffedd5", text: "#9a3412" },
];
function colorFor(name = "") {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}
function getInitials(name = "") {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map(w => w[0]).join("").slice(0, 3).toUpperCase();
}

// ── Storage keys ─────────────────────────────────────────────────────────
function getSavedKey(userId)  { return `shortcuts_saved_${userId || "default"}`; }

// ── Icons ─────────────────────────────────────────────────────────────────
const IconChevLeft  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>;
const IconChevRight = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>;
const IconBack      = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>;
const IconPlus      = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const IconTrash     = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;
const IconSave      = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>;
const IconCheck     = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;

export default function Shortcuts() {
  const { adminData, updatePreferences } = useContext(AuthContext);
  const { menuData }  = useContext(MenuContext);
  const { roleSlug }  = useParams();
  const navigate      = useNavigate();

  const userId = adminData?._id || adminData?.id || null;
  const savedKey = getSavedKey(userId);

  // ── Build all accessible menus ──────────────────────────────────────────
  const allMenus = useMemo(() => {
    const flat = [];
    (menuData || []).forEach(group => {
      if (group.isLink && group.url) {
        flat.push({
          id: `g_${group.groupId}`,
          menuName: group.groupName,
          url: group.url,
          icon: group.groupIcon || "bx-grid-alt",
          groupName: "",
        });
      }
      (group.menus || []).forEach(menu => {
        if (menu.url) {
          flat.push({
            id: `m_${menu.id}`,
            menuName: menu.name || menu.menuName || "",
            url: menu.url,
            icon: menu.icon || menu.menuIcon || "bx-grid-alt",
            groupName: group.groupName || "",
          });
        }
      });
    });
    return flat;
  }, [menuData]);

  const allById = useMemo(() => new Map(allMenus.map(m => [m.id, m])), [allMenus]);

  // ── Pinned shortcuts state (ordered list of IDs) ─────────────────────────
  const [pinned, setPinned] = useState([]); // array of menu IDs
  const [saved,  setSaved]  = useState([]); // last-saved state (for unsaved indicator)
  const [initialized, setInitialized] = useState(false);

  // Load from DB preferences / localStorage on mount
  useEffect(() => {
    if (!allMenus.length) return;
    try {
      let ids = adminData?.preferences?.shortcuts;
      if (!Array.isArray(ids) || ids.length === 0) {
        // Fallback to local storage
        const raw = localStorage.getItem(savedKey);
        ids = raw ? JSON.parse(raw) : [];
      }
      const valid = ids.filter(id => allById.has(id));
      setPinned(valid);
      setSaved(valid);
    } catch {
      setPinned([]);
      setSaved([]);
    }
    setInitialized(true);
  }, [allMenus, adminData?.preferences?.shortcuts, savedKey, allById]);

  const hasUnsaved = initialized && JSON.stringify(pinned) !== JSON.stringify(saved);

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    // Save to DB via AuthContext
    if (updatePreferences) {
      await updatePreferences({ shortcuts: pinned });
    }
    // Also save to localStorage as a migration fallback
    localStorage.setItem(savedKey, JSON.stringify(pinned));
    setSaved([...pinned]);
  };

  // ── Add / Remove ─────────────────────────────────────────────────────────
  const toggle = (id) => {
    setPinned(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // ── Reorder ──────────────────────────────────────────────────────────────
  const moveItem = useCallback((index, direction) => {
    setPinned(prev => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const pinnedMenus   = pinned.map(id => allById.get(id)).filter(Boolean);
  const unpinnedMenus = allMenus.filter(m => !pinned.includes(m.id));

  // Group unpinned menus by their groupName for display
  const unpinnedGroups = useMemo(() => {
    const groups = new Map();
    unpinnedMenus.forEach(m => {
      const g = m.groupName || "Other";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(m);
    });
    return groups;
  }, [unpinnedMenus]);

  document.title = "My Shortcuts";

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 pb-12">

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/${roleSlug}/home`)}
              className="h-9 w-9 rounded-xl flex items-center justify-center border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-all shadow-sm"
              title="Back to Home"
            >
              <IconBack />
            </button>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900">My Shortcuts</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {pinnedMenus.length} pinned · select pages to pin, reorder, then Save
              </p>
            </div>
          </div>

          <button
            onClick={handleSave}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm ${
              hasUnsaved
                ? "bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            <IconSave />
            {hasUnsaved ? "Save Changes" : "Saved"}
          </button>
        </div>

        {/* ── PINNED SECTION ── */}
        <div className="mb-8">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
            Pinned Shortcuts ({pinnedMenus.length})
          </p>

          {pinnedMenus.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 border-dashed p-10 text-center">
              <div className="h-12 w-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              </div>
              <p className="text-sm font-semibold text-slate-500">No shortcuts pinned yet</p>
              <p className="text-xs text-slate-400 mt-1">Click <strong className="text-slate-600">+ Add</strong> on any item below to pin it here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {pinnedMenus.map((menu, index) => {
                const color   = colorFor(menu.menuName);
                const initials = getInitials(menu.menuName);
                const isFirst  = index === 0;
                const isLast   = index === pinnedMenus.length - 1;
                const href     = toRolePath(menu.url, roleSlug);

                return (
                  <div
                    key={menu.id}
                    className="group bg-white rounded-2xl border border-slate-200 shadow-sm p-3.5 flex items-center gap-3 hover:shadow-md hover:border-slate-300 transition-all"
                  >
                    {/* Initials icon */}
                    <div
                      className="h-11 w-11 rounded-xl flex items-center justify-center text-xs font-extrabold shrink-0"
                      style={{ background: color.bg, color: color.text }}
                    >
                      {initials}
                    </div>

                    {/* Info */}
                    <button onClick={() => navigate(href)} className="flex-1 min-w-0 text-left">
                      {menu.groupName && (
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold truncate">{menu.groupName}</p>
                      )}
                      <p className="text-sm font-bold text-slate-800 truncate">{menu.menuName}</p>
                      <p className="text-xs text-slate-400 truncate">{menu.url}</p>
                    </button>

                    {/* Controls */}
                    <div className="flex flex-col items-center gap-1.5 shrink-0">
                      {/* Move up/down */}
                      <div className="flex gap-1">
                        <button
                          onClick={() => moveItem(index, -1)}
                          disabled={isFirst}
                          title="Move up"
                          className={`h-7 w-7 rounded-lg flex items-center justify-center border transition-all ${
                            isFirst ? "border-slate-100 text-slate-300 bg-slate-50 cursor-not-allowed"
                              : "border-slate-200 text-slate-500 bg-white hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600"
                          }`}
                        ><IconChevLeft /></button>
                        <button
                          onClick={() => moveItem(index, 1)}
                          disabled={isLast}
                          title="Move down"
                          className={`h-7 w-7 rounded-lg flex items-center justify-center border transition-all ${
                            isLast ? "border-slate-100 text-slate-300 bg-slate-50 cursor-not-allowed"
                              : "border-slate-200 text-slate-500 bg-white hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600"
                          }`}
                        ><IconChevRight /></button>
                      </div>
                      {/* Position + Remove */}
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-bold text-slate-400">#{index + 1}</span>
                        <button
                          onClick={() => toggle(menu.id)}
                          title="Remove from shortcuts"
                          className="h-6 w-6 rounded-md flex items-center justify-center border border-slate-200 bg-white text-slate-400 hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition-all"
                        ><IconTrash /></button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── AVAILABLE MENUS (grouped) ── */}
        {unpinnedMenus.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              Available to Add ({unpinnedMenus.length})
            </p>
            <div className="space-y-5">
              {[...unpinnedGroups.entries()].map(([groupName, items]) => (
                <div key={groupName}>
                  {groupName && groupName !== "Other" && (
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">{groupName}</p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {items.map(menu => {
                      const color    = colorFor(menu.menuName);
                      const initials = getInitials(menu.menuName);
                      return (
                        <div
                          key={menu.id}
                          className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3 hover:border-blue-200 transition-all"
                        >
                          <div
                            className="h-9 w-9 rounded-lg flex items-center justify-center text-xs font-extrabold shrink-0"
                            style={{ background: color.bg, color: color.text }}
                          >
                            {initials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">{menu.menuName}</p>
                            <p className="text-xs text-slate-400 truncate">{menu.url}</p>
                          </div>
                          <button
                            onClick={() => toggle(menu.id)}
                            title="Add to shortcuts"
                            className="h-7 w-7 rounded-lg flex items-center justify-center border border-slate-200 bg-white text-slate-500 hover:bg-blue-600 hover:border-blue-600 hover:text-white transition-all shrink-0"
                          >
                            <IconPlus />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Sticky save bar at bottom ── */}
        {hasUnsaved && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
            <div className="bg-slate-900 text-white rounded-2xl shadow-2xl px-6 py-3 flex items-center gap-4">
              <span className="text-sm font-medium">You have unsaved changes</span>
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors"
              >
                <IconSave /> Save
              </button>
              <button
                onClick={() => { setPinned([...saved]); }}
                className="text-slate-400 hover:text-white text-xs transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
