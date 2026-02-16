# How to Describe Running Your Application on Podman Containers

## The One-Sentence Pitch

> "The application runs as three interconnected Docker containers: a PostgreSQL database, a Node.js backend API, and a React frontend, all orchestrated with Podman."

## The Short Explanation (2 minutes)

When you run the application on Podman containers, here's what happens:

1. **Three containers start up**, each running independently:
   - **Frontend Container** (React app) listens on port 3000
   - **Backend Container** (Node.js API) listens on port 5000
   - **Database Container** (PostgreSQL) listens on port 5432

2. **They connect through a bridge network** called `group1-net`, allowing them to communicate:
   - Frontend calls the Backend API at `http://group1-backend:5000`
   - Backend connects to Database at `postgresql://group1db:5432`

3. **You access it from your computer** at:
   - Frontend: `http://localhost:3000`
   - Backend: `http://localhost:5000/api/health`
   - Database: `localhost:5050`

4. **Everything is automated**:
   - Single command to build: `./scripts/build_containers.sh`
   - Single command to run: `./scripts/run_all_containers.sh`
   - Single command to stop: `./scripts/cleanup_containers.sh`

## The Technical Explanation (5 minutes)

### Architecture

```
┌──────────────────────────────────────────────────┐
│           Host Machine (Your Computer)           │
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │      Podman Bridge Network (group1-net)    │ │
│  │                                            │ │
│  │  ┌──────────────────────────────────────┐ │ │
│  │  │  Frontend Container (group1-frontend)│ │ │
│  │  │  • Port 3000 (Internal)              │ │ │
│  │  │  • React.js SPA                      │ │ │
│  │  │  • Node.js Alpine Image              │ │ │
│  │  └──────────────┬───────────────────────┘ │ │
│  │                │ HTTP                      │ │
│  │  ┌─────────────▼───────────────────────┐ │ │
│  │  │  Backend Container (group1-backend) │ │ │
│  │  │  • Port 5000 (Internal)             │ │ │
│  │  │  • Express.js REST API              │ │ │
│  │  │  • Node.js Alpine Image             │ │ │
│  │  └──────────────┬───────────────────────┘ │ │
│  │                │ SQL                      │ │
│  │  ┌─────────────▼───────────────────────┐ │ │
│  │  │  Database Container (group1db)      │ │ │
│  │  │  • Port 5432 (Internal)             │ │ │
│  │  │  • PostgreSQL 16 Alpine             │ │ │
│  │  │  • Data Volume (Persistent)         │ │ │
│  │  └─────────────────────────────────────┘ │ │
│  │                                            │ │
│  └────────────────────────────────────────────┘ │
│                    │                             │
│                    │ Port Mapping                │
│  ┌─────────────────┼──────────────────────────┐ │
│  │ 3000:3000       │ 5000:5000    │ 5050:5432 │ │
│  └─────────────────┼──────────────┼───────────┘ │
│                    │              │              │
└────────────────────┼──────────────┼──────────────┘
                     │              │
            localhost:3000  localhost:5000  localhost:5050
                     │              │
                 Your Browser    Testing    Database Tool
```

### Container Specifications

**Frontend Container (group1-frontend)**
- Base Image: Node.js 18 Alpine
- Dockerfile: `frontend/Dockerfile` (multi-stage build)
- Build Process:
  1. Install npm dependencies
  2. Build React app with `npm run build`
  3. Serve static files with `serve` package
- Ports: 3000 internal → 3000 external
- Environment: `REACT_APP_API_URL=http://localhost:5000`

**Backend Container (group1-backend)**
- Base Image: Node.js 18 Alpine
- Dockerfile: `backend/Dockerfile`
- Build Process:
  1. Install npm dependencies with `npm ci`
  2. Copy application code
  3. Run with `npm start`
- Ports: 5000 internal → 5000 external
- Environment Variables:
  - `PORT=5000`
  - `NODE_ENV=production`
  - `DB_HOST=group1db` (container name)
  - `DB_PORT=5432`
  - `DB_NAME=travel_routes`
  - `DB_USER=postgres`
  - `DB_PASSWORD=group1`

**Database Container (group1db)**
- Base Image: PostgreSQL 16 Alpine
- No Dockerfile (uses official image)
- Ports: 5432 internal → 5050 external
- Volumes: `group1_postgres_data` (persistent storage)
- Environment:
  - `POSTGRES_PASSWORD=group1`
  - `POSTGRES_DB=travel_routes`

### Networking

All containers connect via `group1-net`, a Docker bridge network:
- Containers can reach each other by name (e.g., `group1-backend`, `group1db`)
- Containers are isolated from external networks
- Port mapping forwards host ports to container ports

### Persistence

- Database data stored in `group1_postgres_data` volume
- Volume persists even if container is stopped/removed
- Automatic backup can be restored on startup from `postgres/db_backup.sql`

## The Operational Explanation (How to Run)

### Three Ways to Start

1. **Interactive Setup** (Best for first time)
   ```bash
   ./scripts/quickstart.sh
   ```
   Guides you through choosing between three methods.

2. **Podman Compose** (Recommended for daily use)
   ```bash
   podman-compose up -d
   ```
   Standard Docker Compose syntax, works with Podman.

3. **Shell Scripts** (Best for CI/CD automation)
   ```bash
   ./scripts/build_containers.sh
   ./scripts/run_all_containers.sh
   ```
   More control, better for scripted deployments.

### What Happens When You Start

1. Network `group1-net` is created (if not exists)
2. PostgreSQL container starts first
3. System waits for database to be ready
4. Database restores from backup if `postgres/db_backup.sql` exists
5. Backend container starts and connects to database
6. Frontend container starts and is ready to serve
7. All services should be accessible within 10 seconds

### Daily Operations

```bash
# Check if containers are running
podman ps

# View logs from backend
podman logs -f group1-backend

# Stop everything
podman-compose down

# Stop and remove all data
podman-compose down -v

# Restart a specific service
podman restart group1-backend

# Access database directly
podman exec -it group1db psql -U postgres -d travel_routes
```

## When Explaining to Others

### To Project Managers
> "We're using containerization to ensure the application runs identically on any machine. Three containers work together: the website (frontend), the server logic (backend), and the database. Everything starts with a single command."

### To Other Developers
> "The app runs on Podman with docker-compose. Frontend (React) on port 3000 calls the backend (Node.js/Express) on port 5000, which queries PostgreSQL on port 5432. All containers are on a bridge network. Use `podman-compose up -d` to start, `podman ps` to check status."

### To DevOps/Infrastructure
> "We have two Dockerfiles (frontend multi-stage, backend simple) and a docker-compose.yml for orchestration. Build images with our provided scripts. Database data persists in a named volume. Health checks on all services. Ready to push to registry or deploy to Kubernetes."

### To New Team Members
> "Start by reading START_HERE.md, then run `./scripts/quickstart.sh`. It will guide you through starting the containers. Open http://localhost:3000 to see the app. Check CONTAINER_QUICK_REF.md for common commands."

## Key Points to Emphasize

1. **Isolation**: Each service runs independently, failures don't cascade
2. **Reproducibility**: Same containers run on everyone's machine
3. **Simplicity**: Single command to start everything
4. **Persistence**: Database survives container restarts
5. **Scalability**: Easy to add more backend instances
6. **Development-Friendly**: Hot-reload available with docker-compose.dev.yml
7. **Well-Documented**: Multiple guides for different needs

## Common Questions & Answers

**Q: Why containers?**
A: Every developer gets identical environments. No "works on my machine" problems. Easy to scale and deploy.

**Q: How do the containers talk to each other?**
A: Through a bridge network. Containers use container names as hostnames (e.g., `group1-backend:5000`).

**Q: What if I want to change something?**
A: Edit the Dockerfile, rebuild with `podman build`, then restart. Or use `docker-compose.dev.yml` for hot-reload during development.

**Q: How is the database persistent?**
A: Volume storage named `group1_postgres_data`. Persists even if container is removed.

**Q: Can I access the database from my machine?**
A: Yes, at `localhost:5050` with `psql` or any database tool.

**Q: How do I back up the database?**
A: Run `./postgres/save_db.sh` or `podman exec -t group1db pg_dumpall -U postgres > backup.sql`

**Q: What if a container crashes?**
A: Use `podman restart container-name` to restart it. Use `podman logs` to see what went wrong.

## Architecture Summary

```
Lancaster Travel Routes Application
├─ Frontend
│  └─ React SPA running on Node.js
│     └─ Serves on port 3000
├─ Backend
│  └─ Express REST API
│     └─ Serves on port 5000
└─ Database
   └─ PostgreSQL
      └─ Listens on port 5432 (→ 5050)

All three communicate through group1-net
```

## Implementation Details

| Component | Technology | Container | Port |
|-----------|-----------|-----------|------|
| Frontend | React.js | group1-frontend | 3000 |
| Backend | Node.js/Express | group1-backend | 5000 |
| Database | PostgreSQL | group1db | 5432→5050 |
| Orchestration | Podman Compose | - | - |
| Networking | Bridge Network | group1-net | - |
| Storage | Named Volume | group1_postgres_data | - |

## Deployment Paths

1. **Development**: `podman-compose -f docker-compose.yml -f docker-compose.dev.yml up -d`
2. **Testing**: `./scripts/run_all_containers.sh`
3. **Production**: `podman-compose -f docker-compose.yml up -d` with custom `.env`

---

**Use this guide when**:
- Explaining the setup to team members
- Writing project documentation
- Planning deployments
- Troubleshooting issues
- Onboarding new developers
