#!/bin/bash
# Publishes the Core API (127.0.0.1:8080) to the tailnet as HTTPS on 443.
# The setting persists in tailscaled; this only repairs it when missing.
# It never fails the caller: without it the API is unreachable from outside
# the Pi, while the Bot and the daily posts keep working.
set -u
target=http://127.0.0.1:8080
warn() { printf 'warn: tailscale-serve: %s\n' "$1" >&2; exit 0; }

command -v tailscale >/dev/null 2>&1 || warn 'tailscale command not found'
status=$(tailscale serve status --json 2>/dev/null) || warn 'cannot read serve status'
if printf '%s' "$status" | TARGET="$target" python3 -B -c '
import json, os, sys
web = (json.load(sys.stdin) or {}).get("Web") or {}
sys.exit(0 if any(host.endswith(":443") and ((site or {}).get("Handlers") or {}).get("/", {}).get("Proxy") == os.environ["TARGET"] for host, site in web.items()) else 1)
' 2>/dev/null; then
  exit 0
fi
tailscale serve --bg --https=443 "$target" >/dev/null 2>&1 || warn 'failed to publish the Core API'
