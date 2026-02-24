#!/bin/bash

# Lancaster Travel Routes - Container Cleanup Script
# This script stops and removes all containers and optionally removes images
# 
# IMPORTANT: Before cleanup, this script backs up the database to postgres/group1db_backup.sql
# This ensures your data is preserved across container restarts
#
# Usage: 
#   ./scripts/cleanup_containers.sh              # Just stop/remove containers, keep data
#   ./scripts/cleanup_containers.sh --full       # Also remove application images
#   ./scripts/cleanup_containers.sh --volumes    # Also remove data volume (WARNING: deletes data)

PROJECT_NAME="group1"
REMOVE_IMAGES=false
REMOVE_VOLUMES=false
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --full)
      REMOVE_IMAGES=true
      shift
      ;;
    --volumes)
      REMOVE_VOLUMES=true
      shift
      ;;
    *)
      shift
      ;;
  esac
done

echo "================================"
echo "Container Cleanup Sequence"
echo "================================"
echo ""

# Step 1: Backup database before cleanup
echo "Step 1: Backing up database..."
if podman ps | grep -q ${PROJECT_NAME}db; then
  BACKUP_FILE="${REPO_ROOT}/postgres/group1db_backup.sql"
  podman exec -t ${PROJECT_NAME}db pg_dumpall -c -U postgres > "$BACKUP_FILE"
  echo "  ✓ Database backed up to $(basename "$BACKUP_FILE")"
else
  echo "  ℹ Database not running - skipping backup"
fi
echo ""

# Step 2: Stop containers
echo "Step 2: Stopping containers..."
echo "  Stopping ${PROJECT_NAME}db..."
podman stop ${PROJECT_NAME}db 2>/dev/null || true

echo "  Stopping ${PROJECT_NAME}-backend..."
podman stop ${PROJECT_NAME}-backend 2>/dev/null || true

echo "  Stopping ${PROJECT_NAME}-frontend..."
podman stop ${PROJECT_NAME}-frontend 2>/dev/null || true

echo "  ✓ Containers stopped"
echo ""

# Step 3: Remove containers
echo "Step 3: Removing containers..."
podman rm ${PROJECT_NAME}db 2>/dev/null || true
podman rm ${PROJECT_NAME}-backend 2>/dev/null || true
podman rm ${PROJECT_NAME}-frontend 2>/dev/null || true
echo "  ✓ Containers removed"
echo ""

# Step 4: Remove images if --full flag
if [ "$REMOVE_IMAGES" = true ]; then
  echo "Step 4: Removing images..."
  podman rmi localhost/${PROJECT_NAME}-backend:latest 2>/dev/null || true
  podman rmi ${PROJECT_NAME}-frontend:latest 2>/dev/null || true
  echo "  ✓ Images removed"
  echo ""
fi

# Step 5: Remove volumes if --volumes flag
if [ "$REMOVE_VOLUMES" = true ]; then
  echo "Step 5: Removing data volumes..."
  echo "  ⚠️  WARNING: Removing volumes deletes all data!"
  read -p "  Continue? (y/n): " confirm
  if [[ $confirm == "y" || $confirm == "Y" ]]; then
    podman volume rm ${PROJECT_NAME}_postgres_data 2>/dev/null || true
    podman volume rm scc200_postgres_data 2>/dev/null || true
    echo "  ✓ Volumes removed"
  else
    echo "  ✓ Volume removal cancelled"
  fi
  echo ""
fi

echo "================================"
echo "✓ Cleanup complete!"
echo "================================"
echo ""
echo "Your database is backed up:"
echo "  Location: postgres/group1db_backup.sql"
echo ""
echo "To restart the application:"
echo "  Run: ./scripts/lab_restart.sh"
echo "  Or:  podman-compose up -d"
echo ""
