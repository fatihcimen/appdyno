# Contributing

Everyone here follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

You need macOS, Node 26 and pnpm 12. Node 22 is the oldest appdyno runs on, and CI tests on it too.

```sh
mise install        # Node 26, pnpm 12, JDK 25 and the linters (see .mise.toml)
pnpm install
pnpm run ci         # lint, types, tests, build
```

That runs on a clean clone, with no device, no Xcode project and no JDK.

To work on a device you need more: Xcode for iOS, and the Android SDK with `adb` for Android. Build the Android agent
once, and again when you change it. Users of the published package do not need a JDK.

```sh
(cd android && ./gradlew :agent:assembleDebug)
pnpm build          # packages the agent; a package without it refuses to leave this Mac
```

## Checks

```sh
pnpm run ci
scripts/lint-native.sh                        # all that is not TypeScript; needs Xcode
(cd android && ./gradlew --console=plain :agent:testDebugUnitTest)
(cd ios/RunnerCore && swift test)             # the iOS runner's core
```

`pnpm lint` runs eslint and `prettier --check`; `pnpm format` fixes formatting. The same checks run in
`.github/workflows/ci.yml`. eslint holds the paths in `strict` in `eslint.config.js` to typescript-eslint's
`strictTypeChecked` and `stylisticTypeChecked`, with the compiler's types; a package goes in that list once it is clean
under them.

`scripts/lint-native.sh` runs the linters `.mise.toml` pins, and fails on any warning: shellcheck and shfmt for the
shell scripts (`ci.sh` is zsh, which shellcheck does not read, so `zsh -n` parses it), actionlint and zizmor for the
workflows, SwiftLint by `.swiftlint.yml` with `--strict`, `brew style` for the cask in CI (it installs gems into
Homebrew, so on a Mac of your own `ruby -c` stands in), and for the Objective-C clang-format by `.clang-format`, Xcode's
recommended warnings as errors, and the clang static analyzer. `clang-format -i <file>` fixes a format, now and then in
a second pass. A parameter an API's block or callback gives and the code leaves unread is marked `__unused`. The
warnings are the lint's alone: the flags a Mac compiles the viewer and helpers with on first use stay as they are, as a
newer clang's new warning must not leave a person with no viewer. `android/.editorconfig` holds ktlint's rules for the
Kotlin.

`pnpm typecheck` holds every `.mjs` and the configs at the root to the packages' types too, by the root `tsconfig.json`:
a script is run by hand and no test reaches it. That config lets a parameter go untyped, under which an empty array that
fills later needs a type.

## Device suites

These need a real emulator, simulator or phone, and you name it. There is never a default device, because
other devices may be attached.

```sh
(cd android && ./gradlew :agent:assembleDebug :fixture:assembleDebug :push-fixture:assembleDebug)
adb -s <serial> install -r -g android/fixture/build/outputs/apk/debug/fixture-debug.apk
adb -s <serial> install -r -g android/push-fixture/build/outputs/apk/debug/push-fixture-debug.apk
(cd ios && xcodebuild build-for-testing -project Appdyno.xcodeproj -scheme Runner \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath .derived)
APPDYNO_ANDROID_SERIAL=<serial> APPDYNO_IOS_UDID=<udid> pnpm test:device
```

Set only the variable of the device you have. The iOS build makes the runner and the fixture app, which each
simulator suite installs. `APPDYNO_IPHONE_UDID` runs the iPhone suites and needs the
signing variables in [Tools](docs/reference/tools.md#reaching-a-phone). See `vitest.device.config.ts` and `docs/reference/ci.md`. `scripts/ci.sh` runs
every gate locally and records the results.

Close the hub on a device a suite uses. A suite keeps its state in a folder of its own, by `APPDYNO_STATE_DIR`, so it
cannot share the agent of a hub, which keeps to the default one, as neither can read the other's token and a device has
room for one agent. A hub finds a suite's agent in use and stops with `AGENT_CONFLICT`, and so does a suite that finds a
hub's. A hub takes a running emulator or simulator by itself, so a suite between two connections can still lose its
agent to one left open, and a phone may keep from a shell the table that shows who is connected.

## Modules

Each package under `packages/` may import only the packages its rule allows. For example `core` may import
`protocol` and nothing else, and `driver-android` and `driver-apple` never import each other. The rules
and the test that enforces them are in `packages/appdyno/test/boundaries.test.ts`. A package's tests keep
to its rule too, but for the few the test names. Change the rule there if the architecture needs it, not around it.

`packages/appdyno/test/structure.test.ts` keeps a file in `packages/*/src`, and every `.kt`, `.swift`, `.m` and `.h`
we wrote, to one job and to 450 lines, but for the ones it names with a reason, and refuses a run of 8 lines that
appears twice. What both drivers do belongs in `core`; what the iOS runner decides without a device belongs in
`ios/RunnerCore`, and the Android agent's in a class of its own with no framework in it, where a unit test reaches it.

`packages/appdyno/test/function-size.test.ts` does the same for a TypeScript function, at 200 lines, a closure inside it
counted by itself too: a file's limit never sees one closure that holds a class's worth of state. The ones over it are
named, each with what is long about it.

`packages/ops` is what a client calls, `packages/hub` the hub's and a window's controller on top of it. What the hub takes
from `ops` is what `ops` lets out in its `index.ts`, and the rule above keeps `ops` from importing the hub.

## A new platform

A platform is one driver package: a `DeviceProvider` for each kind of device it lists by a tool of its own (Apple's
simulators and iPhones are two), a `Device`, a `PlatformScreen` and a `MeasureSource`, each of which the compiler holds
to the whole port, with `cannot` for what it has no way of measuring. Outside the package it takes `PLATFORMS` in
`packages/protocol/src/messages.ts`, the tables keyed by it in `packages/core/src/device.ts` and
`packages/perf/src/dashboard/format.ts`, its providers in `packages/appdyno/src/providers.ts` and its rule in
`boundaries.test.ts`. `packages/appdyno/test/platforms.test.ts` holds the list.

## Words used here

Some names here carry a meaning of their own:

- A **place** is what stands in the hub's window where a device would: AI Clients and Help. `HubServices` is what they ask of this Mac.
- **Words** are text for a person, in `WordsTable.m` and `wordsOf`, and a **need** is what stands between a person and a device, with its fix.
- **said** and **heard** are what a process wrote and what the other side took from it, on the viewer's wire or a command's output.
- To **keep** a run is to save its records for the gate, and a **source** is what a window shows from, or what measured a number.

## Commits

One change per commit, with a short message in the style of `git log --oneline -15`: `type: what changed`,
with `type` one of `feat`, `fix`, `refactor`, `test`, `docs`, and an optional scope, as in `fix(ios): ...`.

## Comments

Write a comment only for the why that the code cannot show. Do not restate what the code does. Fixtures
and tests use neutral English names.

## Types and the strict lint

A package in `strict` meets typescript-eslint's type-checked rules by its code: a rule is turned off for one line only,
with `-- why`, where it is wrong there, and `eslint.config.js` says why for each it tunes. A fix never changes what the
code does.

- A `!` gives way to what the compiler can follow: a destructuring or a loop over entries in place of an index, one
  `get` and a check in place of `has` then `get!`, a value an `if` narrowed held in a `const`. Where the code knows what
  the types cannot (an index within bounds, a key it set, a regex's group), core's `must(value, 'what')` throws naming
  what is missing, where a `!` went on with undefined; `protocol`, which imports nothing, checks with an `if`. Never
  `as` in its place. In a test, vitest's `assert(x)` narrows, and `?.` will do inside an `expect` whose matcher fails on
  undefined.
- An `async` function with no `await` is a plain one where no caller needs a promise of it, and its callers lose their
  `await`. Where its type or a caller needs one (a port, a fake of one, a `.catch` on it), it returns
  `Promise.resolve(x)`, and `Promise.reject(e)` in place of a `throw`, which a `.catch` would miss; a body that may
  throw on its own goes in `new Promise((resolve) => { resolve(work()); })`.
- What comes from outside (JSON, the wire, a device, a file, the environment, argv, a tool's output) is `unknown`, or a
  type that says what may be missing, until a schema or a check narrows it, so that a check on it is one the types need
  too: `no-unnecessary-condition` never takes one away. JSON whose shape the code wrote itself is cast at the call,
  never by a generic that hides it. A `catch` callback takes `(e: unknown)`, and reads it by
  `e instanceof Error ? e.message : String(e)`.
- A flag a callback sets, which the compiler takes for the value it starts with, is `let done = false as boolean`, as
  typescript-eslint advises for that, with a word on why.
- `||` stays for strings and booleans, where `''` and `false` fall through as meant; a number or an object takes `??`,
  unless `0` should fall through too, which the line then says.
- What is handed around unbound (`stop`, a fake's members) is an arrow or bound. A mock is read in a test as the mock it
  is, never off its port's type.
- A template holds strings and numbers: an undefined goes by narrowing where it cannot be, and `String(x)` keeps the
  text where it is meant. vitest's asymmetric matchers are typed `any`: one inside an object is `as unknown`.
- `void` in a union is `undefined`, and a function that answers nothing says `Promise<undefined>`, as TypeScript takes
  no `return` for `void`.

## Docs

[The docs](docs/README.md) hold guides, which take a reader through a task, and a reference to look things up in. A new
page goes in one of those and in the index. A number in the docs is one you ran: say on what, and with what load.

Diagrams are hand-written SVG in `docs/images`, one file each, with no generator. Each has its own ground and both
themes inside it, so it reads on any page and follows GitHub's theme. To draw one, copy the style block of another and
keep to its shapes: blue is your Mac, teal or violet the device, pink whoever is asking. Look at it in both themes.
`packages/appdyno/test/docs.test.ts` holds them to the code, and every link in the docs to a real target.
