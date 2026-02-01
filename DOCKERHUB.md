# Flexerr

**Media Request & Lifecycle Management for Plex & Jellyfin**

Flexerr manages your entire media lifecycle - from request to cleanup. Users add content to their watchlist, Flexerr automatically downloads it via Sonarr/Radarr, and intelligently cleans it up when everyone's done watching.

## Features

- **Multi-Server Support** - Works with Plex (OAuth) and Jellyfin
- **Watchlist Integration** - Sync with Plex watchlists for automatic requests
- **Auto-Download** - Watchlist additions trigger Sonarr/Radarr downloads
- **VIPER** - Intelligent episode cleanup based on user watch velocity
- **Media Protection** - Protect specific movies/shows from cleanup
- **Auto Convert** - Hardware-accelerated video conversion (NVENC/VAAPI)
- **Multi-User Support** - Each user has their own watchlist

## Quick Start

```bash
docker run -d \
  --name flexerr \
  -p 3100:3100 \
  -v flexerr-data:/app/data \
  -e TZ=America/Los_Angeles \
  sybersects/flexerr:latest
```

Then open http://localhost:3100

## Docker Compose

```yaml
services:
  flexerr:
    image: sybersects/flexerr:latest
    container_name: flexerr
    restart: unless-stopped
    ports:
      - "3100:3100"
    volumes:
      - flexerr-data:/app/data
    environment:
      - TZ=America/Los_Angeles

volumes:
  flexerr-data:
```

## GPU Support (NVIDIA)

```bash
docker run -d \
  --name flexerr \
  --runtime=nvidia \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -p 3100:3100 \
  -v flexerr-data:/app/data \
  sybersects/flexerr:latest
```

## Documentation

Full documentation: https://github.com/sybersects/flexerr

## Supported Architectures

- `linux/amd64`
- `linux/arm64`
