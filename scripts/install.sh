#!/bin/zsh
# One command: builds this checkout and installs `appdyno-mcp` (the MCP server) and `appdyno`
# (devices, doctor, bench, tools) for this user. The package is self-contained under
# $APPDYNO_HOME (default ~/.local/share/appdyno) and carries the Android agent and the iOS
# runner's sources (built once on first use). npm's global prefix gets the two commands
# (APPDYNO_PREFIX=<dir> installs them there instead).
set -eu
cd "${0:A:h}/.."
# the Android agent builds with the project's Java (.mise.toml): found through mise when the shell has none
if ! java -version >/dev/null 2>&1 || [[ -z ${JAVA_HOME:-} ]]; then
  if command -v mise >/dev/null && home=$(mise where java 2>/dev/null) && [[ -x $home/bin/java ]]; then
    export JAVA_HOME=$home PATH=$home/bin:$PATH
  elif [[ -n ${JAVA_HOME:-} && -x $JAVA_HOME/bin/java ]]; then
    export PATH=$JAVA_HOME/bin:$PATH
  fi
fi
if ! java -version >/dev/null 2>&1; then
  echo "no Java to build the Android agent: install the project's tools (mise install) or set JAVA_HOME to a JDK 21" >&2
  exit 1
fi
dest=${APPDYNO_HOME:-$HOME/.local/share/appdyno}
pnpm install --frozen-lockfile
(cd android && ./gradlew --console=plain -q :agent:assembleDebug)
pnpm build
rm -rf "$dest" "$dest.deploy"
# a copy with its own node_modules (the workspace packages included), not links into this checkout: deploy
# hard-links the workspace's own files, so a later build here rewrote the installed library in place
pnpm --filter appdyno-mcp deploy --legacy --prod "$dest.deploy"
cp -R "$dest.deploy" "$dest"
rm -rf "$dest.deploy"
if [[ -n $(find "$dest" -type f -links +1 -print -quit) ]]; then echo "the installed files still share inodes" >&2; exit 1; fi
prefix=()
[[ -n ${APPDYNO_PREFIX:-} ]] && prefix=(--prefix "$APPDYNO_PREFIX")
npm install -g "${prefix[@]}" "$dest"
# the two commands must be executable where npm linked them
for f in "$dest/dist/main.js" "$dest/dist/cli.js"; do [[ -x $f ]] || { echo "not executable: $f" >&2; exit 1; }; done
# the iOS runners built now (a device session never waits for a build); older builds removed
if [[ -d ${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer} ]]; then
  node "$dest/dist/cli.js" ios build
fi
echo "installed $(node -p "require('$dest/package.json').version") at $dest"
echo "next: appdyno doctor"
