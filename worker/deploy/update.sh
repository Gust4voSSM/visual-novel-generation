#!/bin/sh
# Atualiza o worker na VM (roda como root, pelo roteiro-update.timer).
# Segue a branch deployed/worker, que o workflow "deploy" move para o commit da main depois de
# publicar o módulo com sucesso. Assim o worker nunca roda à frente do módulo publicado.
#
# O repositório é privado. A chave de deploy (só leitura) fica em /etc/roteiro, que só o root lê:
# o root busca do GitHub para um espelho local e o usuário roteiro (o do worker) busca desse
# espelho. Um worker comprometido não consegue ler a chave.
set -eu

REPO=git@github.com:Gust4voSSM/spacetime-spike.git
APP=/opt/roteiro/app
MIRROR=/var/lib/roteiro/repo.git
REF=deployed/worker
as_app() { runuser -u roteiro -- git -C "$APP" "$@"; }
as_root() { GIT_SSH_COMMAND="ssh -i /etc/roteiro/deploy_key -o IdentitiesOnly=yes -o UserKnownHostsFile=/etc/roteiro/known_hosts -o StrictHostKeyChecking=yes" git "$@"; }

[ -d "$MIRROR" ] || { install -d -m 0755 "$(dirname "$MIRROR")"; as_root clone -q --bare "$REPO" "$MIRROR"; }
# O espelho é do root; o roteiro só lê. A exceção fica na config do sistema (o worker não a altera).
git config --system --get-all safe.directory 2>/dev/null | grep -qxF "$MIRROR" || git config --system --add safe.directory "$MIRROR"
as_root -C "$MIRROR" fetch -q origin "+refs/heads/$REF:refs/heads/$REF"
as_app remote set-url origin "$MIRROR"
as_app fetch -q origin "+refs/heads/$REF:refs/remotes/origin/$REF"
want=$(as_app rev-parse "origin/$REF")
have=$(as_app rev-parse HEAD)
[ "$want" = "$have" ] && exit 0

echo "atualizando $have -> $want"
lock_changed=$(as_app diff --name-only "$have" "$want" -- worker/package-lock.json)
as_app checkout -q --detach "$want"
[ -z "$lock_changed" ] || runuser -u roteiro -- npm --prefix "$APP/worker" ci --no-audit --no-fund
systemctl restart roteiro-worker
