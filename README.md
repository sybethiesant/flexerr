# Flexerr

**Media Request & Lifecycle Management for Plex & Jellyfin**

Flexerr manages your entire media lifecycle - from request to cleanup. Users add content to their watchlist, Flexerr automatically downloads it via Sonarr/Radarr, and intelligently cleans it up when everyone's done watching.

## Features

- **Multi-Server Support** - Works with Plex (OAuth) and Jellyfin (username/password)
- **Watchlist Integration** - Sync with Plex watchlists or Jellyfin favorites for automatic requests
- **Auto-Download** - Watchlist additions trigger Sonarr/Radarr downloads automatically
- **Smart Episode Manager** - Intelligent episode cleanup based on user watch velocity
- **Media Protection** - Protect specific movies/shows from any cleanup rules
- **Leaving Soon Collection** - Grace period before deletion with collection visibility
- **Watchlist Restoration** - Re-adding to watchlist triggers re-download of deleted content
- **Rules Engine** - Flexible cleanup rules based on watch status, age, ratings, and more
- **Media Repair** - Quality upgrades and Dolby Vision Profile 5 conversion
- **Multi-User Support** - Each user has their own watchlist and viewing history
- **Connected Services Management** - Configure and test services from the Settings page

## How It Works

```
User Watchlist → Auto-Download → Watch → Smart Cleanup → Re-watchlist Restores
```

1. User adds content to their Plex watchlist or Jellyfin favorites
2. Flexerr detects the addition and sends to Sonarr/Radarr
3. Content downloads automatically
4. User watches the content
5. Smart Episode Manager tracks watch progress and velocity
6. Cleanup rules add content to "Leaving Soon" collection (grace period)
7. If user re-adds to watchlist, content is restored
8. Otherwise, content is cleaned up to save storage

**Note:** Protected items bypass all cleanup rules regardless of other settings.

## Quick Start

### Requirements

- **Docker** and **Docker Compose**
- **Plex Media Server** with OAuth enabled OR **Jellyfin** server
- **Sonarr** (for TV shows)
- **Radarr** (for movies)
- **TMDB API Key** ([get one free](https://www.themoviedb.org/settings/api))

### Installation

1. Clone the repository:
```bash
git clone https://github.com/sybethiesant/flexerr.git
cd flexerr
```

2. Start Flexerr:
```bash
docker compose up -d
```

3. Open http://localhost:3100 in your browser

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
| `PORT` | Server port | `3100` |
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

## Smart Episode Manager

The Smart Episode Manager intelligently manages TV show episodes based on each user's watch progress and velocity.

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

- **User A** binges a show, watches S1-S4 in a week
- **User B** watches 1 episode per day
- After User A finishes S1, those episodes are NOT deleted yet
- Flexerr waits for User B to catch up
- When User B finishes S1, those episodes are cleaned up
- If User B suddenly speeds up, Flexerr detects the velocity change and ensures episodes are available

## Media Protection

Protect specific movies or TV shows from any deletion - a priority override for all cleanup rules.

### How to Protect Media

1. Navigate to any movie or TV show detail page
2. Click the **Shield** icon to toggle protection ON
3. Protected items display a shield badge

### Protection Behavior

- **Priority 1 Override** - Protected items are NEVER deleted by any rule
- **Bypasses Smart Cleanup** - Ignored by velocity-based episode management
- **Bypasses Rules Engine** - Ignored by all cleanup rules
- **Stats Visibility** - Protected items shown separately in cleanup stats
- **Persistent** - Protection remains until manually toggled off

## Rules Engine

Create custom cleanup rules for content that doesn't fit the smart cleanup model.

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

**Note:** Jellyfin uses Favorites as a watchlist equivalent since Jellyfin lacks native watchlist support.

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

### Downloads not starting

- Verify Sonarr/Radarr connection in Connected Services
- Check that the content has a TVDB/TMDB ID
- Ensure Sonarr/Radarr have root folders and quality profiles configured

### Smart cleanup not running

- Check Settings → Smart Episode Manager is enabled
- Verify the cleanup schedule is set
- Check Media Server Sync is enabled and running

### Content deleted too soon

- Increase "Days Buffer" in Smart Episode Manager
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
│       ├── smart-episodes.js # Smart cleanup
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

- **Issues**: [GitHub Issues](https://github.com/sybethiesant/flexerr/issues)
- **Discussions**: [GitHub Discussions](https://github.com/sybethiesant/flexerr/discussions)
