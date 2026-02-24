#!/bin/bash

# Lancaster Travel Routes - Lab Machine Startup Script
# This script handles the lab machine environment where data is lost on reboot
# It will restore the database from h-drive backup if available

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
BACKUP_FILE="$PROJECT_DIR/postgres/group1db_backup.sql"

echo "=========================================="
echo "Lancaster Travel Routes - Startup"
echo "=========================================="
echo ""

# Prepare backup file in /tmp for docker volume mounting
if [ -f "$BACKUP_FILE" ]; then
    cp "$BACKUP_FILE" /tmp/group1db_backup.sql 2>/dev/null && chmod 644 /tmp/group1db_backup.sql || true
fi

# Step 1: Start containers
echo "Step 1: Starting containers..."
cd "$PROJECT_DIR"
podman-compose up -d

# Wait for database to be ready
echo "Waiting for database to initialize..."
for i in {1..30}; do
    if podman exec group1db pg_isready -U postgres &>/dev/null; then
        echo "✓ Database is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "⚠ Database may not be fully ready, continuing anyway..."
        break
    fi
    sleep 1
done

echo ""

# Step 2: Check if backup exists and restore if needed
if [ -f "$BACKUP_FILE" ]; then
    echo "Step 2: Restoring database from backup..."
    echo "Backup file: $BACKUP_FILE"
    
    # Create database if it doesn't exist
    podman exec group1db psql -U postgres -c "CREATE DATABASE group1db;" 2>/dev/null || true
    
    # Restore the backup
    echo "Restoring tables from backup..."
    podman exec -i group1db psql -U postgres < "$BACKUP_FILE" >/dev/null 2>&1
    
    # Verify restoration
    TABLES=$(podman exec group1db psql -U postgres -d group1db -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null || echo "0")
    
    if [ "$TABLES" -gt 0 ]; then
        echo "✓ Database restored ($TABLES tables)"
    else
        echo "⚠ Database may not have restored properly"
    fi
else
    echo "Step 2: No backup file found at $BACKUP_FILE"
    echo "⚠ Database will start with empty tables"
    echo ""
    echo "To save data for future restarts, run:"
    echo "  ./scripts/backup_db.sh"
fi

echo ""
echo "=========================================="
echo "✓ All services started!"
echo "=========================================="
echo ""
echo "Access your application:"
echo "  Frontend:  http://localhost:5001"
echo "  Backend:   http://localhost:5000/api/health"
echo "  Database:  localhost:5050"
echo ""
echo "Useful commands:"
echo "  View logs:        podman-compose logs -f"
echo "  Stop services:    podman-compose down"
echo "  Backup database:  ./scripts/backup_db.sh"
echo "  Restore database: ./scripts/restore_db.sh"
echo ""
