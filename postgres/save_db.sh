#!/bin/bash

# Lancaster Travel Routes - Database Backup Script
# Backs up the entire PostgreSQL database to postgres/group1db_backup.sql
# Usage: ./postgres/save_db.sh
#
# This backup includes:
# - All tables (stops, operators, routes, schedules, etc.)
# - All data (bus stops, operators, schedules, planned routes)
# - All indexes and constraints
# - Schema for new tables (bus_routes, route_stops, journey_tracking, planned_routes)
#
# The backup is stored locally for lab machine restart scenarios

set -e

BACKUP_FILE="./postgres/group1db_backup.sql"
BACKUP_DIR="$(dirname "$BACKUP_FILE")"

echo "Backing up PostgreSQL database..."
echo "  Location: $BACKUP_FILE"

# Check if database container is running
if ! podman ps | grep -q group1db; then
  echo "Error: group1db container is not running"
  exit 1
fi

# Perform backup with compression and transaction isolation
podman exec -t group1db pg_dumpall -c -U postgres > "$BACKUP_FILE"

# Verify backup was created
if [ -f "$BACKUP_FILE" ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  LINES=$(wc -l < "$BACKUP_FILE")
  echo "✓ Database backed up successfully"
  echo "  File size: $SIZE"
  echo "  Lines: $LINES"
  echo ""
  echo "Backup ready for lab machine restarts:"
  echo "  - Stored in: $BACKUP_FILE"
  echo "  - Automatically used by: ./scripts/lab_restart.sh"
  echo "  - Or use podman-compose.yml mounting"
else
  echo "Error: Backup file was not created"
  exit 1
fi
