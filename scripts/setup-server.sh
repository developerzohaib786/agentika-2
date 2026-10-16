#!/usr/bin/env bash
# One-time server bootstrap (Amazon Linux 2023 or Ubuntu 22.04). Run on the server from the repo root:
#   bash scripts/setup-server.sh
# Needs .env filled in first (DOMAIN, DUCKDNS_TOKEN, BACKEND_URL, ...).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Missing .env (copy .env.example and fill it in)"; exit 1; }
set -a; . ./.env; set +a

COMPOSE_VERSION=v2.32.4
BUILDX_VERSION=v0.19.3

echo "== 2 GB swap"
if ! swapon --show | grep -q /swapfile; then
  sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "== Docker + Compose"
if ! command -v docker >/dev/null; then
  if command -v dnf >/dev/null; then
    # Amazon Linux 2023: docker is in the base repo; compose/buildx plugins are not.
    sudo dnf install -y docker git
    sudo systemctl enable --now docker
  else
    curl -fsSL https://get.docker.com | sudo sh
  fi
  sudo usermod -aG docker "$USER"
fi
PLUGINS=/usr/local/lib/docker/cli-plugins
if ! sudo docker compose version >/dev/null 2>&1; then
  sudo mkdir -p "$PLUGINS"
  sudo curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-$(uname -m)" -o "$PLUGINS/docker-compose"
  sudo chmod +x "$PLUGINS/docker-compose"
fi
if ! sudo docker buildx version >/dev/null 2>&1; then
  ARCH=$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/')
  sudo mkdir -p "$PLUGINS"
  sudo curl -fsSL "https://github.com/docker/buildx/releases/download/${BUILDX_VERSION}/buildx-${BUILDX_VERSION}.linux-${ARCH}" -o "$PLUGINS/docker-buildx"
  sudo chmod +x "$PLUGINS/docker-buildx"
fi
sudo docker compose version

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
