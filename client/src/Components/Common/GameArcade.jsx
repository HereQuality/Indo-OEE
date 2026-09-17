import React, { useState } from "react";
import DinoRunnerGame from "./DinoRunnerGame";
import Game2048 from "./Game2048";

/**
 * Components/Common/GameArcade.jsx
 * ───────────────────────────────────
 * A tiny mini-arcade embedded in pages/UnderMaintenance.jsx — a few
 * dependency-free games to pass the time during a real outage, switchable
 * via pill tabs. Only the active game is mounted, so each game's own
 * listeners (keyboard, resize, timers) never fight another game's for
 * the same events. Always dark (no theme prop) — this only ever renders
 * inside the always-dark maintenance page, so all games share one fixed
 * blue→gold palette rather than each juggling a light/dark variant.
 */

const GAMES = [
  { key: "runner", label: "Runner", Component: DinoRunnerGame },
  { key: "2048", label: "2048", Component: Game2048 },
];

export default function GameArcade() {
  const [active, setActive] = useState(GAMES[0].key);
  const ActiveGame = GAMES.find((g) => g.key === active)?.Component || DinoRunnerGame;

  return (
    <div>
      <div className="flex flex-wrap justify-center gap-2 mb-5">
        {GAMES.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => setActive(g.key)}
            className={`text-sm font-semibold rounded-full px-4 py-2 transition-colors ${
              active === g.key ? "bg-brand-500 text-white" : "bg-white/8 text-slate-400 hover:bg-white/12 hover:text-slate-200"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>
      <ActiveGame />
    </div>
  );
}
