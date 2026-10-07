#!/usr/bin/env bash
set -e

BACKUP_DIR="/home/oscar/securo_backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/securo_$TIMESTAMP.sql.gz"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando respaldo de base de datos Securo..."
docker exec securo-db-1 pg_dump -U postgres -d securo | gzip > "$BACKUP_FILE"

FILESIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Respaldo creado exitosamente: $BACKUP_FILE ($FILESIZE)"

# Retención: mantener los últimos 30 días y eliminar los más antiguos
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Purgando respaldos con más de 30 días de antigüedad..."
find "$BACKUP_DIR" -name "securo_*.sql.gz" -type f -mtime +30 -delete

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Proceso de respaldo finalizado."
