#!/bin/zsh
# Local CI: every gate in order, the device suites on a named device, and (--nightly) the latency suite with
# its JSON history and a regression gate. Each step's exit code and time go to .ci/runs/<stamp>.json.
#
#   scripts/ci.sh                         unit gates only (format, lint, typecheck, unit, agent unit, build)
#   scripts/ci.sh --device emulator-5580  + install the fixture, device suites (contract, smoke, stdio, perf)
#   scripts/ci.sh --device … --nightly    + latency suite into .ci/history.jsonl, gate against recent runs
#   scripts/ci.sh --ios <simulator id>    + the iOS runner build and the simulator suites (contract, perf, stdio)
#   scripts/ci.sh --iphone <UDID>         + the iPhone runner build and the iPhone suites (APPDYNO_IOS_* signing)
#
# Coordination (optional): APPDYNO_BUSY_FILE — while it exists, measuring steps are skipped (reported as
# postponed); APPDYNO_LOCK_FILE — written while a measuring step runs, removed after.
set -u
cd "${0:A:h}/.."
serial=""; nightly=0; ios=""; iphone=""
while (( $# )); do
  case $1 in
    --device) serial=$2; shift 2 ;;
    --nightly) nightly=1; shift ;;
    --ios) ios=$2; shift 2 ;;
    --iphone) iphone=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p .ci/runs .ci/logs
results=()
failed=0
step() { # name, command…
  local name=$1; shift
  local t0=$(date +%s)
  "$@" > .ci/logs/$stamp-$name.log 2>&1
  local code=$?
  local secs=$(( $(date +%s) - t0 ))
  results+=("{\"step\":\"$name\",\"exit\":$code,\"seconds\":$secs}")
  if (( code == 0 )); then echo "ok   $name (${secs}s)"; else echo "FAIL $name (${secs}s): .ci/logs/$stamp-$name.log"; failed=1; fi
  return $code
}
busy() { [[ -n ${APPDYNO_BUSY_FILE:-} && -e $APPDYNO_BUSY_FILE ]]; }
measuring() { # name, command…: skipped while busy, holds the lock while it runs
  local name=$1; shift
  if busy; then echo "skip $name (machine busy: $APPDYNO_BUSY_FILE)"; results+=("{\"step\":\"$name\",\"exit\":null,\"postponed\":true}"); return 0; fi
  [[ -n ${APPDYNO_LOCK_FILE:-} ]] && echo "start=$(date -u +%FT%TZ) what=ci-$name pid=$$" > $APPDYNO_LOCK_FILE
  step "$name" "$@"; local code=$?
  [[ -n ${APPDYNO_LOCK_FILE:-} ]] && rm -f $APPDYNO_LOCK_FILE
  return $code
}

step install mise exec -- pnpm install --frozen-lockfile
step format mise exec -- pnpm exec prettier --check .
step lint mise exec -- pnpm lint
step typecheck mise exec -- pnpm typecheck
step unit mise exec -- pnpm test
step agent zsh -c 'cd android && mise exec -- ./gradlew --console=plain :agent:testDebugUnitTest :agent:assembleDebug :fixture:assembleDebug'
step build mise exec -- pnpm build
# the runner's platform-independent core (Xcode's Swift: the command line tools have no XCTest; skipped
# where there is no Xcode)
xcode=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
if [[ -d $xcode ]]; then
  step runner-core env DEVELOPER_DIR=$xcode zsh -c 'cd ios/RunnerCore && swift test -j 2'
fi

if [[ -n $serial ]]; then
  export APPDYNO_ANDROID_SERIAL=$serial
  step fixture-install "${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb" -s $serial install -r -g android/fixture/build/outputs/apk/debug/fixture-debug.apk
  step device-functional mise exec -- npx vitest run --config vitest.device.config.ts test-device/android.test.ts test-device/smoke.test.ts test-device/mcp-stdio.test.ts
  measuring device-perf mise exec -- npx vitest run --config vitest.device.config.ts test-device/perf.test.ts
  if (( nightly )); then
    measuring latency mise exec -- node packages/host/dist/cli.js bench --serial $serial --n 30 --max-load 8 --out .ci/runs/$stamp-latency.json
    if [[ -e .ci/runs/$stamp-latency.json ]]; then
      step regression-gate mise exec -- node scripts/ci-gate.mjs .ci/runs/$stamp-latency.json .ci/history.jsonl
    fi
  fi
fi

if [[ -n $ios || -n $iphone ]]; then
  export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
  xb() { xcodebuild build-for-testing -project ios/Appdyno.xcodeproj -scheme Runner -jobs 2 -quiet "$@"; }
fi
if [[ -n $ios ]]; then
  step ios-build xb -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/.derived
  export APPDYNO_IOS_UDID=$ios
  step ios-functional mise exec -- npx vitest run --config vitest.device.config.ts test-device/ios.test.ts test-device/mcp-stdio.test.ts
  measuring ios-perf mise exec -- npx vitest run --config vitest.device.config.ts test-device/ios-perf.test.ts
fi
if [[ -n $iphone ]]; then
  step iphone-build xb -destination 'generic/platform=iOS' -derivedDataPath ios/.derived-device CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=
  export APPDYNO_IPHONE_UDID=$iphone
  step iphone-functional mise exec -- npx vitest run --config vitest.device.config.ts test-device/iphone.test.ts test-device/iphone-mcp.test.ts
fi

{
  printf '{"stamp":"%s","commit":"%s","device":"%s","nightly":%s,"steps":[%s]}\n' \
    "$stamp" "$(git rev-parse --short HEAD)" "$serial" "$( (( nightly )) && echo true || echo false)" "${(j:,:)results}"
} > .ci/runs/$stamp.json
echo "run: .ci/runs/$stamp.json"
exit $failed
