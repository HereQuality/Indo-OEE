import { useEffect } from "react";

// Click-and-drag horizontal scrolling for a wide table: the cursor becomes a
// hand (grab → grabbing) and dragging pans the container left/right only —
// vertical scroll stays on the wheel/scrollbar. Clicks on buttons, links and
// form controls are left alone, and a real drag swallows the click that would
// otherwise fire when the mouse is released over a cell.
const INTERACTIVE = "button, a, input, select, textarea, label, [role='button']";
const DRAG_THRESHOLD = 4;

export default function useDragScrollX(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    let startX = 0;
    let startLeft = 0;
    let down = false;
    let dragged = false;

    el.style.cursor = "grab";

    const onDown = (e) => {
      if (e.button !== 0 || e.target.closest(INTERACTIVE)) return;
      down = true;
      dragged = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
    };
    const onMove = (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!dragged && Math.abs(dx) < DRAG_THRESHOLD) return;
      if (!dragged) {
        dragged = true;
        el.style.cursor = "grabbing";
        el.style.userSelect = "none";
      }
      el.scrollLeft = startLeft - dx;
    };
    const onUp = () => {
      if (!down) return;
      down = false;
      el.style.cursor = "grab";
      el.style.userSelect = "";
    };
    const onClickCapture = (e) => {
      if (dragged) {
        e.stopPropagation();
        e.preventDefault();
        dragged = false;
      }
    };

    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    el.addEventListener("click", onClickCapture, true);
    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      el.removeEventListener("click", onClickCapture, true);
      el.style.cursor = "";
      el.style.userSelect = "";
    };
  }, [ref]);
}
