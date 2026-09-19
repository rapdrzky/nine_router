#!/bin/sh
set -e

# Patch fail = log + exit, so failure is visible in Railway logs
if ! node /app/patch_oc_nine_router.js; then
  echo "ERROR: opencode patch failed or build dir not found" >&2
  exit 1
fi

for entry in \
  /app/app/server.js \
  /app/server.js \
  /root/.npm-global/lib/node_modules/9router/app/server.js \
  /usr/local/lib/node_modules/9router/app/server.js
do
  [ -f "$entry" ] && exec node "$entry"
done

exec 9router -p "${PORT:-20128}" -H 0.0.0.0 -n -l --skip-update