# Database Persistence Setup for Lab Machines

## Problem
Lab machines delete all data outside of the h-drive on restart, so database data cannot persist in container volumes.

## Solution
The database is backed up to h-drive as `postgres/group1db_backup.sql` and automatically restored on startup.

## How It Works

### On Startup
1. **Startup Script** (`scripts/startup.sh`):
   - Copies the backup from h-drive to `/tmp/` with proper permissions
   - Starts all containers using `podman-compose up -d`
   - Waits for the database to be ready
   - Restores the backup into the database
   - Verifies table count

2. **Docker Compose**:
   - Mounts `/tmp/group1db_backup.sql` into the database container
   - Database automatically executes it during initialization if needed

### Database Configuration
- **Database Name**: `group1db`
- **User**: `postgres`
- **Password**: `group1`
- **Port**: 5050 (external) → 5432 (container)

### Backup Files
- **Primary backup**: `/home/bylesl/h-drive/Year 2/SCC200/postgres/group1db_backup.sql`
- **Timestamped backups**: `group1db_backup_YYYYMMDD_HHMMSS.sql` (created each time you run backup_db.sh)

## Using the System

### Start the Application
```bash
cd /home/bylesl/h-drive/Year\ 2/SCC200
./scripts/startup.sh
```

This will:
1. Start all containers
2. Restore the database from h-drive backup
3. Display URLs and commands

### Backup Current Data
After making changes to the database, save them with:
```bash
./scripts/backup_db.sh
```

This creates:
- A main backup: `postgres/group1db_backup.sql`
- A timestamped backup for safety: `postgres/group1db_backup_20260224_144434.sql`

### Restore from Backup
To manually restore from a specific backup:
```bash
./scripts/restore_db.sh [backup_file]
```

Example:
```bash
./scripts/restore_db.sh postgres/group1db_backup_20260224_144434.sql
```

### View Logs
```bash
podman-compose logs -f [service]
# service can be: group1db, group1-backend, group1-frontend, or empty for all
```

### Stop All Services
```bash
podman-compose down
```

## Database Tables

The `group1db` database contains the following tables:
- `stops` - Bus/rail stop locations with coordinates (NaPTAN data)
- `operators` - Transport operators
- `national_rail` - Rail station data
- `schedule_points` - Bus schedule waypoints
- `rail_schedule` - Rail schedule information

## Important Notes

1. **Always backup before major changes**:
   ```bash
   ./scripts/backup_db.sh
   ```

2. **On machine restart**: The application will automatically restore the last backup from h-drive

3. **Ports Used**:
   - Frontend: 5001 (http://localhost:5001)
   - Backend API: 5000 (http://localhost:5000)
   - Database: 5050 (localhost:5050)

4. **Backup timing**: 
   - Backup files are small (~120KB) and safe to keep multiple versions in h-drive
   - Backup takes < 1 second to create
   - Restore takes < 1 second to complete

## Troubleshooting

### Database not restoring on startup
1. Check if backup file exists: `ls -lah postgres/group1db_backup.sql`
2. Check file permissions: `chmod 644 postgres/group1db_backup.sql`
3. Manually restore: `./scripts/restore_db.sh`

### API returns 500 errors
- Check backend is connected to correct database: `echo $DB_NAME`
- Expected: `group1db` (not `travel_routes`)
- Verify database exists: `podman exec group1db psql -U postgres -l | grep group1db`
- Verify tables exist: `podman exec group1db psql -U postgres -d group1db -c "\dt"`

### Containers not starting
1. Check if ports are in use: `lsof -i :5001 -i :5000 -i :5050`
2. Check container logs: `podman logs group1db` (or other service)
3. Clean up and restart: `podman-compose down && ./scripts/startup.sh`
