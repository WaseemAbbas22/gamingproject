#!/usr/bin/env bash
# Install Forza Legends on a USB phone and stream logs (Flutter-style).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
GRADLEW="$ROOT/gradlew"
PKG="com.RomanAndAllyan.forzalegends"
LAUNCHER="$PKG/.EntryActivity"

if [[ ! -x "$ADB" ]]; then
  echo "adb not found at $ADB"
  echo "Install Android platform-tools or set ANDROID_HOME."
  exit 1
fi

"$ADB" start-server >/dev/null
mapfile -t DEVICES < <("$ADB" devices | awk 'NR>1 && $2=="device" {print $1}')

PHONE=""
for serial in "${DEVICES[@]}"; do
  if [[ "$serial" != emulator-* ]]; then
    PHONE="$serial"
    break
  fi
done

if [[ -z "$PHONE" ]]; then
  echo "No physical phone found."
  echo
  echo "On the phone:"
  echo "  1. Settings → About phone → tap Build number 7 times"
  echo "  2. Settings → Developer options → turn on USB debugging"
  echo "  3. Plug in the cable, choose File transfer / PTP (not Charge only)"
  echo "  4. Tap Allow on the USB debugging popup"
  echo
  echo "Then run this script again."
  echo
  echo "adb currently sees:"
  "$ADB" devices -l
  exit 1
fi

echo "Phone: $PHONE"
echo "Building and installing…"
cd "$ROOT"
export ANDROID_SERIAL="$PHONE"
./gradlew installDebug
"$ADB" -s "$PHONE" shell am force-stop "$PKG" || true
"$ADB" -s "$PHONE" shell am start -a android.intent.action.MAIN \
  -c android.intent.category.LAUNCHER -n "$LAUNCHER"
sleep 1
PID="$("$ADB" -s "$PHONE" shell pidof -s "$PKG" | tr -d '\r')"
echo
echo "App is running on the phone. Logs below (Ctrl+C to stop watching)."
echo
if [[ -n "${PID:-}" ]]; then
  "$ADB" -s "$PHONE" logcat -v time --pid="$PID"
else
  "$ADB" -s "$PHONE" logcat -v time ForzaWeb:D AndroidRuntime:E "$PKG":V *:S
fi
