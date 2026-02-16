#!/bin/bash

# Lancaster Travel Routes - Container Cleanup Script
# This script stops and removes all containers and optionally removes images
# Usage: ./scripts/cleanup_containers.sh [--full] [--volumes]

PROJECT_NAME="group1"
REMOVE_IMAGES=false
REMOVE_VOLUMES=false

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
echo "Stopping Containers"
echo "================================"
echo ""

# Stop containers
echo "Stopping ${PROJECT_NAME}db..."
podman stop ${PROJECT_NAME}db 2>/dev/null || true

echo "Stopping ${PROJECT_NAME}-backend..."
podman stop ${PROJECT_NAME}-backend 2>/dev/null || true

echo "Stopping ${PROJECT_NAME}-frontend..."
podman stop ${PROJECT_NAME}-frontend 2>/dev/null || true

# Remove containers
echo ""
echo "Removing containers..."
podman rm ${PROJECT_NAME}db 2>/dev/null || true
podman rm ${PROJECT_NAME}-backend 2>/dev/null || true
podman rm ${PROJECT_NAME}-frontend 2>/dev/null || true

# Remove images if --full flag
if [ "$REMOVE_IMAGES" = true ]; then
  echo ""
  echo "Removing images..."
  podman rmi localhost/${PROJECT_NAME}-backend:latest 2>/dev/null || true
  podman rmi ${PROJECT_NAME}-frontend:latest 2>/dev/null || true
fi

# Remove volumes if --volumes flag
if [ "$REMOVE_VOLUMES" = true ]; then
  echo ""
  echo "Removing volumes..."
  podman volume rm ${PROJECT_NAME}_postgres_data 2>/dev/null || true
fi

echo ""
echo "================================"
echo "✓ Cleanup complete!"
echo "================================"
