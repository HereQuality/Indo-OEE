import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAlert } from "../context/AlertContext";

/**
 * hooks/useOpenEntryFromLink.js
 * ───────────────────────────────
 * Lets a link open one entry's edit form on its data entry page:
 * "<sheet page>?entry=<id>&date=YYYY-MM-DD" — what OEE Review's "Open entry"
 * button and an OEE review notification send people to. The page narrows its
 * date range to that day (so the entry is among the loaded rows), then opens
 * the same edit popup its own pencil button opens, and drops the two params so
 * a refresh doesn't pop the form up again.
 *
 * `entryLinkRange` is for the page's first render, so the very first fetch is
 * already for that day; the hook covers a page that was already open when the
 * link was followed.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The one-day range the URL asks for, or `fallback()` (the page's usual
// default range) when it asks for nothing.
export const entryLinkRange = (fallback) => {
  const q = new URLSearchParams(window.location.search);
  const date = q.get("date");
  return q.get("entry") && DATE_RE.test(date || "") ? [date, date] : fallback();
};

/**
 * @param rows            the page's loaded rows
 * @param loading         whether a fetch is in flight
 * @param range           the page's current [from, to]
 * @param onRangeChange   the page's own range setter (resets paging)
 * @param openEdit        the page's own edit-popup opener
 * @param blockedReason   (row) => text when the row can't be edited right now (no permission, locked), else ""
 */
export const useOpenEntryFromLink = ({ rows, loading, range, onRangeChange, openEdit, blockedReason }) => {
  const toast = useAlert();
  const [params, setParams] = useSearchParams();
  const entryId = params.get("entry");
  const date = params.get("date");
  const dayWanted = DATE_RE.test(date || "") ? date : null;
  const sawLoading = useRef(false);
  // A fetch already in flight when we moved the range may land first, with the
  // wrong day's rows — one miss after we moved it isn't a real "not found".
  const skipMisses = useRef(0);
  const moved = useRef(false);

  const done = () => {
    sawLoading.current = false;
    skipMisses.current = 0;
    moved.current = false;
    setParams(
      (p) => {
        p.delete("entry");
        p.delete("date");
        return p;
      },
      { replace: true },
    );
  };

  // Move to the entry's day when the page isn't already showing it.
  useEffect(() => {
    if (!entryId || !dayWanted || moved.current) return;
    moved.current = true;
    if (range[0] === dayWanted && range[1] === dayWanted) return;
    skipMisses.current = loading ? 1 : 0;
    onRangeChange([dayWanted, dayWanted]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, dayWanted]);

  useEffect(() => {
    if (!entryId) return;
    if (loading) {
      sawLoading.current = true;
      return;
    }
    const row = rows.find((r) => r._id === entryId);
    if (row) {
      const why = blockedReason?.(row);
      if (why) toast.warning(why);
      else openEdit(row);
      done();
      return;
    }
    if (!sawLoading.current) return;
    if (skipMisses.current > 0) {
      skipMisses.current -= 1;
      return;
    }
    toast.info("That entry isn't on the sheet any more.");
    done();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, loading, entryId]);
};
