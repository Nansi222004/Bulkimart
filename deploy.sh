#!/bin/bash
# Redeploy nhcone.com after a git push.
#
# Run this ON THE SERVER, from the repo root
# (/home/nhcone/htdocs/nhcone.com):
#
#   ./deploy.sh
#
# What it does, in order: pull latest code, install backend deps,
# install + build the frontend, restart the backend under PM2.
# The backend itself serves the built frontend (see backend/index.js),
# so there is nothing to copy anywhere else — this repo checkout IS
# the deployed site.
set -e

echo "Deploy started..."

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

echo "Pulling latest code..."
git reset --hard HEAD
git clean -fd
git pull origin main

echo "Installing backend dependencies..."
cd "$REPO_DIR/backend"
npm install

echo "Installing frontend dependencies and building..."
cd "$REPO_DIR/forntend"
npm install
npm run build

echo "Restarting backend..."
pm2 restart nhcone-backend

echo "Deploy finished."
