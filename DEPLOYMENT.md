# Deploying ChordEdit

How to run ChordEdit on your own Linux server under your own domain, with
HTTPS. It's written so a person or a coding agent can follow it top to
bottom; the [checklist for agents](#checklist-for-coding-agents) at the
end is the short version.

## What you get

```
browser ──HTTPS──▶ Caddy (:443, automatic Let's Encrypt cert)
                     └─▶ ChordEdit Go binary (127.0.0.1:8080, systemd)
                           ├─ song data: /var/data/chordedit/songs (plain files)
                           └─ child processes: yt-dlp (YouTube audio), Demucs (stems)
```

- **One binary + `static/` + `templates/`.** No database: songs are text
  files, metadata is JSON, all under `SONGS_DIR`.
- **Releases** live in `/opt/chordedit/releases/vTIMESTAMP/`; the
  `/opt/chordedit/current` symlink points at the live one, so a deploy or a
  rollback is a symlink flip + restart.
- **Built on your machine**, not the server: `deploy.sh` runs the tests,
  builds the Vite bundle and a cross-compiled Linux binary, then rsyncs
  them over SSH.

| Path on the server | What |
|---|---|
| `/opt/chordedit/current/` | the live release (binary `chordedit`, `static/`, `templates/`) |
| `/opt/chordedit/venv/` | Python venv: yt-dlp + Demucs (`deploy/requirements.txt`) |
| `/opt/chordedit/models/` | Demucs model weights (~80 MB, fetched at provision time) |
| `/var/data/chordedit/songs/` | all data (`SONGS_DIR`) |
| `/etc/chordedit/env` | config and secrets (`YOUTUBE_API_KEY`), root:chordedit 0640 |
| `/etc/caddy/sites/chordedit.caddy` | the site block (from `deploy/chordedit.caddy`) |
| `/var/backups/chordedit/` | nightly data snapshots (14 kept) |

systemd units (sources in `deploy/`): `chordedit.service` (the app,
`Restart=always`), `chordedit-backup.timer` (nightly snapshot, audio
excluded), `ytdlp-update.timer` (daily yt-dlp upgrade — YouTube breaks
old versions often).

## Requirements

**Server**
- Ubuntu 26.04 LTS (what the pinned Demucs / torch versions were verified
  on, with its Python 3.14). Debian / older Ubuntu should work but may
  need other torch pins in `deploy/requirements.txt`.
- **4 GB RAM minimum** (Demucs peaks around 2 GB while separating stems),
  2+ vCPUs (a 4-minute song takes ~4 minutes of CPU to separate), 20 GB
  disk (the venv is ~1.5 GB; each song's audio + stems is ~15 MB).
- x86_64 or arm64.
- Ports 80 and 443 reachable from the internet (Caddy needs both for the
  certificate), SSH for you.

**Domain**
- A hostname you control, e.g. `chords.example.com`, with an **A record**
  (and AAAA if the server has IPv6) pointing at the server's public IP.
  Create it first: Caddy requests the certificate on the first request,
  and that only works once DNS resolves to the server.

**Your machine** (macOS or Linux): Go 1.23+, Node 20+ with npm, `rsync`,
`ssh`, and an SSH key the server accepts.

**Optional: a YouTube Data API key** for searching YouTube from Practice.
Google Cloud Console → create a project → enable "YouTube Data API v3" →
Credentials → API key (restrict it to that API). Without it everything
works except the YouTube search; uploading an mp3 still works.

## 1. Prepare the server

As root (or with sudo) on a fresh server:

```bash
# A deploy user that deploy.sh connects as (any name).
adduser --gecos "" deploy                     # sets its password (sudo asks for it)
usermod -aG sudo deploy                       # needed for provisioning and restores
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
# put your public key in /home/deploy/.ssh/authorized_keys (owner deploy, 0600)

# Firewall: SSH + web only. The app itself listens on 127.0.0.1.
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable
```

`setup-server.sh` gives the deploy user passwordless sudo for exactly two
commands (restart the app, start a backup). Provisioning itself needs full
sudo: either let the deploy user use it with a password (`ssh -t` prompts),
or provision as another sudo user via `CHORDEDIT_ADMIN_HOST`.

## 2. Configure your machine

```bash
git clone <this repo> && cd chordedit
npm ci
cp deploy.env.example deploy.env    # gitignored
```

Edit `deploy.env`:

```bash
CHORDEDIT_HOST=deploy@chords.example.com   # or an ~/.ssh/config alias
#CHORDEDIT_ADMIN_HOST=admin@chords.example.com
CHORDEDIT_DOMAIN=chords.example.com
```

Check: `ssh deploy@chords.example.com true` works without a password
prompt.

## 3. Provision (once, and after editing anything in `deploy/`)

```bash
./server.sh provision
```

This copies `deploy/` to the server and runs `setup-server.sh` under sudo
with your `DOMAIN` and deploy user. It is idempotent and does:
- packages: ffmpeg, python3-venv, Node 20+ (yt-dlp's JS challenge
  solver), Caddy from its official apt repo;
- the `chordedit` system user and the directories in the table above;
- the Python venv and the Demucs model (takes a few minutes);
- the systemd units and timers;
- the Caddy site for your domain (the main `/etc/caddy/Caddyfile` gets an
  `import /etc/caddy/sites/*.caddy` line; an existing Caddyfile is kept);
- `/etc/sudoers.d/chordedit`.

Then set the secrets — the first provision creates the file from
`deploy/chordedit.env.example`:

```bash
ssh -t deploy@chords.example.com sudoedit /etc/chordedit/env   # YOUTUBE_API_KEY=...
```

## 4. Deploy

```bash
./deploy.sh             # gates (go test, typecheck, Vitest) + vite build + ship + restart
./deploy.sh --rollback  # switch back to the previous release
./deploy.sh --backup    # pull a data snapshot to ./backups/ first, then deploy
```

`deploy.sh` cross-compiles for the server's arch, rsyncs **only** the
binary, `static/` and `templates/` into a new release dir, flips
`current`, restarts, and health-checks `http://127.0.0.1:8080/music/songs`
on the server. If the check fails, it flips back and prints the app log.
The newest 5 releases are kept.

## 5. Verify

```bash
./server.sh status
```

Expect every unit `active`, "App on :8080: 200", a cert expiry date and
`https://<domain>/music/songs: 200` (401 once there's a password). Then open `https://<domain>/` in a
browser: an empty library with a "Search or add a song" field. Add a
blank song to check saving works.

## Add a password (recommended)

**ChordEdit has no accounts.** Every endpoint is public, including delete
and `/music/restore/*`, so anyone who finds the URL can change or delete
songs. To put the whole site behind one shared password:

```bash
ssh -t deploy@chords.example.com caddy hash-password   # type a password, copy the hash
```

Uncomment the `basic_auth` block in `deploy/chordedit.caddy`, paste the
hash, pick a username, then `./server.sh provision` (or edit
`/etc/caddy/sites/chordedit.caddy` on the server and
`sudo systemctl reload caddy`). Browsers ask once and remember it; check
the iOS Home Screen app on a device, since iOS web apps can be forgetful
about saved site passwords. With a password, add `-u user:password` to
the `curl` commands below.

## Operations

```bash
./server.sh status          # services, release, cert expiry, HTTPS check
./server.sh logs            # follow app logs (also: caddy | ytdlp | backup)
./server.sh restart
./server.sh backup          # snapshot now + copy to ./backups/songs-*.tgz
./server.sh ssh
```

**Backups.** The nightly snapshot covers everything in `SONGS_DIR` except
`audio/` (song texts, versions, meta, setlists, tabs, access times, YouTube
cookies). Audio and stems can be re-downloaded or regenerated. Snapshots
sit on the same disk as the data, so run `./server.sh backup` now and then
for an off-server copy (or use your provider's disk snapshots).
`backups/` is gitignored; keep it private (it holds the cookies).

**Restore** a snapshot:

```bash
scp backups/songs-XXXX.tgz deploy@chords.example.com:
ssh -t deploy@chords.example.com 'sudo tar xzf songs-XXXX.tgz -C /var/data/chordedit &&
  sudo chown -R chordedit:chordedit /var/data/chordedit && sudo systemctl restart chordedit'
```

**Copy songs between servers** (merges; skips versions, audio, tabs):
`./download-songs.sh <dir> https://<old>/music`, then
`./upload-songs.sh <dir> https://<new>/music`.

Scripts that edit `.song-meta.json` directly must run with the service
stopped: the app keeps it in memory and would write the old data back.

## Troubleshooting

**YouTube downloads fail.** The app logs `yt-dlp failed for <videoId>`.
On a cloud server this is usually YouTube's bot check ("Sign in to confirm
you're not a bot"): datacenter IPs are often blocked where home connections
aren't. Export Netscape-format youtube.com cookies from a logged-in browser
(a throwaway Google account is wise) and upload them:

```bash
curl -X POST --data-binary @cookies.txt https://<domain>/music/upload-cookies
```

The app passes `SONGS_DIR/.yt-cookies.txt` to yt-dlp, which keeps it
refreshed. Other checks on the server:

```bash
/opt/chordedit/venv/bin/python -m yt_dlp --version
/opt/chordedit/venv/bin/python -c "import yt_dlp_ejs"
node --version; ffmpeg -version | head -1
sudo systemctl start ytdlp-update.service      # upgrade yt-dlp now
```

Uploading an mp3 in Practice always works as a fallback.

**Stem separation fails.** Logged as `stem separation failed for …` with
the tail of Demucs' output. Usually memory (check `dmesg` for the OOM
killer; the unit sets `MemoryHigh=6G`, lower it on a small server or add
swap) or a missing model:

```bash
sudo -u chordedit env TORCH_HOME=/opt/chordedit/models \
  /opt/chordedit/venv/bin/python -m demucs --help | head -1
ls /opt/chordedit/models/hub/checkpoints/      # htdemucs weights present?
```

**No HTTPS / certificate errors.** `./server.sh logs caddy`. Check that
`dig +short <domain>` returns the server's IP and that ports 80 and 443 are
open in both `ufw` and the provider's firewall / security group.

**Upload rejected (413).** Caddy allows 25 MB (`request_body` in
`deploy/chordedit.caddy`); Go allows 20 MB for audio and 5 MB for tabs.

**`deploy.sh` stops at "sudo: a password is required".** The sudoers rule
from provisioning is missing or names a different user: re-run
`./server.sh provision` with `CHORDEDIT_HOST` set to the deploy user.

## Checklist for coding agents

Ask the human for: the server's IP / SSH access (and which user has sudo),
the domain, and whether they want a YouTube API key and a password. Never
put secrets in the repo; they go in `/etc/chordedit/env` on the server and
in the gitignored `deploy.env` locally.

1. `dig +short <domain>` returns the server's public IP. If not, ask the
   human to create the A record and wait.
2. The server is Ubuntu (`ssh <host> lsb_release -ds`) with ≥ 4 GB RAM
   (`free -g`); the deploy user exists and key-based SSH works; ufw (or the
   provider firewall) allows 22, 80, 443.
3. Locally: `go version` ≥ 1.23, `node --version` ≥ 20, `npm ci`
   succeeds, `deploy.env` filled in from `deploy.env.example`.
4. `./server.sh provision` finishes with "Done". Run it in a way the human
   can answer a sudo password prompt, or use a passwordless sudo
   `CHORDEDIT_ADMIN_HOST`.
5. If there's a YouTube key: write it into `/etc/chordedit/env` with the
   human (`sudoedit`); never echo it into logs or the repo.
6. `./deploy.sh` ends with "✅ Deployed v…".
7. `./server.sh status` shows all units active, the app check at 200 and
   the HTTPS check at 200 (401 with a password).
8. If the human wants a password: the `basic_auth` steps above, then
   step 7 again.
9. Tell the human the URL, that nightly backups run on the server, and
   how to take an off-server copy (`./server.sh backup`).
