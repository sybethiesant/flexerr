<p align="center">
  <img src="https://raw.githubusercontent.com/sybethiesant/flexerr/main/frontend/public/flexerr-logo.png" alt="Flexerr Logo" width="200">
</p>

# Flexerr

**Media Request & Lifecycle Management for Plex & Jellyfin**

Flexerr manages your entire media lifecycle - from request to cleanup. Users add content to their watchlist, Flexerr coordinates with your media management tools (Sonarr/Radarr) to acquire and organize content, then intelligently cleans it up when everyone's done watching.

## Features

- **Multi-Server Support** - Works with Plex (OAuth) and Jellyfin
- **Watchlist Integration** - Sync with Plex watchlists for automatic media requests
- **Media Automation** - Seamlessly integrates with Sonarr/Radarr for hands-free library management
- **VIPER** - Intelligent episode cleanup based on user watch velocity
- **Media Protection** - Protect specific movies/shows from cleanup
- **Auto Convert** - Hardware-accelerated video conversion (NVENC/VAAPI)
- **Multi-User Support** - Each user has their own watchlist

## Quick Start

**Docker Hub:**
```bash
docker pull sybersects/flexerr:latest
```

**GitHub Container Registry:**
```bash
docker pull ghcr.io/sybethiesant/flexerr:latest
```

**Run:**
```bash
docker run -d \
  --name flexerr \
  -p 5505:5505 \
  -v flexerr-data:/app/data \
  -e TZ=America/Los_Angeles \
  sybersects/flexerr:latest
```

Then open http://localhost:5505

## Docker Compose

```yaml
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
      - TZ=America/Los_Angeles

volumes:
  flexerr-data:
```

## GPU Support (NVIDIA)

For hardware-accelerated video conversion (Auto Convert feature), run with NVIDIA runtime:

```bash
docker run -d \
  --name flexerr \
  --runtime=nvidia \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility \
  -e TZ=America/Los_Angeles \
  -p 5505:5505 \
  -v flexerr-data:/app/data \
  -v /path/to/media:/Media \
  sybersects/flexerr:latest
```

**Requirements:**
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) installed on host
- NVIDIA GPU with NVENC support (GTX 600+ series)

**Verify GPU access:**
```bash
docker exec flexerr nvidia-smi
docker exec flexerr ffmpeg -encoders 2>/dev/null | grep nvenc
```

### Docker Compose with GPU

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
      - TZ=America/Los_Angeles
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,video,utility

volumes:
  flexerr-data:
```

## Documentation

Full documentation: https://github.com/sybethiesant/flexerr

## Supported Architectures

- `linux/amd64`
- `linux/arm64`
