#!/bin/bash

# Restore PostgreSQL database from backup for lab machines
# Usage: ./scripts/restore_db.sh [backup_file]

set -e

BACKUP_DIR="/home/bylesl/h-drive/Year 2/SCC200/postgres"
BACKUP_FILE="${1:-$BACKUP_DIR/group1db_backup.sql}"

echo "================================"
echo "Restoring database from backup..."
echo "================================"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Backup file not found: $BACKUP_FILE"
    echo ""
    echo "Available backups in $BACKUP_DIR:"
    ls -lah "$BACKUP_DIR"/*.sql 2>/dev/null || echo "No backups found"
    exit 1
fi

# Check if database container is running
if ! podman ps --format "{{.Names}}" | grep -q "^group1db$"; then
    echo "❌ Database container 'group1db' is not running"
    echo "Please start containers first: podman-compose up -d"
    exit 1
fi

# Wait for database to be ready
echo "Waiting for database to be ready..."
for i in {1..30}; do
    if podman exec group1db pg_isready -U postgres &>/dev/null; then
        echo "✓ Database is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Database failed to start"
        exit 1
    fi
    sleep 1
done

# Restore the database
echo "Restoring from: $BACKUP_FILE"
podman exec -i group1db psql -U postgres < "$BACKUP_FILE"

echo ""
echo "✓ Database restored successfully"
echo "================================"

# Verify restoration
echo "Verifying tables..."
podman exec group1db psql -U postgres -d group1db -c "\dt"

echo ""
echo "✓ Restoration complete"
