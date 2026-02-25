#!/bin/bash

# Backup PostgreSQL database to h-drive for persistence on lab machines
# Usage: ./scripts/backup_db.sh

set -e

BACKUP_DIR="/home/bylesl/h-drive/Year 2/SCC200/postgres"
BACKUP_FILE="$BACKUP_DIR/group1db_backup.sql"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_TIMESTAMPED="$BACKUP_DIR/group1db_backup_$TIMESTAMP.sql"

echo "================================"
echo "Backing up database..."
echo "================================"

# Check if database container is running
if ! podman ps --format "{{.Names}}" | grep -q "^group1db$"; then
    echo "❌ Database container 'group1db' is not running"
    exit 1
fi

# Backup the database
echo "Dumping database to: $BACKUP_FILE"
podman exec group1db pg_dump -U postgres -d group1db > "$BACKUP_FILE"

# Also create timestamped backup for safety
cp "$BACKUP_FILE" "$BACKUP_TIMESTAMPED"

if [ -f "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "✓ Database backed up successfully ($SIZE)"
    echo "  Primary backup: $BACKUP_FILE"
    echo "  Timestamped backup: $BACKUP_TIMESTAMPED"
else
    echo "❌ Backup failed"
    exit 1
fi

echo "================================"
