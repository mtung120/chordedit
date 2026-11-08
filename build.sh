#!/bin/bash
# Local dev build. NOT the production build path — deploy.sh cross-compiles
# for the server and ships the result (see DEPLOYMENT.md).
# This script is convenience for local smoke testing.
set -euo pipefail

# 1. Build the TypeScript frontend.
#    `npm ci` is the no-surprises install (uses package-lock.json verbatim);
#    `npm run build` runs tsc + vite, emitting static/dist/ + manifest.json.
#    The Go server reads that manifest at startup (handlers/vite.go) so the
#    page templates can resolve {{vite "song"}} → the right hashed bundle.
echo "Installing npm deps + building Vite frontend…"
npm ci --silent
npm run build

# 2. Build the Go binary (local name `music`, gitignored).
echo "Building Go binary (local: ./music)…"
go build -o music main.go

echo "Build completed successfully!"
