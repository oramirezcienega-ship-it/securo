#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=========================================="
echo "    Actualizando Securo (Finanzas)       "
echo "=========================================="

echo "[1/4] Descargando últimas actualizaciones oficiales de Securo..."
git fetch upstream main
git rebase upstream/main || {
    echo "Aviso: Conflicto detectado durante el rebase. Abortando para proteger tus cambios."
    git rebase --abort
    exit 1
}

# Subir la rama actualizada a tu GitHub personal
git push origin main || true

echo "[2/4] Actualizando imágenes de Docker..."
docker compose -f docker-compose.prod.yml pull redis db || true

echo "[3/4] Recompilando frontend con tus mejoras..."
docker run --rm -v "$DIR/frontend:/app" -w /app node:22-slim npm run build

echo "[4/4] Reiniciando contenedores..."
docker compose -f docker-compose.prod.yml up -d

echo "=========================================="
echo "  ¡Securo se actualizó correctamente!     "
echo "  Panel: http://100.96.122.113:3000       "
echo "=========================================="
