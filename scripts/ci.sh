#!/bin/zsh
# Local CI: every gate in order, the device suites on a named device, and (--nightly) the latency suite with
# its JSON history and a regression gate. Each step's exit code and time go to .ci/runs/<stamp>.json.
#
#   scripts/ci.sh                         unit gates only (format, lint, typecheck, unit, agent unit, build)
#   scripts/ci.sh --device emulator-5580  + install the fixture, device suites (contract, smoke, stdio, perf)
#   scripts/ci.sh --device … --nightly    + latency suite into .ci/history.jsonl, gate against recent runs
#   scripts/ci.sh --ios <simulator id>    + the iOS runner build and the simulator suites (contract, perf, stdio)
#   scripts/ci.sh --iphone <UDID>         + the iPhone runner build and the iPhone suites (APPDYNO_IOS_* signing, and
#                                           APPDYNO_IPHONE_FIXTURE_APP: with no fixture its measures would not run)
#   scripts/ci.sh --all-on <serial>       + every suite that device can take, one file at a time (docs/reference/ci.md)
#
# Exits 1 when a step failed, and 3 when none did and something was postponed: what never ran is no pass.
#
# Coordination (optional): APPDYNO_BUSY_FILE — while it exists, measuring steps are skipped (reported as
# postponed); APPDYNO_LOCK_FILE — written while a measuring step runs, removed after.
set -u
cd "${0:A:h}/.."
serial=""; nightly=0; ios=""; iphone=""; all_on=""
while (( $# )); do
  case $1 in
    --device) serial=$2; shift 2 ;;
    --nightly) nightly=1; shift ;;
    --ios) ios=$2; shift 2 ;;
    --iphone) iphone=$2; shift 2 ;;
    --all-on) all_on=$2; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
if [[ -n $iphone && -z ${APPDYNO_IPHONE_FIXTURE_APP:-} ]]; then
  echo "--iphone needs APPDYNO_IPHONE_FIXTURE_APP: with no fixture its measures skip, and the step reads ok" >&2
  exit 2
fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p .ci/runs .ci/logs
results=()
failed=0
postponed=0
sweeping=0
step() { # name, command…
  local name=$1; shift
  local t0=$(date +%s)
  "$@" > .ci/logs/$stamp-$name.log 2>&1
  local code=$?
  local secs=$(( $(date +%s) - t0 ))
  results+=("{\"step\":\"$name\",\"exit\":$code,\"seconds\":$secs}")
  if (( code == 0 )); then echo "ok   $name (${secs}s)"
  elif (( code == 3 && sweeping )); then echo "none $name (${secs}s): ran nothing here, .ci/logs/$stamp-$name.log"
  else echo "FAIL $name (${secs}s): .ci/logs/$stamp-$name.log"; failed=1; fi
  return $code
}
busy() { [[ -n ${APPDYNO_BUSY_FILE:-} && -e $APPDYNO_BUSY_FILE ]]; }
ran() { # report name, test files…: exit 3 for a run that skipped all it holds, which vitest calls a pass
  local report=.ci/logs/$stamp-$1.json; shift
  mise exec -- npx vitest run --config vitest.device.config.ts --reporter=default --reporter=json --outputFile.json=$report "$@" || return $?
  mise exec -- node scripts/device-suites.mjs check $report
}
measuring() { # name, command…: skipped while busy, holds the lock while it runs
  local name=$1; shift
  if busy; then echo "skip $name (machine busy: $APPDYNO_BUSY_FILE)"; results+=("{\"step\":\"$name\",\"exit\":null,\"postponed\":true}"); postponed=1; return 0; fi
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
step agent zsh -c 'cd android && mise exec -- ./gradlew --console=plain :agent:testDebugUnitTest :agent:assembleDebug :fixture:assembleDebug :push-fixture:assembleDebug'
step build mise exec -- pnpm build
# the runner's platform-independent core (Xcode's Swift: the command line tools have no XCTest; skipped
# where there is no Xcode)
xcode=${DEVELOPER_DIR:-$(xcode-select -p)}
if [[ -d $xcode ]]; then
  step runner-core env DEVELOPER_DIR=$xcode zsh -c 'cd ios/RunnerCore && swift test -j 2'
fi

install_fixture() { "${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb" -s $1 install -r -g android/fixture/build/outputs/apk/debug/fixture-debug.apk; }
xb() { DEVELOPER_DIR=${DEVELOPER_DIR:-$(xcode-select -p)} xcodebuild build-for-testing -project ios/Appdyno.xcodeproj -scheme Runner -jobs 2 -quiet "$@"; }
ios_build() { xb -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/.derived; }
iphone_build() { xb -destination 'generic/platform=iOS' -derivedDataPath ios/.derived-device CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=; }

if [[ -n $serial ]]; then
  export APPDYNO_ANDROID_SERIAL=$serial
  step fixture-install install_fixture $serial
  step device-functional ran device-functional device-tests/android.test.ts device-tests/smoke.test.ts device-tests/mcp-stdio.test.ts
  measuring device-perf ran device-perf device-tests/perf.test.ts
  if (( nightly )); then
    measuring latency mise exec -- node packages/appdyno/dist/main.js bench --serial $serial --n 30 --max-load 8 --out .ci/runs/$stamp-latency.json
    if [[ -e .ci/runs/$stamp-latency.json ]]; then
      step regression-gate mise exec -- node scripts/ci-gate.mjs .ci/runs/$stamp-latency.json .ci/history.jsonl
    fi
  fi
fi

if [[ -n $ios ]]; then
  step ios-build ios_build
  export APPDYNO_IOS_UDID=$ios
  step ios-functional ran ios-functional device-tests/ios.test.ts device-tests/mcp-stdio.test.ts
  measuring ios-perf ran ios-perf device-tests/ios-perf.test.ts
fi
if [[ -n $iphone ]]; then
  step iphone-build iphone_build
  export APPDYNO_IPHONE_UDID=$iphone
  step iphone-functional ran iphone-functional device-tests/iphone.test.ts device-tests/iphone-mcp.test.ts
fi

if [[ -n $all_on ]]; then
  suites=("${(@f)$(mise exec -- node scripts/device-suites.mjs of $all_on)}")
  variable=$suites[1]
  shift suites
  export $variable=$all_on
  case $variable in
    APPDYNO_ANDROID_SERIAL) step fixture-install install_fixture $all_on ;;
    APPDYNO_IOS_UDID) step ios-build ios_build ;;
    APPDYNO_IPHONE_UDID) step iphone-build iphone_build ;;
  esac
  # a file with a gate of its own reads `none`, and fails nothing: this sweeps, where a suite named above is asked for
  sweeping=1
  for file in $suites; do
    step ${file:t:r} ran ${file:t:r} $file
  done
  sweeping=0
fi

{
  printf '{"stamp":"%s","commit":"%s","device":"%s","nightly":%s,"steps":[%s]}\n' \
    "$stamp" "$(git rev-parse --short HEAD)" "$serial" "$( (( nightly )) && echo true || echo false)" "${(j:,:)results}"
} > .ci/runs/$stamp.json
echo "run: .ci/runs/$stamp.json"
if (( failed )); then exit 1; fi
if (( postponed )); then echo "postponed steps did not run: this is no pass" >&2; exit 3; fi
exit 0
