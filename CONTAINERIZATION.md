# Podman Containerization Guide - Lancaster Travel Routes

This guide explains how to run the Lancaster Travel Routes application using Podman containers.

## Overview

The application consists of three main services running in containers:

1. **PostgreSQL Database** (`group1db`) - Port 5050
   - Stores transportation data
   - Pre-populated with schema and optional backup data

2. **Backend API Server** (`group1-backend`) - Port 5000
   - Node.js/Express REST API
   - Connects to PostgreSQL database
   - Serves API endpoints

3. **Frontend React App** (`group1-frontend`) - Port 5001
   - React single-page application
   - Static files served by Node.js
   - (Internal: 3000, External: 5001)

All containers communicate via a Docker bridge network (`group1-net`).

## Prerequisites

- Podman (1.9 or higher)
- Podman Compose (optional, for docker-compose usage)
- Sufficient disk space (~2GB for images and data)
- Ports 5001, 5000, 5050 available

### Install Podman (if needed)

**Ubuntu/Debian:**
```bash
sudo apt-get update && sudo apt-get install -y podman
```

**macOS (with Homebrew):**
```bash
brew install podman
```

**Other systems:** See [Podman Installation Guide](https://podman.io/getting-started/installation)

## Port Configuration

The application requires the following ports:
- **5001** for Frontend (maps to internal 3000)
- **5000** for Backend
- **5050** for Database (maps to internal PostgreSQL 5432)

## Method 1: Using Podman Compose (Recommended)

This is the easiest method and mimics Docker Compose usage.

### Step 1: Install Podman Compose
```bash
pip install podman-compose
# or
sudo curl -o /usr/local/bin/podman-compose https://raw.githubusercontent.com/containers/podman-compose/devel/podman-compose
sudo chmod +x /usr/local/bin/podman-compose
```

### Step 2: Start All Services
```bash
# From project root directory
podman-compose up -d
```

### Step 3: Verify Services
```bash
podman-compose ps
```

### Step 4: View Logs
```bash
# All services
podman-compose logs -f

# Specific service
podman-compose logs -f backend
podman-compose logs -f frontend
podman-compose logs -f postgres
```

### Step 5: Stop Services
```bash
podman-compose down
```

### Step 6: Stop and Remove Volumes (Clean Start)
```bash
podman-compose down -v
```

## Method 2: Using Provided Scripts

This method uses shell scripts to manage containers individually.

### Step 1: Build Container Images
```bash
./scripts/build_containers.sh
```

This will:
- Create the `group1-net` network
- Build backend image: `localhost/group1-backend:latest`
- Build frontend image: `group1-frontend:latest`

### Step 2: Run All Containers
```bash
./scripts/run_all_containers.sh
```

This will:
- Start PostgreSQL container with optional data restore
- Start Backend API server
- Start Frontend web application
- Display available services and container status

### Step 3: Verify Services
```bash
podman ps
podman ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

### Step 4: View Logs
```bash
# Backend logs
podman logs -f group1-backend

# Frontend logs
podman logs -f group1-frontend

# Database logs
podman logs -f group1db
```

### Step 5: Stop All Containers
```bash
./scripts/cleanup_containers.sh
```

### Step 6: Full Cleanup (Remove Images and Volumes)
```bash
./scripts/cleanup_containers.sh --full --volumes
```

## Method 3: Manual Podman Commands

For more control, run individual commands:

### Create Network
```bash
podman network create group1-net
```

### Start PostgreSQL
```bash
podman run -dt \
  --name group1db \
  --network group1-net \
  -e POSTGRES_PASSWORD=group1 \
  -e POSTGRES_DB=travel_routes \
  -p 5050:5432 \
  -v group1_postgres_data:/var/lib/postgresql/data \
  postgres:16-alpine
```

### Build Backend
```bash
podman build -t localhost/group1-backend:latest ./backend
```

### Run Backend
```bash
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
```

### Build Frontend
```bash
podman build -t group1-frontend:latest ./frontend
```

### Run Frontend
```bash
podman run -dt \
  --name group1-frontend \
  --network group1-net \
  -e REACT_APP_API_URL=http://localhost:5000 \
  -p 3000:3000 \
  group1-frontend:latest
```

## Accessing the Application

Once containers are running, access the application at:

- **Frontend**: http://localhost:5001
- **Backend Health**: http://localhost:5000/api/health
- **Database**: localhost:5050 (from local machine)

## Database Operations

### Backup Database
```bash
podman exec -t group1db pg_dumpall -c -U postgres > postgres/db_backup.sql
```

Or use the provided script:
```bash
./postgres/save_db.sh
```

### Restore from Backup
The backup is automatically restored when starting fresh containers if `postgres/db_backup.sql` exists.

Manual restore:
```bash
cat postgres/db_backup.sql | podman exec -i group1db psql -U postgres
```

### Access Database Directly
```bash
podman exec -it group1db psql -U postgres -d travel_routes
```

## Environment Variables

### Backend Environment Variables

The backend container accepts these environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 5000 | API server port |
| NODE_ENV | development | Environment mode |
| DB_HOST | localhost | PostgreSQL host |
| DB_PORT | 5432 | PostgreSQL port |
| DB_NAME | travel_routes | Database name |
| DB_USER | postgres | Database user |
| DB_PASSWORD | postgres | Database password |

### Frontend Environment Variables

| Variable | Description |
|----------|-------------|
| REACT_APP_API_URL | Backend API URL (defaults to localhost:5000) |

## Networking

All containers communicate through the `group1-net` bridge network:

```
Frontend (5001)
    ↓
Backend (5000) ← [group1-net] → PostgreSQL (5432)
```

Container-to-container communication uses container names as hostnames:
- From backend to database: `postgresql://postgres@group1db:5432/travel_routes`

## Troubleshooting

### Containers not starting

Check logs:
```bash
podman logs group1-backend
podman logs group1-frontend
podman logs group1db
```

### Port already in use

Change ports in docker-compose.yml or scripts:
```bash
# Example: Change frontend to port 8080
podman run -dt -p 8080:3000 group1-frontend:latest
```

### Database connection errors

Ensure PostgreSQL is running and healthy:
```bash
podman logs group1db
```

Wait a few seconds for PostgreSQL to fully start before starting backend.

### Network issues

Verify network exists and is functional:
```bash
podman network ls
podman network inspect group1-net
```

### Rebuild images

To rebuild images with latest code:
```bash
podman build --no-cache -t localhost/group1-backend:latest ./backend
podman build --no-cache -t group1-frontend:latest ./frontend
```

## Performance Optimization

### Build with BuildKit
```bash
DOCKER_BUILDKIT=1 podman build -t group1-backend:latest ./backend
```

### Multi-stage builds (already configured)
Both Dockerfiles use multi-stage builds to minimize image size.

### Resource limits

Run containers with resource constraints:
```bash
podman run -dt \
  --memory="512m" \
  --cpus="1" \
  --name group1-backend \
  ...
```

## Production Deployment

### Build for production

```bash
# Build with BuildKit
DOCKER_BUILDKIT=1 podman build \
  --build-arg NODE_ENV=production \
  -t group1-backend:v1.0.0 \
  ./backend
```

### Push to Registry

```bash
# Tag for registry
podman tag group1-backend:latest registry.example.com/group1-backend:v1.0.0

# Push
podman push registry.example.com/group1-backend:v1.0.0
```

### Run with Systemd Service

Create `/etc/systemd/system/group1-app.service`:
```ini
[Unit]
Description=Lancaster Travel Routes Application
After=network-online.target
Requires=podman.service

[Service]
Type=simple
ExecStart=/path/to/scripts/run_all_containers.sh
ExecStop=/path/to/scripts/cleanup_containers.sh

[Install]
WantedBy=multi-user.target
```

Start service:
```bash
sudo systemctl enable group1-app.service
sudo systemctl start group1-app.service
```

## Summary of Commands

| Action | Command |
|--------|---------|
| Start all (Compose) | `podman-compose up -d` |
| Start all (Scripts) | `./scripts/run_all_containers.sh` |
| Stop all (Compose) | `podman-compose down` |
| Stop all (Scripts) | `./scripts/cleanup_containers.sh` |
| View logs | `podman-compose logs -f` |
| List containers | `podman ps` |
| Access database | `podman exec -it group1db psql -U postgres` |
| Backup database | `./postgres/save_db.sh` |
| Rebuild images | `./scripts/build_containers.sh` |

## Next Steps

1. Build images: `./scripts/build_containers.sh`
2. Start containers: `./scripts/run_all_containers.sh`
3. Access frontend: http://localhost:5001
4. Check backend: http://localhost:5000/api/health
5. Connect to database: `podman exec -it group1db psql -U postgres`

For more information, see the main [README.md](../README.md).
