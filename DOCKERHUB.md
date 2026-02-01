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
- **Auto Convert** - Fix incompatible formats (DV5/7/8, AV1, MKV, TrueHD/DTS) with GPU acceleration, or automatically search for compatible releases first
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

## GPU Support (Optional)

GPU is only required if using the conversion feature. The "Search for Alternate Release" feature works without GPU.

### NVIDIA

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

**Requirements:** [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) + GTX 600+ GPU

### AMD/Intel (VAAPI)

```bash
docker run -d \
  --name flexerr \
  --device /dev/dri:/dev/dri \
  -e TZ=America/Los_Angeles \
  -p 5505:5505 \
  -v flexerr-data:/app/data \
  -v /path/to/media:/Media \
  sybersects/flexerr:latest
```

### Docker Compose (NVIDIA)

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

### Docker Compose (VAAPI)

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
      - TZ=America/Los_Angeles

volumes:
  flexerr-data:
```

## Documentation

Full documentation: https://github.com/sybethiesant/flexerr

## Supported Architectures

- `linux/amd64`
- `linux/arm64`
