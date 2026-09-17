#!/bin/sh
set -eu
cd /home/c503085/master-omkara.ru
test -d app && test -f app/hello.js && test -f omkara/package-lock.json
umask 077
mkdir -p private-backups
cp -p app/hello.js "private-backups/hello-before-omkara-$(date -u +%Y%m%dT%H%M%SZ).js"
cd omkara
chmod 600 .env
npm ci --omit=dev --ignore-scripts
npm run migrate
node --check server.js
node --check app.js
cd ..
cat > app/hello.js <<'BOOT'
process.loadEnvFile('/home/c503085/master-omkara.ru/omkara/.env');
import('/home/c503085/master-omkara.ru/omkara/server.js');
BOOT
touch reload
