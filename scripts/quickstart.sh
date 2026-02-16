#!/bin/bash

# Quick Start Guide - Lancaster Travel Routes with Podman
# This script demonstrates how to quickly get the application running

echo "=========================================="
echo "Lancaster Travel Routes - Quick Start"
echo "=========================================="
echo ""

# Check prerequisites
echo "Checking prerequisites..."
if ! command -v podman &> /dev/null; then
    echo "❌ Podman is not installed. Please install Podman first."
    echo "   See: https://podman.io/getting-started/installation"
    exit 1
fi

echo "✓ Podman is installed"

# Option selection
echo ""
echo "Choose your setup method:"
echo ""
echo "1. Podman Compose (Recommended - easiest)"
echo "2. Shell Scripts (More manual control)"
echo "3. Manual Podman Commands (Full control)"
echo ""
read -p "Enter your choice (1-3): " choice

case $choice in
    1)
        echo ""
        echo "Using Podman Compose..."
        
        # Check if podman-compose is installed
        if ! command -v podman-compose &> /dev/null; then
            echo ""
            echo "⚠️  podman-compose is not installed."
            echo "Install with: pip install podman-compose"
            echo ""
            echo "Or use Method 2 (Shell Scripts) instead."
            exit 1
        fi
        
        echo "✓ Starting containers with Podman Compose..."
        podman-compose up -d
        
        echo ""
        echo "Waiting for services to start..."
        sleep 5
        
        echo ""
        echo "✓ All containers are running!"
        echo ""
        echo "Access your application:"
        echo "  Frontend:  http://localhost:5001"
        echo "  Backend:   http://localhost:5000/api/health"
        echo "  Database:  localhost:5050"
        echo ""
        echo "Common commands:"
        echo "  View logs:     podman-compose logs -f"
        echo "  Stop all:      podman-compose down"
        echo "  View status:   podman-compose ps"
        ;;
        
    2)
        echo ""
        echo "Using Shell Scripts..."
        
        # Build images
        echo "Step 1: Building container images..."
        ./scripts/build_containers.sh
        
        echo ""
        echo "Step 2: Starting all containers..."
        ./scripts/run_all_containers.sh
        
        echo ""
        echo "✓ All containers are running!"
        echo ""
        echo "Access your application:"
        echo "  Frontend:  http://localhost:5001"
        echo "  Backend:   http://localhost:5000/api/health"
        echo "  Database:  localhost:5050"
        echo ""
        echo "Common commands:"
        echo "  View logs:     podman logs -f group1-backend"
        echo "  Stop all:      ./scripts/cleanup_containers.sh"
        echo "  View status:   podman ps"
        ;;
        
    3)
        echo ""
        echo "Manual Podman Commands..."
        echo ""
        echo "Step 1: Create network"
        podman network create group1-net
        
        echo ""
        echo "Step 2: Start PostgreSQL"
        podman run -dt \
          --name group1db \
          --network group1-net \
          -e POSTGRES_PASSWORD=group1 \
          -e POSTGRES_DB=travel_routes \
          -p 5050:5432 \
          -v group1_postgres_data:/var/lib/postgresql/data \
          postgres:16-alpine
        
        echo "Waiting for database to be ready..."
        sleep 5
        
        echo ""
        echo "Step 3: Build backend image"
        podman build -t localhost/group1-backend:latest ./backend
        
        echo ""
        echo "Step 4: Start backend"
        podman run -dt \
          --name group1-backend \
          --network group1-net \
          -e PORT=5000 \
          -e NODE_ENV=production \
          -e DB_HOST=group1db \
          -e DB_PORT=5432 \
          -e DB_NAME=travel_routes \
          -e DB_USER=postgres \
          -e DB_PASSWORD=group1 \
          -p 5000:5000 \
          localhost/group1-backend:latest
        
        echo ""
        echo "Step 5: Build frontend image"
        podman build -t group1-frontend:latest ./frontend
        
        echo ""
        echo "Step 6: Start frontend"
        podman run -dt \
          --name group1-frontend \
          --network group1-net \
          -e REACT_APP_API_URL=http://localhost:5000 \
          -p 5001:3000 \
          group1-frontend:latest
        
        echo ""
        echo "✓ All containers are running!"
        echo ""
        echo "Access your application:"
        echo "  Frontend:  http://localhost:5001"
        echo "  Backend:   http://localhost:5000/api/health"
        echo "  Database:  localhost:5050"
        echo ""
        echo "Common commands:"
        echo "  View logs:     podman logs -f group1-backend"
        echo "  List containers: podman ps"
        echo "  Stop all:"
        echo "    podman stop group1-frontend group1-backend group1db"
        echo "    podman rm group1-frontend group1-backend group1db"
        ;;
        
    *)
        echo "Invalid choice. Please run the script again."
        exit 1
        ;;
esac

echo ""
echo "=========================================="
echo "Setup complete! Happy developing! 🚀"
echo "=========================================="
