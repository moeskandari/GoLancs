#!/bin/bash

# Lancaster Travel Routes - Complete Container Startup Script
# This script starts all containers (PostgreSQL, Backend, Frontend)
# Usage: ./scripts/run_all_containers.sh

set -e

PROJECT_NAME="group1"

echo "================================"
echo "Starting Lancaster Travel Routes"
echo "================================"

# Create network if it doesn't exist
echo ""
echo "Setting up network..."
podman network exists ${PROJECT_NAME}-net || podman network create ${PROJECT_NAME}-net

# Start PostgreSQL
echo ""
echo "Starting PostgreSQL container..."
podman stop ${PROJECT_NAME}db 2>/dev/null || true
podman rm ${PROJECT_NAME}db 2>/dev/null || true

podman pull docker.io/library/postgres:16-alpine
podman run -dt \
  --name ${PROJECT_NAME}db \
  --network ${PROJECT_NAME}-net \
  -e POSTGRES_PASSWORD=group1 \
  -e POSTGRES_DB=group1db \
  -p 5050:5432 \
  -v ${PROJECT_NAME}_postgres_data:/var/lib/postgresql/data \
  postgres:16-alpine

echo "PostgreSQL starting... waiting for health check"
sleep 5

# Restore database backup if exists
BACKUP_FILE="./postgres/db_backup.sql"
if [ -f "$BACKUP_FILE" ]; then
  echo "Restoring database from backup..."
  cat "$BACKUP_FILE" | podman exec -i ${PROJECT_NAME}db psql -U postgres
  echo "✓ Database restored"
else
  echo "No backup file found, starting with fresh database"
fi

echo "Applying bus schema updates..."
podman exec -i ${PROJECT_NAME}db psql -U postgres -d group1db < ./postgres/bus_schema.sql

echo "Rebuilding stops and bus schedules..."
python3 ./postgres/import_naptan.py
python3 ./postgres/import_bus_schedules.py

# Start Backend
echo ""
echo "Starting Backend container..."
podman stop ${PROJECT_NAME}-backend 2>/dev/null || true
podman rm ${PROJECT_NAME}-backend 2>/dev/null || true

podman run -dt \
  --name ${PROJECT_NAME}-backend \
  --network ${PROJECT_NAME}-net \
  -e PORT=5000 \
  -e NODE_ENV=production \
  -e DB_HOST=${PROJECT_NAME}db \
  -e DB_PORT=5432 \
  -e DB_NAME=group1db \
  -e DB_USER=postgres \
  -e DB_PASSWORD=group1 \
  -p 5000:5000 \
  localhost/${PROJECT_NAME}-backend:latest

echo "Backend starting... waiting for health check"
sleep 3

# Start Frontend
echo ""
echo "Starting Frontend container..."
podman stop ${PROJECT_NAME}-frontend 2>/dev/null || true
podman rm ${PROJECT_NAME}-frontend 2>/dev/null || true

podman run -dt \
  --name ${PROJECT_NAME}-frontend \
  --network ${PROJECT_NAME}-net \
  -e REACT_APP_API_URL=http://localhost:5000 \
  -p 5001:3000 \
  ${PROJECT_NAME}-frontend:latest

echo ""
echo "================================"
echo "✓ All containers started!"
echo "================================"
echo ""
echo "Services available at:"
echo "  Frontend:  http://localhost:5001"
echo "  Backend:   http://localhost:5000/api/health"
echo "  Database:  localhost:5050"
echo ""
echo "Container Status:"
podman ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "View logs:"
echo "  Backend:  podman logs -f ${PROJECT_NAME}-backend"
echo "  Frontend: podman logs -f ${PROJECT_NAME}-frontend"
echo "  Database: podman logs -f ${PROJECT_NAME}db"
