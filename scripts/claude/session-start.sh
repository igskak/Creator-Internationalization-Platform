#!/usr/bin/env bash
# SessionStart hook for Claude Code on the web (M0-03). Makes `pnpm check` work in a fresh
# cloud session. Local sessions are skipped: developers run `pnpm install` themselves.
set -euo pipefail

if [[ "${CLAUDE_CODE_REMOTE:-}" != "true" ]]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# Never download browsers in the session; use the pre-installed Chromium (PLAYWRIGHT_BROWSERS_PATH).
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
if [[ -n "${CLAUDE_ENV_FILE:-}" ]]; then
  echo "export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1" >> "$CLAUDE_ENV_FILE"
fi

node_major=$(node -p 'process.versions.node.split(".")[0]')
wanted_node=$(cat .nvmrc)
if (( node_major < wanted_node )); then
  echo "session-start: Node $(node -v) is older than .nvmrc ($wanted_node); pnpm check may fail." >&2
fi

# pnpm version pinned by package.json "packageManager" (e.g. pnpm@12.6.0).
wanted_pnpm=$(node -p 'require("./package.json").packageManager.split("@")[1]')
if [[ "$(pnpm -v 2>/dev/null || true)" != "$wanted_pnpm" ]]; then
  npm install -g "pnpm@$wanted_pnpm" --silent
fi

pnpm install --frozen-lockfile --reporter=silent
echo "session-start: Node $(node -v), pnpm $(pnpm -v), dependencies installed."
