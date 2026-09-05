#!/bin/bash
# Forced command for the CI-only OpenSSH key. No arbitrary command or shell.
set -euo pipefail
command=${SSH_ORIGINAL_COMMAND:-}
if [[ ! "$command" =~ ^deploy\ sha256:[0-9a-f]{64}$ ]]; then
  printf '%s\n' 'deploy: invalid-command' >&2
  exit 1
fi
digest=${command#deploy }
root=$(cd "$(dirname "$0")/.." && pwd)
[ ! -e "$root/.deploy-state/ci-disabled" ] || { printf '%s\n' 'deploy: maintenance' >&2; exit 1; }
# systemctl waits for the oneshot to finish, including any rollback.
sudo -n /usr/bin/systemctl start discord-bot-update.service
bash "$root/scripts/pi-update.sh" --verify "ghcr.io/yone-k/yone-discord-bot@$digest"
