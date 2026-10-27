#!/usr/bin/env bash
# Eurario - Script di Aggiornamento Automatico Multi-Piattaforma
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "[EURARIO] Verifica provider di aggiornamento in corso..."

if [ -f "docker-compose.yml" ] && command -v docker >/dev/null 2>&1; then
    echo "[EURARIO] Rilevato Docker Compose: scaricamento nuova immagine da Docker Hub..."
    docker compose pull
    echo "[EURARIO] Riavvio container Eurario..."
    docker compose up -d
    echo "[EURARIO] Aggiornamento container completato con successo."
elif [ -d ".git" ] && command -v git >/dev/null 2>&1; then
    echo "[EURARIO] Rilevato repository Git: aggiornamento codice sorgente..."
    git fetch origin main
    git pull origin main
    echo "[EURARIO] Codice aggiornato con successo dal branch main."
else
    echo "[EURARIO ERROR] Nessun metodo di aggiornamento automatico compatibile rilevato." >&2
    exit 1
fi

echo "[EURARIO] Procedura di aggiornamento terminata con successo."
exit 0
