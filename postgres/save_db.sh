#!/bin/bash
BACKUP_FILE="./db_backup.sql"
podman exec -t group1db pg_dumpall -c -U postgres > "$BACKUP_FILE"
echo "Saved!"
