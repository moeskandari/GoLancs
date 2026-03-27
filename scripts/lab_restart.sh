#!/bin/bash

# Lancaster Travel Routes - Lab Machine Restart Script (Optimised)
# Complete restart: stops containers, backs up database, rebuilds, restarts everything
# Usage: ./scripts/lab_restart.sh
#
# Speed optimisations over the original:
#   - Parallel container stops with reduced timeout (saves ~25s)
#   - Parallel frontend + backend image builds (saves build time of the faster one)
#   - DB restore file prep runs concurrently with image builds
#   - postgres image uses --pull=missing to skip registry checks
#   - Hard sleeps replaced with active health polling (saves ~5s)
#   - Health check interval reduced from 10s to 5s for faster DB readiness
#   - Total time printed at end for benchmarking
#
# Ports:
#   Frontend:  http://localhost:5001
#   Backend:   http://localhost:5000
#   Database:  localhost:5050

set -e

PROJECT_NAME="group1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_FILE="${REPO_ROOT}/postgres/group1db_backup.sql"
NETWORK_NAME="scc200_${PROJECT_NAME}-net"
START_TIME=$(date +%s)

echo "================================"
echo "Lab Machine Restart (Optimised)"
echo "================================"
echo ""

# Step 1: Backup existing database (if container running)
echo "Step 1: Backing up current database..."
if podman ps --format '{{.Names}}' 2>/dev/null | grep -q "^${PROJECT_NAME}db$"; then
  echo "  Database running - creating backup..."
  podman exec -t ${PROJECT_NAME}db pg_dumpall -c -U postgres > "${BACKUP_FILE}" 2>/dev/null || true
  echo "  ✓ Database backed up"
else
  echo "  No running database container found - skipping backup"
fi
echo ""

# Step 2: Stop and remove all containers IN PARALLEL with short timeout
# Original: sequential stops with 10s default timeout each = up to 30s
# Optimised: parallel stops with 2s timeout = ~2s total
echo "Step 2: Stopping and removing containers (parallel, 2s timeout)..."
for ctr in ${PROJECT_NAME}-frontend ${PROJECT_NAME}-backend ${PROJECT_NAME}db; do
  ( podman stop -t 2 "$ctr" 2>/dev/null; podman rm -f "$ctr" 2>/dev/null ) &
done
wait
echo "  ✓ Old containers removed"
echo ""

# Step 3: Ensure network exists
echo "Step 3: Setting up network..."
podman network exists "${NETWORK_NAME}" 2>/dev/null || podman network create "${NETWORK_NAME}" 2>/dev/null || true
echo "  ✓ Network '${NETWORK_NAME}' ready"
echo ""

# Step 4: Rebuild images IN PARALLEL + prepare DB restore files concurrently
echo "Step 4: Rebuilding images (parallel) + preparing DB files..."

# --- Background job: prepare database restore files ---
(
  if [ -f "$BACKUP_FILE" ]; then
    if grep -q '^\\connect group1db' "$BACKUP_FILE"; then
      awk '/^\\connect group1db/{found=1; next} found && /^\\connect postgres/{exit} found && /^\\restrict/{next} found && /^\\unrestrict/{next} found{print}' \
        "$BACKUP_FILE" > /tmp/group1db_backup.sql 2>/dev/null || true
    else
      cp "$BACKUP_FILE" /tmp/group1db_backup.sql 2>/dev/null || true
    fi
    chmod 644 /tmp/group1db_backup.sql 2>/dev/null || true
  else
    touch /tmp/group1db_backup.sql
  fi
  cp "${REPO_ROOT}/postgres/post_restore.sql" /tmp/post_restore.sql 2>/dev/null || true
  chmod 644 /tmp/post_restore.sql 2>/dev/null || true
) &
DB_PREP_PID=$!

# --- Background job: build backend image ---
echo "  Building backend..."
podman build -q -t localhost/${PROJECT_NAME}-backend:latest "${REPO_ROOT}/backend" > /tmp/build_backend.log 2>&1 &
BACKEND_BUILD_PID=$!

# --- Background job: build frontend image ---
echo "  Building frontend..."
podman build -q -t localhost/${PROJECT_NAME}-frontend:latest "${REPO_ROOT}/frontend" > /tmp/build_frontend.log 2>&1 &
FRONTEND_BUILD_PID=$!

# Wait for DB file prep (usually instant)
wait $DB_PREP_PID
echo "  ✓ DB restore files prepared"

# Wait for builds and report results
BUILDS_OK=true
if wait $BACKEND_BUILD_PID; then
  echo "  ✓ Backend image built"
else
  echo "  ✗ Backend build FAILED - check /tmp/build_backend.log"
  BUILDS_OK=false
fi

if wait $FRONTEND_BUILD_PID; then
  echo "  ✓ Frontend image built"
else
  echo "  ✗ Frontend build FAILED - check /tmp/build_frontend.log"
  BUILDS_OK=false
fi

if [ "$BUILDS_OK" = false ]; then
  echo ""
  echo "ERROR: One or more builds failed. Aborting."
  exit 1
fi
echo ""

# Step 5: Start database container (--pull=missing skips registry check if image cached)
echo "Step 5: Starting database..."
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
  --health-interval 5s \
  --health-timeout 3s \
  --health-retries 5 \
  --restart unless-stopped \
  --pull missing \
  docker.io/library/postgres:16-alpine

echo "  Waiting for database to become healthy..."
for i in $(seq 1 30); do
  if podman exec ${PROJECT_NAME}db pg_isready -U postgres > /dev/null 2>&1; then
    echo "  ✓ Database ready (${i}s)"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  ⚠ Database not ready after 30s - continuing anyway"
  fi
  sleep 1
done

# Apply auth schema to ensure auth tables exist
echo "  Applying auth schema..."
podman exec -i ${PROJECT_NAME}db psql -U postgres -d group1db < "${REPO_ROOT}/postgres/auth_schema.sql" > /dev/null 2>&1
echo "  ✓ Auth schema applied"

# Safety check: if core transport data is missing (common on reused/partially initialised volumes), auto-restore backup
TRANSPORT_COUNTS=$(podman exec -t ${PROJECT_NAME}db psql -U postgres -d group1db -t -A -F, -c "SELECT (SELECT count(*) FROM stops), (SELECT count(*) FROM bus_journeys), (SELECT count(*) FROM bus_journey_stops);" 2>/dev/null || echo "0,0,0")
OLD_IFS="$IFS"
IFS=',' read -r TRANSPORT_STOPS_COUNT TRANSPORT_JOURNEYS_COUNT TRANSPORT_JOURNEY_STOPS_COUNT <<< "${TRANSPORT_COUNTS}"
IFS="$OLD_IFS"

if { [ "${TRANSPORT_STOPS_COUNT}" = "0" ] || [ "${TRANSPORT_JOURNEYS_COUNT}" = "0" ] || [ "${TRANSPORT_JOURNEY_STOPS_COUNT}" = "0" ]; } && [ -s "/tmp/group1db_backup.sql" ]; then
  echo "  ⚠ Transport data incomplete (stops=${TRANSPORT_STOPS_COUNT}, journeys=${TRANSPORT_JOURNEYS_COUNT}, journey_stops=${TRANSPORT_JOURNEY_STOPS_COUNT}) - restoring backup..."
  if podman exec -i ${PROJECT_NAME}db psql -U postgres -d group1db < /tmp/group1db_backup.sql > /tmp/db_restore_autofix.log 2>&1; then
    echo "  ✓ Backup restored"
  else
    echo "  ✗ Auto-restore failed - check /tmp/db_restore_autofix.log"
  fi
fi
echo ""

# Step 6: Start backend and frontend containers
echo "Step 6: Starting backend (port 5000) + frontend (port 5001)..."
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

podman run -d --name ${PROJECT_NAME}-frontend \
  --network "${NETWORK_NAME}" \
  -p 5001:5001 \
  --restart unless-stopped \
  localhost/${PROJECT_NAME}-frontend:latest

# Poll for backend health instead of blind sleep (max 15s)
echo "  Waiting for backend..."
for i in $(seq 1 15); do
  if curl -sf http://localhost:5000/health > /dev/null 2>&1; then
    echo "  ✓ Backend healthy (${i}s)"
    break
  fi
  [ "$i" -eq 15 ] && echo "  ⚠ Backend not responding yet - may still be starting"
  sleep 1
done

# Poll for frontend (max 10s)
echo "  Waiting for frontend..."
for i in $(seq 1 10); do
  if curl -sf http://localhost:5001 > /dev/null 2>&1; then
    echo "  ✓ Frontend healthy (${i}s)"
    break
  fi
  [ "$i" -eq 10 ] && echo "  ⚠ Frontend not responding yet - may still be starting"
  sleep 1
done
echo ""

# Step 7: Verify everything is working
echo "Step 7: Verifying services..."
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

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
echo ""
echo "================================"
echo "✓ Lab Restart Complete! (${ELAPSED}s)"
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
