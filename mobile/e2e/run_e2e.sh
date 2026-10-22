#!/usr/bin/env bash
# End-to-end run: throwaway backend + Android emulator + Flutter integration tests.
#   mobile/e2e/run_e2e.sh                       # all of mobile/integration_test as e2e_vmc
#   E2E_USER=e2e_multi mobile/e2e/run_e2e.sh integration_test/smoke_test.dart
# Env: E2E_PORT (5099)  E2E_AVD (Pixel_9_Pro)  E2E_DEVICE (use this adb device instead of booting one)
#      E2E_VERIFY_HTTP=1 (also run verify_http.js)  E2E_HEADLESS=0 (show the emulator window)  E2E_KEEP=1 (leave backend/emulator running)
set -euo pipefail
E2E="$(cd "$(dirname "$0")" && pwd)"
MOBILE="$(cd "$E2E/.." && pwd)"
PORT="${E2E_PORT:-5099}"
AVD="${E2E_AVD:-Pixel_9_Pro}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
ADB="$SDK/platform-tools/adb"
EMU="$SDK/emulator/emulator"
E2E_USER="${E2E_USER:-e2e_vmc}"
TARGET="${1:-integration_test}"
# Android Studio's bundled JDK (Gradle 9 in this project works with it).
if [ -z "${JAVA_HOME:-}" ] && [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi
export ANDROID_HOME="$SDK"

STARTED_EMU=0
cleanup() {
  rc=$?
  if [ "${E2E_KEEP:-0}" != "1" ]; then
    [ "$STARTED_EMU" = 1 ] && "$ADB" -s "$DEVICE" emu kill >/dev/null 2>&1 || true
    "$E2E/stop_backend.sh" || true
  fi
  exit $rc
}
trap cleanup EXIT

"$E2E/start_backend.sh"
# Optional: E2E_VERIFY_HTTP=1 also runs the HTTP checks (it saves rows dated yesterday).
[ "${E2E_VERIFY_HTTP:-0}" = "1" ] && node "$E2E/verify_http.js"

# ── device ──────────────────────────────────────────────────────────────────
DEVICE="${E2E_DEVICE:-}"
if [ -z "$DEVICE" ]; then
  DEVICE="$("$ADB" devices | awk '/^emulator-[0-9]+\tdevice/ {print $1; exit}')"
fi
if [ -z "$DEVICE" ]; then
  echo "[e2e] booting emulator $AVD"
  FLAGS=(-avd "$AVD" -no-audio -no-snapshot -gpu swiftshader_indirect -no-boot-anim)
  [ "${E2E_HEADLESS:-1}" = "1" ] && FLAGS+=(-no-window)
  mkdir -p "$E2E/.run"
  node "$E2E/daemon.js" "$E2E/.run/emulator.pid" "$E2E/.run/emulator.log" "$E2E" -- "$EMU" "${FLAGS[@]}"
  STARTED_EMU=1
  "$ADB" start-server >/dev/null 2>&1 || true
  for _ in $(seq 1 120); do
    DEVICE="$("$ADB" devices | awk '/^emulator-[0-9]+\t/ {print $1; exit}')"; [ -n "$DEVICE" ] && break; sleep 2
  done
  [ -n "$DEVICE" ] || { echo "emulator never appeared"; tail -20 "$E2E/.run/emulator.log"; exit 1; }
  for _ in $(seq 1 180); do
    [ "$("$ADB" -s "$DEVICE" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break; sleep 2
  done
  [ "$("$ADB" -s "$DEVICE" shell getprop sys.boot_completed | tr -d '\r')" = "1" ] || { echo "emulator did not finish booting"; exit 1; }
  sleep 5
fi
echo "[e2e] device: $DEVICE"
# The emulator reaches the host's backend at 10.0.2.2; prove it from inside the device.
"$ADB" -s "$DEVICE" shell "toybox nc -w 3 10.0.2.2 $PORT </dev/null >/dev/null 2>&1; echo reach=\$?" 2>/dev/null | tail -1 || true

PASSWORD="$(node -pe "JSON.parse(require('fs').readFileSync('$E2E/e2e_env.json','utf8')).users['$E2E_USER'].password")"
cd "$MOBILE"
flutter test "$TARGET" -d "$DEVICE" \
  --dart-define=API_BASE_URL="http://10.0.2.2:$PORT" \
  --dart-define=E2E_USER="$E2E_USER" \
  --dart-define=E2E_PASSWORD="$PASSWORD" \
  --dart-define=E2E_TOKENS="$(node "$E2E/mint_tokens.js")"
