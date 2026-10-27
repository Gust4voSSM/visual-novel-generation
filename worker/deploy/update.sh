#!/bin/sh
# Atualiza o worker na VM (roda como root, pelo roteiro-update.timer).
# Só implanta commits da main cujo workflow "deploy" terminou com sucesso, ou seja, com o
# módulo já publicado. Enquanto o workflow não existir na main, segue a ponta da main.
set -eu

REPO=Gust4voSSM/spacetime-spike
APP=/opt/roteiro/app
as_app() { runuser -u roteiro -- "$@"; }

want=$(curl -fsS "https://api.github.com/repos/$REPO/actions/workflows/deploy.yml/runs?branch=main&status=success&per_page=1" 2>/dev/null \
  | jq -r '.workflow_runs[0].head_sha // empty' || true)
as_app git -C "$APP" fetch -q origin main
[ -n "$want" ] || want=$(as_app git -C "$APP" rev-parse origin/main)

have=$(as_app git -C "$APP" rev-parse HEAD)
[ "$want" = "$have" ] && exit 0

echo "atualizando $have -> $want"
lock_changed=$(as_app git -C "$APP" diff --name-only "$have" "$want" -- worker/package-lock.json)
as_app git -C "$APP" checkout -q --detach "$want"
[ -z "$lock_changed" ] || as_app npm --prefix "$APP/worker" ci --no-audit --no-fund
systemctl restart roteiro-worker
