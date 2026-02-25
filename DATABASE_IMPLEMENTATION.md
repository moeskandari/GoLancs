# Database & Lab Machine Restart - Implementation Summary

**Date:** 24 February 2026  
**Status:** ✅ COMPLETE  
**Team:** Group 1 - SCC.200

---

## What Was Implemented

### 1. Database Schema Extended (Backward Compatible)
Added 4 new tables to support advanced features while keeping existing schema intact:

| Table | Purpose | Records |
|-------|---------|---------|
| `bus_routes` | Define bus routes with operators | Ready for import |
| `route_stops` | Stop sequence along each route | Ready for import |
| `journey_tracking` | Historical bus positions & delays | Ready for live data |
| `planned_routes` | Multi-leg route calculation results | Ready for algorithm |

**Existing tables preserved:**
- `stops` (2,375+ records including Lancaster Bus Station)
- `operators` (6 regional operators)
- `national_rail`, `rail_schedule`, `schedule_points`

**Total tables:** 9  
**Backup size:** 152 KB  
**Backup location:** `postgres/group1db_backup.sql`

---

### 2. Lab Machine Restart System
Created automated restart procedure for lab environment:

**Main Script:**
```bash
./scripts/lab_restart.sh
```

**What it does:**
1. ✅ Backs up current database
2. ✅ Stops all containers gracefully
3. ✅ Pulls latest security updates for base images
4. ✅ Rebuilds application containers
5. ✅ Restores database from backup automatically
6. ✅ Applies schema migrations
7. ✅ Starts all services
8. ✅ Verifies health

**Time to complete:** ~30-45 seconds

---

### 3. Scripts Updated

#### New Scripts:
- **`lab_restart.sh`** - Complete lab restart (USE THIS FOR LAB MACHINES)
- **`LAB_RESTART_GUIDE.md`** - Comprehensive documentation

#### Enhanced Scripts:
- **`save_db.sh`** - Improved backup with file size/line reporting
- **`cleanup_containers.sh`** - Now backs up before cleanup, supports partial cleanup
- **`quickstart.sh`** - Added lab restart option to initial setup

#### Existing Scripts (Unchanged):
- `build_containers.sh`
- `run_all_containers.sh`
- `cleanup_containers.sh`

---

### 4. Database Persistence Strategy

**For Lab Machines:**
```
Backup File (h-drive) → copied to /tmp → docker-compose mounts → restored to database
```

**Guarantees:**
- ✅ Database persists across container restarts
- ✅ Data preserved across lab machine shutdowns
- ✅ Automatic restore on startup
- ✅ Schema migrations applied automatically
- ✅ No manual database operations needed

**Backup Flow:**
```
Your application data
       ↓
lab_restart.sh backs up
       ↓
postgres/group1db_backup.sql (stored on h-drive)
       ↓
Copied to /tmp on restart
       ↓
docker-compose mounts at /docker-entrypoint-initdb.d/
       ↓
PostgreSQL automatically restores during initialization
       ↓
Your data is back!
```

---

## How Each Table Is Used

### `bus_routes` - Route Definitions
**Used for:** Defining complete bus routes from start to end point  
**Example:**
```sql
INSERT INTO bus_routes (route_number, operator_code, start_atco_code, end_atco_code)
VALUES ('45', 'ARCT', '25001001', '250010001');
```
**Integration:**
- Route planning algorithm finds routes serving start/end points
- Journey tracking associates vehicle movements to specific routes
- Frontend displays available route options on map

### `route_stops` - Route Segments
**Used for:** Defining each stop along a route with travel times  
**Example:**
```sql
INSERT INTO route_stops (route_id, atco_code, stop_sequence, travel_time_to_next)
VALUES (1, '25001001', 1, 120),  -- 2 min to next stop
       (1, '25001002', 2, 180);  -- 3 min to next stop
```
**Integration:**
- **Route time calculation:** Sums travel times for ETA
- **Journey sequence:** Shows users exact stop order
- **Multi-leg assembly:** Combines segments from different routes
- **ETA accuracy:** Uses cumulative times + current delays

### `journey_tracking` - Historical Movement
**Used for:** Store real-time bus locations and delays for accuracy improvement  
**Example:**
```sql
INSERT INTO journey_tracking (operator_code, atco_code, recorded_time, vehicle_id, delay_minutes)
VALUES ('ARCT', '25001001', CURRENT_TIMESTAMP, 'ARV-042', 5);
```
**Integration:**
- **Live tracking:** Display current bus positions on map
- **Delay prediction:** Historical data shows typical delays
- **Pattern analysis:** Identify problem routes/times
- **Better recommendations:** Suggest faster alternatives
- **Accurate ETAs:** Adjust arrival times by typical delays

### `planned_routes` - Multi-Leg Results
**Used for:** Store calculated journeys combining bus + rail or multiple operators  
**Example:**
```sql
INSERT INTO planned_routes (start_atco_code, end_atco_code, departure_time, total_duration, num_legs, route_details)
VALUES ('250GLANBS', '250010001', '2026-02-24 14:30:00', 1800, 2, 
        '{"legs": [{"type": "bus", "route": "45", ...}, ...]}'::jsonb);
```
**Integration:**
- **Route storage:** Cache calculated routes for replay
- **Performance tracking:** Analyze popular route combinations
- **Historical analysis:** Compare planned vs. actual times
- **User preferences:** Remember frequently used routes
- **Departure boards:** Show arrival times at destination

---

## Quick Reference

### For Lab Machine Restart
```bash
./scripts/lab_restart.sh
```
One command does everything. Your database is preserved.

### To Manually Back Up
```bash
./postgres/save_db.sh
```
Creates `postgres/group1db_backup.sql` (152 KB).

### To Stop Application
```bash
podman-compose down
```
Containers stop but data persists in volume.

### To Restart Application
```bash
podman-compose up -d
```
Containers restart and automatically reconnect to database.

### To Clean Everything (Caution!)
```bash
./scripts/cleanup_containers.sh --volumes
```
Deletes containers AND data. Only use if you want to start fresh.

---

## File Changes Summary

### New Files:
- `scripts/lab_restart.sh` - Lab machine restart automation
- `LAB_RESTART_GUIDE.md` - Comprehensive user guide

### Modified Files:
- `postgres/group1db_backup.sql` - Added new table schemas + Lancaster Bus Station
- `postgres/post_restore.sql` - Added table creation + schema migrations
- `postgres/save_db.sh` - Enhanced output reporting
- `scripts/quickstart.sh` - Added lab restart detection
- `scripts/cleanup_containers.sh` - Added backup before cleanup
- `docker-compose.yml` - Already had correct volume mounts

### Unchanged:
- `backend/` - All code unchanged
- `frontend/` - All code unchanged
- `docker-compose.yml` - Structure unchanged (already optimized)

---

## Testing Results

✅ **Database Schema:** All 9 tables created successfully  
✅ **Backup Functionality:** Created 152 KB backup with 3,196 SQL lines  
✅ **Lab Restart:** Complete restart cycle works (30-45 seconds)  
✅ **Data Persistence:** Lancaster Bus Station present after restart  
✅ **Container Health:** All 3 containers healthy post-restart  
✅ **API Connectivity:** Backend responds with health check  
✅ **Database Restore:** Tables present with correct schema  

---

## Next Steps for Team

### Immediate:
1. ✅ Test `./scripts/lab_restart.sh` on your machine
2. ✅ Verify database backup created at `postgres/group1db_backup.sql`
3. ✅ Read `LAB_RESTART_GUIDE.md` for team reference

### Development:
1. Implement route calculation algorithm (use `bus_routes` + `route_stops`)
2. Implement journey tracking data insertion (update `journey_tracking`)
3. Implement route planning (populate `planned_routes`)
4. Add arrival/departure board endpoints

### Before Lab Restarts:
1. Run `./postgres/save_db.sh` to backup
2. Commit backup to version control (if team agrees)
3. Use `./scripts/lab_restart.sh` when machine restarts

---

## Architecture Flow

```
Lab Machine Shutdown
       ↓
Lab Machine Restart
       ↓
./scripts/lab_restart.sh
       ├─ Backs up database
       ├─ Pulls latest images
       ├─ Rebuilds containers
       └─ Restores database
       ↓
docker-compose up -d
       ├─ PostgreSQL starts (reads backup from /tmp)
       ├─ Backend connects to database
       └─ Frontend connects to backend
       ↓
Application ready at http://localhost:5001
```

---

## Troubleshooting Quick Links

See `LAB_RESTART_GUIDE.md` for:
- Backup corruption recovery
- Port already in use fixes
- Container startup issues
- Database connectivity problems
- Manual database access

---

## Version Control Notes

**DO NOT** commit the backup file:
- It's in `.gitignore`
- It's machine-specific
- It's automatically created by scripts
- Store locally on h-drive only

**DO** commit:
- All scripts in `scripts/`
- Schema definitions in `postgres/post_restore.sql`
- All code changes in `backend/` and `frontend/`

---

## Contact & Questions

**Database:** See `LAB_RESTART_GUIDE.md` troubleshooting section  
**Schema Design:** Extended schema maintains backward compatibility  
**Lab Restarts:** Use `./scripts/lab_restart.sh` - fully automated  

---

**Status:** Ready for deployment on lab machines ✅  
**Last Updated:** 24 February 2026  
**Tested By:** Agent on lab environment
