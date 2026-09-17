import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Components/Common/DinoRunnerGame.jsx
 * ────────────────────────────────────
 * A tiny offline-style runner (Chrome's dino game, reskinned) — one of
 * the games in the mini-arcade on pages/UnderMaintenance.jsx (see
 * GameArcade.jsx). Pure <canvas> + vector shapes — no image assets, no
 * new dependencies. Space/↑/tap to jump, high score persisted in
 * localStorage. Colors are fixed (not theme-aware) — this only ever
 * renders inside the always-dark maintenance arcade, matching the rest
 * of the arcade's own blue→gold palette (see GameArcade.jsx).
 */

const HIGH_SCORE_KEY = "indo_maintenance_runner_highscore";

const GROUND_Y_RATIO = 0.78; // ground line as a fraction of canvas height
const GRAVITY = 2600; // px/s^2
const JUMP_VELOCITY = -900; // px/s
const BASE_SPEED = 340; // px/s
const SPEED_RAMP = 4; // px/s per second

const PLAYER_SIZE = 34;

const readHighScore = () => {
  try {
    return Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;
  } catch {
    return 0;
  }
};

const writeHighScore = (value) => {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, String(value));
  } catch {
    // localStorage unavailable (private mode, quota) — score just won't persist.
  }
};

export default function DinoRunnerGame() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const stateRef = useRef("idle"); // "idle" | "playing" | "over"
  const worldRef = useRef(null);
  const [uiState, setUiState] = useState("idle");
  const [score, setScore] = useState(0);
  // Read inside the rAF loop via ref (not state) — the loop's tick()
  // closure is only re-created when `isDarkMode` changes, so a plain
  // state value here would render as permanently stale (frozen at
  // whatever it was on mount) the moment a new high score is set mid-game.
  const highScoreRef = useRef(readHighScore());

  const resetWorld = useCallback((width, height) => {
    const groundY = height * GROUND_Y_RATIO;
    worldRef.current = {
      width,
      height,
      groundY,
      player: { y: groundY - PLAYER_SIZE, vy: 0, jumping: false },
      obstacles: [],
      speed: BASE_SPEED,
      elapsed: 0,
      spawnTimer: 0.9,
      score: 0,
    };
  }, []);

  const startGame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    resetWorld(canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
    stateRef.current = "playing";
    setUiState("playing");
    setScore(0);
  }, [resetWorld]);

  const jump = useCallback(() => {
    if (stateRef.current === "idle" || stateRef.current === "over") {
      startGame();
      return;
    }
    const world = worldRef.current;
    if (!world) return;
    if (!world.player.jumping) {
      world.player.vy = JUMP_VELOCITY;
      world.player.jumping = true;
    }
  }, [startGame]);

  // Input wiring
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        jump();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [jump]);

  // Canvas sizing (device-pixel-ratio aware for crispness)
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return undefined;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const width = Math.max(280, rect.width);
      const height = 260;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!worldRef.current || stateRef.current === "idle") {
        resetWorld(width, height);
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [resetWorld]);

  // Main loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    let last = performance.now();

    // Brand blue runner, warm-gold obstacles — same cool→warm language as
    // Game2048's tile scale. No background fill (canvas stays
    // transparent) so the arcade panel's own bg-black/20 bezel shows
    // through instead of a mismatched hard edge.
    const colors = { ground: "#ffffff40", player: "#60a5fa", obstacle: "#fbbf24", text: "#f1f5f9", dim: "#94a3b8" };

    const spawnObstacle = (world) => {
      const isTall = Math.random() > 0.6;
      world.obstacles.push({
        x: world.width + 10,
        w: isTall ? 16 : 22,
        h: isTall ? 34 : 20,
      });
    };

    // A handful of fixed star positions (0..1 fractional coords), reused
    // every frame — cheap parallax depth without per-frame randomness.
    const stars = Array.from({ length: 14 }, (_, i) => ({
      fx: (i * 137.5) % 1, // golden-angle spread, looks scattered without Math.random()
      fy: ((i * 71) % 60) / 100,
      r: 1 + (i % 3) * 0.5,
    }));

    const tick = (now) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const world = worldRef.current;

      if (world) {
        ctx.clearRect(0, 0, world.width, world.height);

        // faint fixed starfield — cheap depth cue behind the action
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        stars.forEach((s) => {
          ctx.beginPath();
          ctx.arc(s.fx * world.width, s.fy * world.groundY, s.r, 0, Math.PI * 2);
          ctx.fill();
        });

        // ground — solid line + short perpendicular ticks, scrolling with
        // the obstacles so it reads as motion, not just a static rule
        ctx.strokeStyle = colors.ground;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, world.groundY);
        ctx.lineTo(world.width, world.groundY);
        ctx.stroke();
        ctx.lineWidth = 1.5;
        const tickSpacing = 26;
        const offset = ((world.elapsed || 0) * world.speed) % tickSpacing;
        for (let x = world.width + tickSpacing - offset; x > -tickSpacing; x -= tickSpacing) {
          ctx.beginPath();
          ctx.moveTo(x, world.groundY);
          ctx.lineTo(x - 8, world.groundY + 6);
          ctx.stroke();
        }

        if (stateRef.current === "playing") {
          world.elapsed += dt;
          world.speed = BASE_SPEED + world.elapsed * SPEED_RAMP;
          world.score += dt * 12;

          // physics
          const p = world.player;
          p.vy += GRAVITY * dt;
          p.y += p.vy * dt;
          const floorY = world.groundY - PLAYER_SIZE;
          if (p.y >= floorY) {
            p.y = floorY;
            p.vy = 0;
            p.jumping = false;
          }

          // spawn + move obstacles
          world.spawnTimer -= dt;
          if (world.spawnTimer <= 0) {
            spawnObstacle(world);
            world.spawnTimer = Math.max(0.55, 1.3 - world.elapsed * 0.02) + Math.random() * 0.5;
          }
          world.obstacles.forEach((o) => {
            o.x -= world.speed * dt;
          });
          world.obstacles = world.obstacles.filter((o) => o.x + o.w > -10);

          // collision (slightly inset hitbox so near-misses feel fair)
          const px = 40, py = p.y, pw = PLAYER_SIZE, ph = PLAYER_SIZE;
          const inset = 6;
          for (const o of world.obstacles) {
            const oy = world.groundY - o.h;
            const overlap =
              px + inset < o.x + o.w && px + pw - inset > o.x && py + inset < oy + o.h && py + ph - inset > oy;
            if (overlap) {
              stateRef.current = "over";
              const finalScore = Math.floor(world.score);
              setScore(finalScore);
              setUiState("over");
              if (finalScore > highScoreRef.current) {
                highScoreRef.current = finalScore;
                writeHighScore(finalScore);
              }
              break;
            }
          }

          setScore(Math.floor(world.score));
        }

        // ground-contact shadow — shrinks/fades with jump height, the
        // usual cheap trick for selling "this thing left the ground"
        const p = world.player;
        const px = 40;
        const airborne = Math.max(0, (world.groundY - PLAYER_SIZE - p.y) / 80);
        ctx.fillStyle = `rgba(0,0,0,${0.28 * Math.max(0, 1 - airborne)})`;
        ctx.beginPath();
        ctx.ellipse(px + PLAYER_SIZE / 2, world.groundY + 3, (PLAYER_SIZE / 2) * Math.max(0.35, 1 - airborne * 0.6), 3, 0, 0, Math.PI * 2);
        ctx.fill();

        // player (rounded square "runner" with an eye — no image assets)
        ctx.save();
        ctx.fillStyle = colors.player;
        const r = 8;
        ctx.beginPath();
        ctx.moveTo(px + r, p.y);
        ctx.arcTo(px + PLAYER_SIZE, p.y, px + PLAYER_SIZE, p.y + PLAYER_SIZE, r);
        ctx.arcTo(px + PLAYER_SIZE, p.y + PLAYER_SIZE, px, p.y + PLAYER_SIZE, r);
        ctx.arcTo(px, p.y + PLAYER_SIZE, px, p.y, r);
        ctx.arcTo(px, p.y, px + PLAYER_SIZE, p.y, r);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#0b1220";
        ctx.beginPath();
        ctx.arc(px + PLAYER_SIZE - 10, p.y + 12, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // obstacles — actual small flags (pole + triangle pennant), not
        // plain bars, matching the "NC flag" idea the game is themed on
        world.obstacles.forEach((o) => {
          const baseY = world.groundY;
          const poleX = o.x + o.w / 2;
          ctx.strokeStyle = colors.dim;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(poleX, baseY);
          ctx.lineTo(poleX, baseY - o.h);
          ctx.stroke();

          ctx.fillStyle = colors.obstacle;
          ctx.beginPath();
          ctx.moveTo(poleX, baseY - o.h);
          ctx.lineTo(poleX + o.w, baseY - o.h + o.w * 0.35);
          ctx.lineTo(poleX, baseY - o.h + o.w * 0.7);
          ctx.closePath();
          ctx.fill();
        });

        // score, on a small rounded chip instead of bare floating text
        const scoreText = `${Math.floor(world.score).toString().padStart(5, "0")}`;
        const hiText = `HI ${highScoreRef.current.toString().padStart(5, "0")}`;
        ctx.font = "600 12px Inter, sans-serif";
        const chipW = Math.max(ctx.measureText(scoreText).width, ctx.measureText(hiText).width) + 20;
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        const chipX = world.width - chipW - 8;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(chipX, 6, chipW, 34, 8) : ctx.rect(chipX, 6, chipW, 34);
        ctx.fill();

        ctx.fillStyle = colors.text;
        ctx.textAlign = "right";
        ctx.fillText(scoreText, world.width - 18, 22);
        ctx.fillStyle = colors.dim;
        ctx.fillText(hiText, world.width - 18, 36);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full select-none">
      <div
        className="relative w-full rounded-2xl overflow-hidden bg-black/20 border border-white/5 cursor-pointer"
        onClick={jump}
        onTouchStart={(e) => {
          e.preventDefault();
          jump();
        }}
        role="button"
        tabIndex={0}
        aria-label="Runner game — tap or press space to jump"
      >
        <canvas ref={canvasRef} className="block w-full" />
        {uiState !== "playing" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-zinc-950/60 backdrop-blur-[1px]">
            <p className="text-sm font-semibold text-slate-100">
              {uiState === "idle" ? "Tap / press Space to play" : `Game over — score ${score}`}
            </p>
            <p className="text-xs text-slate-400">
              {uiState === "over" ? "Tap to try again" : "Jump the flags while you wait"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
