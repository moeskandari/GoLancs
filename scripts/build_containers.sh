#!/bin/bash

# Lancaster Travel Routes - Podman Container Setup Script
# This script builds all necessary container images

set -e

PROJECT_NAME="group1"
REGISTRY="localhost"

echo "================================"
echo "Building Podman Images"
echo "================================"

# Create network if it doesn't exist
echo "Creating Podman network..."
podman network exists ${PROJECT_NAME}-net || podman network create ${PROJECT_NAME}-net

# Build backend image
echo ""
echo "Building backend image..."
podman build -t ${REGISTRY}/${PROJECT_NAME}-backend:latest ./backend

# Build frontend image
echo ""
echo "Building frontend image..."
podman build -t ${PROJECT_NAME}-frontend:latest ./frontend

echo ""
echo "================================"
echo "✓ All images built successfully!"
echo "================================"
echo ""
echo "Images created:"
podman images | grep -E "group1|REPOSITORY"
