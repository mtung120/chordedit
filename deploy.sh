#!/bin/bash

# Deploy ChordEdit to your server (set up once with deploy/setup-server.sh;
# see DEPLOYMENT.md).
#
# Usage:
#   ./deploy.sh              # gates + build + ship + restart
#   ./deploy.sh --backup     # pull a data snapshot to ./backups/ first
#   ./deploy.sh --rollback   # point `current` at the previous release
#
# Each deploy is a new directory /opt/chordedit/releases/vTIMESTAMP/
# holding only the binary, static/ and templates/. The `current` symlink
# is flipped atomically and the service restarted; if the health check
# fails the symlink is flipped back. Song data lives in
# /var/data/chordedit/songs and is never touched by a deploy.
#
# Target: CHORDEDIT_HOST (an ssh destination for the deploy user, e.g. an
# ~/.ssh/config alias) and CHORDEDIT_DOMAIN, from the environment or a
# gitignored deploy.env in the repo root.
set -euo pipefail

[[ -f deploy.env ]] && source deploy.env
HOST="${CHORDEDIT_HOST:?Set CHORDEDIT_HOST (in deploy.env or the environment)}"
APP_DIR=/opt/chordedit
KEEP_RELEASES=5

health_check() {
    # Through the app port directly, so this works before DNS/TLS are live.
    ssh "$HOST" 'for i in $(seq 1 15); do
        curl -fsS -o /dev/null http://127.0.0.1:8080/music/songs && exit 0
        sleep 1
    done; exit 1'
}

if [[ "${1:-}" == "--rollback" ]]; then
    # Newest release older than the current one (labels sort by time).
    PREV=$(ssh "$HOST" "cur=\$(basename \"\$(readlink $APP_DIR/current)\"); ls -1 $APP_DIR/releases | sort | awk -v c=\"\$cur\" '\$0 < c' | tail -1")
    [[ -n "$PREV" ]] || { echo "❌ No previous release to roll back to"; exit 1; }
    echo "⏪ Rolling back to ${PREV}…"
    ssh "$HOST" "ln -sfn $APP_DIR/releases/$PREV $APP_DIR/current.tmp && mv -T $APP_DIR/current.tmp $APP_DIR/current && sudo systemctl restart chordedit"
    health_check && echo "✅ Rolled back to $PREV" || { echo "❌ Health check failed after rollback"; exit 1; }
    exit 0
fi

if [[ "${1:-}" == "--backup" ]]; then
    ./server.sh backup
fi

echo "🚀 Deploying ChordEdit to ${HOST}…"

# Pre-deploy gates: any failure halts the deploy.
echo "🧪 Pre-deploy gates: go test + typecheck + unit tests…"
go test ./... >/dev/null
npm ci --silent
npm run typecheck
npm run test:unit -- --run >/dev/null

echo "📦 Building Vite frontend (NODE_ENV=production)…"
NODE_ENV=production npm run build

case "$(ssh "$HOST" uname -m)" in
    x86_64)        GOARCH=amd64 ;;
    aarch64|arm64) GOARCH=arm64 ;;
    *)             echo "❌ Unsupported server arch"; exit 1 ;;
esac
echo "🔨 Building Go binary (linux/$GOARCH)…"
BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT
CGO_ENABLED=0 GOOS=linux GOARCH=$GOARCH go build -o "$BUILD_DIR/chordedit" main.go

RELEASE="v$(date +%Y%m%d%H%M%S)"
echo "📤 Uploading release ${RELEASE}…"
# Explicit file list — nothing else from the working tree ships.
rsync -a --delete "$BUILD_DIR/chordedit" static templates "$HOST:$APP_DIR/releases/$RELEASE/"

PREV=$(ssh "$HOST" "readlink $APP_DIR/current || true")
echo "🔁 Switching current → $RELEASE and restarting…"
ssh "$HOST" "ln -sfn $APP_DIR/releases/$RELEASE $APP_DIR/current.tmp && mv -T $APP_DIR/current.tmp $APP_DIR/current && sudo systemctl restart chordedit"

if ! health_check; then
    echo "❌ Health check failed."
    if [[ -n "$PREV" ]]; then
        echo "⏪ Restoring $(basename "$PREV")…"
        ssh "$HOST" "ln -sfn $PREV $APP_DIR/current.tmp && mv -T $APP_DIR/current.tmp $APP_DIR/current && sudo systemctl restart chordedit"
    fi
    ssh "$HOST" "journalctl -u chordedit -n 30 --no-pager" || true
    exit 1
fi

# Prune old releases (keep the newest $KEEP_RELEASES).
ssh "$HOST" "cd $APP_DIR/releases && ls -1 | sort | head -n -$KEEP_RELEASES | xargs -r rm -rf"

echo "✅ Deployed $RELEASE"
[[ -n "${CHORDEDIT_DOMAIN:-}" ]] && echo "🌐 https://$CHORDEDIT_DOMAIN/music/"
true
