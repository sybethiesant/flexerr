# Flexerr Installation Guide

Complete installation and configuration guide for Flexerr - Media Request & Lifecycle Management for Plex & Jellyfin.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Docker Installation](#docker-installation)
- [Docker Compose](#docker-compose)
- [Volume Configuration](#volume-configuration)
- [GPU Setup](#gpu-setup)
- [Reverse Proxy](#reverse-proxy)
- [Initial Setup](#initial-setup)
- [Connecting Services](#connecting-services)
- [Platform-Specific Instructions](#platform-specific-instructions)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required
- Docker (20.10+) or Docker Desktop
- Plex Media Server OR Jellyfin (with admin access)
- 512MB+ RAM available for the container

### Optional (for full functionality)
- Sonarr (for TV show management)
- Radarr (for movie management)
- NVIDIA or AMD/Intel GPU (only for video conversion feature)

### Network Requirements
- Port 5505 available (or configure a different port)
- Plex/Jellyfin accessible from where Flexerr runs
- If using reverse proxy: WebSocket support enabled

---

## Quick Start

**Docker Hub:**
```bash
docker run -d \
  --name flexerr \
  -p 5505:5505 \
  -v flexerr-data:/app/data \
  -e TZ=America/New_York \
  sybersects/flexerr:latest
```

**GitHub Container Registry:**
```bash
docker run -d \
  --name flexerr \
  -p 5505:5505 \
  -v flexerr-data:/app/data \
  -e TZ=America/New_York \
  ghcr.io/sybethiesant/flexerr:latest
```

Then open http://localhost:5505 to begin setup.

---

## Docker Installation

### Basic Installation

```bash
docker run -d \
  --name flexerr \
  --restart unless-stopped \
  -p 5505:5505 \
  -v flexerr-data:/app/data \
  -e TZ=America/New_York \
  sybersects/flexerr:latest
```

### With Media Volume (Required for Auto Convert)

If you plan to use the Auto Convert feature, Flexerr needs direct access to your media files:

```bash
docker run -d \
  --name flexerr \
  --restart unless-stopped \
  -p 5505:5505 \
  -v flexerr-data:/app/data \
  -v /path/to/your/media:/Media \
  -e TZ=America/New_York \
  sybersects/flexerr:latest
```

**Important:** The path inside the container (`/Media`) must match what Sonarr/Radarr report as file paths, OR you need to set up path mapping. See [Volume Configuration](#volume-configuration).

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TZ` | `UTC` | Timezone (e.g., `America/New_York`, `Europe/London`) |
| `PORT` | `5505` | Internal port (rarely needs changing) |
| `JWT_SECRET` | Auto-generated | Fixed secret for JWT tokens (optional, set for persistence across rebuilds) |

---

## Docker Compose

### Basic Setup

```yaml
version: "3.8"

services:
  flexerr:
    image: sybersects/flexerr:latest
    container_name: flexerr
    restart: unless-stopped
    ports:
      - "5505:5505"
    volumes:
      - flexerr-data:/app/data
    environment:
      - TZ=America/New_York

volumes:
  flexerr-data:
```

### With Media Access

```yaml
version: "3.8"

services:
  flexerr:
    image: sybersects/flexerr:latest
    container_name: flexerr
    restart: unless-stopped
    ports:
      - "5505:5505"
    volumes:
      - flexerr-data:/app/data
      - /path/to/media:/Media
    environment:
      - TZ=America/New_York

volumes:
  flexerr-data:
```

### Full Stack Example (with Sonarr/Radarr)

```yaml
version: "3.8"

services:
  flexerr:
    image: sybersects/flexerr:latest
    container_name: flexerr
    restart: unless-stopped
    ports:
      - "5505:5505"
    volumes:
      - flexerr-data:/app/data
      - /data/media:/data/media  # Same path as Sonarr/Radarr
    environment:
      - TZ=America/New_York
    depends_on:
      - sonarr
      - radarr

  sonarr:
    image: lscr.io/linuxserver/sonarr:latest
    container_name: sonarr
    restart: unless-stopped
    ports:
      - "8989:8989"
    volumes:
      - sonarr-config:/config
      - /data/media:/data/media
    environment:
      - TZ=America/New_York
      - PUID=1000
      - PGID=1000

  radarr:
    image: lscr.io/linuxserver/radarr:latest
    container_name: radarr
    restart: unless-stopped
    ports:
      - "7878:7878"
    volumes:
      - radarr-config:/config
      - /data/media:/data/media
    environment:
      - TZ=America/New_York
      - PUID=1000
      - PGID=1000

volumes:
  flexerr-data:
  sonarr-config:
  radarr-config:
```

---

## Volume Configuration

### Understanding Path Mapping

Flexerr needs to access media files for the Auto Convert feature. The paths inside Flexerr must match what Sonarr/Radarr report.

**Example scenario:**
- Your media is at `/mnt/storage/media` on the host
- Sonarr reports files as `/data/media/Movies/Movie.mkv`
- Radarr reports files as `/data/media/TV/Show/episode.mkv`

**Solution:** Mount your media so paths match:
```bash
-v /mnt/storage/media:/data/media
```

### Common Path Configurations

| Host Path | Container Path | Use Case |
|-----------|---------------|----------|
| `/mnt/media` | `/Media` | Simple setup |
| `/data/media` | `/data/media` | Match Sonarr/Radarr paths |
| `/volume1/media` | `/volume1/media` | Synology NAS |
| `/mnt/user/media` | `/mnt/user/media` | Unraid |

### Checking Sonarr/Radarr Paths

1. Open Sonarr/Radarr web UI
2. Go to any movie/show
3. Look at the file path shown
4. Configure Flexerr's media mount to match

---

## GPU Setup

GPU acceleration is **only needed for the conversion feature**. If you're only using "Search for Alternate Release" without conversion fallback, skip this section.

### NVIDIA GPU

#### Prerequisites
1. NVIDIA GPU (GTX 600 series or newer)
2. NVIDIA drivers installed on host
3. [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) installed

#### Installation (Ubuntu/Debian)
```bash
# Add NVIDIA container toolkit repository
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list

# Install
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit

# Restart Docker
sudo systemctl restart docker
```

#### Docker Run (NVIDIA)
```bash
docker run -d \
  --name flexerr \
  --restart unless-stopped \
  --runtime=nvidia \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility \
  -p 5505:5505 \
  -v flexerr-data:/app/data \
  -v /path/to/media:/Media \
  -e TZ=America/New_York \
  sybersects/flexerr:latest
```

#### Docker Compose (NVIDIA)
```yaml
services:
  flexerr:
    image: sybersects/flexerr:latest
    container_name: flexerr
    restart: unless-stopped
    runtime: nvidia
    ports:
      - "5505:5505"
    volumes:
      - flexerr-data:/app/data
      - /path/to/media:/Media
    environment:
      - TZ=America/New_York
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,video,utility

volumes:
  flexerr-data:
```

#### Verify NVIDIA Access
```bash
# Check GPU is visible
docker exec flexerr nvidia-smi

# Check NVENC encoders available
docker exec flexerr ffmpeg -encoders 2>/dev/null | grep nvenc
```

Expected output should show `h264_nvenc`, `hevc_nvenc`.

### AMD/Intel GPU (VAAPI)

#### Prerequisites
1. AMD or Intel GPU with VAAPI support
2. VAAPI drivers installed on host (`mesa-va-drivers` on Debian/Ubuntu)

#### Installation (Ubuntu/Debian)
```bash
# Install VAAPI drivers
sudo apt-get install mesa-va-drivers vainfo

# Verify VAAPI works on host
vainfo
```

#### Docker Run (VAAPI)
```bash
docker run -d \
  --name flexerr \
  --restart unless-stopped \
  --device /dev/dri:/dev/dri \
  -p 5505:5505 \
  -v flexerr-data:/app/data \
  -v /path/to/media:/Media \
  -e TZ=America/New_York \
  sybersects/flexerr:latest
```

#### Docker Compose (VAAPI)
```yaml
services:
  flexerr:
    image: sybersects/flexerr:latest
    container_name: flexerr
    restart: unless-stopped
    devices:
      - /dev/dri:/dev/dri
    ports:
      - "5505:5505"
    volumes:
      - flexerr-data:/app/data
      - /path/to/media:/Media
    environment:
      - TZ=America/New_York

volumes:
  flexerr-data:
```

#### Verify VAAPI Access
```bash
docker exec flexerr ffmpeg -encoders 2>/dev/null | grep vaapi
```

Expected output should show `h264_vaapi`, `hevc_vaapi`.

---

## Reverse Proxy

### Nginx

```nginx
server {
    listen 80;
    server_name flexerr.yourdomain.com;

    location / {
        proxy_pass http://localhost:5505;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Nginx Proxy Manager

1. Add new Proxy Host
2. Domain: `flexerr.yourdomain.com`
3. Forward Hostname/IP: `flexerr` (container name) or IP
4. Forward Port: `5505`
5. Enable "Websockets Support"

### Caddy

```
flexerr.yourdomain.com {
    reverse_proxy localhost:5505
}
```

### Traefik (Docker Labels)

```yaml
services:
  flexerr:
    image: sybersects/flexerr:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.flexerr.rule=Host(`flexerr.yourdomain.com`)"
      - "traefik.http.services.flexerr.loadbalancer.server.port=5505"
```

---

## Initial Setup

### Step 1: Access Setup Wizard

Open your browser to:
- Direct: `http://your-server-ip:5505`
- Via reverse proxy: `https://flexerr.yourdomain.com`

### Step 2: Connect to Plex

1. Click "Sign in with Plex"
2. A popup will open to plex.tv
3. Sign in with your Plex account
4. Authorize Flexerr
5. Popup closes automatically

**Troubleshooting:**
- If popup is blocked, allow popups for Flexerr's URL
- If popup doesn't close, check browser console for errors
- Try a different browser (Chrome works best)

### Step 3: Create Admin Account

1. Click "Sign in with Plex" again
2. This creates your admin account linked to your Plex identity
3. You'll be redirected to the dashboard

### Step 4: Configure Settings

Go to Settings and configure:
1. **Media Sync** - Connect Sonarr/Radarr
2. **VIPER** - Configure cleanup rules
3. **Auto Convert** - Set up format detection (optional)

---

## Connecting Services

### Plex

Already connected during setup. To reconnect:
1. Go to Settings → Connected Services
2. Click "Reconnect Plex"
3. Complete OAuth flow

### Jellyfin

1. Go to Settings → Connected Services
2. Enter Jellyfin URL (e.g., `http://192.168.1.100:8096`)
3. Enter API Key (found in Jellyfin → Dashboard → API Keys)
4. Click Test & Save

### Sonarr

1. Go to Settings → Connected Services
2. Enter Sonarr URL (e.g., `http://192.168.1.100:8989`)
3. Enter API Key (found in Sonarr → Settings → General)
4. Click Test & Save

### Radarr

1. Go to Settings → Connected Services
2. Enter Radarr URL (e.g., `http://192.168.1.100:7878`)
3. Enter API Key (found in Radarr → Settings → General)
4. Click Test & Save

### Finding API Keys

| Service | Location |
|---------|----------|
| Sonarr | Settings → General → API Key |
| Radarr | Settings → General → API Key |
| Jellyfin | Dashboard → API Keys → Create |
| Plex | Automatic via OAuth |

---

## Platform-Specific Instructions

### Unraid

#### Basic Installation
1. Go to Apps → Search "flexerr" (or add manually)
2. Configure:
   - Container Port: `5505`
   - Host Port: `5505`
   - Data Path: `/mnt/user/appdata/flexerr` → `/app/data`
   - Media Path: `/mnt/user/media` → `/mnt/user/media` (match exactly)

#### With NVIDIA GPU
1. Install **Nvidia-Driver** plugin from Community Applications
2. Edit container → Advanced View
3. Extra Parameters: `--runtime=nvidia`
4. Add environment variables:
   - `NVIDIA_VISIBLE_DEVICES=all`
   - `NVIDIA_DRIVER_CAPABILITIES=compute,video,utility`

### Synology NAS

#### Using Container Manager
1. Registry → Search `sybersects/flexerr`
2. Download latest tag
3. Create container:
   - Port: Local 5505 → Container 5505
   - Volume: `/volume1/docker/flexerr` → `/app/data`
   - Volume: `/volume1/media` → `/volume1/media`
4. Environment: `TZ=Your/Timezone`

### TrueNAS Scale

1. Apps → Discover Apps → Custom App
2. Image: `sybersects/flexerr:latest`
3. Configure networking and storage
4. For GPU passthrough, configure in "GPU Configuration" section

### Proxmox (LXC)

For LXC containers, GPU passthrough requires additional configuration:

```bash
# On Proxmox host, add to container config:
lxc.cgroup2.devices.allow: c 226:* rwm
lxc.mount.entry: /dev/dri dev/dri none bind,optional,create=dir
```

---

## Troubleshooting

### Common Issues

#### "Please connect to Plex first" on sign-in

**Cause:** Plex service not properly saved during setup.

**Solutions:**
1. Go back to setup page 2 and reconnect Plex
2. Ensure popups are allowed
3. Try a different browser
4. Clear browser cache and cookies

#### Plex OAuth popup doesn't close

**Cause:** OAuth redirect issue, often with reverse proxies.

**Solutions:**
1. Check reverse proxy passes `X-Forwarded-Proto` and `X-Forwarded-Host`
2. Try accessing Flexerr directly (not through proxy) for setup
3. Check browser console for JavaScript errors

#### Container won't start

**Check logs:**
```bash
docker logs flexerr
```

**Common causes:**
- Port 5505 already in use → Change port mapping
- Volume permissions → Ensure Docker can write to data volume
- Missing dependencies → Pull latest image

#### GPU not detected

**NVIDIA:**
```bash
# Check nvidia-smi works in container
docker exec flexerr nvidia-smi

# If not, verify NVIDIA Container Toolkit:
docker run --rm --runtime=nvidia nvidia/cuda:11.0-base nvidia-smi
```

**VAAPI:**
```bash
# Check /dev/dri exists in container
docker exec flexerr ls -la /dev/dri

# Should show renderD128 and card0
```

#### Conversion jobs failing

**Check:**
1. Media volume is correctly mounted
2. File paths match between Flexerr and Sonarr/Radarr
3. GPU is accessible (if using hardware acceleration)
4. Sufficient disk space in temp directory

**View conversion logs:**
```bash
docker logs flexerr 2>&1 | grep -i "mediaconverter\|ffmpeg"
```

#### Sonarr/Radarr connection failed

**Check:**
1. URL is correct (include port, no trailing slash)
2. API key is correct
3. Flexerr can reach Sonarr/Radarr (same Docker network or accessible IP)

**Test from container:**
```bash
docker exec flexerr curl -s "http://sonarr:8989/api/v3/system/status" -H "X-Api-Key: YOUR_API_KEY"
```

#### Watchlist not syncing

**Check:**
1. Plex token is valid (Settings → Connected Services → Test)
2. User has items on their Plex watchlist
3. View logs for sync errors:
```bash
docker logs flexerr 2>&1 | grep -i "watchlist"
```

### Log Locations

All logs go to stdout/stderr (Docker standard):

```bash
# View all logs
docker logs flexerr

# Follow logs in real-time
docker logs -f flexerr

# View last 100 lines
docker logs flexerr --tail 100

# Filter for errors
docker logs flexerr 2>&1 | grep -i error
```

### Database Issues

**Reset database (lose all data):**
```bash
docker exec flexerr rm /app/data/flexerr.sqlite
docker restart flexerr
```

**Backup database:**
```bash
docker cp flexerr:/app/data/flexerr.sqlite ./flexerr-backup.sqlite
```

### Getting Help

1. Check [GitHub Issues](https://github.com/sybethiesant/flexerr/issues) for known problems
2. Include logs when reporting issues
3. Provide your Docker run command or compose file (redact sensitive info)

---

## Updating

### Docker CLI

```bash
docker pull sybersects/flexerr:latest
docker stop flexerr
docker rm flexerr
# Re-run your original docker run command
```

### Docker Compose

```bash
docker compose pull
docker compose up -d
```

### Unraid

1. Go to Docker tab
2. Click the Flexerr icon → "Check for Updates"
3. Apply update if available

---

## Uninstalling

### Keep data (for reinstall later)

```bash
docker stop flexerr
docker rm flexerr
# Data volume preserved
```

### Complete removal

```bash
docker stop flexerr
docker rm flexerr
docker volume rm flexerr-data  # or your volume name
docker rmi sybersects/flexerr:latest
```
