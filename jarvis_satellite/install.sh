#!/usr/bin/env bash
# Instala o jarvis_satellite num dispositivo remoto (ex: Raspberry Pi) e
# configura o PM2 pra subir sozinho no boot.
#
# Pré-requisitos: Node.js 18+ e Tailscale já instalados e logados
# (o satélite precisa aparecer na malha Tailscale como 100.x.x.x antes
# de rodar este script).
#
# Uso: ./install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Instalando dependências (jarvis_satellite)..."
npm install --omit=dev

echo "==> Instalando dependências (jarvis_shared)..."
(cd ../jarvis_shared && npm install --omit=dev)

if [ ! -f .env ]; then
  echo "==> Nenhum .env encontrado. Copiando .env.example — edite antes de continuar."
  cp .env.example .env
  echo
  echo "Edite $SCRIPT_DIR/.env com:"
  echo "  - SATELLITE_ID, SATELLITE_NAME, SATELLITE_LOCATION (identidade deste satélite)"
  echo "  - SATELLITE_TOKEN (gere um valor aleatório único, ex: openssl rand -hex 24)"
  echo "  - SATELLITE_HOST (IP Tailscale 100.x.x.x deste dispositivo + porta, ex: 100.64.0.5:5001)"
  echo "  - BRAIN_URL (http://<IP Tailscale do cérebro>:4000)"
  echo "  - SATELLITE_REGISTRATION_SECRET (idêntico ao do .env do cérebro)"
  echo
  echo "Depois rode ./install.sh de novo pra continuar."
  exit 0
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Instalando PM2 globalmente..."
  npm install -g pm2
fi

echo "==> Subindo o satélite via PM2..."
pm2 start src/index.js --name "jarvis-satellite" --cwd "$SCRIPT_DIR"
pm2 save

echo "==> Configurando PM2 pra iniciar sozinho no boot..."
pm2 startup | tail -n 1 | bash || echo "Rode manualmente o comando 'pm2 startup' impresso acima, com sudo."

echo
echo "==> Pronto. Verifique com: pm2 logs jarvis-satellite"
