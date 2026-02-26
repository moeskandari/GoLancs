# Lancaster Travel Routes

SCC200 Group 1 — A multi-modal transport route planner for Lancaster, Preston, Blackpool and the Fylde & Wyre coast.

---

## Architecture

```
Browser → http://localhost:5001
           │
    ┌──────┴──────────────────┐
    │   Frontend (React)      │  Port 5001
    │   group1-frontend       │
    └──────┬──────────────────┘
           │ HTTP
    ┌──────┴──────────────────┐
    │   Backend (Node/Express)│  Port 5000
    │   group1-backend        │
    └──────┬──────────────────┘
           │ SQL
    ┌──────┴──────────────────┐
    │   PostgreSQL 16         │  Port 5050 → 5432
    │   group1db              │
    └─────────────────────────┘
    All on bridge network: group1-net
```

---

## Prerequisites

- **Podman** (1.9+) and **podman-compose**
- **Node.js 18+** (for local dev without containers)
- **Python 3** (for data import scripts)
- Ports **5000**, **5001**, **5050** available

---

## Quick Start (Lab Machines)

After every lab machine restart, run one command:

```bash
cd "/home/bylesl/h-drive/Year 2/SCC200"
./scripts/lab_restart.sh
```

This automatically: backs up the DB → stops old containers → pulls base images → rebuilds → restores DB → starts everything. Takes ~30–45 seconds.

Then open **http://localhost:5001**.

### Alternative: Podman Compose Only

If containers are already built and you just need to restart:

```bash
podman-compose up -d          # Start
podman-compose down           # Stop
```

---

## Development Setup

### With Hot-Reload

```bash
podman-compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

This mounts source directories so code changes auto-reload (React dev server for frontend, nodemon for backend).

### Without Containers (Local Dev)

```bash
# Terminal 1 — Backend
cd backend && npm install && npm run dev

# Terminal 2 — Frontend
cd frontend && npm install && npm start
```

Requires a running PostgreSQL instance on port 5050.

---

## Command Cheat Sheet

| Task | Command |
|------|---------|
| **Full lab restart** | `./scripts/lab_restart.sh` |
| **Start all** | `podman-compose up -d` |
| **Stop all** | `podman-compose down` |
| **View logs** | `podman-compose logs -f [service]` |
| **Rebuild images** | `./scripts/build_containers.sh` |
| **Backup database** | `./scripts/backup_db.sh` |
| **Restore database** | `./scripts/restore_db.sh [file]` |
| **Import bus routes** | `./scripts/import_routes.sh [OPERATOR]` |
| **Clean up containers** | `./scripts/cleanup_containers.sh` |
| **Full clean (delete data)** | `./scripts/cleanup_containers.sh --full --volumes` |
| **Database shell** | `podman exec -it group1db psql -U postgres -d group1db` |
| **Check container status** | `podman ps` |

---

## Database

### Connection Details

| Property | Value |
|----------|-------|
| Host | `localhost` (or `group1db` from containers) |
| Port | `5050` (external) / `5432` (internal) |
| Database | `group1db` |
| User | `postgres` |
| Password | `group1` |

### Tables

| Table | Purpose |
|-------|---------|
| `stops` | Bus/rail stop locations from NaPTAN (2,375+ records) |
| `operators` | Transport operators (ARCT, BLAC, KLCO, SCCU, SCMY, NUTT) |
| `bus_routes` | Route definitions with operator and endpoint stops |
| `route_stops` | Ordered stop sequences per route with travel times |
| `journey_tracking` | Historical/live bus positions and delay data |
| `planned_routes` | Cached multi-leg calculated routes |
| `national_rail` | Rail station information |
| `rail_schedule` | Train timetables |
| `schedule_points` | Individual stops on rail schedules |

### Persistence on Lab Machines

The database is backed up to `postgres/group1db_backup.sql` on the h-drive. On restart, `lab_restart.sh` copies it to `/tmp` where `docker-compose.yml` mounts it into PostgreSQL's init directory for automatic restoration.

```
h-drive backup → /tmp/group1db_backup.sql → docker-entrypoint-initdb.d/ → auto-restore
```

Always run `./scripts/backup_db.sh` after important data changes.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check — returns service status |
| GET | `/api/routes?start=ATCO&end=ATCO` | Find bus routes between two stops |
| POST | `/api/routes` | Route planning (in development) |
| GET | `/api/transport` | Transportation data (in development) |

### Route Finding Example

```bash
curl "http://localhost:5000/api/routes?start=250012161&end=250010001"
```

Returns direct routes and transfer options with estimated travel times. Travel times are estimated using haversine distance at ~20 km/h average bus speed.

### Importing Route Data

Routes are imported from the transport API (requires campus/VPN access):

```bash
./scripts/import_routes.sh          # All operators
./scripts/import_routes.sh ARCT     # Specific operator
```

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/lab_restart.sh` | **Primary startup script.** Full backup → rebuild → restore cycle for lab machines. |
| `scripts/build_containers.sh` | Build frontend and backend container images. Creates network if needed. |
| `scripts/cleanup_containers.sh` | Stop and remove containers. Backs up DB first. Use `--full` to also remove images, `--volumes` to remove data. |
| `scripts/backup_db.sh` | Dump `group1db` to `postgres/group1db_backup.sql` with timestamped copy. |
| `scripts/restore_db.sh` | Restore database from backup file. Accepts optional file path argument. |
| `scripts/import_routes.sh` | Import bus routes from transport API into database. |

---

## Project Structure

```
├── backend/              # Node.js Express API
│   ├── Dockerfile
│   ├── server.js
│   ├── __tests__/        # Jest tests
│   └── data/             # Static data (railway graph)
├── frontend/             # React application
│   ├── Dockerfile
│   ├── src/
│   │   ├── App.js
│   │   └── components/   # SearchBar, MapView, RouteResults, etc.
│   └── public/
├── postgres/             # Database setup & import scripts
│   ├── init.sql          # Initial schema
│   ├── bus_schema.sql    # Bus-specific tables
│   ├── post_restore.sql  # Post-restore migrations
│   ├── import_*.py       # Python data import scripts
│   └── *.sql             # Backups
├── scripts/              # Automation scripts
├── docker-compose.yml    # Production orchestration
├── docker-compose.dev.yml # Dev overrides (hot-reload)
└── README.md             # This file
```

---

## Troubleshooting

### Port already in use

```bash
lsof -i :5001              # Find what's using the port
kill -9 <PID>              # Kill it
```

### Containers won't start

```bash
podman-compose logs group1db         # Check database logs
podman-compose logs group1-backend   # Check backend logs
```

### Database empty after restart

```bash
./scripts/backup_db.sh              # Ensure backup exists
./scripts/lab_restart.sh            # Full restart with restore
```

### Backend can't connect to database

Wait a few seconds for PostgreSQL to fully initialise, then:

```bash
podman restart group1-backend
```

### Need to rebuild from scratch

```bash
./scripts/cleanup_containers.sh --full --volumes
./scripts/build_containers.sh
podman-compose up -d
./scripts/restore_db.sh
```

---

## Environment Variables

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | API server port |
| `NODE_ENV` | `development` | Environment mode |
| `DB_HOST` | `localhost` | PostgreSQL host (`group1db` in containers) |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `group1db` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `group1` | Database password |

### Frontend

| Variable | Description |
|----------|-------------|
| `REACT_APP_API_URL` | Backend API URL (default: `http://localhost:5000`) |
