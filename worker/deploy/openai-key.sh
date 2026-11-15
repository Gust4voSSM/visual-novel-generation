#!/bin/sh
# Lê a chave da OpenAI do Secret Manager (segredo openai-api-key, última versão) com a service
# account da VM e a grava em /run/roteiro/openai.env (memória; some quando o worker para).
# Roda como root antes de cada início do worker (ExecStartPre=+ no roteiro-worker.service).
#   openai-key.sh            busca e grava a chave
#   openai-key.sh --changed  sai com 0 se há versão nova desde o último início (usado pelo update.sh)
# Sem o segredo (ou sem acesso), não grava nada e o worker usa /etc/roteiro/openai.env, se existir.
set -eu

SECRET=openai-api-key
OUT=/run/roteiro
md() { curl -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/$1"; }

project=$(md project/project-id)
token=$(md instance/service-accounts/default/token | jq -r .access_token)
if ! resp=$(curl -fsS -H "Authorization: Bearer $token" \
    "https://secretmanager.googleapis.com/v1/projects/$project/secrets/$SECRET/versions/latest:access"); then
  [ "${1:-}" = "--changed" ] && exit 1
  echo "segredo $SECRET indisponível; o worker usa /etc/roteiro/openai.env se existir" >&2
  exit 0
fi
version=$(printf %s "$resp" | jq -r .name)

if [ "${1:-}" = "--changed" ]; then
  [ "$version" != "$(cat "$OUT/openai.version" 2>/dev/null)" ] && exit 0 || exit 1
fi

key=$(printf %s "$resp" | jq -r .payload.data | base64 -d | tr -d '\r\n')
[ -n "$key" ] || { echo "segredo $SECRET está vazio" >&2; exit 1; }
umask 077
install -d -m 0700 "$OUT"
printf 'OPENAI_API_KEY=%s\n' "$key" > "$OUT/openai.env"
printf %s "$version" > "$OUT/openai.version"
echo "chave da OpenAI: versão ${version##*/} do Secret Manager"
