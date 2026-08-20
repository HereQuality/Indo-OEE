import React, { useState, useRef } from "react";
import ReactDOM from "react-dom";

// Hover tooltip for truncated table cells — renders via portal so it's never
// clipped by a scrollable table wrapper (overflow-x-auto also forces
// overflow-y to clip), and shows instantly instead of the browser's native
// `title` attribute delay.
const Tooltip = ({ text, children, className = "" }) => {
  const [rect, setRect] = useState(null);
  const ref = useRef(null);

  if (!text) return children;

  const show = () => { if (ref.current) setRect(ref.current.getBoundingClientRect()); };
  const hide = () => setRect(null);

  // Flip above the trigger when there isn't enough room below it, so the
  // tooltip never runs off the bottom of the viewport with no way to see
  // the rest of it (it's position:fixed via portal, so clamping here is the
  // only thing keeping it on-screen).
  const TOOLTIP_WIDTH = 280;
  const EST_HEIGHT = 90;
  let style = null;
  if (rect) {
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < EST_HEIGHT && rect.top > EST_HEIGHT;
    style = {
      position: "fixed",
      left: Math.min(Math.max(rect.left, 8), window.innerWidth - TOOLTIP_WIDTH - 8),
      width: TOOLTIP_WIDTH,
      ...(openUpward ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
    };
  }

  return (
    <>
      <span ref={ref} onMouseEnter={show} onMouseLeave={hide} className={className}>
        {children}
      </span>
      {rect && ReactDOM.createPortal(
        <div
          style={style}
          className="z-[200] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a1a1a] shadow-xl px-3 py-2 text-xs text-slate-700 dark:text-slate-200 leading-snug whitespace-pre-wrap break-words"
        >
          {text}
        </div>,
        document.body
      )}
    </>
  );
};

export default Tooltip;
