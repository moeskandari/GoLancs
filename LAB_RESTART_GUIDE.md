# Lab Machine Restart Guide

## Quick Start After Lab Machine Restart

When you restart a lab machine and need to get the application running again:

```bash
cd "/home/bylesl/h-drive/Year 2/SCC200"
./scripts/lab_restart.sh
```

**That's it!** The script handles everything:
- ✅ Backs up current database
- ✅ Stops old containers  
- ✅ Pulls latest base images
- ✅ Rebuilds application images
- ✅ Restores database from backup
- ✅ Applies schema migrations
- ✅ Starts all services

Then open: **http://localhost:5001**

---

## What Gets Backed Up

The `lab_restart.sh` script backs up your database automatically to:
```
postgres/group1db_backup.sql
```

This file contains:
- **Database Schema**: All table definitions (9 tables)
  - `stops` - Bus stops and transit hubs (2,375+ records including Lancaster Bus Station)
  - `operators` - Transport operators (ARCT, BLAC, KLCO, SCCU, SCMY, NUTT)
  - `national_rail` - Rail station information
  - `rail_schedule` - Train timetables
  - `schedule_points` - Individual stops on rail schedules
  - `bus_routes` - Bus route definitions
  - `route_stops` - Stop sequence along each route
  - `journey_tracking` - Historical bus position/delay data
  - `planned_routes` - Calculated multi-leg routes

- **All Data**: Every record in each table
- **Indexes & Constraints**: Foreign keys and performance indexes
- **User Data**: Any routes/searches you've calculated

---

## Database Recovery Guarantee

Your database will **automatically restore** when you run `lab_restart.sh`:

1. **Backup is copied to `/tmp`** for docker-compose to mount
2. **PostgreSQL container starts** with recovery scripts
3. **Database is restored** from backup during initialization
4. **Schema updates apply** (supports new tables added to the project)
5. **All services connect** automatically

---

## Manual Database Backup

To manually back up your database at any time:

```bash
./postgres/save_db.sh
```

Output:
```
Backing up PostgreSQL database...
  Location: ./postgres/group1db_backup.sql
✓ Database backed up successfully
  File size: 152K
  Lines: 3196
```

---

## Step-by-Step: What lab_restart.sh Does

### Step 1: Backup Current Database
```bash
podman exec -t group1db pg_dumpall -c -U postgres > postgres/group1db_backup.sql
```
Saves all data so you don't lose it when restarting.

### Step 2: Stop All Containers
```bash
podman-compose down
```
Gracefully stops database, backend, and frontend.

### Step 3: Clean Up Old Containers
Removes old container instances that might be orphaned.

### Step 4: Pull Latest Base Images
```bash
podman pull docker.io/library/postgres:16-alpine
podman pull docker.io/library/node:18-alpine
```
Ensures you have the latest secure versions.

### Step 5: Rebuild Application Images
```bash
podman build -t localhost/group1-backend:latest ./backend
podman build -t group1-frontend:latest ./frontend
```
Rebuilds backend and frontend from your code.

### Step 6: Prepare Restore Files
Copies backup and migration scripts to `/tmp` for docker-compose mounting.

### Step 7: Start All Containers
```bash
podman-compose up -d
```
Starts PostgreSQL, Backend, and Frontend with automatic database restore.

### Step 8-9: Verify Health
Checks that all services are running and database is accessible.

---

## Other Useful Commands

### Just Clean Up (Preserve Data)
```bash
./scripts/cleanup_containers.sh
```
- Stops and removes containers
- **Preserves** database backup
- Keeps data volume

### Clean Everything (Warning: Deletes Data!)
```bash
./scripts/cleanup_containers.sh --volumes
```
- Removes containers **and** data volume
- **Only use if you want to start fresh**

### Manual Start (Without Cleanup)
```bash
podman-compose down
podman-compose up -d
```
Stops and restarts without image rebuild.

### View Logs
```bash
podman-compose logs -f           # All services
podman-compose logs -f backend   # Just backend
podman-compose logs -f postgres  # Just database
```

### Access Database Directly
```bash
podman exec -it group1db psql -U postgres -d group1db
```

---

## Troubleshooting

### Database Doesn't Restore
If the backup file is corrupted:
1. Check file exists: `ls -lh postgres/group1db_backup.sql`
2. Check size (should be >100KB): `du -h postgres/group1db_backup.sql`
3. Verify it contains table definitions: `head -50 postgres/group1db_backup.sql`

### Containers Won't Start
Check logs:
```bash
podman-compose logs group1db       # Database errors
podman-compose logs group1-backend # Backend errors
```

### Port Already in Use
If port 5001 or 5000 is already in use:
1. Find what's using it: `lsof -i :5001`
2. Kill the process: `kill -9 <PID>`
3. Retry: `./scripts/lab_restart.sh`

### Slow Restart
The script includes sleep delays for stability. This is normal:
- Initial container startup: ~5 seconds
- Full restart sequence: ~30-45 seconds

---

## File Structure

```
.
├── postgres/
│   ├── group1db_backup.sql       # ← Your database backup (GIT IGNORED)
│   ├── save_db.sh                # ← Manual backup script
│   └── post_restore.sql          # ← Auto-applied schema updates
│
├── scripts/
│   ├── lab_restart.sh            # ← USE THIS for lab restarts
│   ├── quickstart.sh             # ← Initial setup
│   ├── build_containers.sh       # ← Build images only
│   ├── run_all_containers.sh     # ← Start containers (old method)
│   └── cleanup_containers.sh     # ← Stop/remove containers
│
└── docker-compose.yml            # ← Container orchestration
```

---

## Git Handling

The `postgres/group1db_backup.sql` file is in `.gitignore` because:
- It's large (100+ KB)
- It contains local data
- Each team member has different data
- It's specific to each machine

**Instead**, the backup is:
1. **Stored locally** on the h-drive (`/home/bylesl/h-drive/Year 2/SCC200/postgres/`)
2. **Automatically used** by `lab_restart.sh`
3. **Safe across restarts** because it's on h-drive

---

## Automation Tips

### Create an Alias
Add to your `~/.bashrc`:
```bash
alias lab-restart='cd "/home/bylesl/h-drive/Year 2/SCC200" && ./scripts/lab_restart.sh'
```

Then just run:
```bash
lab-restart
```

### Cron Job (Optional)
Auto-backup daily:
```bash
0 18 * * * cd "/home/bylesl/h-drive/Year 2/SCC200" && ./postgres/save_db.sh >> /tmp/backup.log 2>&1
```

---

## Summary

| Scenario | Command |
|----------|---------|
| **Lab machine restarted** | `./scripts/lab_restart.sh` |
| **Just backing up database** | `./postgres/save_db.sh` |
| **Stopping for the day** | `podman-compose down` |
| **Restarting application** | `podman-compose up -d` |
| **Full cleanup + restart** | `./scripts/lab_restart.sh` |
| **Emergency: delete everything** | `./scripts/cleanup_containers.sh --volumes` |

---

## Questions?

Check logs:
```bash
podman-compose logs -f
```

Check database:
```bash
podman exec -it group1db psql -U postgres -d group1db
```

Check services:
```bash
podman-compose ps
```
