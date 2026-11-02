#!/bin/sh
# Developer install: builds this checkout, packs the one package and installs `appdyno-mcp` (the MCP
# server) and `appdyno` from that file, with no registry. npm's global prefix gets the two commands
# (APPDYNO_PREFIX=<dir> installs them there instead).
set -eu
cd "$(dirname "$0")/.."
# the Android agent builds with the project's Java (.mise.toml): found through mise when the shell has none
if ! java -version >/dev/null 2>&1 || [ -z "${JAVA_HOME:-}" ]; then
  if command -v mise >/dev/null && home=$(mise where java 2>/dev/null) && [ -x "$home/bin/java" ]; then
    JAVA_HOME=$home
    PATH=$home/bin:$PATH
    export JAVA_HOME PATH
  elif [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
    PATH=$JAVA_HOME/bin:$PATH
    export PATH
  fi
fi
if ! java -version >/dev/null 2>&1; then
  echo "no Java to build the Android agent: install the project's tools (mise install) or set JAVA_HOME to a JDK 21" >&2
  exit 1
fi
pnpm install --frozen-lockfile
(cd android && ./gradlew --console=plain -q :agent:assembleDebug)
pnpm build
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
(cd packages/appdyno && npm pack --silent --pack-destination "$out" >/dev/null)
set -- "$out"/appdyno-*.tgz
[ -n "${APPDYNO_PREFIX:-}" ] && set -- --prefix "$APPDYNO_PREFIX" "$@"
npm install -g --offline --no-audit --no-fund "$@"
echo "installed appdyno $(node -p "require('./packages/appdyno/package.json').version")"
echo "the iOS runners build on first use; appdyno ios build builds them now"
echo "next: appdyno doctor"
