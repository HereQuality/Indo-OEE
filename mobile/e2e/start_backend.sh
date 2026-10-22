#!/usr/bin/env bash
# Boots a SAFE local backend for phone-app e2e: throwaway in-memory mongod +
# throwaway redis + the real server/ code, seeded. Never touches server/.env
# or Atlas. Stop with mobile/e2e/stop_backend.sh.
set -euo pipefail
E2E="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$E2E/../.." && pwd)"
RUN="$E2E/.run"
PORT="${E2E_PORT:-5099}"
REDIS_PORT="${E2E_REDIS_PORT:-6399}"

guard() { # abort on anything that is not a local throwaway mongod
  case "$1" in
    *mongodb+srv*|*mongodb.net*|*atlas*) echo "E2E SAFETY: refusing Atlas/SRV Mongo URI" >&2; exit 99;;
    mongodb://127.0.0.1:*|mongodb://localhost:*) ;;
    *) echo "E2E SAFETY: MONGO_URI must be mongodb://127.0.0.1:<port>/..." >&2; exit 99;;
  esac
}
# A MONGO_URI inherited from the caller's shell is never used; we say so loudly.
if [ -n "${MONGO_URI:-}" ]; then guard "$MONGO_URI"; echo "[e2e] ignoring inherited MONGO_URI; using a fresh throwaway mongod"; fi

"$E2E/stop_backend.sh" >/dev/null 2>&1 || true
for pt in "$PORT" "$REDIS_PORT"; do
  if lsof -nP -iTCP:"$pt" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "E2E: port $pt is already in use by something this script did not start (kill it or set E2E_PORT / E2E_REDIS_PORT)" >&2; exit 98
  fi
done
rm -rf "$RUN"; mkdir -p "$RUN/logs"

if [ ! -d "$E2E/.tools/node_modules/mongodb-memory-server" ]; then
  echo "[e2e] installing mongodb-memory-server into mobile/e2e/.tools (repo package.json untouched)"
  (cd "$E2E/.tools" && npm install --no-audit --no-fund >/dev/null)
fi

echo "[e2e] starting throwaway mongod"
node "$E2E/daemon.js" "$RUN/mongo.pid" "$RUN/mongo.log" "$E2E" -- node "$E2E/mongo_mem.js"
for _ in $(seq 1 180); do [ -s "$RUN/mongo_uri" ] && break; kill -0 "$(cat "$RUN/mongo.pid")" 2>/dev/null || { cat "$RUN/mongo.log"; exit 1; }; sleep 1; done
[ -s "$RUN/mongo_uri" ] || { echo "mongod did not start"; cat "$RUN/mongo.log"; exit 1; }
E2E_MONGO_URI="$(cat "$RUN/mongo_uri")"
guard "$E2E_MONGO_URI"

echo "[e2e] starting throwaway redis on :$REDIS_PORT"
if command -v redis-server >/dev/null; then
  node "$E2E/daemon.js" "$RUN/redis.pid" "$RUN/redis.log" "$RUN" -- redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --save "" --appendonly no --dir "$RUN"
  sleep 1
else
  echo "[e2e] WARNING: redis-server not installed; profile-queue jobs will log connection errors (harmless for e2e)"
fi

# Minimal explicit environment (env -i): nothing from the caller's shell or any .env leaks in.
BASE_ENV=(env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development PORT="$PORT" E2E_PORT="$PORT"
  MONGO_URI="$E2E_MONGO_URI"
  JWT_SECRET=e2e-dummy-jwt-secret JWT_EXPIRES_IN=1d JWT_REFRESH_SECRET=e2e-dummy-refresh-secret JWT_REFRESH_EXPIRES_IN=7d JWT_COOKIE_EXPIRES_IN=7
  REDIS_HOST=127.0.0.1 REDIS_PORT="$REDIS_PORT" LOG_DIR="$RUN/logs" LOG_LEVEL=info APP_NAME=indo-e2e)

echo "[e2e] seeding"
(cd "$RUN" && "${BASE_ENV[@]}" node "$E2E/seed_e2e.js")

echo "[e2e] starting real server on :$PORT (cwd=$RUN so server/.env is never read)"
"${BASE_ENV[@]}" node "$E2E/daemon.js" "$RUN/server.pid" "$RUN/server.log" "$RUN" -- node "$REPO/server/server.js"
for _ in $(seq 1 60); do
  curl -fs "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && { echo "[e2e] backend ready: http://127.0.0.1:$PORT  (emulator: http://10.0.2.2:$PORT)"; exit 0; }
  sleep 1
done
echo "server did not become healthy"; tail -30 "$RUN/server.log"; exit 1
