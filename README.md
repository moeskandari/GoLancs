# Lancaster Travel Routes

SCC200 Group 1 — A multi-modal transport route planner for Lancaster, Preston, Blackpool and the Fylde & Wyre coast.

---

## Documentation

This repository includes the supporting documents produced alongside the codebase.

| Document | Purpose |
|----------|---------|
| `Participant Information Sheet.docx` | Given to each participant before user testing; explains consent, data handling and what testing involved. The app was tested with real users following this process. |
| `Software-Security-Code-of-Practice-Self-Assessment-Template.docx` | Our completed code of conduct and security self-assessment against the department's software security code of practice. |
| `Group 2-1 Design Report.pdf` | Full design report covering requirements, architecture and system design decisions. |
| `Presentation slides.pptx` | Slides from our project presentation, delivered to potential buyers alongside a breakdown of development and running costs. |

We presented the finished product to potential buyers, covering both the system itself and the costs involved in building and running it.

---

## Personal Computer Quick Start

> Follow these steps if you received the project as a zip file and want to run it on your own Mac, Windows, or Linux machine. You can use either **Docker** or **Podman** — both work.

### Step 1 — Install a container runtime

Pick one. Docker Desktop is easier to set up; Podman Desktop is open-source and what the lab machines use.

**Option A — Docker Desktop (recommended for personal machines)**

| OS | Link |
|----|------|
| Mac (Apple Silicon or Intel) | https://docs.docker.com/desktop/install/mac-install/ |
| Windows 10/11 | https://docs.docker.com/desktop/install/windows-install/ |
| Linux | https://docs.docker.com/desktop/install/linux-install/ |

After installing, open Docker Desktop and wait until the status bar shows **"Docker Desktop is running"** (green icon in the system tray / menu bar).

**Option B — Podman Desktop**

| OS | Link |
|----|------|
| Mac (Apple Silicon or Intel) | https://podman-desktop.io/downloads/macos |
| Windows 10/11 | https://podman-desktop.io/downloads/windows |
| Linux | https://podman-desktop.io/downloads/linux |

After installing, open Podman Desktop and initialise the Podman machine when prompted (one-time setup). You also need `podman-compose`:
```bash
pip3 install podman-compose
```

### Step 2 — Open a terminal in the project folder

**Mac / Linux:**
```bash
cd path/to/Group1-200-Project
```

**Windows (PowerShell):**
```powershell
cd C:\path\to\Group1-200-Project
```

### Step 3 — Start everything

**If you installed Docker:**
```bash
docker compose up -d
```

**If you installed Podman:**
```bash
podman-compose up -d
```

This builds the frontend and backend images, seeds the database from the included backup, and starts all three services. **The first run takes 2–5 minutes** while images are downloaded and built. Subsequent starts take about 10 seconds.

Watch progress with:
```bash
# Docker
docker compose logs -f

# Podman
podman-compose logs -f
```

Press `Ctrl+C` to stop watching logs (the app keeps running).

### Step 4 — Open the app

Once all three containers are running, open your browser to:

**http://localhost:5101**

To confirm everything is healthy:
```bash
# Docker
docker compose ps

# Podman
podman ps
```

All three services (`group1db`, `group1-backend`, `group1-frontend`) should show **"Up"** or **"healthy"**.

### Step 5 — Stop the app

```bash
# Docker
docker compose down

# Podman
podman-compose down
```

Your database data is preserved in a Docker/Podman volume and will be there next time you start the app.

To delete all saved data and start completely fresh:
```bash
# Docker
docker compose down -v

# Podman
podman-compose down -v
```

### Troubleshooting

**Port already in use** — another app is using port 5100, 5101, or 5050. Find and stop it:
```bash
# Mac / Linux
lsof -i :5101

# Windows PowerShell
netstat -ano | findstr :5101
```

**Containers crash on first start** — the database may need a moment to initialise before the backend connects. Restart the backend:
```bash
# Docker
docker compose restart group1-backend

# Podman
podman restart group1-backend
```

**"Cannot connect to the Docker daemon"** — Docker Desktop (or Podman Desktop) is not running. Open the app first.

**Windows line-ending errors in scripts** — run `git config core.autocrlf false`, delete the folder, and re-unzip.

---

## Architecture

```
Browser → http://localhost:5101
           │
    ┌──────┴──────────────────┐
    │   Frontend (React)      │  Port 5101
    │   group1-frontend       │
    └──────┬──────────────────┘
           │ HTTP
    ┌──────┴──────────────────┐
    │   Backend (Node/Express)│  Port 5100
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
- Ports **5100**, **5101**, **5050** available

---

## Quick Start (Lab Machines)

After every lab machine restart, run one command:

```bash
cd "/home/bylesl/h-drive/Year 2/SCC200"
./scripts/lab_restart.sh
```

This automatically: backs up the DB → stops old containers → pulls base images → rebuilds → restores DB → starts everything. Takes ~30–45 seconds.

Then open **http://localhost:5101**.

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

### Python Data Import Scripts

The scripts in `postgres/` require a Python virtual environment. The `.venv` folder is excluded from the repository — recreate it locally:

```bash
cd postgres
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Once activated, you can run any of the import scripts:

```bash
python3 import_bus_routes.py
python3 import_bus_timetables.py
python3 import_rail_data.py
```

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

The database is backed up to `postgres/group1db_backup.sql`. On restart, `lab_restart.sh` runs a full rebuild and restores from that file. `docker-compose.yml` mounts it directly from `./postgres/` into PostgreSQL's init directory for automatic restoration.

```
postgres/group1db_backup.sql → docker-entrypoint-initdb.d/ → auto-restore
```

Always run `./scripts/backup_db.sh` after important data changes.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check — returns service status |
| GET | `/api/stops` | List all bus/rail stops |
| GET | `/api/stops/nearby?lat=&lon=&radius=` | Find stops near a location |
| GET | `/api/geocode?q=` | Forward geocode (text → coordinates) |
| GET | `/api/reverse-geocode?lat=&lon=` | Reverse geocode (coordinates → name) |
| GET | `/api/reverse?lat=&lon=` | Full reverse geocode with display_name |
| GET | `/api/search?q=` | Unified search (stops + places) |
| GET | `/api/plan?start=&end=&time=&sort=` | **Multi-modal route planner** (bus, train, walk) |
| GET | `/api/routes?start=ATCO&end=ATCO` | Legacy bus route search |
| GET | `/api/transport` | Transport data placeholder |
| GET | `/api/rail/stations` | Rail stations in database |
| GET | `/api/rail/departures/:crs` | Live rail departures with calling points |
| GET | `/api/rail/facilities/:crs` | Station facilities |
| GET | `/api/rail/routes?from=CRS&to=CRS` | Find train routes between stations |
| GET | `/api/rail/delay-codes` | UK rail delay reason codes |
| GET | `/api/bus/departures/:atco` | Timetable departures from a bus stop |
| GET | `/api/bus/journey/:journeyId` | Full stop list for a bus journey |
| GET | `/api/bus/live` | All live bus GPS positions (Lancashire) |
| GET | `/api/bus/live/route/:routeNumber` | Live buses for a specific route |
| GET | `/api/bus/live/:noc` | Live buses for an operator |
| GET | `/api/weather?lat=&lon=` | 3-day weather forecast (Open-Meteo) |
| GET | `/api/road/vms` | Motorway Variable Message Signs |

### Route Finding Example

```bash
curl "http://localhost:5100/api/routes?start=250012161&end=250010001"
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
├── backend/                        # Node.js Express API (modular architecture)
│   ├── Dockerfile
│   ├── server.js                   # Slim entry point — mounts all route modules
│   ├── db/
│   │   └── pool.js                 # Centralised PostgreSQL connection pool
│   ├── utils/                      # Pure utility functions (no side-effects)
│   │   ├── geo.js                  # Haversine distance, bearing, station coords (88+ stations)
│   │   ├── time.js                 # Time ↔ minutes conversion, day-of-week index
│   │   ├── rail-graph.js           # Railway graph loading + Dijkstra pathfinding
│   │   └── stop-utils.js           # ATCO stop code expansion (sibling stops)
│   ├── services/                   # Business logic (database + computation)
│   │   ├── geometry.js             # Route polyline enrichment (Valhalla/OSRM)
│   │   ├── journey-search.js       # Direct bus/train journey + connection finders
│   │   └── nearby.js               # Nearby rail stations + bus stops search
│   ├── routes/                     # Express route handlers (one per feature)
│   │   ├── health.js               # GET /api/health
│   │   ├── stops.js                # GET /api/stops, /api/stops/nearby
│   │   ├── geocode.js              # Geocoding, reverse geocode, search
│   │   ├── rail.js                 # Rail stations, departures, facilities, routes
│   │   ├── bus-timetable.js        # Bus departures, journeys, route search
│   │   ├── planner.js              # GET /api/plan — multi-modal journey planner
│   │   ├── weather.js              # GET /api/weather — Open-Meteo proxy
│   │   ├── bus-live.js             # Live bus GPS tracking (SIRI-VM parser)
│   │   └── road-vms.js             # Variable Message Signs (motorway data)
│   ├── __tests__/                  # Jest + Supertest tests (142 tests, 10 suites)
│   └── data/
│       └── railway_graph.json      # Dijkstra graph nodes for track-following geometry
├── frontend/                       # React application (hooks-based architecture)
│   ├── Dockerfile
│   ├── src/
│   │   ├── App.js                  # Slim root component — composes all hooks
│   │   ├── services/
│   │   │   └── api.js              # Centralised API client (all backend calls)
│   │   ├── hooks/                  # Custom React hooks
│   │   │   ├── useGeolocation.js   # GPS/IP geolocation with multi-level fallback
│   │   │   ├── useWeather.js       # Current + destination weather fetching
│   │   │   ├── useLiveTracking.js  # Live bus/train polling with best-match scoring
│   │   │   └── useRoutePlanner.js  # Route planning state + geocoding + pin drop
│   │   └── components/             # React UI components (43 tests, 3 suites)
│   │       ├── MapView.js          # Leaflet map with route/live overlays
│   │       ├── SearchBar.js        # Autocomplete search input
│   │       ├── RouteResults.js     # Route cards with leg details + live tracking
│   │       ├── WeatherSidebar.js   # 3-day forecast sidebar
│   │       └── ...                 # Auth, Compass, BottomControls
│   └── public/
├── postgres/                       # Database setup & import scripts
│   ├── init.sql                    # Initial schema
│   ├── bus_schema.sql              # Bus-specific tables
│   ├── post_restore.sql            # Post-restore migrations
│   ├── import_*.py                 # Python data import scripts
│   └── *.sql                       # Backups
├── scripts/                        # Automation scripts
├── docker-compose.yml              # Production orchestration
├── docker-compose.dev.yml          # Dev overrides (hot-reload)
└── README.md                       # This file
```

### Backend Module Dependency Graph

```
server.js (entry)
  ├── routes/*         (Express routers — each feature isolated)
  │     ├── planner.js → services/* + utils/* + db/pool
  │     ├── rail.js    → utils/geo + db/pool
  │     ├── bus-live.js → xml2js (SIRI-VM parsing)
  │     └── ...
  ├── services/*       (business logic)
  │     ├── geometry.js  → db/pool + utils/geo + utils/rail-graph
  │     ├── journey-search.js → db/pool + utils/stop-utils + utils/time + services/nearby
  │     └── nearby.js    → db/pool + utils/geo + utils/stop-utils
  └── utils/*          (pure functions, no side-effects)
        ├── geo.js       (haversine, bearing, STATION_COORDS)
        ├── time.js      (timeToMinutes, minutesToTime, getDayIndex)
        ├── rail-graph.js (graph loading + Dijkstra)
        └── stop-utils.js (ATCO code expansion → db/pool)
```

---

## Troubleshooting

### Port already in use

```bash
lsof -i :5101              # Find what's using the port
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
| `REACT_APP_API_URL` | Backend API URL (default: `http://localhost:5100`) |
