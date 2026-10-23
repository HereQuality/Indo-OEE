/**
 * utils/modalEscape.js
 * ──────────────────────
 * Escape pressed to close an open dropdown (react-select menu), time panel or
 * date calendar should close just that — not the whole form it sits in.
 *
 * reactstrap's <Modal> closes on Escape *keyup*, after the dropdown has
 * already closed itself on keydown, so by then nothing shows the press was
 * meant for the dropdown. This notes, on keydown (capture phase, before the
 * dropdown reacts), whether a popup was open; a modal whose toggle is wrapped
 * in guardEscape() then ignores that one keyup.
 *
 * A popup counts as open when an element in the modal the key was pressed in
 * says so (the sidebar's own expanded groups don't count):
 *   aria-haspopup + aria-expanded="true" — react-select's input while its menu
 *                           is open, and our TimePicker / DatePicker boxes. An
 *                           opened form section (aria-expanded alone, no
 *                           popup) doesn't count.
 *   data-popup-open="true" — anything else that opens over a form
 *
 *   <Modal isOpen={open} toggle={guardEscape(close)}>
 */

let popupEscape = false;

const POPUP_OPEN = '[aria-haspopup][aria-expanded="true"], [data-popup-open="true"]';

if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      const modal = e.target instanceof Element ? e.target.closest(".modal") : null;
      popupEscape = !!modal?.querySelector(POPUP_OPEN);
    },
    true,
  );
}

export const guardEscape = (toggle) => (e) => {
  if (e?.type === "keyup" && popupEscape) {
    popupEscape = false;
    return;
  }
  popupEscape = false;
  if (toggle) toggle(e);
};
