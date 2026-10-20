#!/bin/bash
# Redeploy the verified backend checkout after a git push.
#
# Run this ON THE SERVER, from the verified deployed repository root:
#
#   bash deploy.sh <verified-PM2-backend-name>
#
# What it does, in order: pull latest code, install backend deps,
# install + build the frontend, restart the backend under PM2.
# If the frontend is separately static-hosted, publish forntend/dist through
# that host's existing workflow as well; restarting the API does not publish it.
set -euo pipefail

echo "Deploy started..."

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

# Never guess a legacy process name or discard local changes/secrets.
PM2_PROCESS_NAME="${1:-${PM2_PROCESS_NAME:-}}"
if [ -z "$PM2_PROCESS_NAME" ]; then
  echo 'Usage: bash deploy.sh <verified PM2 backend process name>' >&2
  echo 'List sanitized process metadata: node backend/scripts/auditJwtDeployment.mjs' >&2
  exit 1
fi
node backend/scripts/auditJwtDeployment.mjs --process="$PM2_PROCESS_NAME"
git diff --quiet && git diff --cached --quiet || { echo 'Commit or preserve tracked local changes before deployment.' >&2; exit 1; }

echo "Pulling latest code..."
git pull --ff-only origin main

echo "Installing backend dependencies..."
cd "$REPO_DIR/backend"
npm ci
npm run build

echo "Installing frontend dependencies and building..."
cd "$REPO_DIR/forntend"
npm ci
npm run build

echo "Restarting backend..."
node "$REPO_DIR/backend/scripts/auditJwtDeployment.mjs" --process="$PM2_PROCESS_NAME"
pm2 restart "$PM2_PROCESS_NAME" --update-env
node "$REPO_DIR/backend/scripts/auditJwtDeployment.mjs" --process="$PM2_PROCESS_NAME"

echo "Deploy finished."
