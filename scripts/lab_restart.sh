#!/bin/bash

# Lancaster Travel Routes - Lab Machine Restart Script
# Complete restart: stops containers, backs up database, rebuilds, restarts everything
# Usage: ./scripts/lab_restart.sh
#
# This script handles the lab machine restart scenario:
# 1. Backup current database (if running)
# 2. Stop all containers
# 3. Remove old containers
# 4. Rebuild container images
# 5. Start database, wait for healthy, restore backup
# 6. Start backend and frontend with correct port mappings
#
# Ports:
#   Frontend:  http://localhost:5001
#   Backend:   http://localhost:5000
#   Database:  localhost:5050

set -e

PROJECT_NAME="group1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_FILE="${REPO_ROOT}/postgres/group1db_backup.sql"
NETWORK_NAME="${PROJECT_NAME}-net"

echo "================================"
echo "Lab Machine Restart Sequence"
echo "================================"
echo ""

# Step 1: Backup existing database (if container running)
echo "Step 1: Backing up current database..."
if podman ps | grep -q ${PROJECT_NAME}db; then
  echo "  Database running - creating backup..."
  podman exec -t ${PROJECT_NAME}db pg_dumpall -c -U postgres > "${BACKUP_FILE}" 2>/dev/null || true
  echo "  ✓ Database backed up to ${BACKUP_FILE}"
else
  echo "  No running database container found - skipping backup"
fi
echo ""

# Step 2: Stop and remove all containers
echo "Step 2: Stopping and removing containers..."
for ctr in ${PROJECT_NAME}-frontend ${PROJECT_NAME}-backend ${PROJECT_NAME}db; do
  podman stop "$ctr" 2>/dev/null || true
  podman rm -f "$ctr" 2>/dev/null || true
done
echo "  ✓ Old containers removed"
echo ""

# Step 3: Ensure network exists
echo "Step 3: Setting up network..."
if ! podman network exists "${NETWORK_NAME}" 2>/dev/null; then
  podman network create "${NETWORK_NAME}" 2>/dev/null || true
fi
echo "  ✓ Network '${NETWORK_NAME}' ready"
echo ""

# Step 4: Rebuild application images
echo "Step 4: Rebuilding application images..."
podman build -t localhost/${PROJECT_NAME}-backend:latest "${REPO_ROOT}/backend"
podman build -t localhost/${PROJECT_NAME}-frontend:latest "${REPO_ROOT}/frontend"
echo "  ✓ Application images rebuilt"
echo ""

# Step 5: Prepare database restore files
echo "Step 5: Preparing database restore files..."
if [ -f "$BACKUP_FILE" ]; then
  awk '/^\\connect group1db/{found=1; next} found && /^\\connect postgres/{exit} found && /^\\restrict/{next} found && /^\\unrestrict/{next} found{print}' \
    "$BACKUP_FILE" > /tmp/group1db_backup.sql 2>/dev/null || true
  chmod 644 /tmp/group1db_backup.sql 2>/dev/null || true
  echo "  ✓ Backup file prepared ($(du -h /tmp/group1db_backup.sql 2>/dev/null | cut -f1 || echo 'unknown size'))"
else
  echo "  ⚠ No backup file found - will start with empty database"
  touch /tmp/group1db_backup.sql
fi

cp "${REPO_ROOT}/postgres/post_restore.sql" /tmp/post_restore.sql 2>/dev/null || true
chmod 644 /tmp/post_restore.sql 2>/dev/null || true
echo "  ✓ Schema migration scripts prepared"
echo ""

# Step 6: Start database container
echo "Step 6: Starting database..."
podman run -d --name ${PROJECT_NAME}db \
  --network "${NETWORK_NAME}" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=group1 \
  -e POSTGRES_DB=group1db \
  -p 5050:5432 \
  -v postgres_data:/var/lib/postgresql/data \
  -v /tmp/group1db_backup.sql:/docker-entrypoint-initdb.d/01_restore.sql:ro \
  -v /tmp/post_restore.sql:/docker-entrypoint-initdb.d/02_post_restore.sql:ro \
  --health-cmd "pg_isready -U postgres" \
  --health-interval 10s \
  --health-timeout 5s \
  --health-retries 5 \
  --restart unless-stopped \
  docker.io/library/postgres:16-alpine

echo "  Waiting for database to become healthy..."
for i in $(seq 1 30); do
  if podman exec ${PROJECT_NAME}db pg_isready -U postgres > /dev/null 2>&1; then
    echo "  ✓ Database ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  ⚠ Database not ready after 30s - continuing anyway"
  fi
  sleep 1
done
echo ""

# Step 7: Start backend container
echo "Step 7: Starting backend (port 5000)..."
podman run -d --name ${PROJECT_NAME}-backend \
  --network "${NETWORK_NAME}" \
  -e PORT=5000 \
  -e NODE_ENV=production \
  -e DB_HOST=${PROJECT_NAME}db \
  -e DB_PORT=5432 \
  -e DB_NAME=group1db \
  -e DB_USER=postgres \
  -e DB_PASSWORD=group1 \
  -p 5000:5000 \
  --restart unless-stopped \
  localhost/${PROJECT_NAME}-backend:latest

sleep 3
echo "  ✓ Backend started"
echo ""

# Step 8: Start frontend container
echo "Step 8: Starting frontend (port 5001)..."
podman run -d --name ${PROJECT_NAME}-frontend \
  --network "${NETWORK_NAME}" \
  -p 5001:3000 \
  --restart unless-stopped \
  localhost/${PROJECT_NAME}-frontend:latest

sleep 2
echo "  ✓ Frontend started"
echo ""

# Step 9: Verify everything is working
echo "Step 9: Verifying services..."
echo ""

podman ps --format "  {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep ${PROJECT_NAME}
echo ""

BACKEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/health 2>/dev/null || echo "000")
FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5001 2>/dev/null || echo "000")
DB_STATUS="down"
if podman exec ${PROJECT_NAME}db pg_isready -U postgres > /dev/null 2>&1; then
  DB_STATUS="ready"
fi

echo "  Database:  ${DB_STATUS}"
echo "  Backend:   HTTP ${BACKEND_STATUS}"
echo "  Frontend:  HTTP ${FRONTEND_STATUS}"
echo ""

TABLE_COUNT=$(podman exec -t ${PROJECT_NAME}db psql -U postgres -d group1db -t -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | xargs || echo "0")
echo "  Database tables: ${TABLE_COUNT}"
echo ""

echo "================================"
echo "✓ Lab Restart Complete!"
echo "================================"
echo ""
echo "Services available at:"
echo "  Frontend:  http://localhost:5001"
echo "  Backend:   http://localhost:5000"
echo "  Database:  localhost:5050"
echo ""
echo "Useful commands:"
echo "  podman ps                          # Check container status"
echo "  podman logs group1-backend -f      # Follow backend logs"
echo "  podman logs group1-frontend -f     # Follow frontend logs"
echo ""
