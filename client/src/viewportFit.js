// Keeps the --app-vh CSS variable (see index.css) equal to the part of the
// screen that is really visible. `dvh` already excludes a mobile browser's
// address bar, but most browsers do not shrink it when the on-screen keyboard
// opens; the visual viewport does. Modals are bounded by this height, so the
// Save / Cancel footer stays on screen while the keyboard is up, and the field
// being typed in is scrolled back into view.
if (typeof window !== "undefined" && window.visualViewport) {
  const vv = window.visualViewport;
  const root = document.documentElement;
  const apply = () => root.style.setProperty("--app-vh", `${Math.round(vv.height)}px`);
  apply();
  vv.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);

  // Touch screens only: after the keyboard has settled, bring the focused field
  // into view inside its scrolling modal body.
  if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
    document.addEventListener("focusin", (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.closest(".modal-body")) return;
      if (!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      setTimeout(() => {
        if (document.activeElement === el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, 300);
    });
  }
}
