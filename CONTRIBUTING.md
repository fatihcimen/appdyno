# Contributing

## Setup

You need macOS, Xcode (for the iOS parts) and the Android SDK with `adb` (for the Android parts).

```sh
mise install        # Node 22, pnpm 10, JDK 21 (see .mise.toml)
pnpm install
```

JDK 21 is for the Android agent only. Users of the published package do not need it.

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test      # no device, no build
(cd android && ./gradlew --console=plain :agent:testDebugUnitTest)
(cd ios/RunnerCore && swift test)             # the iOS runner's core
```

`pnpm lint` runs eslint and `prettier --check`; `pnpm format` fixes formatting. The same checks run in
`.github/workflows/ci.yml`.

## Device suites

These need a real emulator, simulator or phone, and you name it. There is never a default device, because
other devices may be attached.

```sh
(cd android && ./gradlew :agent:assembleDebug :fixture:assembleDebug)
adb -s <serial> install -r -g android/fixture/build/outputs/apk/debug/fixture-debug.apk
APPDYNO_ANDROID_SERIAL=<serial> APPDYNO_IOS_UDID=<udid> pnpm test:device
```

Set only the variable of the device you have. `APPDYNO_IPHONE_UDID` runs the iPhone suites and needs the
signing variables from the README. See `vitest.device.config.ts` and `docs/ci.md`. `scripts/ci.sh` runs
every gate locally and records the results.

## Modules

Each package under `packages/` may import only the packages its rule allows. For example `core` may import
`protocol` and nothing else, and `driver-android` and `driver-apple` never import each other. The rules
and the test that enforces them are in `packages/appdyno/test/boundaries.test.ts`. Change the rule there
if the architecture needs it, not around it.

`packages/appdyno/test/structure.test.ts` keeps a file in `packages/*/src` to one job and to 430 lines, but for
the ones it names with a reason, and refuses a run of 8 lines that appears twice. What both drivers do belongs
in `core`.

## Commits

One change per commit, with a short message in the style of `git log --oneline -15`: `type: what changed`,
with `type` one of `feat`, `fix`, `refactor`, `test`, `docs`, and an optional scope, as in `fix(ios): ...`.

## Comments

Write a comment only for the why that the code cannot show. Do not restate what the code does. Fixtures
and tests use neutral English names.
