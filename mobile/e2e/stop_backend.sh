#!/usr/bin/env bash
# Stops everything start_backend.sh started (only processes it recorded).
E2E="$(cd "$(dirname "$0")" && pwd)"; RUN="$E2E/.run"
for n in server redis mongo; do
  [ -f "$RUN/$n.pid" ] && kill "$(cat "$RUN/$n.pid")" 2>/dev/null || true
done
sleep 1
for n in server redis mongo; do
  [ -f "$RUN/$n.pid" ] && kill -9 "$(cat "$RUN/$n.pid")" 2>/dev/null || true
done
echo "[e2e] backend stopped"
