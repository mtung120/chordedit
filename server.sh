#!/bin/bash

# ChordEdit ops helper, run from your machine over SSH.
#
#   ./server.sh status              app services, release, HTTPS check
#   ./server.sh logs [svc]          follow logs: chordedit (default) | caddy | ytdlp | backup
#   ./server.sh restart             restart the app
#   ./server.sh backup              snapshot data on the server, copy it to ./backups/
#   ./server.sh provision           copy deploy/ to the server and run setup-server.sh
#   ./server.sh ssh                 open a shell
#
# Settings, from the environment or a gitignored deploy.env in the repo root:
#   CHORDEDIT_HOST        ssh destination for the deploy user
#   CHORDEDIT_ADMIN_HOST  ssh destination with sudo, for provisioning
#                         (default: CHORDEDIT_HOST)
#   CHORDEDIT_DOMAIN      the public hostname
set -euo pipefail

[[ -f deploy.env ]] && source deploy.env
HOST="${CHORDEDIT_HOST:?Set CHORDEDIT_HOST (in deploy.env or the environment)}"
ADMIN_HOST="${CHORDEDIT_ADMIN_HOST:-$HOST}"
DOMAIN="${CHORDEDIT_DOMAIN:?Set CHORDEDIT_DOMAIN (in deploy.env or the environment)}"

case "${1:-status}" in
status)
    echo "── Services"
    ssh "$HOST" 'for u in chordedit caddy ytdlp-update.timer chordedit-backup.timer; do
        printf "   %-24s %s\n" "$u" "$(systemctl is-active $u)"; done
        echo "── Release: $(basename "$(readlink /opt/chordedit/current)")"
        printf "── App on :8080: "; curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/music/songs || echo DOWN'
    printf "── Cert expires: "
    echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || echo "n/a"
    printf "── https://%s/music/songs: " "$DOMAIN"
    curl -fsS -o /dev/null -w "%{http_code}\n" --max-time 10 "https://$DOMAIN/music/songs" || echo FAIL
    ;;
logs)
    case "${2:-chordedit}" in
        ytdlp)   unit=ytdlp-update ;;
        backup)  unit=chordedit-backup ;;
        *)       unit="${2:-chordedit}" ;;
    esac
    ssh -t "$HOST" "journalctl -u $unit -n 200 -f"
    ;;
restart)
    ssh "$HOST" 'sudo systemctl restart chordedit'
    echo "Restarted. Run ./server.sh status to check."
    ;;
backup)
    ssh "$HOST" 'sudo systemctl start chordedit-backup.service'
    LATEST=$(ssh "$HOST" 'ls -1t /var/backups/chordedit/songs-*.tgz | head -1')
    mkdir -p backups
    rsync -a "$HOST:$LATEST" backups/
    echo "💾 backups/$(basename "$LATEST")"
    ;;
provision)
    rsync -a --delete deploy/ "$ADMIN_HOST:chordedit-setup/"
    DEPLOY_USER=$(ssh -G "$HOST" | awk '/^user /{print $2}')
    ssh -t "$ADMIN_HOST" "sudo DOMAIN=$DOMAIN DEPLOY_USER=$DEPLOY_USER bash chordedit-setup/setup-server.sh"
    ;;
ssh) ssh -t "$HOST" ;;
*)
    sed -n '3,15p' "$0"; exit 1 ;;
esac
