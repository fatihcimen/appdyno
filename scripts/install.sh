#!/bin/zsh
# One command: builds this checkout and installs `appdyno-mcp` (the MCP server) and `appdyno`
# (devices, doctor, bench, tools) for this user. The package is self-contained under
# $APPDYNO_HOME (default ~/.local/share/appdyno) and carries the Android agent and the iOS
# runner's sources (built once on first use). npm's global prefix gets the two commands
# (APPDYNO_PREFIX=<dir> installs them there instead).
set -eu
cd "${0:A:h}/.."
dest=${APPDYNO_HOME:-$HOME/.local/share/appdyno}
pnpm install --frozen-lockfile
(cd android && ./gradlew --console=plain -q :agent:assembleDebug)
pnpm build
rm -rf "$dest"
# a copy with its own node_modules (the workspace packages included), not links into this checkout
pnpm --filter appdyno-mcp deploy --legacy --prod "$dest"
prefix=()
[[ -n ${APPDYNO_PREFIX:-} ]] && prefix=(--prefix "$APPDYNO_PREFIX")
npm install -g "${prefix[@]}" "$dest"
echo "installed $(node -p "require('$dest/package.json').version") at $dest"
echo "next: appdyno doctor"
