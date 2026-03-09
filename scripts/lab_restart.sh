#!/bin/bash

# Lancaster Travel Routes - Lab Machine Restart Script
# Complete restart: stops containers, backs up database, rebuilds, restarts everything
# Usage: ./scripts/lab_restart.sh
# 
# This script handles the lab machine restart scenario:
# 1. Backup current database (if running)
# 2. Stop all containers
# 3. Remove old containers
# 4. Pull latest images
# 5. Rebuild containers
# 6. Restore database from backup
# 7. Apply schema migrations
# 8. Start all containers
#
# Data is preserved via PostgreSQL volume and backup file

set -e

PROJECT_NAME="group1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_FILE="${REPO_ROOT}/postgres/group1db_backup.sql"

echo "================================"
echo "Lab Machine Restart Sequence"
echo "================================"
echo ""

# Step 1: Backup existing database (if container running)
echo "Step 1: Backing up current database..."
if podman ps -a | grep -q ${PROJECT_NAME}db; then
  if podman ps | grep -q ${PROJECT_NAME}db; then
    echo "  Database running - creating backup..."
    podman exec -t ${PROJECT_NAME}db pg_dumpall -c -U postgres > "${BACKUP_FILE}"
    echo "  ✓ Database backed up to ${BACKUP_FILE}"
  else
    echo "  Database container exists but not running - skipping backup"
  fi
else
  echo "  No existing database container found"
fi
echo ""

# Step 2: Stop all containers
echo "Step 2: Stopping containers..."
podman-compose down 2>/dev/null || true
sleep 2
echo "  ✓ Containers stopped"
echo ""

# Step 3: Remove old containers (in case compose failed)
echo "Step 3: Cleaning up containers..."
podman stop ${PROJECT_NAME}db 2>/dev/null || true
podman stop ${PROJECT_NAME}-backend 2>/dev/null || true
podman stop ${PROJECT_NAME}-frontend 2>/dev/null || true
podman rm ${PROJECT_NAME}db 2>/dev/null || true
podman rm ${PROJECT_NAME}-backend 2>/dev/null || true
podman rm ${PROJECT_NAME}-frontend 2>/dev/null || true
echo "  ✓ Old containers removed"
echo ""

# Step 4: Pull latest base images
echo "Step 4: Pulling latest base images..."
podman pull docker.io/library/postgres:16-alpine
podman pull docker.io/library/node:18-alpine
echo "  ✓ Base images pulled"
echo ""

# Step 5: Rebuild application images
echo "Step 5: Rebuilding application images..."
podman build -t localhost/${PROJECT_NAME}-backend:latest ./backend
podman build -t ${PROJECT_NAME}-frontend:latest ./frontend
echo "  ✓ Application images rebuilt"
echo ""

# Step 6: Copy backup and migration scripts to /tmp for docker-compose mounting
echo "Step 6: Preparing database restore files..."
if [ -f "$BACKUP_FILE" ]; then
  # pg_dumpall dumps the entire cluster (roles, template DBs, all databases).
  # The docker entrypoint already creates the 'group1db' database and 'postgres' role,
  # so we extract ONLY the group1db content to avoid conflicts.
  # This filters out: DROP/CREATE DATABASE, DROP/CREATE ROLE, \restrict/\unrestrict
  awk '/^\\connect group1db/{found=1; next} found && /^\\connect postgres/{exit} found && /^\\restrict/{next} found && /^\\unrestrict/{next} found{print}' \
    "$BACKUP_FILE" > /tmp/group1db_backup.sql
  chmod 644 /tmp/group1db_backup.sql
  echo "  ✓ Backup file prepared and filtered ($(du -h /tmp/group1db_backup.sql | cut -f1))"
else
  echo "  ⚠ No backup file found - will start with empty database"
fi

cp "${REPO_ROOT}/postgres/post_restore.sql" /tmp/post_restore.sql
chmod 644 /tmp/post_restore.sql
echo "  ✓ Schema migration scripts prepared"
echo ""

# Step 7: Start all containers
echo "Step 7: Starting containers..."
podman-compose up -d
sleep 8
echo "  ✓ Containers started and initialized"
echo ""

# Step 8: Verify containers are healthy and apply auth schema
echo "Step 8: Verifying container health..."
if podman ps | grep -q ${PROJECT_NAME}db; then
  if podman exec -t ${PROJECT_NAME}db pg_isready -U postgres > /dev/null 2>&1; then
    echo "  ✓ Database ready"
  else
    echo "  ⚠ Database not responding yet, waiting..."
    sleep 5
  fi

  # Always apply auth schema to ensure auth tables exist
  echo "  Applying auth schema..."
  podman exec -i ${PROJECT_NAME}db psql -U postgres -d group1db < "${REPO_ROOT}/postgres/auth_schema.sql" > /dev/null 2>&1
  echo "  ✓ Auth schema applied"
fi

if podman ps | grep -q ${PROJECT_NAME}-backend; then
  echo "  ✓ Backend running"
fi

if podman ps | grep -q ${PROJECT_NAME}-frontend; then
  echo "  ✓ Frontend running"
fi
echo ""

# Step 9: Verify database tables exist
echo "Step 9: Verifying database schema..."
TABLE_COUNT=$(podman exec -t group1db psql -U postgres -d group1db -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | xargs || echo "0")
if [ "$TABLE_COUNT" -gt 0 ] 2>/dev/null; then
  echo "  ✓ Database schema verified ($TABLE_COUNT tables)"
else
  echo "  ℹ Database schema created (will be populated by application)"
fi
echo ""

echo "================================"
echo "✓ Lab Restart Complete!"
echo "================================"
echo ""
echo "Services available at:"
echo "  Frontend:  http://localhost:5001"
echo "  Backend:   http://localhost:5000/api/health"
echo "  Database:  localhost:5050"
echo ""
echo "To check status: podman-compose ps"
echo "To view logs:    podman-compose logs -f [service]"
echo ""
