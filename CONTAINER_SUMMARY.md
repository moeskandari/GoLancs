# Running Lancaster Travel Routes on Podman Containers

## Summary

The Lancaster Travel Routes application has been fully containerized with Podman. All components (PostgreSQL, Node.js Backend, React Frontend) are configured to run in isolated, communicating containers.

## Quick Start

### Fastest Way to Run (3 commands)
```bash
# 1. Make scripts executable (first time only)
chmod +x scripts/*.sh

# 2. Build container images
./scripts/build_containers.sh

# 3. Start all services
./scripts/run_all_containers.sh
```

Then access:
- **Frontend**: http://localhost:3000
- **Backend Health**: http://localhost:5000/api/health
- **Database**: localhost:5050

---

## Complete System Architecture

```
USER'S BROWSER (Port 3000)
         ↓
    ┌────────────────────────┐
    │  Frontend Container    │
    │  (group1-frontend)     │
    │  React App             │
    │  Port 3000             │
    └────────────┬───────────┘
                 │ HTTP Requests
                 ↓ (group1-net network)
    ┌────────────────────────┐
    │  Backend Container     │
    │  (group1-backend)      │
    │  Node.js/Express       │
    │  Port 5000             │
    └────────────┬───────────┘
                 │ SQL Queries
                 ↓ (TCP 5432)
    ┌────────────────────────┐
    │  Database Container    │
    │  (group1db)            │
    │  PostgreSQL            │
    │  Port 5432 (→ 5050)    │
    └────────────────────────┘
```

---

## What Each Container Does

### Frontend Container (group1-frontend)
- **Base Image**: Node.js 18 Alpine
- **Purpose**: Serves the React web application
- **Exposed Port**: 3000
- **Build Process**: 
  1. Installs Node dependencies
  2. Builds optimized React bundle
  3. Serves static files with `serve`
- **Health Check**: HTTP request to root path

### Backend Container (group1-backend)
- **Base Image**: Node.js 18 Alpine
- **Purpose**: REST API server for routing and data
- **Exposed Port**: 5000
- **Endpoints**:
  - `GET /api/health` - Health status
  - `POST /api/routes` - Route planning (placeholder)
  - `GET /api/transport` - Transportation data (placeholder)
- **Environment Variables**:
  - `DB_HOST=group1db` (internal network hostname)
  - `DB_PORT=5432` (PostgreSQL default port)
  - `DB_NAME=travel_routes`
  - `DB_USER=postgres`
  - `DB_PASSWORD=group1`

### Database Container (group1db)
- **Base Image**: PostgreSQL 16 Alpine
- **Purpose**: Data storage for transportation information
- **Internal Port**: 5432
- **External Port**: 5050
- **Database**: `travel_routes`
- **User**: postgres
- **Password**: group1
- **Persistent Volume**: `group1_postgres_data`

---

## Three Ways to Run the Application

### Method 1: Podman Compose (Easiest)

**Best for**: Quick testing, development, simple deployments

```bash
# Start all services
podman-compose up -d

# Check status
podman-compose ps

# View logs
podman-compose logs -f

# Stop all
podman-compose down
```

**Advantages**:
- Single command to manage all services
- Services start in dependency order
- Automatic container naming
- Easy to view logs of all services
- Standard Docker Compose syntax

### Method 2: Shell Scripts (Automated)

**Best for**: Production-like setup, scripted deployments, CI/CD

```bash
# Build container images
./scripts/build_containers.sh

# Start all services
./scripts/run_all_containers.sh

# Check status
podman ps

# View logs
podman logs -f group1-backend

# Stop all
./scripts/cleanup_containers.sh
```

**Advantages**:
- More control over container startup
- Automatic database backup restoration
- Detailed logging and progress messages
- Safe cleanup with data preservation options
- Good for automation and CI/CD pipelines

### Method 3: Manual Commands (Full Control)

**Best for**: Debugging, custom deployments, learning

```bash
# Create network
podman network create group1-net

# Start database
podman run -dt --name group1db --network group1-net \
  -e POSTGRES_PASSWORD=group1 \
  -p 5050:5432 \
  postgres:16-alpine

# Build backend
podman build -t localhost/group1-backend:latest ./backend

# Start backend
podman run -dt --name group1-backend --network group1-net \
  -e DB_HOST=group1db \
  -p 5000:5000 \
  localhost/group1-backend:latest

# Build frontend
podman build -t group1-frontend:latest ./frontend

# Start frontend
podman run -dt --name group1-frontend --network group1-net \
  -p 3000:3000 \
  group1-frontend:latest
```

**Advantages**:
- Maximum flexibility
- Easy to debug individual containers
- Can inspect each step
- Good for learning how containers work

---

## Network Communication

All containers are connected via the `group1-net` bridge network, which allows them to communicate using container names as hostnames:

```
Frontend → Backend: http://group1-backend:5000
Backend → Database: postgresql://postgres@group1db:5432/travel_routes
```

When accessing from your computer (outside containers):
```
You → Frontend: http://localhost:3000
You → Backend: http://localhost:5000/api/health
You → Database: localhost:5050
```

---

## Database Operations in Containers

### Create Backup
```bash
# Using script
./postgres/save_db.sh

# Or manually
podman exec -t group1db pg_dumpall -c -U postgres > postgres/db_backup.sql
```

### Restore from Backup
```bash
# Automatic (if db_backup.sql exists when starting fresh containers)
./scripts/run_all_containers.sh

# Or manually
cat postgres/db_backup.sql | podman exec -i group1db psql -U postgres
```

### Connect to Database Directly
```bash
podman exec -it group1db psql -U postgres -d travel_routes
```

---

## File Structure After Setup

```
project-root/
├── backend/
│   ├── Dockerfile              # Backend container image definition
│   ├── package.json
│   ├── server.js
│   └── .env.container          # Container environment template
├── frontend/
│   ├── Dockerfile              # Frontend container image definition
│   ├── package.json
│   ├── public/
│   └── src/
├── postgres/
│   ├── db_backup.sql           # Database snapshot (auto-loaded)
│   └── *.sh, *.py              # Database utilities
├── scripts/
│   ├── build_containers.sh     # Build all images
│   ├── run_all_containers.sh   # Start all containers
│   ├── cleanup_containers.sh   # Stop and cleanup
│   └── quickstart.sh           # Interactive setup
├── docker-compose.yml          # Container orchestration file
├── docker-compose.dev.yml      # Development overrides
├── CONTAINERIZATION.md         # Detailed container docs
├── DOCKER_RUN_GUIDE.md        # How to run guide
└── README.md                   # Main documentation
```

---

## Monitoring Containers

### View Container Status
```bash
# List running containers
podman ps

# Detailed view
podman ps -a

# Filter by name
podman ps -f name=group1
```

### View Logs
```bash
# Backend logs (follow new output)
podman logs -f group1-backend

# Last 50 lines
podman logs --tail 50 group1-backend

# All containers
podman logs -f group1-backend & podman logs -f group1-frontend & podman logs -f group1db
```

### Check Container Health
```bash
# Inspect container
podman inspect group1-backend

# Check if running
podman ps | grep group1-backend

# Get IP address
podman inspect -f '{{.NetworkSettings.IPAddress}}' group1-backend
```

---

## Common Tasks

### Restart All Containers
```bash
podman-compose restart
# OR
podman restart group1-frontend group1-backend group1db
```

### Rebuild Frontend After Code Changes
```bash
podman build --no-cache -t group1-frontend:latest ./frontend
podman-compose up -d frontend
```

### Rebuild Backend After Code Changes
```bash
podman build --no-cache -t localhost/group1-backend:latest ./backend
podman-compose up -d backend
```

### Development with Hot-Reload
```bash
# Use development compose file
podman-compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Changes to src/ files auto-reload (React)
# Backend restarts on code changes (with nodemon)
```

### Check Disk Usage
```bash
podman system df

# Clean up unused images/containers/volumes
podman system prune
```

---

## Troubleshooting

### Issue: Port Already in Use
**Solution**: Stop other services using the ports or change ports in docker-compose.yml

```bash
# Find what's using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>
```

### Issue: Backend Can't Connect to Database
**Solution**: Ensure database is fully started before backend

```bash
# Check database is running
podman ps | grep group1db

# Wait and restart backend
sleep 5
podman restart group1-backend

# Check logs
podman logs group1-backend
```

### Issue: Frontend Shows Connection Error
**Solution**: Check backend is running and frontend has correct API URL

```bash
# Test backend from frontend container
podman exec group1-frontend curl http://group1-backend:5000/api/health

# Check environment variable
podman inspect group1-frontend | grep REACT_APP_API_URL
```

### Issue: Container Won't Start
**Solution**: Check logs for specific error

```bash
# View detailed logs
podman logs group1-backend

# Check image exists
podman images | grep group1

# Rebuild if needed
podman build -t group1-backend:latest ./backend
```

---

## Production Considerations

### Environment Variables
For production, create a `.env` file (not in git):
```bash
PORT=5000
NODE_ENV=production
DB_HOST=group1db
DB_PORT=5432
DB_NAME=travel_routes
DB_USER=postgres
DB_PASSWORD=<secure-password>
```

### Resource Limits
Edit docker-compose.yml to add resource constraints:
```yaml
backend:
  deploy:
    resources:
      limits:
        cpus: '1'
        memory: 512M
```

### Persistent Data
Database data is automatically stored in `group1_postgres_data` volume, which persists across container restarts.

### Logging
View logs from all services:
```bash
podman-compose logs --tail 100 -f
```

---

## Next Steps

1. **Run the Application**
   ```bash
   ./scripts/build_containers.sh
   ./scripts/run_all_containers.sh
   ```

2. **Access Frontend**
   - Open http://localhost:3000 in your browser

3. **Test Backend**
   - Visit http://localhost:5000/api/health

4. **Monitor Logs**
   ```bash
   podman logs -f group1-backend
   ```

5. **Develop**
   - Make code changes
   - Rebuild images as needed
   - Restart containers

---

## Key Files

| File | Purpose |
|------|---------|
| [README.md](README.md) | Main project documentation |
| [CONTAINERIZATION.md](CONTAINERIZATION.md) | Detailed container documentation |
| [DOCKER_RUN_GUIDE.md](DOCKER_RUN_GUIDE.md) | How to run the application |
| [docker-compose.yml](docker-compose.yml) | Production container orchestration |
| [docker-compose.dev.yml](docker-compose.dev.yml) | Development with hot-reload |
| [backend/Dockerfile](backend/Dockerfile) | Backend container image |
| [frontend/Dockerfile](frontend/Dockerfile) | Frontend container image |

---

## Support Commands Reference

```bash
# Quick setup
./scripts/quickstart.sh

# Build images
./scripts/build_containers.sh

# Start application
./scripts/run_all_containers.sh

# View status
podman ps

# View logs
podman logs -f group1-backend

# Stop application
./scripts/cleanup_containers.sh

# Full cleanup
./scripts/cleanup_containers.sh --full --volumes

# Access database
podman exec -it group1db psql -U postgres -d travel_routes

# Backup database
./postgres/save_db.sh

# Using compose
podman-compose up -d
podman-compose ps
podman-compose logs -f
podman-compose down
```

---

**Status**: ✅ Complete containerization ready for deployment

All containers are configured, documented, and ready to run. Choose your preferred method above and start the application!
