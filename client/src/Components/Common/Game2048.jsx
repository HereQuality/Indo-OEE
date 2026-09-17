import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Components/Common/Game2048.jsx
 * ────────────────────────────────
 * A compact, dependency-free 2048 clone — one of the games on the Under
 * Maintenance page's mini-arcade (see GameArcade.jsx). Arrow keys or
 * swipe; best score persisted in localStorage.
 */

const SIZE = 4;
const BEST_KEY = "indo_maintenance_2048_best";

// One deliberate cool-to-warm progression (not a grab-bag of unrelated
// hues) — low tiles stay in the app's own brand blue, climbing through
// indigo/violet, and only the rare high tiles turn gold. Always dark —
// this game only ever renders inside the always-dark maintenance arcade
// (see GameArcade.jsx), so there's no light-mode variant to maintain.
// Every tier below uses a SOLID background (no translucency) paired with
// a real Tailwind color token — the previous 2/4/8 tiers used low-opacity
// fills with `text-brand-100`, a shade that was never defined in
// tailwind.config.js (only brand-300..700 exist), so that class was a
// silent no-op and the "4" tile rendered with near-invisible dark-on-dark
// text against the arcade's already very dark background.
const TILE_STYLES = {
  2: "bg-slate-700 text-slate-100",
  4: "bg-brand-700 text-white",
  8: "bg-brand-600 text-white",
  16: "bg-brand-500 text-white",
  32: "bg-brand-400 text-navy-900",
  64: "bg-indigo-500 text-white",
  128: "bg-indigo-600 text-white",
  256: "bg-violet-500 text-white",
  512: "bg-violet-600 text-white",
  1024: "bg-amber-400 text-zinc-950",
  2048: "bg-amber-300 text-zinc-950 ring-2 ring-amber-200/60",
};
const tileClass = (v) => TILE_STYLES[v] || "bg-amber-200 text-zinc-950 ring-2 ring-amber-100/70";

const emptyGrid = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));

const readBest = () => {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
};
const writeBest = (v) => {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    // best score just won't persist
  }
};

// Compresses+merges one row to the LEFT. Returns { row, gained, moved }.
function slideLeft(row) {
  const vals = row.filter((v) => v !== 0);
  const merged = [];
  let gained = 0;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] === vals[i + 1]) {
      const sum = vals[i] * 2;
      merged.push(sum);
      gained += sum;
      i++;
    } else {
      merged.push(vals[i]);
    }
  }
  while (merged.length < SIZE) merged.push(0);
  const moved = merged.some((v, i) => v !== row[i]);
  return { row: merged, gained, moved };
}

const transpose = (grid) => grid[0].map((_, c) => grid.map((row) => row[c]));
const reverseRows = (grid) => grid.map((row) => [...row].reverse());

function applyMove(grid, direction) {
  let working = grid.map((r) => [...r]);
  if (direction === "up" || direction === "down") working = transpose(working);
  if (direction === "right" || direction === "down") working = reverseRows(working);

  let gained = 0;
  let moved = false;
  working = working.map((row) => {
    const res = slideLeft(row);
    gained += res.gained;
    moved = moved || res.moved;
    return res.row;
  });

  if (direction === "right" || direction === "down") working = reverseRows(working);
  if (direction === "up" || direction === "down") working = transpose(working);

  return { grid: working, gained, moved };
}

function spawnTile(grid) {
  const empties = [];
  grid.forEach((row, r) => row.forEach((v, c) => v === 0 && empties.push([r, c])));
  if (!empties.length) return grid;
  const [r, c] = empties[Math.floor(Math.random() * empties.length)];
  const next = grid.map((row) => [...row]);
  next[r][c] = Math.random() < 0.9 ? 2 : 4;
  return next;
}

function hasMoves(grid) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] === 0) return true;
      if (c < SIZE - 1 && grid[r][c] === grid[r][c + 1]) return true;
      if (r < SIZE - 1 && grid[r][c] === grid[r + 1][c]) return true;
    }
  }
  return false;
}

function freshGrid() {
  return spawnTile(spawnTile(emptyGrid()));
}

export default function Game2048() {
  const [grid, setGrid] = useState(freshGrid);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(readBest);
  const [status, setStatus] = useState("playing"); // playing | won | over
  const wonAcknowledged = useRef(false);
  const touchStart = useRef(null);

  const restart = useCallback(() => {
    setGrid(freshGrid());
    setScore(0);
    setStatus("playing");
    wonAcknowledged.current = false;
  }, []);

  const move = useCallback(
    (direction) => {
      if (status === "over") return;
      setGrid((prev) => {
        const { grid: next, gained, moved } = applyMove(prev, direction);
        if (!moved) return prev;
        const withSpawn = spawnTile(next);
        setScore((s) => {
          const total = s + gained;
          setBest((b) => {
            if (total > b) {
              writeBest(total);
              return total;
            }
            return b;
          });
          return total;
        });
        if (!wonAcknowledged.current && withSpawn.some((row) => row.some((v) => v >= 2048))) {
          wonAcknowledged.current = true;
          setStatus("won");
        } else if (!hasMoves(withSpawn)) {
          setStatus("over");
        }
        return withSpawn;
      });
    },
    [status]
  );

  useEffect(() => {
    const onKeyDown = (e) => {
      const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
      if (map[e.key]) {
        e.preventDefault();
        move(map[e.key]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move]);

  const onTouchStart = (e) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? "right" : "left");
    else move(dy > 0 ? "down" : "up");
  };

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-2">
          <div className="rounded-xl bg-white/8 px-3 py-1.5 text-center min-w-[64px]">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">Score</div>
            <div className="text-sm font-bold text-white">{score}</div>
          </div>
          <div className="rounded-xl bg-white/8 px-3 py-1.5 text-center min-w-[64px]">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">Best</div>
            <div className="text-sm font-bold text-white">{best}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={restart}
          className="text-xs font-medium rounded-lg px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white transition-colors"
        >
          New game
        </button>
      </div>

      <div
        className="relative rounded-2xl bg-black/20 border border-white/5 p-2 touch-none"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="grid grid-cols-4 gap-2">
          {grid.map((row, r) =>
            row.map((v, c) => (
              <div
                key={`${r}-${c}`}
                className={`aspect-square rounded-xl flex items-center justify-center font-bold text-lg transition-all duration-150 ${
                  v ? tileClass(v) + " shadow-md shadow-black/30 animate-fadeIn" : "bg-white/[0.04]"
                }`}
              >
                {v || ""}
              </div>
            ))
          )}
        </div>

        {status !== "playing" && (
          <div className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center gap-2 bg-zinc-950/90 backdrop-blur-sm">
            <p className="text-base font-bold text-white">
              {status === "won" ? "You hit 2048!" : "No more moves"}
            </p>
            <button
              type="button"
              onClick={status === "won" ? () => setStatus("playing") : restart}
              className="text-xs font-semibold rounded-lg px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white transition-colors"
            >
              {status === "won" ? "Keep playing" : "Try again"}
            </button>
          </div>
        )}
      </div>
      <p className="text-center text-[11px] text-slate-500 mt-2">Arrow keys or swipe to slide the tiles</p>
    </div>
  );
}
