#!/bin/sh
# Configuração do Google Cloud para o worker (rodar uma vez, no PC, com o gcloud logado):
#   sh worker/deploy/gcp-setup.sh
# Pode rodar de novo: o que já existe é mantido.
#
# - Service account própria da VM (roteiro-worker), em vez da padrão do Compute, que costuma ter
#   Editor no projeto inteiro. Ela só lê o segredo openai-api-key e escreve logs/métricas.
# - Segredo openai-api-key no Secret Manager (a chave entra depois, com gcloud secrets versions add).
# - Troca a service account da VM. ISSO PARA A VM POR ~1 MIN (o worker volta sozinho ao ligar).
set -eu

P=regal-oasis-512900-b3
ZONE=us-east1-b
VM=roteiro-worker
SA="roteiro-worker@$P.iam.gserviceaccount.com"

gcloud services enable secretmanager.googleapis.com --project="$P"

gcloud iam service-accounts describe "$SA" --project="$P" >/dev/null 2>&1 \
  || gcloud iam service-accounts create roteiro-worker --display-name="Roteiro worker (VM)" --project="$P"

gcloud secrets describe openai-api-key --project="$P" >/dev/null 2>&1 \
  || gcloud secrets create openai-api-key --replication-policy=automatic --project="$P"

gcloud secrets add-iam-policy-binding openai-api-key --project="$P" \
  --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --format=none
for r in roles/logging.logWriter roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$SA" --role="$r" --condition=None --format=none
done

current=$(gcloud compute instances describe "$VM" --zone="$ZONE" --project="$P" --format='value(serviceAccounts[0].email)')
if [ "$current" != "$SA" ]; then
  echo "trocando a service account da VM ($current -> $SA); a VM para por ~1 min"
  gcloud compute instances stop "$VM" --zone="$ZONE" --project="$P"
  gcloud compute instances set-service-account "$VM" --zone="$ZONE" --project="$P" \
    --service-account="$SA" --scopes=cloud-platform
  gcloud compute instances start "$VM" --zone="$ZONE" --project="$P"
fi
echo "pronto. Agora a chave: gcloud secrets versions add openai-api-key --data-file=- --project=$P"
