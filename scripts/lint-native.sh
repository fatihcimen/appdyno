#!/usr/bin/env bash
# The linters of all that is not TypeScript, at the versions .mise.toml pins (`mise install`), with this Mac's
# Xcode and a JDK: the shell scripts, the workflows, the cask, the Swift, the Kotlin and Android Lint, and the
# Objective-C's format, warnings and static analysis. Exits 1 when any of them finds something.
set -u
cd "$(dirname "$0")/.." || exit 2
failed=0
check() { # name, command…
  local name=$1
  shift
  if "$@"; then echo "ok   $name"; else
    echo "FAIL $name"
    failed=1
  fi
}

# android/gradlew is Gradle's own, written again by `gradle wrapper`
posix=(scripts/install.sh scripts/lint-native.sh mac/App/appdyno mac/App/no-tool)
check shellcheck shellcheck "${posix[@]}"
check shfmt shfmt -i 2 -ci -d "${posix[@]}"
# ShellCheck reads no zsh: ci.sh is zsh's to parse, and shfmt's to format
check ci.sh zsh -n scripts/ci.sh
check ci.sh-format shfmt -ln zsh -i 2 -ci -d scripts/ci.sh

check actionlint actionlint
# a token adds the audits that ask GitHub, as CI has
check zizmor zizmor --no-progress .github/workflows

if [[ -n ${GITHUB_ACTIONS:-} ]]; then
  # as a release fills it in (scripts/build-app.mjs), and where a tap holds it, which Homebrew's rules for a cask need
  tap=$(mktemp -d)
  mkdir "$tap/Casks"
  manifest=packages/appdyno/package.json
  version=$(node -p "require('./$manifest').version")
  repository=$(node -p "require('./$manifest').repository.url.replace(/^git\+/, '').replace(/\.git\$/, '')")
  sed -e "s|@VERSION@|$version|g" -e "s|@SHA256@|$(printf '%064d' 0)|g" -e "s|@REPOSITORY@|$repository|g" \
    mac/App/appdyno.rb >"$tap/Casks/appdyno.rb"
  check cask brew style "$tap/Casks/appdyno.rb"
else
  # brew style installs its gems into Homebrew and turns on its developer mode: that is for a runner's Homebrew
  check cask ruby -c mac/App/appdyno.rb
fi

# by .swiftlint.yml; --strict: a warning fails as an error does
check swiftlint swiftlint lint --strict --quiet

# by android/.editorconfig; then AGP's own lint, by each module's lint.xml, a warning an error (build.gradle.kts)
check ktlint ktlint --relative 'android/*/src/**/*.kt' 'android/*.kts' 'android/*/*.kts'
check android-lint android/gradlew -p android --console=plain --quiet :agent:lintDebug :fixture:lintDebug :push-fixture:lintDebug

objc=(mac/Viewer/*.m mac/Viewer/*.h mac/App/*.m mac/TextScan/*.m ios/SimHelper/*.m)
check clang-format clang-format --dry-run --Werror "${objc[@]}"

# Xcode's recommended warnings, on top of -Wall -Wextra. Here and not in the flags a user's Mac compiles with on
# first use, where a newer clang's new warning would leave it with no viewer.
warnings=(
  -Werror -Wall -Wextra
  -Wblock-capture-autoreleasing -Wbool-conversion -Wcomma -Wconditional-uninitialized -Wconstant-conversion
  -Wdeprecated-implementations -Wdeprecated-objc-isa-usage -Wdocumentation -Wduplicate-method-match
  -Wempty-body -Wenum-conversion -Wimplicit-retain-self -Winfinite-recursion -Wint-conversion
  -Wnon-literal-null-conversion -Wobjc-literal-conversion -Wobjc-root-class -Wquoted-include-in-framework-header
  -Wrange-loop-analysis -Wshorten-64-to-32 -Wstrict-prototypes -Wundeclared-selector -Wunguarded-availability
  -Wunreachable-code -Wunused-function -Wunused-variable
)
# as the app's build has them: the oldest Mac it runs on, and the simulator's helpers as simhelper.ts builds them
macos=(clang -fobjc-arc -mmacosx-version-min=13.5)
simulator=(--sdk iphonesimulator clang -fobjc-arc -arch arm64 -mios-simulator-version-min=17.0)
viewer=() viewer_test=()
for f in mac/Viewer/*.m; do
  viewer_test+=("$f")
  case ${f##*/} in SelfTest* | Fixtures*) ;; *) viewer+=("$f") ;; esac
done
compiles() { # name, xcrun's words…
  local name=$1
  shift
  check "$name" xcrun "$@" -fsyntax-only "${warnings[@]}"
}
compiles viewer "${macos[@]}" "${viewer[@]}"
compiles viewer-test "${macos[@]}" -DMV_SELFTEST "${viewer_test[@]}"
compiles app "${macos[@]}" mac/App/Menu.m
compiles text-scan "${macos[@]}" mac/TextScan/TextScan.m
compiles sim-hid clang -fobjc-arc ios/SimHelper/SimHID.m
compiles sim-energy clang ios/SimHelper/SimEnergy.m
compiles sim-helpers "${simulator[@]}" ios/SimHelper/{SimAX,SimOpen,SimProbe,NetProbe}.m

found=0
analyzed() { # xcrun's words…, then one file
  local said
  # a finding is a warning, and leaves the exit code at 0
  if said=$(xcrun "$@" --analyze -Xanalyzer -analyzer-output=text -o /dev/null 2>&1) && [[ $said != *warning:* ]]; then
    return
  fi
  echo "$said"
  found=1
}
for f in "${viewer_test[@]}" mac/App/Menu.m mac/TextScan/TextScan.m; do analyzed "${macos[@]}" -DMV_SELFTEST "$f"; done
analyzed clang -fobjc-arc ios/SimHelper/SimHID.m
analyzed clang ios/SimHelper/SimEnergy.m
for f in ios/SimHelper/{SimAX,SimOpen,SimProbe,NetProbe}.m; do analyzed "${simulator[@]}" "$f"; done
check analyzer test "$found" = 0

exit $failed
