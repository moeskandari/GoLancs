#!/bin/bash

BACKUP_FILE="./db_backup.sql"

podman stop group1db || true
podman rm group1db || true

podman pull docker.io/library/postgres:16-alpine 
podman network exists group1-net || podman network  create group1-net 
podman run -dt --name group1db --network group1-net  -e POSTGRES_PASSWORD=group1 -p 5050:5432 postgres:16-alpine
sleep 5 
if [ -f "$BACKUP_FILE" ]; then
	echo "Using backup file"
	cat "$BACKUP_FILE" | podman exec -i group1db psql -U postgres
	echo "Data restored"
else
	echo "Starting fresh db"
fi

