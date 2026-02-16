# How to Run the Lancaster Travel Routes Application

This document describes how to run the complete Lancaster Travel Routes application on Podman containers.

## Architecture Overview

The application uses a three-tier containerized architecture:

```
┌─────────────────────────────────────────────────────┐
│                 Podman Host Machine                  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │         group1-net (Bridge Network)           │  │
│  │                                              │  │
│  │  ┌──────────────┐  ┌──────────────────┐    │  │
│  │  │  Frontend    │  │     Backend      │    │  │
│  │  │  (React)     │  │     (Node.js)    │    │  │
│  │  │  Port 5080   ├──┤  Port 5000       │    │  │
│  │  │              │  │                  ├───┐│  │
│  │  └──────────────┘  └──────────────────┘   ││  │
│  │         ↑                                   ││  │
│  │    localhost:5080                          ││  │
│  │                                            ││  │
│  │                              ┌─────────────┘│  │
│  │                              ↓              │  │
│  │                         ┌──────────────┐   │  │
│  │                         │  PostgreSQL  │   │  │
│  │                         │  Port 5432   │   │  │
│  │                         │  (Port 5050) │   │  │
│  │                         └──────────────┘   │  │
│  │                                            │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Container Details

### 1. PostgreSQL Database (group1db)
- **Image**: postgres:16-alpine
- **Internal Port**: 5432
- **External Port**: 5050
- **Network**: group1-net
- **Data Volume**: group1_postgres_data
- **Database**: travel_routes
- **User**: postgres
- **Password**: group1

### 2. Backend API Server (group1-backend)
- **Image**: localhost/group1-backend:latest
- **Built from**: ./backend/Dockerfile
- **Internal Port**: 5000
- **External Port**: 5000
- **Network**: group1-net
- **Environment**:
  - PORT=5000
  - NODE_ENV=production
  - DB_HOST=group1db
  - DB_PORT=5432
  - DB_NAME=travel_routes

### 3. Frontend Web Application (group1-frontend)
- **Image**: group1-frontend:latest
- **Built from**: ./frontend/Dockerfile
- **Internal Port**: 3000
- **External Port**: 5080
- **Network**: group1-net
- **Environment**:
  - REACT_APP_API_URL=http://localhost:5000

## Running the Application

### Option A: Interactive Quick Start (Recommended for First Time)

```bash
# From project root directory
chmod +x scripts/quickstart.sh
./scripts/quickstart.sh
```

This script will:
1. Check that Podman is installed
2. Ask you to choose your preferred method (Compose, Scripts, or Manual)
3. Guide you through the setup process
4. Display connection information when ready

### Option B: Podman Compose (Easiest and Most Consistent)

#### Prerequisites
```bash
# Install podman-compose
pip install podman-compose
# OR
sudo apt-get install podman-compose
```

#### Commands
```bash
# Start all containers in background
podman-compose up -d

# View running containers
podman-compose ps

# View logs from all services
podman-compose logs -f

# View logs from specific service
podman-compose logs -f backend
podman-compose logs -f frontend
podman-compose logs -f postgres

# Stop all containers
podman-compose down

# Stop and remove all data
podman-compose down -v
```

### Option C: Shell Scripts (Full Automation)

#### Commands
```bash
# Step 1: Build all container images
./scripts/build_containers.sh

# Output:
# ✓ All images built successfully!
# Images created:
# group1-backend        latest    <image-id>
# group1-frontend       latest    <image-id>

# Step 2: Start all containers
./scripts/run_all_containers.sh

# Output:
# ✓ All containers started!
# Services available at:
#   Frontend:  http://localhost:5080
#   Backend:   http://localhost:5000/api/health
#   Database:  localhost:5050

# View container status
podman ps

# View logs
podman logs -f group1-backend
podman logs -f group1-frontend
podman logs -f group1db

# Stop all containers
./scripts/cleanup_containers.sh

# Remove containers, images, and data
./scripts/cleanup_containers.sh --full --volumes
```

### Option D: Manual Podman Commands (For Advanced Users)

```bash
# 1. Create network
podman network create group1-net

# 2. Start PostgreSQL
podman run -dt \
  --name group1db \
  --network group1-net \
  -e POSTGRES_PASSWORD=group1 \
  -e POSTGRES_DB=travel_routes \
  -p 5050:5432 \
  -v group1_postgres_data:/var/lib/postgresql/data \
  postgres:16-alpine

# 3. Build backend image
podman build -t localhost/group1-backend:latest ./backend

# 4. Run backend
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

# 5. Build frontend image
podman build -t group1-frontend:latest ./frontend

# 6. Run frontend
podman run -dt \
  --name group1-frontend \
  --network group1-net \
  -e REACT_APP_API_URL=http://localhost:5000 \
  -p 5080:3000 \
  group1-frontend:latest
```

## Accessing the Application

Once all containers are running:

### Frontend
- **URL**: http://localhost:5080
- **What you'll see**: Interactive map with search bars and compass

### Backend API
- **Health Check**: http://localhost:5000/api/health
- **Response**: `{"status":"ok","message":"Backend server is running"}`

### Database
- **Host**: localhost
- **Port**: 5050
- **Database**: travel_routes
- **User**: postgres
- **Password**: group1

## Database Operations

### Backup Database
```bash
# Option 1: Using provided script
./postgres/save_db.sh
# Creates: postgres/db_backup.sql

# Option 2: Manual backup
podman exec -t group1db pg_dumpall -c -U postgres > postgres/db_backup.sql
```

### Restore Database
```bash
# Automatic: Place db_backup.sql in postgres/ folder, containers will auto-restore
# Manual: cat postgres/db_backup.sql | podman exec -i group1db psql -U postgres
```

### Connect to Database Directly
```bash
podman exec -it group1db psql -U postgres -d travel_routes
```

## Monitoring and Troubleshooting

### View Container Status
```bash
# Show all containers and their status
podman ps

# Show detailed status
podman ps -a

# Show only running containers
podman ps --filter status=running
```

### View Logs
```bash
# Backend logs (last 50 lines, follow new output)
podman logs -f --tail 50 group1-backend

# Frontend logs
podman logs -f group1-frontend

# Database logs
podman logs -f group1db

# All containers
podman logs -f group1-backend && podman logs -f group1-frontend && podman logs -f group1db
```

### Common Issues and Solutions

#### Issue: Port Already in Use
```bash
# Find what's using the port
lsof -i :3000
lsof -i :5000
lsof -i :5050

# Kill the process
kill -9 <PID>

# Or change ports in docker-compose.yml
```

#### Issue: Containers Won't Start
```bash
# Check logs for errors
podman logs group1-backend

# Restart container
podman restart group1-backend

# Remove and recreate
podman rm group1-backend
# Then run container again
```

#### Issue: Database Connection Failed
```bash
# Ensure database container is running
podman ps | grep group1db

# Check database logs
podman logs group1db

# Restart database
podman restart group1db

# Wait for it to be ready (may take 5-10 seconds)
sleep 10
podman restart group1-backend
```

#### Issue: Frontend Can't Reach Backend
```bash
# Ensure backend is running
podman logs group1-backend

# Check network connectivity
podman exec group1-frontend curl http://group1-backend:5000/api/health

# Verify environment variable
podman inspect group1-frontend | grep REACT_APP_API_URL
```

## Development Workflow with Containers

### Using Hot Reload (Development)
```bash
# Use development compose file for hot-reload
podman-compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Changes to frontend/src/ will automatically reload
# Changes to backend/ will automatically restart (with nodemon)
```

### Building Fresh
```bash
# Rebuild without cache
podman build --no-cache -t localhost/group1-backend:latest ./backend
podman build --no-cache -t group1-frontend:latest ./frontend

# Then restart containers
podman-compose restart backend frontend
```

## Scaling and Performance

### Increase Container Resources
Edit docker-compose.yml:
```yaml
services:
  backend:
    # Add resource limits
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

### Multiple Backend Instances
```yaml
backend:
  deploy:
    replicas: 2
```

## Cleaning Up

### Stop All (Keep Volumes)
```bash
podman-compose down
# OR
./scripts/cleanup_containers.sh
```

### Full Cleanup (Remove Everything)
```bash
# With podman-compose
podman-compose down -v

# With scripts
./scripts/cleanup_containers.sh --full --volumes
```

### Manual Cleanup
```bash
# Stop containers
podman stop group1-frontend group1-backend group1db

# Remove containers
podman rm group1-frontend group1-backend group1db

# Remove images
podman rmi localhost/group1-backend:latest group1-frontend:latest

# Remove volumes
podman volume rm group1_postgres_data

# Remove network
podman network rm group1-net
```

## Production Deployment

### Build for Production
```bash
# Build with production settings
DOCKER_BUILDKIT=1 podman build \
  --build-arg NODE_ENV=production \
  -t registry.example.com/group1-backend:v1.0.0 \
  ./backend
```

### Push to Registry
```bash
# Tag image
podman tag group1-backend:latest registry.example.com/group1-backend:v1.0.0

# Login to registry
podman login registry.example.com

# Push
podman push registry.example.com/group1-backend:v1.0.0
```

### Using Systemd Service
Create `/etc/systemd/system/group1-travel-routes.service`:
```ini
[Unit]
Description=Group 1 Lancaster Travel Routes Application
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/path/to/project
ExecStart=/path/to/scripts/run_all_containers.sh
ExecStop=/path/to/scripts/cleanup_containers.sh
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable group1-travel-routes.service
sudo systemctl start group1-travel-routes.service
```

## Summary

| Task | Command |
|------|---------|
| Interactive Setup | `./scripts/quickstart.sh` |
| Start (Compose) | `podman-compose up -d` |
| Start (Scripts) | `./scripts/run_all_containers.sh` |
| View Status | `podman ps` |
| View Logs | `podman logs -f group1-backend` |
| Stop All | `podman-compose down` |
| Clean All | `./scripts/cleanup_containers.sh --full --volumes` |
| Access Frontend | http://localhost:3000 |
| Access Backend | http://localhost:5000/api/health |
| Database | localhost:5050 |

## Next Steps

1. Ensure Podman is installed
2. Run `./scripts/quickstart.sh` or choose a method above
3. Access frontend at http://localhost:3000
4. Check backend health: http://localhost:5000/api/health
5. Start developing!

For more detailed information, see [CONTAINERIZATION.md](CONTAINERIZATION.md)
