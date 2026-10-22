#!/usr/bin/env bash
# Fast iteration: run one integration test file on the already-running emulator + backend
# (start both once with:  E2E_KEEP=1 mobile/e2e/run_e2e.sh integration_test/smoke_test.dart).
#   mobile/e2e/dev_run.sh integration_test/explore_test.dart
set -uo pipefail
E2E="$(cd "$(dirname "$0")" && pwd)"; MOBILE="$(cd "$E2E/.." && pwd)"
PORT="${E2E_PORT:-5099}"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
DEVICE="${E2E_DEVICE:-$("$SDK/platform-tools/adb" devices | awk '/^emulator-[0-9]+\tdevice/ {print $1; exit}')}"
[ -n "$DEVICE" ] || { echo "no emulator running"; exit 1; }
if [ -z "${JAVA_HOME:-}" ] && [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi
cd "$MOBILE"
mkdir -p "$E2E/shots"
# A test prints "E2E_SHOT:<name>"; we grab the emulator screen right then (adb screencap).
TOKENS="$(node "$E2E/mint_tokens.js")"
flutter test "$1" -d "$DEVICE" --dart-define=API_BASE_URL="http://10.0.2.2:$PORT" --dart-define=E2E_TOKENS="$TOKENS" "${@:2}" 2>&1 | grep --line-buffered -v '^WARNING' | while IFS= read -r line; do
  echo "$line"
  case "$line" in
    *E2E_SHOT:*) name="${line##*E2E_SHOT:}"; name="${name%% *}"; "$SDK/platform-tools/adb" -s "$DEVICE" exec-out screencap -p > "$E2E/shots/$name.png" 2>/dev/null || true;;
  esac
done
exit "${PIPESTATUS[0]}"
