#!/bin/sh
# Prepara uma VM Debian 12 para o worker de IA. Rode como root, de dentro desta pasta:
#   sudo sh setup.sh
# Depois, preencha /etc/roteiro/worker.env e /etc/roteiro/openai.env e inicie o serviço.
set -eu
cd "$(dirname "$0")"

# Node 22 pelo repositório oficial da NodeSource (chave assinada, atualiza com o apt).
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git jq
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
apt-get update -q
apt-get install -y -q nodejs unattended-upgrades

# Usuário sem login, dono do código.
id roteiro >/dev/null 2>&1 || useradd --system --home-dir /opt/roteiro --shell /usr/sbin/nologin roteiro
install -d -o roteiro -g roteiro /opt/roteiro
# O repositório é privado: chave de deploy só leitura, que só o root lê (update.sh explica o espelho).
# Cadastre a .pub com
#   gh repo deploy-key add <arquivo.pub> --repo Gust4voSSM/spacetime-spike --title roteiro-worker
# e rode este script de novo. As chaves do github.com vêm da API (não de ssh-keyscan).
install -d -m 0700 /etc/roteiro
[ -f /etc/roteiro/deploy_key ] || ssh-keygen -q -t ed25519 -N '' -C roteiro-worker-deploy -f /etc/roteiro/deploy_key
curl -fsS https://api.github.com/meta | jq -r '.ssh_keys[] | "github.com " + .' > /etc/roteiro/known_hosts
if ! GIT_SSH_COMMAND="ssh -i /etc/roteiro/deploy_key -o IdentitiesOnly=yes -o UserKnownHostsFile=/etc/roteiro/known_hosts" \
    git ls-remote -q git@github.com:Gust4voSSM/spacetime-spike.git HEAD >/dev/null 2>&1; then
  echo "cadastre esta chave de deploy (só leitura) e rode de novo:"; cat /etc/roteiro/deploy_key.pub; exit 1
fi
install -d -m 0755 /var/lib/roteiro
[ -d /var/lib/roteiro/repo.git ] || GIT_SSH_COMMAND="ssh -i /etc/roteiro/deploy_key -o IdentitiesOnly=yes -o UserKnownHostsFile=/etc/roteiro/known_hosts" \
  git clone -q --bare git@github.com:Gust4voSSM/spacetime-spike.git /var/lib/roteiro/repo.git
git config --system --get-all safe.directory 2>/dev/null | grep -qxF /var/lib/roteiro/repo.git || git config --system --add safe.directory /var/lib/roteiro/repo.git
[ -d /opt/roteiro/app/.git ] || runuser -u roteiro -- git clone -q /var/lib/roteiro/repo.git /opt/roteiro/app
runuser -u roteiro -- npm --prefix /opt/roteiro/app/worker ci --no-audit --no-fund
install -d -o roteiro -g roteiro /opt/roteiro/app/client/public/generated

# Segredos: só root lê; o systemd entrega ao processo.
install -d -m 0700 /etc/roteiro
for f in worker.env openai.env; do [ -f /etc/roteiro/$f ] || install -m 0600 /dev/null /etc/roteiro/$f; done

install -m 0755 update.sh /opt/roteiro/update.sh
install -m 0644 roteiro-worker.service roteiro-update.service roteiro-update.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable roteiro-worker roteiro-update.timer
echo "pronto: preencha /etc/roteiro/*.env e rode: systemctl start roteiro-worker roteiro-update.timer"
