# Container Quick Reference Card

## Fastest Start (Choose One)

### Quick Interactive Setup
```bash
./scripts/quickstart.sh
```

### Podman Compose (Recommended)
```bash
podman-compose up -d
```

### Shell Scripts
```bash
./scripts/build_containers.sh
./scripts/run_all_containers.sh
```

---

## Access Application

| Service | URL | Purpose |
|---------|-----|---------|
| Frontend | http://localhost:3000 | Web UI |
| Backend API | http://localhost:5000/api/health | Health check |
| Database | localhost:5050 | PostgreSQL |

---

## Essential Commands

| Task | Command |
|------|---------|
| **Start** | `podman-compose up -d` |
| **Stop** | `podman-compose down` |
| **View Status** | `podman ps` |
| **View Logs** | `podman logs -f group1-backend` |
| **Restart** | `podman restart group1-backend` |
| **Clean (keep data)** | `./scripts/cleanup_containers.sh` |
| **Clean (remove all)** | `./scripts/cleanup_containers.sh --full --volumes` |

---

## Container Names & Ports

| Container | Internal Port | External Port | Network |
|-----------|---------------|---------------|---------|
| group1-frontend | 3000 | 3000 | group1-net |
| group1-backend | 5000 | 5000 | group1-net |
| group1db | 5432 | 5050 | group1-net |

---

## Database Access

```bash
# Connect to database
podman exec -it group1db psql -U postgres -d travel_routes

# Backup
./postgres/save_db.sh

# Restore
cat postgres/db_backup.sql | podman exec -i group1db psql -U postgres
```

---

## Debugging

```bash
# Check if containers are running
podman ps

# View logs
podman logs -f group1-backend
podman logs -f group1-frontend
podman logs -f group1db

# Inspect container
podman inspect group1-backend

# Test backend from frontend
podman exec group1-frontend curl http://group1-backend:5000/api/health

# Test database from backend
podman exec group1-backend psql -h group1db -U postgres -d travel_routes
```

---

## File Locations

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Main orchestration |
| `backend/Dockerfile` | Backend image |
| `frontend/Dockerfile` | Frontend image |
| `scripts/quickstart.sh` | Interactive setup |
| `scripts/build_containers.sh` | Build images |
| `scripts/run_all_containers.sh` | Start containers |
| `CONTAINER_SUMMARY.md` | Overview |
| `DOCKER_RUN_GUIDE.md` | Detailed guide |
| `CONTAINERIZATION.md` | Full documentation |

---

## Common Issues

| Problem | Solution |
|---------|----------|
| Port in use | `lsof -i :3000` then `kill -9 <PID>` |
| DB connection fails | Wait 5 seconds, then `podman restart group1-backend` |
| Frontend can't reach API | Check `podman logs group1-frontend` |
| Container won't start | Check `podman logs <container-name>` |
| Stuck logs | Press `Ctrl+C` to exit log view |

---

## Network Architecture

```
User Browser
    ↓ (localhost:3000)
Frontend Container (group1-frontend)
    ↓ (group1-net network, group1-backend:5000)
Backend Container (group1-backend)
    ↓ (group1-net network, group1db:5432)
Database Container (group1db)
```

Containers communicate by name on group1-net network:
- Frontend → Backend: `http://group1-backend:5000`
- Backend → Database: `postgresql://postgres@group1db:5432`

---

## Development Commands

```bash
# Development with hot-reload
podman-compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Rebuild after code changes
podman build --no-cache -t group1-frontend:latest ./frontend
podman-compose restart frontend

# Same for backend
podman build --no-cache -t localhost/group1-backend:latest ./backend
podman-compose restart backend

# Follow logs while developing
podman logs -f group1-backend &
podman logs -f group1-frontend
```

---

## Production Checklist

- [ ] Use strong database password in .env
- [ ] Set NODE_ENV=production
- [ ] Review resource limits in docker-compose.yml
- [ ] Test database backups work
- [ ] Set up log rotation
- [ ] Configure firewall rules
- [ ] Use reverse proxy (nginx)
- [ ] Enable HTTPS
- [ ] Set up monitoring
- [ ] Document deployment procedure

---

## Environment Variables

### Backend (.env)
```bash
PORT=5000
NODE_ENV=production
DB_HOST=group1db
DB_PORT=5432
DB_NAME=travel_routes
DB_USER=postgres
DB_PASSWORD=group1
```

### Frontend
```bash
REACT_APP_API_URL=http://localhost:5000
```

---

## Manual Container Setup (Advanced)

```bash
# 1. Network
podman network create group1-net

# 2. Database
podman run -dt --name group1db --network group1-net \
  -e POSTGRES_PASSWORD=group1 -p 5050:5432 \
  postgres:16-alpine

# 3. Backend
podman build -t localhost/group1-backend:latest ./backend
podman run -dt --name group1-backend --network group1-net \
  -e DB_HOST=group1db -p 5000:5000 \
  localhost/group1-backend:latest

# 4. Frontend
podman build -t group1-frontend:latest ./frontend
podman run -dt --name group1-frontend --network group1-net \
  -p 3000:3000 group1-frontend:latest
```

---

## More Info

- **Full Guide**: See `DOCKER_RUN_GUIDE.md`
- **Documentation**: See `CONTAINERIZATION.md`
- **Overview**: See `CONTAINER_SUMMARY.md`
- **Main README**: See `README.md`

---

**Last Updated**: February 16, 2026
**Status**: Production Ready ✅
