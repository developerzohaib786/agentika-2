#!/usr/bin/env bash
# One-time EC2 bootstrap (Ubuntu 22.04). Run on the server from the repo root:
#   bash scripts/setup-server.sh
# Needs .env filled in first (DOMAIN, DUCKDNS_TOKEN, BACKEND_URL, ...).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Missing .env (copy .env.example and fill it in)"; exit 1; }
set -a; . ./.env; set +a

echo "== 2 GB swap"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "== Docker + Compose"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

echo "== DuckDNS → this server's public IP"
if [ -n "${DUCKDNS_TOKEN:-}" ]; then
  SUB="${DOMAIN%%.duckdns.org}"
  curl -fsS "https://www.duckdns.org/update?domains=${SUB}&token=${DUCKDNS_TOKEN}&ip=" && echo
fi

echo "== Data dirs (n8n runs as uid 1000)"
mkdir -p n8n_data caddy_data caddy_config
sudo chown -R 1000:1000 n8n_data

echo "== Start stack"
sudo docker compose up -d --build
sudo docker compose ps
echo "Done. Open https://${DOMAIN} once Caddy has its certificate (~1 min)."
