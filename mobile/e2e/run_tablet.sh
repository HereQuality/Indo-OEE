#!/usr/bin/env bash
# Tablet + landscape sanity on the (phone) emulator: resizes the display with `wm size` / `wm density`,
# runs integration_test/tablet_layout_test.dart for each size, and ALWAYS resets the display afterwards.
# Needs the backend + emulator already up (E2E_KEEP=1 mobile/e2e/run_e2e.sh integration_test/smoke_test.dart).
#   mobile/e2e/run_tablet.sh
set -uo pipefail
E2E="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"; ADB="$SDK/platform-tools/adb"
DEVICE="${E2E_DEVICE:-$("$ADB" devices | awk '/^emulator-[0-9]+\tdevice/ {print $1; exit}')}"
[ -n "$DEVICE" ] || { echo "no emulator running"; exit 1; }
PHYS="$("$ADB" -s "$DEVICE" shell wm size | awk '/Physical/ {print $3}' | tr -d '\r')"
PDPI="$("$ADB" -s "$DEVICE" shell wm density | awk '/Physical/ {print $3}' | tr -d '\r')"
W="${PHYS%x*}"; H="${PHYS#*x}"
SHORT=$(( (W < H ? W : H) * 160 / PDPI ))
reset() {
  "$ADB" -s "$DEVICE" shell wm size reset; "$ADB" -s "$DEVICE" shell wm density reset
  "$ADB" -s "$DEVICE" shell settings put system user_rotation 0; "$ADB" -s "$DEVICE" shell settings put system accelerometer_rotation 1
}
trap reset EXIT
rc=0
if [ "$SHORT" -ge 600 ]; then
  # A real tablet AVD (e.g. Tablet_API35, Pixel Tablet 1280x800 dp): rotate it, no resizing needed.
  "$ADB" -s "$DEVICE" shell settings put system accelerometer_rotation 0
  for cfg in "1:tablet_portrait" "0:tablet_landscape"; do
    IFS=: read -r rot name <<<"$cfg"
    echo "=== $name: rotation $rot (device short side ${SHORT} dp)"
    "$ADB" -s "$DEVICE" shell settings put system user_rotation "$rot"
    sleep 3
    "$E2E/dev_run.sh" integration_test/tablet_layout_test.dart --dart-define=E2E_SHOT_TAG="$name" || rc=1
  done
  exit $rc
fi
# A phone AVD: fake it with wm size/density. 1000x1600 @ 213 = 750x1200 dp (portrait, past the dashboard's 700 dp
# tablet breakpoint); 1600x1000 @ 213 = 1200x750 dp (landscape).
for cfg in "1000x1600:213:tablet_portrait" "1600x1000:213:tablet_landscape"; do
  IFS=: read -r size dpi name <<<"$cfg"
  echo "=== $name: wm size $size density $dpi"
  "$ADB" -s "$DEVICE" shell wm size "$size"; "$ADB" -s "$DEVICE" shell wm density "$dpi"
  sleep 3
  "$E2E/dev_run.sh" integration_test/tablet_layout_test.dart --dart-define=E2E_SHOT_TAG="$name" || rc=1
done
exit $rc
