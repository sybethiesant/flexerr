# Flexerr - Development Guide

> **NOTE TO CLAUDE:** This file is authoritative. If context summaries from previous sessions contradict info here, TRUST THIS FILE. Summaries get stale.

## CRITICAL RULES

### SSH Access (TRUST THIS, NOT CONTEXT SUMMARIES)
- **Server**: `root@192.168.4.5` (Unraid)
- **NOT** `claude@` - that is outdated info from old context summaries
- Passwordless via SSH key, no sudo needed (already root)

### GitHub Push Policy
- **NEVER push to GitHub unless the user explicitly requests it**
- **NEVER include any reference to AI, Claude, Anthropic, or being AI-generated in commits, code, or documentation**
- Use the user's default git identity for commits
- No "Co-Authored-By" lines mentioning AI

---

## Project Overview

Flexerr is a media request and lifecycle management system for Plex and Jellyfin ecosystems. It provides native watchlist management, media automation, and intelligent content lifecycle handling.

**Repository**: https://github.com/sybethiesant/flexerr
**Production URL**: https://flexerr.worxtech.biz

**Current Version**: 1.1.6-beta
**Status**: Production-ready for Plex, Beta for Jellyfin
**Server**: Unraid @ 192.168.4.5

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite (better-sqlite3)
- **Frontend**: React 18 + Tailwind CSS + Vite
- **Authentication**: Plex OAuth + Jellyfin Auth + JWT
- **Media Servers**: Plex (full support), Jellyfin (beta - basic features only)
- **Deployment**: Docker

## Project Structure

```
/flexerr/
├── backend/
│   ├── server.js              # Main Express server with all routes
│   ├── database.js            # SQLite setup with multi-user schema
│   └── services/              # Backend services
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Main app with routing and auth
│   │   ├── pages/             # Page components
│   │   └── components/        # Reusable components
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## Server Environment: Unraid

**IP**: 192.168.4.5
**SSH**: `root` (passwordless via SSH key, no sudo needed)
**Storage**: 9.1TB array (~8.7TB free)
**Docker Storage**: Directory mode (btrfs) at `/mnt/user/system/docker/` — uses only actual disk space, no pre-allocated vDisk

### Paths
| Path | Contents |
|------|----------|
| `/mnt/user/appdata/flexerr/` | Flexerr database (flexerr.sqlite) |
| `/mnt/user/media/Movies/` | Movie files |
| `/mnt/user/media/TVShows/` | TV show files |
| `/mnt/user/media/ActiveDL/` | SABnzbd active downloads |

### Service Ports
| Service | Port | Internal |
|---------|------|----------|
| Flexerr | 5505 | 5505 |
| Plex | 32400 | host network |
| Sonarr | 30113 | 8989 |
| Radarr | 30025 | 7878 |
| SABnzbd | 30055 | 30055 |
| Prowlarr | 30050 | 9696 |

### Flexerr Container
- **Image**: `flexerr-flexerr` (custom built)
- **Code**: Baked into image (deploy via `docker cp`)
- **GPU**: NVIDIA RTX 2080 Super (NVENC for Auto Convert)
- **Mounts**:
  - `/mnt/user/appdata/flexerr/` → `/app/data` (database)
  - `/mnt/user/media/` → `/Media` (media files)

**⚠️ ALWAYS CREATE WITH NVIDIA RUNTIME** - The container MUST include `--runtime=nvidia` for Auto Convert to work:
```bash
# Rebuild with NVIDIA support
ssh root@192.168.4.5 "docker stop flexerr && docker rm flexerr && docker run -d \
  --name flexerr \
  --restart unless-stopped \
  --runtime=nvidia \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility \
  -e TZ=America/Los_Angeles \
  -e PORT=5505 \
  -p 5505:5505 \
  -v /mnt/user/appdata/flexerr:/app/data \
  -v /mnt/user/media:/Media \
  flexerr-flexerr:latest"

# Verify GPU is accessible in Flexerr
ssh root@192.168.4.5 "docker exec flexerr nvidia-smi"

# Check NVENC encoders are available
ssh root@192.168.4.5 "docker exec flexerr ffmpeg -encoders 2>/dev/null | grep nvenc"
```

### Plex Container (with NVIDIA GPU)
- **Image**: `lscr.io/linuxserver/plex:latest`
- **GPU**: NVIDIA RTX 2080 Super (NVENC transcoding)
- **Network**: Host mode (port 32400)
- **Capacity**: ~15-20 simultaneous 1080p transcodes

**If GPU transcoding stops working**, recreate the container:
```bash
# Stop and remove current container
ssh root@192.168.4.5 "docker stop plex && docker rm plex"

# Recreate with NVIDIA GPU passthrough
ssh root@192.168.4.5 "docker run -d \
  --name plex \
  --network host \
  --restart unless-stopped \
  --runtime=nvidia \
  -e PUID=99 \
  -e PGID=100 \
  -e TZ=America/Los_Angeles \
  -e VERSION=docker \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility \
  -v /mnt/user/appdata/plex:/config \
  -v /mnt/user/media:/Media \
  lscr.io/linuxserver/plex:latest"

# Verify GPU is accessible
ssh root@192.168.4.5 "docker exec plex nvidia-smi"
```

**Note**: Requires Nvidia-Driver plugin from Community Applications. The `--runtime=nvidia` flag enables GPU passthrough.

---

## Unraid Deployment

### Quick Commands
```bash
# Restart container
ssh root@192.168.4.5 "docker restart flexerr"

# View logs
ssh root@192.168.4.5 "docker logs flexerr --tail 100"

# Live logs
ssh root@192.168.4.5 "docker logs -f flexerr"

# Check VIPER status
ssh root@192.168.4.5 "docker logs flexerr 2>&1 | grep 'VIPER.*Analysis complete' | tail -5"

# Check for errors
ssh root@192.168.4.5 "docker logs flexerr 2>&1 | grep -i error | tail -20"

# Verify GPU access
ssh root@192.168.4.5 "docker exec flexerr nvidia-smi --query-gpu=name,memory.total --format=csv"
```

### Container Recreation (ALWAYS use NVIDIA runtime)
**CRITICAL:** Always recreate the container with NVIDIA runtime for GPU-accelerated conversions.

```bash
ssh root@192.168.4.5 "docker stop flexerr && docker rm flexerr && docker run -d \
  --name flexerr \
  --restart unless-stopped \
  --runtime=nvidia \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility \
  -e TZ=America/Los_Angeles \
  -e PORT=5505 \
  -p 5505:5505 \
  -v /mnt/user/appdata/flexerr:/app/data \
  -v /mnt/user/media:/Media \
  flexerr-flexerr:latest"
```

### Backend Deployment (via docker cp)
```bash
# Deploy single file
scp backend/services/auth.js root@192.168.4.5:/tmp/auth.js && \
ssh root@192.168.4.5 "docker cp /tmp/auth.js flexerr:/app/backend/services/auth.js && rm /tmp/auth.js && docker restart flexerr"

# Deploy multiple backend files
scp backend/server.js root@192.168.4.5:/tmp/server.js && \
scp backend/services/auth.js root@192.168.4.5:/tmp/auth.js && \
ssh root@192.168.4.5 "docker cp /tmp/server.js flexerr:/app/backend/server.js && docker cp /tmp/auth.js flexerr:/app/backend/services/auth.js && rm /tmp/server.js /tmp/auth.js && docker restart flexerr"
```

### Frontend Deployment (build on server)

**IMPORTANT:** The container only has `/app/frontend/build` (pre-built). Source files must be copied to server, built there using node:20-alpine, then the build folder copied into the container.

```bash
# 1. Copy frontend source to server
scp -r frontend root@192.168.4.5:/tmp/frontend-build

# 2. Build on server using Docker (node:20-alpine)
ssh root@192.168.4.5 "docker run --rm -v /tmp/frontend-build:/app -w /app node:20-alpine sh -c 'npm install && npm run build'"

# 3. Remove old build and copy new build into container
ssh root@192.168.4.5 "docker exec flexerr rm -rf /app/frontend/build && docker cp /tmp/frontend-build/build flexerr:/app/frontend/build"

# 4. Clean up and restart
ssh root@192.168.4.5 "rm -rf /tmp/frontend-build && docker restart flexerr"
```

**One-liner (copy-paste friendly):**
```bash
scp -r frontend root@192.168.4.5:/tmp/frontend-build && ssh root@192.168.4.5 "docker run --rm -v /tmp/frontend-build:/app -w /app node:20-alpine sh -c 'npm install && npm run build' && docker exec flexerr rm -rf /app/frontend/build && docker cp /tmp/frontend-build/build flexerr:/app/frontend/build && rm -rf /tmp/frontend-build && docker restart flexerr"
```

**Common Mistakes:**
- ❌ Trying to `docker cp` source files into container (source not present, only build)
- ❌ Building locally on Windows (npm/node path issues in bash)
- ❌ Forgetting to remove old build before copying (stale files remain)

### Database Queries

**CRITICAL:** Always use `-w /app` to set working directory inside container.

```bash
# Query database - CORRECT pattern
ssh root@192.168.4.5 "docker exec -w /app flexerr node -e \"
const { db } = require('./backend/database');
const result = db.prepare('SELECT * FROM table WHERE id = ?').all(123);
console.log(JSON.stringify(result, null, 2));
\""

# Query with single quotes (no variable interpolation needed)
ssh root@192.168.4.5 'docker exec -w /app flexerr node -e "
const { db } = require(\"./backend/database\");
const result = db.prepare(\"SELECT * FROM users LIMIT 5\").all();
console.log(JSON.stringify(result, null, 2));
"'

# For complex queries, use a script file
ssh root@192.168.4.5 "cat > /tmp/query.js << 'EOF'
const { db } = require('./backend/database');
const result = db.prepare('SELECT * FROM watch_history WHERE tmdb_id = ? ORDER BY watched_at DESC LIMIT 10').all(4448);
console.log(JSON.stringify(result, null, 2));
EOF
docker cp /tmp/query.js flexerr:/app/query.js
docker exec -w /app flexerr node query.js
rm /tmp/query.js"
```

**Common Mistakes to Avoid:**
- ❌ `node -e "const db = require('./backend/database')"` - Missing `-w /app`
- ❌ `docker exec flexerr node -p "..."` - Working directory defaults to /app/backend
- ❌ Complex bash escaping in heredocs - Use script file approach instead

---

## Development Environment

**Local Machine**: Windows (Mike-UFO)
- User: `mshaw`
- Project Path: `C:\Users\mshaw\projects\flexerr\`
- Git configured with user's credentials
- SSH key authentication enabled (passwordless to Unraid)

## Access & Permissions

| Resource | Access | Details |
|----------|--------|---------|
| Local File System | Read/Write | C:\Users\mshaw\projects\flexerr\ |
| GitHub | Push/Pull | Via local git credentials |
| Unraid SSH | Passwordless | root@192.168.4.5 |
| Docker | Full access | Can restart/rebuild/exec into containers |

## GitHub Operations
```bash
# Use local git credentials (already configured)
git push origin main  # ONLY WHEN USER REQUESTS
```

### GitHub CLI (gh)
- **Installed**: `"C:\Program Files\GitHub CLI\gh.exe"` (v2.86.0)
- **Authenticated**: Account `sybethiesant` via keyring
- **Scopes**: gist, read:org, repo, workflow
- Use for managing issues, PRs, releases, etc.
```bash
# List issues
"/c/Program Files/GitHub CLI/gh.exe" issue list --repo sybethiesant/flexerr

# Close an issue with comment
"/c/Program Files/GitHub CLI/gh.exe" issue close <number> --repo sybethiesant/flexerr --comment "Fixed in commit abc123"

# Create an issue
"/c/Program Files/GitHub CLI/gh.exe" issue create --repo sybethiesant/flexerr --title "Title" --body "Description"
```

---

## Media Stack API Commands

**API Key Locations** (if keys change, check these config files):
```bash
# Radarr API key
ssh root@192.168.4.5 "cat /mnt/user/appdata/radarr/config.xml | grep ApiKey"
# Sonarr API key
ssh root@192.168.4.5 "cat /mnt/user/appdata/sonarr/config.xml | grep ApiKey"
```

**Current Keys** (as of 2026-01-30):
- Radarr: `94a5224f09e4477bb5733dc2957f81d9`
- Sonarr: `33ba1abdcaba43a1994499010a1581ff`
- SABnzbd: `vmqiyzu9j416w02i5r23eenwzil5jeyc`

### Backup Files (for restoring monitored items)
- `/mnt/user/appdata/flexerr/monitored-shows-backup.json` - 30 shows
- `/mnt/user/appdata/flexerr/monitored-movies-backup.json` - 47 movies

### Plex Library Sections
- Section 3: Movies
- Section 4: TV Shows

### Plex (port 32400)
```bash
# Get Plex token from Flexerr database
ssh root@192.168.4.5 "docker exec -w /app flexerr node -e \"const {db}=require('./backend/database'); console.log(db.prepare('SELECT api_key FROM services WHERE type=?').get('plex').api_key);\""

# Refresh all libraries (Section 3=Movies, 4=TV Shows)
ssh root@192.168.4.5 'curl -s "http://192.168.4.5:32400/library/sections/3/refresh?X-Plex-Token=TOKEN"'
ssh root@192.168.4.5 'curl -s "http://192.168.4.5:32400/library/sections/4/refresh?X-Plex-Token=TOKEN"'

# Empty trash (remove phantom entries)
ssh root@192.168.4.5 'curl -s -X PUT "http://192.168.4.5:32400/library/sections/3/emptyTrash?X-Plex-Token=TOKEN"'
ssh root@192.168.4.5 'curl -s -X PUT "http://192.168.4.5:32400/library/sections/4/emptyTrash?X-Plex-Token=TOKEN"'

# Clean bundles and optimize
ssh root@192.168.4.5 'curl -s -X PUT "http://192.168.4.5:32400/library/clean/bundles?X-Plex-Token=TOKEN"'
ssh root@192.168.4.5 'curl -s -X PUT "http://192.168.4.5:32400/library/optimize?X-Plex-Token=TOKEN"'
```

### Sonarr (port 30113)
```bash
# Rescan disk for all series
ssh root@192.168.4.5 'curl -s -X POST "http://192.168.4.5:30113/api/v3/command" -H "X-Api-Key: 33ba1abdcaba43a1994499010a1581ff" -H "Content-Type: application/json" -d "{\"name\": \"RescanSeries\"}"'

# Search for all missing episodes
ssh root@192.168.4.5 'curl -s -X POST "http://192.168.4.5:30113/api/v3/command" -H "X-Api-Key: 33ba1abdcaba43a1994499010a1581ff" -H "Content-Type: application/json" -d "{\"name\": \"MissingEpisodeSearch\"}"'

# Get missing count
ssh root@192.168.4.5 "curl -s 'http://192.168.4.5:30113/api/v3/wanted/missing?apikey=33ba1abdcaba43a1994499010a1581ff' | jq '.totalRecords'"
```

### Radarr (port 30025)
```bash
# Rescan disk for all movies
ssh root@192.168.4.5 'curl -s -X POST "http://192.168.4.5:30025/api/v3/command" -H "X-Api-Key: 94a5224f09e4477bb5733dc2957f81d9" -H "Content-Type: application/json" -d "{\"name\": \"RescanMovie\"}"'

# Search for all missing movies
ssh root@192.168.4.5 'curl -s -X POST "http://192.168.4.5:30025/api/v3/command" -H "X-Api-Key: 94a5224f09e4477bb5733dc2957f81d9" -H "Content-Type: application/json" -d "{\"name\": \"MissingMoviesSearch\"}"'

# Get missing count
ssh root@192.168.4.5 "curl -s 'http://192.168.4.5:30025/api/v3/movie?apikey=94a5224f09e4477bb5733dc2957f81d9' | jq '[.[] | select(.hasFile == false)] | length'"
```

### SABnzbd (port 30055)
```bash
# Check queue status
ssh root@192.168.4.5 "curl -s 'http://192.168.4.5:30055/api?mode=queue&output=json&apikey=vmqiyzu9j416w02i5r23eenwzil5jeyc' | jq '{status: .queue.status, slots: .queue.noofslots_total, paused: .queue.paused}'"

# Pause/Resume
ssh root@192.168.4.5 "curl -s 'http://192.168.4.5:30055/api?mode=pause&apikey=vmqiyzu9j416w02i5r23eenwzil5jeyc'"
ssh root@192.168.4.5 "curl -s 'http://192.168.4.5:30055/api?mode=resume&apikey=vmqiyzu9j416w02i5r23eenwzil5jeyc'"

# Purge entire queue
ssh root@192.168.4.5 "curl -s 'http://192.168.4.5:30055/api?mode=queue&name=purge&del_files=1&apikey=vmqiyzu9j416w02i5r23eenwzil5jeyc'"
```

### Flexerr Plex Sync
```bash
# Force full Plex sync (updates availability status)
ssh root@192.168.4.5 'docker exec -w /app flexerr node -e "
const PlexSync = require(\"./backend/services/plex-sync\");
PlexSync.forceFullSync().then(r => console.log(JSON.stringify(r, null, 2))).catch(e => console.error(e.message));
"'
```

---

## Quality Limits (as of 2026-02-06)

Generous file size limits (MB per minute). Profile cutoff set to Bluray-2160p (prefers 4K, accepts 720p+).

**Radarr (Movies) - Max file sizes for 2hr movie:**
| Quality | Max MB/min | 2hr Movie Max |
|---------|-----------|---------------|
| 720p HDTV/WEB | 55 | ~6.6 GB |
| 720p Bluray | 65 | ~7.8 GB |
| 1080p HDTV | 100 | ~12 GB |
| 1080p WEB | 100 | ~12 GB |
| 1080p Bluray | 130 | ~15.6 GB |
| 1080p Remux | 400 | ~48 GB |
| 4K HDTV/WEB | 175 | ~21 GB |
| 4K Bluray | 250 | ~30 GB |
| 4K Remux | 400 | ~48 GB |

**Sonarr (TV)** - Similar limits, slightly lower for episodes

### Custom Formats
- **AV1 (Avoid)** - Score: -10000 with minFormatScore=0 in both Radarr & Sonarr. Blocks AV1 codec releases (causes green/purple artifacts on devices without AV1 hardware decode).

---

## Feature Backlog

### Acquisition Enhancements
- **Content Routing Rules** - Route content to different root folders/instances based on genre, year, rating, etc. (e.g., horror → folder A, comedy → folder B). Requested via Reddit feedback.

### Notifications
- **Discord Bot Integration** - Approval workflows, notifications, interactive commands

### Request Management  
- **Approval Workflows** - Admin approval for certain content/users
- **User Quotas** - Daily/weekly/monthly request limits per user
