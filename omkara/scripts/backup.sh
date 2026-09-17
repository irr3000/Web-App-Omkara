#!/bin/sh
set -eu
cd /home/c503085/master-omkara.ru
umask 077
mkdir -p private-backups
: "${DB_CONNECTION_STRING:?Run inside the NetAngels site environment}"
# Pending receipt binaries are temporary and intentionally excluded.
pg_dump "$DB_CONNECTION_STRING" --format=custom --exclude-table-data=receipts --file="private-backups/omkara-$(date -u +%Y%m%dT%H%M%SZ).dump"
# Keep 14 days locally. Only generated dumps in this exact directory are removed.
find /home/c503085/master-omkara.ru/private-backups -maxdepth 1 -type f -name 'omkara-*.dump' -mtime +14 -delete
