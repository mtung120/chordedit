#!/bin/bash
# Provision ChordEdit on an Ubuntu / Debian server. Idempotent — safe to
# re-run after editing any file in deploy/.
#
# Run from your machine with `./server.sh provision`, which copies this
# directory to the server and runs it under sudo, or on the server:
#   sudo DOMAIN=chords.example.com DEPLOY_USER=deploy bash setup-server.sh
#
#   DOMAIN       public hostname; its DNS A/AAAA record must already point
#                at this server (Caddy gets the TLS cert on first request)
#   DEPLOY_USER  existing login user that deploy.sh pushes releases as
#
# What it sets up:
#   - packages: ffmpeg, python3-venv, Node 20+ (yt-dlp-ejs), Caddy
#   - system user `chordedit`, /var/data/chordedit/songs, /opt/chordedit
#   - /opt/chordedit/venv from requirements.txt (yt-dlp + Demucs) and the
#     Demucs model in /opt/chordedit/models
#   - systemd: chordedit, ytdlp-update.timer, chordedit-backup.timer
#   - /etc/caddy/sites/chordedit.caddy (imported by /etc/caddy/Caddyfile)
#   - sudoers: DEPLOY_USER may restart chordedit / start a backup
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Run as root (sudo)." >&2
    exit 1
fi
: "${DOMAIN:?Set DOMAIN, e.g. DOMAIN=chords.example.com}"
: "${DEPLOY_USER:?Set DEPLOY_USER to the login user deploy.sh uses}"
id "$DEPLOY_USER" >/dev/null 2>&1 || { echo "No user $DEPLOY_USER." >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ffmpeg python3-venv

# yt-dlp-ejs (YouTube JS challenge solver) needs Node 20+. Newer Ubuntu
# releases ship it; fall back to NodeSource on older ones.
command -v node >/dev/null || apt-get install -y -q nodejs
if ! node --version 2>/dev/null | grep -qE '^v(2[0-9]|[3-9][0-9])'; then
    echo "==> Node.js 22 (NodeSource)"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -q nodejs
fi

echo "==> User + directories"
id chordedit >/dev/null 2>&1 || \
    useradd --system --home-dir /var/data/chordedit --shell /usr/sbin/nologin chordedit
install -d -o chordedit -g chordedit -m 0755 /var/data/chordedit /var/data/chordedit/songs
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 /opt/chordedit /opt/chordedit/releases
install -d -o root -g chordedit -m 0750 /etc/chordedit
install -d -o root -g "$DEPLOY_USER" -m 0750 /var/backups/chordedit
if [[ ! -f /etc/chordedit/env ]]; then
    install -o root -g chordedit -m 0640 "$HERE/chordedit.env.example" /etc/chordedit/env
    echo "!! Created /etc/chordedit/env from the template — fill in YOUTUBE_API_KEY."
fi

echo "==> Python venv (yt-dlp + Demucs)"
[[ -x /opt/chordedit/venv/bin/python ]] || python3 -m venv /opt/chordedit/venv
/opt/chordedit/venv/bin/pip install --quiet --upgrade pip
/opt/chordedit/venv/bin/pip install --quiet -r "$HERE/requirements.txt"
echo "yt-dlp $(/opt/chordedit/venv/bin/python -m yt_dlp --version)"

# Fetch the htdemucs weights (~80 MB) now: at runtime the service can't
# write outside /var/data/chordedit, so it only reads them from TORCH_HOME.
install -d -m 0755 /opt/chordedit/models
TORCH_HOME=/opt/chordedit/models /opt/chordedit/venv/bin/python -c \
    'from demucs.pretrained import get_model; get_model("htdemucs")' >/dev/null
chmod -R a+rX /opt/chordedit/models

echo "==> systemd units"
for unit in chordedit.service ytdlp-update.service ytdlp-update.timer \
            chordedit-backup.service chordedit-backup.timer; do
    install -m 0644 "$HERE/$unit" /etc/systemd/system/
done
systemctl daemon-reload
systemctl enable --quiet chordedit.service
[[ -e /opt/chordedit/current ]] && systemctl restart chordedit.service
systemctl enable --now --quiet ytdlp-update.timer chordedit-backup.timer

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
    # Official Caddy apt repo (https://caddyserver.com/docs/install).
    apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https curl gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -q
    apt-get install -y -q caddy
fi
install -d -m 0755 /etc/caddy/sites
# Make the main Caddyfile import sites/: replace the package's placeholder
# (it serves /usr/share/caddy on :80), or append to a Caddyfile you already use.
IMPORT='import /etc/caddy/sites/*.caddy'
if ! grep -qF "$IMPORT" /etc/caddy/Caddyfile 2>/dev/null; then
    if [[ ! -s /etc/caddy/Caddyfile ]] || grep -q '/usr/share/caddy' /etc/caddy/Caddyfile; then
        printf '# Each site is a file in /etc/caddy/sites/.\n%s\n' "$IMPORT" > /etc/caddy/Caddyfile
    else
        printf '\n%s\n' "$IMPORT" >> /etc/caddy/Caddyfile
    fi
fi
sed "s/CHORDEDIT_DOMAIN/$DOMAIN/" "$HERE/chordedit.caddy" > /etc/caddy/sites/chordedit.caddy
chmod 0644 /etc/caddy/sites/chordedit.caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
    || { caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; exit 1; }
systemctl enable --quiet caddy
systemctl reload-or-restart caddy

# deploy.sh / server.sh run non-interactively as the deploy user.
cat > /etc/sudoers.d/chordedit <<EOF
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart chordedit, /usr/bin/systemctl start chordedit-backup.service
EOF
chmod 0440 /etc/sudoers.d/chordedit
visudo -cf /etc/sudoers.d/chordedit >/dev/null

echo "==> Done. Next: fill YOUTUBE_API_KEY in /etc/chordedit/env, then run ./deploy.sh."
