<p align="center">
  <img src="flexerr-logo.png" alt="Flexerr Logo" width="200">
</p>

<h1 align="center">Flexerr</h1>

<p align="center">
  <strong>Media Request & Lifecycle Management for Plex & Jellyfin</strong>
</p>

<p align="center">
  <a href="https://hub.docker.com/r/sybersects/flexerr"><img src="https://img.shields.io/docker/pulls/sybersects/flexerr?style=flat-square&logo=docker" alt="Docker Pulls"></a>
  <a href="https://hub.docker.com/r/sybersects/flexerr"><img src="https://img.shields.io/docker/v/sybersects/flexerr?style=flat-square&logo=docker&label=version" alt="Docker Version"></a>
  <a href="https://github.com/sybersects/flexerr/blob/main/LICENSE"><img src="https://img.shields.io/github/license/sybersects/flexerr?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#viper---velocity-informed-protection--episode-removal">VIPER</a> •
  <a href="#api-reference">API</a>
</p>

---

Flexerr manages your entire media lifecycle - from request to cleanup. Users add content to their watchlist, Flexerr coordinates with your media management tools (Sonarr/Radarr) to acquire and organize content, then intelligently cleans it up when everyone's done watching.

## Features

- **Multi-Server Support** - Works with Plex (OAuth) and Jellyfin (username/password)
- **Watchlist Integration** - Sync with Plex watchlists or Jellyfin favorites for automatic media requests
- **Media Automation** - Watchlist additions seamlessly integrate with Sonarr/Radarr for hands-free library management
- **Auto-Invite** - Automatically invite new users to your Plex server with configured library access
- **VIPER** - Intelligent episode cleanup based on user watch velocity
- **Media Protection** - Protect specific movies/shows from any cleanup rules
- **Leaving Soon Collection** - Grace period before deletion with collection visibility
- **Watchlist Sync & Restoration** - Tracks watchlist removals and re-adds; re-adding triggers automatic restoration and fresh download
- **Rules Engine** - Flexible cleanup rules based on watch status, age, ratings, and more
- **Auto Convert** - Hardware-accelerated video conversion with NVIDIA NVENC support
- **Multi-User Support** - Each user has their own watchlist and viewing history
- **Connected Services Management** - Configure and test services from the Settings page

## How It Works

```
User Watchlist → Media Acquisition → Watch → VIPER Cleanup → Re-watchlist Restores
```

1. User adds content to their Plex watchlist or Jellyfin favorites
2. Flexerr detects the addition and coordinates with Sonarr/Radarr
3. Content is acquired and organized in your library
4. User watches the content
5. VIPER tracks watch progress and velocity
6. Cleanup rules add content to "Leaving Soon" collection (grace period)
7. Content is cleaned up to save storage
8. **If user re-adds to watchlist later**, Flexerr detects the re-add and triggers a fresh acquisition cycle (restoration)

**Note:** Protected items bypass all cleanup rules regardless of other settings.

## Quick Start

> **Now available on Docker Hub!** `docker pull sybersects/flexerr:latest`

### Requirements

- **Docker** and **Docker Compose**
- **Plex Media Server** with OAuth enabled OR **Jellyfin** server
- **Sonarr** (for TV shows)
- **Radarr** (for movies)
- **TMDB API Key** ([get one free](https://www.themoviedb.org/settings/api))

> **Note:** Flexerr is not compatible with Overseerr, Jellyseerr, or similar request management tools. Flexerr manages requests directly through Sonarr/Radarr and should be used as a standalone solution.

### Installation

**Option 1: Docker Hub (Recommended)**

```bash
# Create a directory for Flexerr
mkdir flexerr && cd flexerr

# Download the example compose file
curl -O https://raw.githubusercontent.com/sybersects/flexerr/main/docker-compose.example.yml
mv docker-compose.example.yml docker-compose.yml

# Start Flexerr
docker compose up -d
```

**Option 2: Build from Source**

```bash
git clone https://github.com/sybersects/flexerr.git
cd flexerr
docker compose up -d
```

3. Open http://localhost:5505 in your browser

4. Choose your media server type:
   - **Plex**: Sign in with your Plex account (first user becomes admin)
   - **Jellyfin**: Enter your server URL and login credentials

5. Complete the setup wizard:
   - Enter your TMDB API key
   - Connect Sonarr and Radarr
   - Configure your preferences

That's it! Users can now browse content, add to watchlists, and Flexerr handles the rest.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5505` |
| `TZ` | Timezone for scheduled tasks | `UTC` |
| `JWT_SECRET` | Secret for JWT tokens | Auto-generated |
| `NODE_ENV` | Environment mode | `production` |

### Media Volume Mount

**Required if using:** Auto Convert (DV5 conversion) or direct file deletion

Flexerr needs access to your media files for these features. The path inside the container **must match** what Sonarr/Radarr report as file paths.

**To find the correct path:**
1. Go to Sonarr/Radarr → Activity → History
2. Look at any completed download's file path
3. Mount that root path into Flexerr

**Example:** If Sonarr shows files at `/data/media/TV/Show Name/...`
```yaml
volumes:
  - /your/host/path:/data/media  # Maps to same path Sonarr uses
```

**Common setups:**
```yaml
# If Sonarr/Radarr use /data/media internally
- /mnt/storage/media:/data/media

# If they use /movies and /tv separately
- /mnt/movies:/movies
- /mnt/tv:/tv
```

### Docker Compose Options

```yaml
services:
  flexerr:
    # ...
    volumes:
      - flexerr-data:/app/data
      # Media mount - required for Auto Convert and file deletion
      # Path must match what Sonarr/Radarr report (see above)
      - /your/media/path:/data/media
    environment:
      - TZ=America/New_York
      # Optional: Fixed JWT secret
      - JWT_SECRET=your-secret-here
    # GPU access - required for hardware-accelerated Auto Convert
    # devices:
    #   - /dev/dri:/dev/dri
```

### NVIDIA GPU Support (NVENC)

For hardware-accelerated video conversion using NVIDIA GPUs:

1. Install the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) on your host

2. Run the container with NVIDIA runtime:
```bash
docker run -d \
  --name flexerr \
  --runtime=nvidia \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,video,utility \
  -p 5505:5505 \
  -v flexerr-data:/app/data \
  -v /path/to/media:/Media \
  flexerr
```

3. Verify GPU access:
```bash
docker exec flexerr nvidia-smi
docker exec flexerr ffmpeg -encoders 2>/dev/null | grep nvenc
```

Supported encoders: `h264_nvenc`, `hevc_nvenc`, `av1_nvenc`

### Auto-Invite New Users

Automatically invite new users to your Plex server when they sign in to Flexerr:

1. Go to Settings → Media Sync tab
2. Enable "Auto-Invite New Users"
3. Select which libraries to share with new users
4. When a new user authenticates via Plex OAuth, they'll receive an email invitation to your Plex server

This allows you to share a Flexerr link with friends - they sign in with Plex, automatically get invited to your server, and can immediately start adding content to their watchlist.

## Watchlist Sync & Restoration

Flexerr continuously syncs with Plex watchlists and Jellyfin favorites, detecting both additions and removals.

### How It Works

1. **Addition Detection** - New watchlist items are automatically coordinated with Sonarr/Radarr
2. **Removal Tracking** - Items removed from watchlist are marked as removed in Flexerr
3. **Re-Add Detection** - If a user adds back a previously removed item, Flexerr detects this as a restoration
4. **Automatic Restoration** - Re-added items trigger fresh acquisition cycle, removing from exclusion lists and resetting lifecycle

### Use Case: Content Recovery

This enables users to recover content that was cleaned up:

1. User watches a show, removes from watchlist
2. Smart cleanup eventually deletes the files
3. Months later, user wants to rewatch
4. User simply adds back to Plex watchlist or Jellyfin favorites
5. Flexerr automatically:
   - Detects the re-add
   - Removes from Sonarr/Radarr exclusion lists
   - Resets lifecycle status
   - Triggers fresh download

No admin intervention required - users can self-service restore their content.

## VIPER - Velocity-Informed Protection & Episode Removal

VIPER intelligently manages TV show episodes based on each user's watch progress and velocity.

### How It Works

1. **Tracks Watch Progress** - Monitors where each user is in each show
2. **Calculates Velocity** - Determines how fast users watch (episodes per day)
3. **Smart Buffer** - Keeps enough episodes ahead based on watch speed
4. **Safe Cleanup** - Only deletes when ALL active users have moved past
5. **Proactive Redownload** - Re-downloads episodes before slower users need them
6. **Respects Protection** - Never deletes protected items regardless of velocity

### Key Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Days Buffer | Days of watching to keep ahead | 10 |
| Max Episodes Ahead | Hard cap on episodes to keep | 200 |
| Unknown Velocity Buffer | Fallback when velocity unknown | 10 |
| Min Velocity Samples | Episodes needed to trust velocity | 3 |
| Proactive Redownload | Auto-redownload deleted episodes | Enabled |

### Example Scenario

A household of 3 users watching "Breaking Bad" (62 episodes):

| User | Watch Speed | Current Position |
|------|-------------|------------------|
| Dad | Finished | Season 5 Complete |
| Mom | 1 ep/day | Season 2, Episode 5 |
| Teen | Paused for 2 weeks | Season 1, Episode 3 |

**What VIPER keeps:**
- S1E01-S1E02 → Cleaned (everyone's past them)
- S1E03 + buffer ahead → Protected (Teen's bubble)
- S2E05 + buffer ahead → Protected (Mom's bubble)
- S2E06 through S5 → Cleaned (Dad's done, outside Mom's forward buffer)

**The gap cleanup:** Episodes between Teen's bubble and Mom's bubble, and between Mom's bubble and the end, get cleaned. Only the bubbles around active viewers are preserved.

**What happens next:**
- Teen resumes watching, finishes S1 → Teen's bubble moves forward
- Gap between Teen and Mom shrinks, more episodes become cleanable behind Teen
- Mom continues steady pace, her bubble moves forward with her
- Storage is reclaimed gradually as bubbles move and gaps open up

**The key insight:** Each user has an invisible bubble around their position. Content is only cleaned when it falls outside ALL users' bubbles. Large gaps between viewers get cleaned automatically.

## Media Protection

Protect specific movies or TV shows from any deletion - a priority override for all cleanup rules. Protection now automatically ensures content is available!

### How to Protect Media

1. Navigate to any movie or TV show detail page
2. Click the **Shield** icon to toggle protection ON
3. Protected items display a shield badge

### Protection Behavior

- **Priority 1 Override** - Protected items are NEVER deleted by any rule
- **Bypasses VIPER Cleanup** - Ignored by velocity-based episode management
- **Bypasses Rules Engine** - Ignored by all cleanup rules
- **Auto-Monitor** (NEW!) - Automatically sets to monitored in Sonarr/Radarr
- **Auto-Search** (TV Shows) - Triggers search for ALL episodes to ensure availability
- **Stats Visibility** - Protected items shown separately in cleanup stats
- **Persistent** - Protection remains until manually toggled off

### What Happens When You Protect Content

**TV Shows:**
1. Series set to `monitored: true` in Sonarr
2. ALL episodes set to monitored (including previously unmonitored ones)
3. Series search triggered to download any missing episodes
4. Episodes will never be deleted by VIPER or rules

**Movies:**
1. Movie set to `monitored: true` in Radarr
2. Will never be deleted by rules

## Rules Engine

Create custom cleanup rules for content that doesn't fit the VIPER model.

### Available Conditions

| Condition | Description |
|-----------|-------------|
| Watched | Has any user watched this? |
| View Count | Total times watched across users |
| Days Since Watched | Days since last watch |
| Days Since Added | Days since added to library |
| On Watchlist | Is any user's watchlist? |
| Rating | TMDB/IMDB rating |
| File Size (GB) | Total file size |
| Genre | Content genre |
| Release Year | Year of release |

### Available Actions

| Action | Description |
|--------|-------------|
| Add to Leaving Soon | Queue for deletion with grace period |
| Delete from Plex/Jellyfin | Remove from media server |
| Delete from Sonarr/Radarr | Remove from *arr apps |
| Unmonitor | Stop tracking for upgrades |
| Delete Files | Remove actual media files |

**Note:** Protected items are always skipped by rules, regardless of conditions.

### Example Rules

**Watched Movies Cleanup:**
- Watched = Yes AND Days Since Watched > 30 AND On Watchlist = No
- Action: Add to Leaving Soon (15 day buffer)

**Large File Cleanup:**
- File Size > 50GB AND Watched = Yes
- Action: Add to Leaving Soon

**Old Unwatched Content:**
- Days Since Added > 90 AND Watched = No AND On Watchlist = No
- Action: Add to Leaving Soon

## Connecting Services

### Plex

Flexerr uses Plex OAuth - no manual token setup needed. The first user to sign in becomes the admin. Additional users are automatically synced from your Plex server.

### Jellyfin (Beta)

Jellyfin uses username/password authentication:
1. Enter your Jellyfin server URL during setup
2. Login with your Jellyfin credentials
3. The first user to sign in becomes the admin

**Important Notes:**
- Jellyfin uses Favorites as a watchlist equivalent since Jellyfin lacks native watchlist support
- **Smart cleanup currently requires Plex** - Jellyfin velocity tracking is in development
- Basic features work: browsing, requesting, watch history, collections
- Advanced features (VIPER, velocity tracking) are Plex-only for now

### Sonarr / Radarr

1. Go to Settings → Connected Services
2. Click "Add Service"
3. Select Sonarr or Radarr
4. Enter:
   - **URL**: Your Sonarr/Radarr URL (e.g., `http://192.168.1.100:8989`)
   - **API Key**: Found in Sonarr/Radarr Settings → General
5. Click "Test Connection" then "Save"

### TMDB

1. Create a free account at [themoviedb.org](https://www.themoviedb.org)
2. Go to Settings → API
3. Request an API key
4. Enter the key during Flexerr setup (or in Settings → General)

## Admin Dashboard

The admin dashboard provides:

- **Statistics** - Requests, deletions, storage saved
- **User Management** - View users, watchlists, admin status
- **Rules Management** - Create, edit, and run cleanup rules
- **Queue** - View and manage pending deletions
- **Logs** - Activity and error logging
- **Connected Services** - Manage media server and download managers

## Troubleshooting

### Plex sign-in not working

- Ensure Plex OAuth is enabled in your Plex server settings
- Check that your Plex server is accessible from Flexerr
- Verify no firewall blocking the connection

### Jellyfin sign-in not working

- Verify the server URL is correct and accessible
- Check username/password are correct
- Ensure Jellyfin server is running and accepting connections

### Media not being acquired

- Verify Sonarr/Radarr connection in Connected Services
- Check that the content has a TVDB/TMDB ID
- Ensure Sonarr/Radarr have root folders and quality profiles configured

### Smart cleanup not running

- **Smart cleanup requires Plex** - Jellyfin velocity tracking coming soon
- Check Settings → VIPER is enabled
- Verify the cleanup schedule is set
- Check Media Server Sync is enabled and running
- Check logs for errors - admin dashboard shows detailed error reporting

### Content deleted too soon

- Increase "Days Buffer" in VIPER
- Add content to watchlist to protect it
- **Use the Protect toggle** on the media detail page for permanent protection
- Check "Leaving Soon" collection for upcoming deletions

## API Reference

### Authentication
```
POST /api/auth/plex/start     - Start Plex OAuth flow
GET  /api/auth/plex/callback  - Complete OAuth
POST /api/jellyfin/auth       - Jellyfin authentication
POST /api/auth/refresh        - Refresh JWT token
GET  /api/auth/me             - Get current user
```

### Discovery
```
GET /api/discover/search?q=   - Search TMDB
GET /api/discover/trending    - Trending content
GET /api/discover/movie/:id   - Movie details
GET /api/discover/tv/:id      - TV show details
```

### Watchlist
```
GET    /api/watchlist         - User's watchlist
POST   /api/watchlist         - Add to watchlist
DELETE /api/watchlist/:id     - Remove from watchlist
```

### Protection
```
GET  /api/protection/:mediaType/:tmdbId  - Get protection status
POST /api/protection/:mediaType/:tmdbId  - Toggle protection
```

### Admin (requires admin role)
```
GET  /api/rules               - List rules
POST /api/rules               - Create rule
GET  /api/settings            - Get settings
PUT  /api/settings            - Update settings
GET  /api/services            - List services
POST /api/services            - Add service
```

## Tech Stack

- **Frontend**: React 18, Tailwind CSS, Vite
- **Backend**: Node.js, Express, SQLite (better-sqlite3)
- **Authentication**: Plex OAuth, Jellyfin Auth, JWT
- **APIs**: TMDB, Sonarr, Radarr, Plex, Jellyfin

## Project Structure

```
flexerr/
├── backend/
│   ├── server.js           # Express server & routes
│   ├── database.js         # SQLite database
│   └── services/
│       ├── auth.js         # Plex OAuth + Jellyfin Auth + JWT
│       ├── plex.js         # Plex API client
│       ├── sonarr.js       # Sonarr integration
│       ├── radarr.js       # Radarr integration
│       ├── tmdb.js         # TMDB API
│       ├── rules-engine.js # Cleanup rules
│       ├── smart-episodes.js # VIPER engine
│       ├── scheduler.js    # Job scheduling
│       └── media-server/   # Multi-server abstraction
│           ├── media-server.js
│           ├── plex-media-server.js
│           ├── jellyfin-media-server.js
│           └── media-server-factory.js
├── frontend/src/
│   ├── App.jsx             # Routes & auth context
│   └── pages/              # Page components
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file.

## Support

- **Issues**: [GitHub Issues](https://github.com/sybersects/flexerr/issues)
- **Discussions**: [GitHub Discussions](https://github.com/sybersects/flexerr/discussions)
