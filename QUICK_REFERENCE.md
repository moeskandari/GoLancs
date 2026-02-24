# Lancaster Travel Routes - Quick Reference Card

## Lab Machine Restart (Use This!)

```bash
./scripts/lab_restart.sh
```

**What it does:**
- ✅ Backs up database
- ✅ Rebuilds containers
- ✅ Restores data
- ✅ Starts all services

**Time:** ~30-45 seconds  
**Result:** http://localhost:5001

---

## Essential Commands

| Task | Command |
|------|---------|
| **Lab restart** | `./scripts/lab_restart.sh` |
| **Manual backup** | `./postgres/save_db.sh` |
| **Stop all** | `podman-compose down` |
| **Start all** | `podman-compose up -d` |
| **View logs** | `podman-compose logs -f` |
| **Database shell** | `podman exec -it group1db psql -U postgres -d group1db` |
| **Clean up** | `./scripts/cleanup_containers.sh` |

---

## Database Tables

| Table | Purpose | Size |
|-------|---------|------|
| `stops` | Bus stops & hubs | 2,375+ records |
| `operators` | 6 operators | 6 records |
| `bus_routes` | Route definitions | Ready |
| `route_stops` | Stops per route | Ready |
| `journey_tracking` | Live bus data | Live |
| `planned_routes` | Multi-leg routes | Ready |
| `national_rail` | Rail info | Ready |
| `rail_schedule` | Train schedules | Ready |
| `schedule_points` | Rail stops | Ready |

---

## Service URLs

- **Frontend:** http://localhost:5001
- **Backend API:** http://localhost:5000/api/health
- **Database:** localhost:5050

---

## File Locations

- **Backup:** `postgres/group1db_backup.sql` (152 KB)
- **Scripts:** `scripts/*.sh`
- **Guide:** `LAB_RESTART_GUIDE.md`
- **Details:** `DATABASE_IMPLEMENTATION.md`

---

## Backup Strategy

```
Application Data
    ↓
Automatic backup (lab_restart.sh)
    ↓
postgres/group1db_backup.sql (on h-drive)
    ↓
Copied to /tmp on restart
    ↓
Restored by docker-compose
    ↓
Your data is back!
```

---

## Troubleshooting

**Containers won't start?**
```bash
podman-compose logs group1db
```

**Port already in use?**
```bash
lsof -i :5001
kill -9 <PID>
```

**Database empty?**
```bash
./postgres/save_db.sh  # Create backup
./scripts/lab_restart.sh  # Full restart
```

---

## Team Checklist

- ✅ Database schema extended (9 tables)
- ✅ Backup system automated
- ✅ Lab restart script created
- ✅ All containers tested
- ✅ Data persistence verified
- ✅ Documentation complete

**Next:** Implement route planning algorithm

---

**Last Updated:** 24 February 2026
