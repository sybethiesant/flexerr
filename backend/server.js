require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const https = require('https');

// Shared HTTPS agent for image proxy endpoints (allows self-signed certs)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const {
  db,
  getSetting,
  setSetting,
  getAllSettings,
  log,
  getUserById,
  getMediaServerByType,
  recordJellyfinWatchEvent,
  calculateJellyfinVelocity,
  getJellyfinRecentStartEvent
} = require('./database');
const AuthService = require('./services/auth');
const TMDBService = require('./services/tmdb');
const WatchlistTriggerService = require('./services/watchlist-trigger');
const PlexService = require('./services/plex');
const SonarrService = require('./services/sonarr');
const RadarrService = require('./services/radarr');
const RulesEngine = require('./services/rules-engine');
const scheduler = require('./services/scheduler');
const NotificationService = require('./services/notifications');
const Viper = require('./services/smart-episodes');
const DebugLogger = require('./services/debug-logger');

const app = express();
const PORT = process.env.PORT || 5505;
const JWT_SECRET = process.env.JWT_SECRET || 'flexerr-secret-change-me';

// Track running rules for async execution
const runningRules = new Map(); // ruleId -> { status, startedAt, results, error }

// Security warning for default JWT secret
if (!process.env.JWT_SECRET) {
  console.warn('[SECURITY] Warning: Using default JWT secret. Set JWT_SECRET environment variable in production!');
}

// Middleware
// CORS configuration - allow same-origin and configured origins
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, non-browser clients, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }

    // Allow configured origins via CORS_ORIGIN env var
    if (process.env.CORS_ORIGIN) {
      const allowedOrigins = process.env.CORS_ORIGIN.split(',').map(o => o.trim());
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
    }

    // In development, allow all origins
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    // In production, allow common same-domain patterns
    // This handles reverse proxy setups where Origin header is present
    const allowedPatterns = [
      /^https?:\/\/localhost(:\d+)?$/,
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
      /^https?:\/\/flexerr\./,  // Allow flexerr.* subdomains
    ];

    if (allowedPatterns.some(pattern => pattern.test(origin))) {
      return callback(null, true);
    }

    // Default: allow (safer for SPA with reverse proxy)
    callback(null, true);
  },
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Trust proxy (needed for rate limiting behind Cloudflare/nginx)
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200 // Increased for multi-user
});
app.use('/api/', limiter);

// Serve static files from frontend build
app.use(express.static(path.join(__dirname, '../frontend/build')));

// =========================
// AUTH MIDDLEWARE
// =========================

// Authenticate user via JWT
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const validation = AuthService.validateAccessToken(token);
  if (!validation.success) {
    return res.status(401).json({ error: validation.error, expired: validation.expired });
  }

  req.user = validation.user;
  next();
};

// Require admin privileges
const requireAdmin = (req, res, next) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Optional auth (for setup wizard and public endpoints)
const optionalAuth = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (token) {
    const validation = AuthService.validateAccessToken(token);
    if (validation.success) {
      req.user = validation.user;
    }
  }

  next();
};

// =========================
// SETUP & AUTH ROUTES
// =========================

// Check if setup is complete
app.get('/api/setup/status', (req, res) => {
  const setupComplete = getSetting('setup_complete') === 'true';
  const hasUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count > 0;
  const hasTmdbKey = !!getSetting('tmdb_api_key');
  res.json({ setupComplete, hasUsers, hasTmdbKey });
});

// Complete setup (first-time only) - supports Plex and Jellyfin
app.post('/api/setup/complete', async (req, res) => {
  const { serverType, plexToken, plexUrl, jellyfinUrl, jellyfinToken, jellyfinUserId, jellyfinUsername, services, tmdbApiKey } = req.body;

  // Check if already set up
  const existingUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (existingUsers.count > 0) {
    return res.status(400).json({ error: 'Setup already completed' });
  }

  // Validate based on server type
  const effectiveServerType = serverType || 'plex';

  if (effectiveServerType === 'jellyfin') {
    if (!jellyfinUrl || !jellyfinToken || !jellyfinUserId) {
      return res.status(400).json({ error: 'Jellyfin URL, token, and user ID required' });
    }
  } else {
    if (!plexToken || !plexUrl) {
      return res.status(400).json({ error: 'Plex token and URL required' });
    }
  }

  try {
    // Set custom TMDB API key if provided, otherwise use default
    if (tmdbApiKey) {
      setSetting('tmdb_api_key', tmdbApiKey);
      TMDBService.refreshApiKey();
    }

    let authResult;

    if (effectiveServerType === 'jellyfin') {
      // Create media server entry for Jellyfin
      const { createOrUpdateUserGeneric, createMediaServer } = require('./database');

      const mediaServer = createMediaServer({
        type: 'jellyfin',
        name: 'Jellyfin',
        url: jellyfinUrl,
        admin_user_id: jellyfinUserId,
        admin_token: jellyfinToken,
        is_primary: true
      });

      // Create admin user
      const user = createOrUpdateUserGeneric({
        server_user_id: jellyfinUserId,
        server_token: jellyfinToken,
        username: jellyfinUsername,
        is_admin: true,
        is_owner: true,
        media_server_type: 'jellyfin',
        media_server_id: mediaServer.id
      });

      // Generate tokens
      authResult = {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          is_admin: true,
          is_owner: true
        },
        ...AuthService.generateTokensForMediaServer(user, 'jellyfin')
      };
    } else {
      // Create media server entry for Plex
      const { createMediaServer } = require('./database');

      const mediaServer = createMediaServer({
        type: 'plex',
        name: 'Plex',
        url: plexUrl,
        api_key: plexToken,
        is_primary: true
      });

      // Create first user via Plex auth (existing flow)
      authResult = await AuthService.setupFirstUser(plexToken, plexUrl);
      if (!authResult.success) {
        return res.status(400).json({ error: authResult.error });
      }

      // Update the user to link to media server
      const { getUserById } = require('./database');
      const user = getUserById(authResult.user.id);
      if (user && !user.media_server_id) {
        db.prepare(`
          UPDATE users SET media_server_type = 'plex', media_server_id = ?
          WHERE id = ?
        `).run(mediaServer.id, user.id);
      }

      // Add Plex service (legacy compatibility)
      db.prepare(`
        INSERT INTO services (type, name, url, api_key, is_default, is_active)
        VALUES ('plex', 'Plex', ?, ?, 1, 1)
      `).run(plexUrl, plexToken);
    }

    // Add additional services (Sonarr, Radarr)
    if (services && Array.isArray(services)) {
      for (const svc of services) {
        if (svc.url && svc.type !== 'plex' && svc.type !== 'jellyfin') {
          db.prepare(`
            INSERT INTO services (type, name, url, api_key, is_default, is_active)
            VALUES (?, ?, ?, ?, 1, 1)
          `).run(svc.type, svc.name || svc.type, svc.url, svc.api_key || '');
        }
      }
    }

    // Mark setup as complete
    setSetting('setup_complete', 'true');
    setSetting('media_server_type', effectiveServerType);

    log('info', 'system', 'Setup completed', {
      username: authResult.user.username,
      serverType: effectiveServerType
    });

    // Start the scheduler
    scheduler.start().catch(err => {
      log('error', 'system', 'Failed to start scheduler', { error: err.message });
    });

    res.json({
      success: true,
      user: authResult.user,
      accessToken: authResult.accessToken,
      refreshToken: authResult.refreshToken
    });
  } catch (err) {
    console.error('Setup failed:', err);
    res.status(500).json({ error: 'Setup failed: ' + err.message });
  }
});

// =====================================================
// JELLYFIN API ENDPOINTS
// =====================================================

// Test Jellyfin server connection (no auth required)
app.post('/api/jellyfin/test', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: 'Server URL required' });
  }

  try {
    const cleanUrl = url.replace(/\/$/, '');
    const response = await axios.get(cleanUrl + '/System/Info/Public', {
      timeout: 10000
    });

    res.json({
      success: true,
      name: response.data.ServerName,
      version: response.data.Version,
      id: response.data.Id
    });
  } catch (error) {
    console.error('[Jellyfin] Connection test failed:', error.message);
    res.json({
      success: false,
      error: error.code === 'ECONNREFUSED' ? 'Could not connect to server' :
             error.code === 'ENOTFOUND' ? 'Server not found' :
             error.message
    });
  }
});

// Authenticate with Jellyfin
app.post('/api/jellyfin/auth', async (req, res) => {
  const { url, username, password } = req.body;

  if (!url || !username || !password) {
    return res.status(400).json({ success: false, error: 'URL, username and password required' });
  }

  try {
    const result = await AuthService.authenticateJellyfin(url, username, password);
    res.json(result);
  } catch (error) {
    console.error('[Jellyfin] Auth failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Jellyfin Webhook - receives playback events for velocity tracking
app.post('/api/jellyfin/webhook', async (req, res) => {
  try {
    const event = req.body;

    // Early validation of event structure
    if (!event || typeof event !== 'object') {
      console.warn('[Jellyfin Webhook] Invalid event: not an object');
      return res.status(400).json({ success: false, error: 'Invalid event data' });
    }

    const eventType = event.Event || event.NotificationType;
    console.log(`[Jellyfin Webhook] Received event: ${eventType}`);

    // Validate event has required fields
    if (!eventType) {
      console.warn('[Jellyfin Webhook] Missing event type');
      return res.status(400).json({ success: false, error: 'Missing event type' });
    }

    if (!event.Item || event.Item.Type !== 'Episode') {
      // Silently ignore non-episode events (movies, music, etc.)
      return res.json({ success: true, message: 'Event ignored (not an episode)' });
    }

    // Validate required user fields
    const userId = event.User?.Id || event.UserId;
    const userName = event.User?.Name || event.Username;

    if (!userId) {
      console.error('[Jellyfin Webhook] Missing user ID in event');
      return res.status(400).json({ success: false, error: 'Missing user ID' });
    }

    // Validate required item fields
    const item = event.Item;
    if (!item.SeriesId || !item.Id) {
      console.error('[Jellyfin Webhook] Missing required item fields (SeriesId or Id)');
      return res.status(400).json({ success: false, error: 'Missing required item fields' });
    }

    const seriesId = item.SeriesId;
    const seriesName = item.SeriesName || 'Unknown Series';
    const seasonNumber = item.ParentIndexNumber || item.SeasonNumber || 0;
    const episodeNumber = item.IndexNumber || item.EpisodeNumber || 0;
    const episodeId = item.Id;
    const episodeName = item.Name || `Episode ${episodeNumber}`;

    // Get Jellyfin server configuration
    const jellyfinServer = getMediaServerByType('jellyfin');
    if (!jellyfinServer) {
      console.warn('[Jellyfin Webhook] No Jellyfin server configured - event will be recorded without media_server_id');
    }
    const mediaServerId = jellyfinServer?.id || null;

    // Get configurable settings with fallbacks
    const completionThreshold = parseFloat(getSetting('jellyfin_completion_percentage') || '90');

    // Handle different event types
    if (eventType === 'playback.start' || eventType === 'PlaybackStart') {
      // User started watching
      try {
        recordJellyfinWatchEvent({
          user_id: userId,
          user_name: userName,
          series_id: seriesId,
          series_name: seriesName,
          season_number: seasonNumber,
          episode_number: episodeNumber,
          episode_id: episodeId,
          episode_name: episodeName,
          event_type: 'start',
          session_id: event.PlaybackInfo?.PlaySessionId || event.SessionId || null,
          device_name: event.PlaybackInfo?.DeviceName || event.DeviceName || null,
          media_server_id: mediaServerId,
          timestamp: event.Timestamp || new Date().toISOString()
        });

        console.log(`[Jellyfin] User ${userName} started watching ${seriesName} S${seasonNumber}E${episodeNumber}`);
      } catch (dbError) {
        console.error('[Jellyfin Webhook] Database error recording start event:', dbError);
        throw dbError;
      }
    }
    else if (eventType === 'playback.stop' || eventType === 'PlaybackStop') {
      // User stopped watching
      // CRITICAL FIX: Don't default to 0 if PlaybackInfo is missing - use null instead
      const positionTicks = event.PlaybackInfo?.PositionTicks || null;
      const playedPercentage = event.PlaybackInfo?.PlayedPercentage !== undefined
        ? event.PlaybackInfo.PlayedPercentage
        : null;

      // Calculate watch duration by finding matching start event
      let watchDuration = null;
      const sessionId = event.PlaybackInfo?.PlaySessionId || event.SessionId || null;

      try {
        const startEvent = getJellyfinRecentStartEvent(userId, episodeId, sessionId, mediaServerId);
        if (startEvent && startEvent.timestamp) {
          const startTime = new Date(startEvent.timestamp);
          const stopTime = new Date(event.Timestamp || new Date().toISOString());
          const durationMs = stopTime - startTime;

          // Only set duration if it's positive and reasonable (< 24 hours)
          if (durationMs > 0 && durationMs < 24 * 60 * 60 * 1000) {
            watchDuration = Math.floor(durationMs / 1000); // Convert to seconds
          }
        }
      } catch (durationError) {
        console.warn('[Jellyfin Webhook] Could not calculate watch duration:', durationError.message);
        // Continue without duration - not critical
      }

      // Determine if episode was completed
      // If no PlaybackInfo, we can't determine completion - mark as "stop" only
      const completed = playedPercentage !== null && playedPercentage > completionThreshold;

      try {
        recordJellyfinWatchEvent({
          user_id: userId,
          user_name: userName,
          series_id: seriesId,
          series_name: seriesName,
          season_number: seasonNumber,
          episode_number: episodeNumber,
          episode_id: episodeId,
          episode_name: episodeName,
          event_type: completed ? 'complete' : 'stop',
          position_ticks: positionTicks,
          played_percentage: playedPercentage,
          watch_duration_seconds: watchDuration,
          session_id: event.PlaybackInfo?.PlaySessionId || event.SessionId || null,
          device_name: event.PlaybackInfo?.DeviceName || event.DeviceName || null,
          media_server_id: mediaServerId,
          timestamp: event.Timestamp || new Date().toISOString()
        });

        if (completed) {
          // Recalculate velocity when episode completed
          try {
            const velocityData = calculateJellyfinVelocity(userId, seriesId, mediaServerId);

            if (velocityData) {
              console.log(`[Jellyfin] User ${userName} completed ${seriesName} S${seasonNumber}E${episodeNumber}`);
              console.log(`[Jellyfin] Updated velocity: ${velocityData.velocity.toFixed(2)} episodes/day (${velocityData.episodesWatched} episodes watched)`);
            } else {
              console.log(`[Jellyfin] User ${userName} completed ${seriesName} S${seasonNumber}E${episodeNumber} (not enough data for velocity yet)`);
            }
          } catch (velocityError) {
            console.error('[Jellyfin Webhook] Error calculating velocity:', velocityError);
            // Don't fail the webhook - velocity calculation is not critical
          }
        } else if (playedPercentage !== null) {
          console.log(`[Jellyfin] User ${userName} stopped watching ${seriesName} S${seasonNumber}E${episodeNumber} at ${playedPercentage.toFixed(1)}%`);
        } else {
          console.log(`[Jellyfin] User ${userName} stopped watching ${seriesName} S${seasonNumber}E${episodeNumber} (no progress data)`);
        }
      } catch (dbError) {
        console.error('[Jellyfin Webhook] Database error recording stop event:', dbError);
        throw dbError;
      }
    }
    else if (eventType === 'item.markplayed' || eventType === 'ItemMarkPlayed') {
      // Episode manually marked as played
      try {
        recordJellyfinWatchEvent({
          user_id: userId,
          user_name: userName,
          series_id: seriesId,
          series_name: seriesName,
          season_number: seasonNumber,
          episode_number: episodeNumber,
          episode_id: episodeId,
          episode_name: episodeName,
          event_type: 'complete',
          played_percentage: 100,
          media_server_id: mediaServerId,
          timestamp: event.Timestamp || new Date().toISOString()
        });

        // Recalculate velocity
        try {
          const velocityData = calculateJellyfinVelocity(userId, seriesId, mediaServerId);

          if (velocityData) {
            console.log(`[Jellyfin] User ${userName} marked ${seriesName} S${seasonNumber}E${episodeNumber} as played`);
            console.log(`[Jellyfin] Updated velocity: ${velocityData.velocity.toFixed(2)} episodes/day`);
          }
        } catch (velocityError) {
          console.error('[Jellyfin Webhook] Error calculating velocity:', velocityError);
          // Don't fail the webhook
        }
      } catch (dbError) {
        console.error('[Jellyfin Webhook] Database error recording markplayed event:', dbError);
        throw dbError;
      }
    }

    res.json({ success: true, event: eventType });
  } catch (error) {
    console.error('[Jellyfin Webhook] Error processing event:', error);
    console.error('[Jellyfin Webhook] Event data:', JSON.stringify(req.body, null, 2));
    res.status(500).json({ success: false, error: error.message });
  }
});

// Plex OAuth: Create auth PIN
app.post('/api/auth/plex/start', async (req, res) => {
  try {
    const pin = await AuthService.createAuthPin();
    res.json(pin);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Plex OAuth: Check PIN and complete login
app.get('/api/auth/plex/callback/:id', async (req, res) => {
  try {
    const pinResult = await AuthService.checkAuthPin(req.params.id);
    if (!pinResult.success || !pinResult.token) {
      return res.json({ success: false });
    }

    // Check if we're in setup mode (no Plex configured yet)
    const plexService = db.prepare("SELECT id FROM services WHERE type = 'plex' AND is_active = 1 LIMIT 1").get();

    if (!plexService) {
      // Setup mode - return the Plex token for setup flow
      return res.json({
        success: true,
        plexToken: pinResult.token
      });
    }

    // Check if user exists before login (to detect new users)
    const existingUserCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

    // Normal login - complete the full flow
    const loginResult = await AuthService.login(pinResult.token);
    if (!loginResult.success && loginResult.invited) {
      return res.json({ success: false, invited: true, message: loginResult.error });
    }
    if (!loginResult.success) {
      return res.status(401).json({ error: loginResult.error });
    }

    // Check if this is a new user (user count increased)
    const newUserCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (newUserCount > existingUserCount && loginResult.user) {
      // New user joined - send notification
      try {
        await NotificationService.notifyUserJoined({
          username: loginResult.user.username,
          media_server_type: 'plex'
        });
      } catch (notifyErr) {
        console.warn('[Auth] Failed to send new user notification:', notifyErr.message);
      }
    }

    res.json({
      success: true,
      plexToken: pinResult.token,
      user: loginResult.user,
      accessToken: loginResult.accessToken,
      refreshToken: loginResult.refreshToken,
      warning: loginResult.warning || null,
      needsServerAccess: loginResult.needsServerAccess || false
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Refresh access token
app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  const result = await AuthService.refreshAccessToken(refreshToken);
  if (!result.success) {
    return res.status(401).json({ error: result.error });
  }

  res.json({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    user: result.user
  });
});

// Logout
app.post('/api/auth/logout', authenticate, (req, res) => {
  const { refreshToken } = req.body;
  AuthService.logout(refreshToken);
  res.json({ success: true });
});

// Get current user
app.get('/api/auth/me', authenticate, (req, res) => {
  const user = AuthService.getCurrentUser(req.user.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(user);
});

// =========================
// DISCOVERY/TMDB ROUTES
// =========================

// Search movies and TV
app.get('/api/discover/search', authenticate, async (req, res) => {
  try {
    const { q, page = 1 } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query required' });
    }
    const results = await TMDBService.searchMulti(q, parseInt(page));
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get trending content
app.get('/api/discover/trending', authenticate, async (req, res) => {
  try {
    const { type = 'all', timeWindow = 'week', page = 1 } = req.query;
    const results = await TMDBService.getTrending(type, timeWindow, parseInt(page));
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get popular content
app.get('/api/discover/popular', authenticate, async (req, res) => {
  try {
    const { type = 'movie', page = 1 } = req.query;
    const results = await TMDBService.getPopular(type, parseInt(page));
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get top rated content
app.get('/api/discover/top-rated', authenticate, async (req, res) => {
  try {
    const { type = 'movie', page = 1 } = req.query;
    const results = await TMDBService.getTopRated(type, parseInt(page));
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get upcoming movies
app.get('/api/discover/upcoming', authenticate, async (req, res) => {
  try {
    const { page = 1 } = req.query;
    const results = await TMDBService.getUpcoming(parseInt(page));
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get movie details
app.get('/api/discover/movie/:id', authenticate, async (req, res) => {
  try {
    const movie = await TMDBService.getMovie(req.params.id);

    // Check if on user's watchlist
    const watchlistItem = db.prepare(`
      SELECT * FROM watchlist WHERE user_id = ? AND tmdb_id = ? AND media_type = 'movie' AND is_active = 1
    `).get(req.user.userId, req.params.id);

    // Check request status
    const request = WatchlistTriggerService.getRequest(parseInt(req.params.id), 'movie');

    res.json({
      ...movie,
      onWatchlist: !!watchlistItem,
      request: request || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get TV show details
app.get('/api/discover/tv/:id', authenticate, async (req, res) => {
  try {
    const show = await TMDBService.getTVShow(req.params.id);

    // Check if on user's watchlist
    const watchlistItem = db.prepare(`
      SELECT * FROM watchlist WHERE user_id = ? AND tmdb_id = ? AND media_type = 'tv' AND is_active = 1
    `).get(req.user.userId, req.params.id);

    // Check request status
    const request = WatchlistTriggerService.getRequest(parseInt(req.params.id), 'tv');

    res.json({
      ...show,
      onWatchlist: !!watchlistItem,
      request: request || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get TV season details
app.get('/api/discover/tv/:id/season/:season', authenticate, async (req, res) => {
  try {
    const season = await TMDBService.getTVSeason(req.params.id, req.params.season);
    res.json(season);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get genres
app.get('/api/discover/genres', authenticate, async (req, res) => {
  try {
    const { type = 'movie' } = req.query;
    const genres = await TMDBService.getGenres(type);
    res.json(genres);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Default provider IDs for discover filter
const DEFAULT_DISCOVER_PROVIDERS = [9, 1956, 350, 283, 337, 15, 1899, 8, 2303, 386];

// Get enabled providers for discover filter (accessible by all users)
app.get('/api/discover/enabled-providers', authenticate, (req, res) => {
  try {
    const setting = getSetting('discover_providers');
    let providerIds = DEFAULT_DISCOVER_PROVIDERS;

    if (setting) {
      try {
        providerIds = JSON.parse(setting);
      } catch (e) {
        // Use defaults if parsing fails
      }
    }

    res.json({ providerIds });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get streaming providers (Netflix, Disney+, etc.) - powered by JustWatch
app.get('/api/discover/providers', authenticate, async (req, res) => {
  try {
    const { type = 'movie', region = 'US' } = req.query;
    const providers = await TMDBService.getWatchProviders(type, region);
    res.json({
      region,
      providers,
      attribution: 'Streaming availability powered by JustWatch'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get available regions for provider filtering
app.get('/api/discover/regions', authenticate, async (req, res) => {
  try {
    const regions = await TMDBService.getWatchProviderRegions();
    res.json(regions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Advanced discover with filters (providers, genres, year, rating, etc.)
app.get('/api/discover', authenticate, async (req, res) => {
  try {
    const {
      type = 'movie',
      page = 1,
      providers,
      genres,
      year_min,
      year_max,
      rating_min,
      rating_max,
      runtime_min,
      runtime_max,
      sort = 'popularity.desc',
      region = 'US'
    } = req.query;

    const results = await TMDBService.discoverWithFilters(type, {
      page: parseInt(page),
      providers,
      genres,
      yearMin: year_min ? parseInt(year_min) : undefined,
      yearMax: year_max ? parseInt(year_max) : undefined,
      ratingMin: rating_min ? parseFloat(rating_min) : undefined,
      ratingMax: rating_max ? parseFloat(rating_max) : undefined,
      runtimeMin: runtime_min ? parseInt(runtime_min) : undefined,
      runtimeMax: runtime_max ? parseInt(runtime_max) : undefined,
      sortBy: sort,
      region
    });

    res.json({
      ...results,
      attribution: 'Streaming availability powered by JustWatch'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get watch providers for a specific movie/TV show
app.get('/api/discover/:type/:id/providers', authenticate, async (req, res) => {
  try {
    const { type, id } = req.params;
    const { region = 'US' } = req.query;

    if (!['movie', 'tv'].includes(type)) {
      return res.status(400).json({ error: 'Type must be movie or tv' });
    }

    const providers = await TMDBService.getItemWatchProviders(id, type, region);
    res.json({
      id: parseInt(id),
      type,
      region,
      providers,
      attribution: 'Streaming availability powered by JustWatch'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================
// PLEX WATCH URL ROUTES
// =========================

// Get Plex server info for building watch URLs
app.get('/api/plex/info', authenticate, async (req, res) => {
  try {
    const plex = PlexService.fromDb();
    if (!plex) {
      return res.status(404).json({ error: 'Plex not configured' });
    }

    const machineId = await plex.getMachineId();
    res.json({
      machineIdentifier: machineId,
      serverUrl: plex.url
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Plex watch URL for a given TMDB ID
app.get('/api/plex/watch-url/:tmdbId/:mediaType', authenticate, async (req, res) => {
  try {
    const { tmdbId, mediaType } = req.params;
    const { season, episode } = req.query;

    console.log(`[Plex Watch URL] Looking for ${mediaType} with TMDB ID ${tmdbId}`);

    const plex = PlexService.fromDb();
    if (!plex) {
      console.log('[Plex Watch URL] Plex not configured');
      return res.status(404).json({ error: 'Plex not configured' });
    }

    // Get TMDB details to find in Plex
    const details = mediaType === 'movie'
      ? await TMDBService.getMovie(tmdbId)
      : await TMDBService.getTVShow(tmdbId);

    console.log(`[Plex Watch URL] TMDB title: "${details.title}", year: ${details.year}`);

    // Search Plex library for the item
    const libraries = await plex.getLibraries();
    let plexItem = null;

    for (const lib of libraries) {
      if ((mediaType === 'movie' && lib.type === 'movie') ||
          (mediaType === 'tv' && lib.type === 'show')) {
        console.log(`[Plex Watch URL] Searching library: ${lib.title} (${lib.type})`);
        const contents = await plex.getLibraryContents(lib.id);
        console.log(`[Plex Watch URL] Library has ${contents.length} items`);

        // Try to match by TMDB ID in GUID first (more reliable)
        let match = contents.find(c => {
          const guidMatch = c.guid?.includes(`tmdb://${tmdbId}`) ||
            c.Guid?.some(g => g.id === `tmdb://${tmdbId}`);
          return guidMatch;
        });

        if (match) {
          console.log(`[Plex Watch URL] Found by GUID match: "${match.title}"`);
        }

        // Fall back to title and year match
        if (!match) {
          match = contents.find(c =>
            c.title?.toLowerCase() === details.title?.toLowerCase() &&
            (!details.year || c.year === details.year)
          );
          if (match) {
            console.log(`[Plex Watch URL] Found by exact title match: "${match.title}"`);
          }
        }

        // Also try partial title match if exact match fails
        if (!match && details.title) {
          match = contents.find(c =>
            c.title?.toLowerCase().includes(details.title.toLowerCase()) &&
            (!details.year || c.year === details.year)
          );
          if (match) {
            console.log(`[Plex Watch URL] Found by partial title match: "${match.title}"`);
          }
        }

        if (match) {
          plexItem = match;
          break;
        }
      }
    }

    if (!plexItem) {
      console.log(`[Plex Watch URL] NOT FOUND: "${details.title}" (${details.year})`);
      return res.status(404).json({ error: 'Item not found in Plex', searched: details.title });
    }

    // If specific episode requested, find it
    let targetRatingKey = plexItem.ratingKey;
    if (mediaType === 'tv' && season && episode) {
      const seasons = await plex.getItemChildren(plexItem.ratingKey);
      const targetSeason = seasons.find(s => s.index === parseInt(season));
      if (targetSeason) {
        const episodes = await plex.getItemChildren(targetSeason.ratingKey);
        const targetEpisode = episodes.find(e => e.index === parseInt(episode));
        if (targetEpisode) {
          targetRatingKey = targetEpisode.ratingKey;
        }
      }
    } else if (mediaType === 'tv' && season) {
      // Season only
      const seasons = await plex.getItemChildren(plexItem.ratingKey);
      const targetSeason = seasons.find(s => s.index === parseInt(season));
      if (targetSeason) {
        targetRatingKey = targetSeason.ratingKey;
      }
    }

    const machineId = await plex.getMachineId();
    const watchUrl = `https://app.plex.tv/desktop/#!/server/${machineId}/details?key=%2Flibrary%2Fmetadata%2F${targetRatingKey}`;

    res.json({
      watchUrl,
      ratingKey: targetRatingKey,
      machineIdentifier: machineId,
      title: plexItem.title,
      year: plexItem.year
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Plex episodes for a TV show (with watch status)
app.get('/api/plex/episodes/:tmdbId', authenticate, async (req, res) => {
  try {
    const { tmdbId } = req.params;
    const { season } = req.query;

    const plex = PlexService.fromDb();
    if (!plex) {
      return res.status(404).json({ error: 'Plex not configured' });
    }

    // Get TMDB details to find in Plex
    const details = await TMDBService.getTVShow(tmdbId);

    // Search Plex library for the show
    const libraries = await plex.getLibraries();
    let plexShow = null;

    for (const lib of libraries) {
      if (lib.type === 'show') {
        const contents = await plex.getLibraryContents(lib.id);
        const match = contents.find(c =>
          c.title?.toLowerCase() === details.title?.toLowerCase() &&
          (!details.year || c.year === details.year)
        );
        if (match) {
          plexShow = match;
          break;
        }
      }
    }

    if (!plexShow) {
      return res.status(404).json({ error: 'Show not found in Plex' });
    }

    const machineId = await plex.getMachineId();
    const seasons = await plex.getItemChildren(plexShow.ratingKey);

    const result = {
      showRatingKey: plexShow.ratingKey,
      machineIdentifier: machineId,
      seasons: []
    };

    for (const s of seasons) {
      if (season && s.index !== parseInt(season)) continue;

      const episodes = await plex.getItemChildren(s.ratingKey);

      // Fetch TMDB season data for fallback episode stills
      let tmdbEpisodes = [];
      try {
        const tmdbSeason = await TMDBService.getTVSeason(tmdbId, s.index);
        tmdbEpisodes = tmdbSeason.episodes || [];
      } catch (e) {
        // TMDB lookup failed, continue without fallback images
      }

      const seasonData = {
        seasonNumber: s.index,
        ratingKey: s.ratingKey,
        title: s.title,
        thumb: s.thumb ? `${plex.url}${s.thumb}?X-Plex-Token=${plex.token}` : null,
        episodes: episodes.map(ep => {
          // Find matching TMDB episode for fallback still
          const tmdbEp = tmdbEpisodes.find(te => te.episode_number === ep.index);
          const plexThumb = ep.thumb ? `${plex.url}${ep.thumb}?X-Plex-Token=${plex.token}` : null;

          return {
            episodeNumber: ep.index,
            ratingKey: ep.ratingKey,
            title: ep.title,
            summary: ep.summary,
            // Prefer TMDB still (CDN accessible) over Plex thumb (local IP)
            thumb: tmdbEp?.still_path || plexThumb || null,
            duration: ep.duration,
            viewCount: ep.viewCount || 0,
            viewOffset: ep.viewOffset || 0,
            lastViewedAt: ep.lastViewedAt ? new Date(ep.lastViewedAt * 1000) : null,
            watchUrl: `https://app.plex.tv/desktop/#!/server/${machineId}/details?key=%2Flibrary%2Fmetadata%2F${ep.ratingKey}`
          };
        })
      };
      result.seasons.push(seasonData);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================
// WATCHLIST ROUTES
// =========================

// Get user's watchlist
app.get('/api/watchlist', authenticate, (req, res) => {
  const items = WatchlistTriggerService.getWatchlist(req.user.userId);
  res.json(items);
});

// Add to watchlist (triggers download)
app.post('/api/watchlist', authenticate, async (req, res) => {
  try {
    const { tmdbId, mediaType } = req.body;

    if (!tmdbId || !mediaType) {
      return res.status(400).json({ error: 'tmdbId and mediaType required' });
    }

    const result = await WatchlistTriggerService.addToWatchlist(req.user.userId, tmdbId, mediaType);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('[API] Add to watchlist error:', error);
    res.status(500).json({ error: 'Failed to add to watchlist' });
  }
});

// Remove from watchlist
app.delete('/api/watchlist/:tmdbId/:mediaType', authenticate, async (req, res) => {
  try {
    const { tmdbId, mediaType } = req.params;

    const result = await WatchlistTriggerService.removeFromWatchlist(
      req.user.userId,
      parseInt(tmdbId),
      mediaType
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('[API] Remove from watchlist error:', error);
    res.status(500).json({ error: 'Failed to remove from watchlist' });
  }
});

// Sync Plex watchlist
app.post('/api/watchlist/sync', authenticate, async (req, res) => {
  try {
    // Get user's Plex token
    const user = db.prepare('SELECT plex_token FROM users WHERE id = ?').get(req.user.userId);
    if (!user?.plex_token) {
      return res.status(400).json({ error: 'Plex token not found. Please re-authenticate.' });
    }

    const result = await WatchlistTriggerService.syncPlexWatchlist(req.user.userId, user.plex_token);
    res.json(result);
  } catch (error) {
    console.error('[API] Watchlist sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Debug: Test Plex watchlist fetch directly (Admin only - exposes tokens)
app.get('/api/watchlist/debug', authenticate, requireAdmin, async (req, res) => {
  try {
    const user = db.prepare('SELECT plex_token FROM users WHERE id = ?').get(req.user.userId);
    if (!user?.plex_token) {
      return res.status(400).json({ error: 'Plex token not found' });
    }

    const plex = new PlexService('https://plex.tv', user.plex_token);

    // Test getting user info first
    let userInfo = null;
    try {
      const userRes = await axios.get('https://plex.tv/api/v2/user', {
        headers: {
          'X-Plex-Token': user.plex_token,
          'X-Plex-Client-Identifier': 'flexerr-media-manager',
          'Accept': 'application/json'
        }
      });
      userInfo = { id: userRes.data.id, username: userRes.data.username, email: userRes.data.email };
    } catch (e) {
      userInfo = { error: e.message };
    }

    // Test watchlist
    const watchlist = await plex.getWatchlist();

    res.json({
      plexUser: userInfo,
      watchlistCount: watchlist.length,
      watchlistItems: watchlist.slice(0, 5).map(w => ({
        title: w.title,
        year: w.year,
        type: w.type,
        ratingKey: w.ratingKey
      })),
      tokenPrefix: user.plex_token.substring(0, 10) + '...'
    });
  } catch (error) {
    console.error('[API] Watchlist debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =========================
// REQUESTS ROUTES
// =========================

// Get requests (admin sees all, user sees their own)
app.get('/api/requests', authenticate, (req, res) => {
  const filters = req.user.isAdmin ? req.query : { ...req.query, user_id: req.user.userId };
  const requests = WatchlistTriggerService.getAllRequests(filters);
  res.json(requests);
});

// Get request status by TMDB ID (must be before /:id to avoid route conflict)
app.get('/api/requests/status/:tmdbId', authenticate, (req, res) => {
  const { tmdbId } = req.params;
  const { media_type } = req.query;

  // Validate required parameters
  if (!media_type || !['movie', 'tv'].includes(media_type)) {
    return res.status(400).json({ error: 'media_type query parameter required (movie or tv)' });
  }

  // Check if item is on user's watchlist
  const watchlistItem = db.prepare(`
    SELECT * FROM watchlist
    WHERE user_id = ? AND tmdb_id = ? AND media_type = ? AND is_active = 1
  `).get(req.user.userId, tmdbId, media_type);

  // Check for user's own request for this TMDB ID (or any if admin)
  let request;
  if (req.user.isAdmin) {
    request = db.prepare(`
      SELECT * FROM requests
      WHERE tmdb_id = ? AND media_type = ?
    `).get(tmdbId, media_type);
  } else {
    request = db.prepare(`
      SELECT * FROM requests
      WHERE tmdb_id = ? AND media_type = ? AND user_id = ?
    `).get(tmdbId, media_type, req.user.userId);
  }

  res.json({
    status: request?.status || null,
    on_watchlist: !!watchlistItem,
    request_id: request?.id || null
  });
});

// Get single request
app.get('/api/requests/:id', authenticate, (req, res) => {
  const request = db.prepare('SELECT r.*, u.username as requested_by FROM requests r JOIN users u ON r.user_id = u.id WHERE r.id = ?').get(req.params.id);

  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }

  // Non-admins can only see their own requests
  if (!req.user.isAdmin && request.user_id !== req.user.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json(request);
});

// =========================
// SETTINGS ROUTES (Admin Only)
// =========================

// Get all settings
app.get('/api/settings', authenticate, requireAdmin, (req, res) => {
  const settings = getAllSettings();
  res.json(settings);
});

// Update settings
app.put('/api/settings', authenticate, requireAdmin, (req, res) => {
  const updates = req.body;

  // Protect critical settings from being cleared accidentally
  const protectedSettings = ['tmdb_api_key'];
  for (const key of protectedSettings) {
    if (key in updates) {
      const value = updates[key];
      // Skip if empty, whitespace-only, or looks like a masked value
      if (!value ||
          (typeof value === 'string' && (!value.trim() || value.includes('••') || value === '********'))) {
        delete updates[key];
        console.log(`[Settings] Blocked clearing of protected setting: ${key}`);
      }
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    setSetting(key, value);
  }

  // Refresh TMDB API key if changed
  if (updates.tmdb_api_key) {
    TMDBService.refreshApiKey();
  }

  // Restart scheduler if schedule changed
  if (updates.schedule || updates.timezone) {
    scheduler.restart().catch(err => {
      log('error', 'system', 'Failed to restart scheduler', { error: err.message });
    });
  }

  // Refresh debug logger cache if debug level changed
  if (updates.debug_level !== undefined) {
    DebugLogger.refreshCache();
    console.log(`[Settings] Debug level changed to: ${DebugLogger.getLevelName(parseInt(updates.debug_level))}`);
  }

  log('info', 'system', 'Settings updated', { keys: Object.keys(updates), user_id: req.user.userId });
  res.json({ success: true });
});

// Get/Set debug level
app.get('/api/settings/debug', authenticate, requireAdmin, (req, res) => {
  const level = DebugLogger.getCurrentLevel();
  res.json({
    level,
    levelName: DebugLogger.getLevelName(level),
    levels: DebugLogger.LEVEL_NAMES.map((name, i) => ({ value: i, label: name }))
  });
});

app.put('/api/settings/debug', authenticate, requireAdmin, (req, res) => {
  const { level } = req.body;
  if (level === undefined || level < 0 || level > 3) {
    return res.status(400).json({ error: 'Invalid debug level (0-3)' });
  }
  setSetting('debug_level', level.toString());
  DebugLogger.refreshCache();
  console.log(`[Settings] Debug level set to: ${DebugLogger.getLevelName(level)} (${level})`);
  log('info', 'system', 'Debug level changed', { level, levelName: DebugLogger.getLevelName(level), user_id: req.user.userId });
  res.json({ success: true, level, levelName: DebugLogger.getLevelName(level) });
});

// Detect available GPU hardware for transcoding
app.get('/api/settings/detect-hardware', authenticate, requireAdmin, async (req, res) => {
  const { execSync } = require('child_process');
  const fs = require('fs');

  const hardware = {
    nvidia: { available: false, gpus: [] },
    vaapi: { available: false, devices: [] },
    recommended: { hwaccel: 'none', device: '', codec: 'hevc' }
  };

  // Check for NVIDIA GPU
  try {
    const nvidiaSmi = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', {
      encoding: 'utf8',
      timeout: 5000
    });
    const gpus = nvidiaSmi.trim().split('\n').filter(Boolean).map((line, idx) => {
      const [name, memory] = line.split(',').map(s => s.trim());
      return {
        id: idx,
        name,
        memory: `${memory} MB`,
        device: idx.toString()
      };
    });
    if (gpus.length > 0) {
      hardware.nvidia.available = true;
      hardware.nvidia.gpus = gpus;
      hardware.recommended = { hwaccel: 'nvenc', device: '0', codec: 'hevc' };
    }
  } catch (e) {
    // NVIDIA not available
  }

  // Check for VAAPI devices (AMD/Intel)
  try {
    const driPath = '/dev/dri';
    if (fs.existsSync(driPath)) {
      const files = fs.readdirSync(driPath);
      const renderDevices = files.filter(f => f.startsWith('renderD')).map(f => ({
        name: f,
        path: `${driPath}/${f}`
      }));
      if (renderDevices.length > 0) {
        hardware.vaapi.available = true;
        hardware.vaapi.devices = renderDevices;
        // Only recommend VAAPI if no NVIDIA
        if (!hardware.nvidia.available) {
          hardware.recommended = {
            hwaccel: 'vaapi',
            device: renderDevices[0].path,
            codec: 'hevc'
          };
        }
      }
    }
  } catch (e) {
    // VAAPI not available
  }

  res.json(hardware);
});

// Get Plex libraries for auto-invite settings
app.get('/api/settings/plex-libraries', authenticate, requireAdmin, async (req, res) => {
  try {
    const PlexService = require('./services/plex');
    const plex = PlexService.fromDb();

    if (!plex) {
      return res.status(400).json({ error: 'Plex is not configured' });
    }

    const libraries = await plex.getLibraries();
    res.json({
      libraries: libraries.map(lib => ({
        id: lib.id,
        title: lib.title,
        type: lib.type
      }))
    });
  } catch (err) {
    console.error('[Settings] Error getting Plex libraries:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get Plex invitations (for auto-invite tracking)
app.get('/api/settings/invitations', authenticate, requireAdmin, (req, res) => {
  try {
    const { getPlexInvitations } = require('./database');
    const invitations = getPlexInvitations(100);

    // Parse libraries_shared JSON for each invitation
    const parsed = invitations.map(inv => ({
      ...inv,
      libraries_shared: inv.libraries_shared ? JSON.parse(inv.libraries_shared) : null
    }));

    res.json(parsed);
  } catch (err) {
    console.error('[Settings] Error getting invitations:', err);
    res.status(500).json({ error: err.message });
  }
});

// =========================
// SERVICES ROUTES (Admin Only)
// =========================

// Get all services
app.get('/api/services', authenticate, requireAdmin, (req, res) => {
  const services = db.prepare('SELECT * FROM services ORDER BY type, is_default DESC').all();
  // Mask API keys
  const masked = services.map(s => ({
    ...s,
    api_key: s.api_key ? '••••••••' + s.api_key.slice(-4) : null
  }));
  res.json(masked);
});

// Add service
app.post('/api/services', authenticate, requireAdmin, async (req, res) => {
  const { type, name, url, api_key, is_default, settings } = req.body;

  if (!type || !name || !url) {
    return res.status(400).json({ error: 'Type, name, and URL are required' });
  }

  const existingCount = db.prepare('SELECT COUNT(*) as count FROM services WHERE type = ?').get(type).count;
  const makeDefault = is_default || existingCount === 0;

  if (makeDefault) {
    db.prepare('UPDATE services SET is_default = 0 WHERE type = ?').run(type);
  }

  const result = db.prepare(`
    INSERT INTO services (type, name, url, api_key, is_default, settings)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(type, name, url, api_key, makeDefault ? 1 : 0, JSON.stringify(settings || {}));

  log('info', 'system', 'Service added', { type, name, user_id: req.user.userId });
  res.json({ id: result.lastInsertRowid, success: true });
});

// Update service
app.put('/api/services/:id', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, url, api_key, is_default, is_active, settings } = req.body;

  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  if (!service) {
    return res.status(404).json({ error: 'Service not found' });
  }

  if (is_default) {
    db.prepare('UPDATE services SET is_default = 0 WHERE type = ?').run(service.type);
  }

  db.prepare(`
    UPDATE services SET
      name = COALESCE(?, name),
      url = COALESCE(?, url),
      api_key = COALESCE(?, api_key),
      is_default = COALESCE(?, is_default),
      is_active = COALESCE(?, is_active),
      settings = COALESCE(?, settings)
    WHERE id = ?
  `).run(name, url, api_key, is_default ? 1 : null, is_active, settings ? JSON.stringify(settings) : null, id);

  res.json({ success: true });
});

// Delete service
app.delete('/api/services/:id', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;
  const service = db.prepare('SELECT id FROM services WHERE id = ?').get(id);
  if (!service) {
    return res.status(404).json({ error: 'Service not found' });
  }
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
  log('info', 'system', 'Service deleted', { id, user_id: req.user.userId });
  res.json({ success: true });
});

// Test service connection
app.post('/api/services/:id/test', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;

  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  if (!service) {
    return res.status(404).json({ error: 'Service not found' });
  }

  let result;
  try {
    switch (service.type) {
      case 'plex':
        const plex = new PlexService(service.url, service.api_key);
        result = await plex.testConnection();
        break;
      case 'sonarr':
        const sonarr = new SonarrService(service.url, service.api_key);
        result = await sonarr.testConnection();
        break;
      case 'radarr':
        const radarr = new RadarrService(service.url, service.api_key);
        result = await radarr.testConnection();
        break;
      default:
        result = { success: false, error: 'Unknown service type' };
    }

    if (result.success) {
      db.prepare('UPDATE services SET last_connected = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    }
  } catch (error) {
    result = { success: false, error: error.message };
  }

  res.json(result);
});

// Test service connection (for setup wizard - before saving)
app.post('/api/services/test', optionalAuth, async (req, res) => {
  const { type, url, api_key } = req.body;

  let result;
  try {
    switch (type) {
      case 'plex':
        const plex = new PlexService(url, api_key);
        result = await plex.testConnection();
        break;
      case 'sonarr':
        const sonarr = new SonarrService(url, api_key);
        result = await sonarr.testConnection();
        break;
      case 'radarr':
        const radarr = new RadarrService(url, api_key);
        result = await radarr.testConnection();
        break;
      case 'tmdb':
        // Temporarily set API key for test
        const originalKey = getSetting('tmdb_api_key');
        setSetting('tmdb_api_key', api_key);
        TMDBService.refreshApiKey();
        result = await TMDBService.testConnection();
        // Restore original key if test was just a test
        if (originalKey) {
          setSetting('tmdb_api_key', originalKey);
          TMDBService.refreshApiKey();
        }
        break;
      default:
        result = { success: false, error: 'Unknown service type' };
    }
  } catch (error) {
    result = { success: false, error: error.message };
  }

  res.json(result);
});

// =========================
// PLEX ROUTES
// =========================

// Plex OAuth: Get user's servers after auth
app.get('/api/plex/servers', optionalAuth, async (req, res) => {
  try {
    const token = req.query.token || req.headers['x-plex-token'];
    if (!token) {
      return res.status(400).json({ error: 'Token required' });
    }
    const servers = await PlexService.getServers(token);
    res.json(servers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Plex libraries
app.get('/api/plex/libraries', authenticate, async (req, res) => {
  try {
    const plex = PlexService.fromDb();
    if (!plex) {
      return res.status(400).json({ error: 'Plex not configured' });
    }
    const libraries = await plex.getLibraries();
    res.json(libraries);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Promote all collections to Recommended tab
app.post('/api/plex/collections/promote-all', authenticate, requireAdmin, async (req, res) => {
  try {
    const plex = PlexService.fromDb();
    if (!plex) {
      return res.status(400).json({ error: 'Plex not configured' });
    }
    const results = await plex.promoteAllCollectionsToRecommended();
    res.json({
      success: true,
      promoted: results.promoted.length,
      failed: results.failed.length,
      details: results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Proxy Plex images for queue items (uses stored poster_url from database)
// No auth required - images served from Plex via server-side token
app.get('/api/plex/image/queue/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const item = db.prepare('SELECT poster_url, plex_rating_key FROM queue_items WHERE id = ?').get(id);

    if (!item || (!item.poster_url && !item.plex_rating_key)) {
      return res.status(404).send('Image not found');
    }

    // Try the stored URL first
    if (item.poster_url) {
      try {
        const response = await axios.get(item.poster_url, {
          responseType: 'arraybuffer',
          timeout: 10000,
          httpsAgent
        });
        res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=86400');
        return res.send(response.data);
      } catch (e) {
        // Stored URL failed, try fresh fetch from Plex
      }
    }

    // Fallback: fetch fresh from Plex using rating key
    if (item.plex_rating_key) {
      const plex = PlexService.fromDb();
      if (plex) {
        const freshUrl = `${plex.url}/library/metadata/${item.plex_rating_key}/thumb?X-Plex-Token=${plex.token}`;
        const response = await axios.get(freshUrl, {
          responseType: 'arraybuffer',
          timeout: 10000,
          httpsAgent
        });
        res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=86400');
        return res.send(response.data);
      }
    }

    res.status(404).send('Image not found');
  } catch (error) {
    res.status(404).send('Image not found');
  }
});

// Proxy Plex images by rating key (for general use)
// No auth required - images served from Plex via server-side token
app.get('/api/plex/image/:ratingKey', async (req, res) => {
  try {
    const plex = PlexService.fromDb();
    if (!plex) {
      return res.status(400).json({ error: 'Plex not configured' });
    }

    const { ratingKey } = req.params;
    const imageUrl = `${plex.url}/library/metadata/${ratingKey}/thumb?X-Plex-Token=${plex.token}`;

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      httpsAgent
    });

    res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    res.send(response.data);
  } catch (error) {
    console.error('[API] Plex image proxy error:', error.message);
    res.status(404).send('Image not found');
  }
});

// =========================
// USERS ROUTES (Admin Only)
// =========================

// Get all users
app.get('/api/users', authenticate, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, plex_id, username, email, thumb, is_admin, is_owner, last_login, created_at FROM users ORDER BY created_at ASC').all();
  res.json(users);
});

// Update user
app.put('/api/users/:id', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { is_admin } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Can't demote the server owner
  if (user.is_owner && is_admin === false) {
    return res.status(400).json({ error: 'Cannot demote server owner from admin' });
  }

  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, id);

  log('info', 'system', 'User updated', { target_user_id: id, is_admin, user_id: req.user.userId });
  res.json({ success: true });
});

// Get a specific user's watchlist (Admin only)
app.get('/api/users/:id/watchlist', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;

  // Verify user exists
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const watchlist = db.prepare(`
    SELECT w.*, r.status as request_status, r.id as request_id
    FROM watchlist w
    LEFT JOIN requests r ON w.tmdb_id = r.tmdb_id AND w.media_type = r.media_type
    WHERE w.user_id = ?
    ORDER BY w.added_at DESC
  `).all(id);

  res.json({
    user: { id: user.id, username: user.username },
    watchlist
  });
});

// =========================
// RULES ROUTES (Admin Only)
// =========================

// Get all rules
app.get('/api/rules', authenticate, requireAdmin, (req, res) => {
  const rules = db.prepare('SELECT * FROM rules ORDER BY priority DESC, created_at ASC').all();
  res.json(rules.map(r => ({
    ...r,
    conditions: JSON.parse(r.conditions),
    actions: JSON.parse(r.actions),
    target_library_ids: r.target_library_ids ? JSON.parse(r.target_library_ids) : null,
    notify_webhook_ids: r.notify_webhook_ids ? JSON.parse(r.notify_webhook_ids) : null,
    smart_enabled: !!r.smart_enabled,
    smart_require_all_users_watched: r.smart_require_all_users_watched !== 0,
    smart_proactive_redownload: r.smart_proactive_redownload !== 0
  })));
});

// Get single rule
app.get('/api/rules/:id', authenticate, requireAdmin, (req, res) => {
  const rule = db.prepare('SELECT * FROM rules WHERE id = ?').get(req.params.id);
  if (!rule) {
    return res.status(404).json({ error: 'Rule not found' });
  }
  res.json({
    ...rule,
    conditions: JSON.parse(rule.conditions),
    actions: JSON.parse(rule.actions),
    target_library_ids: rule.target_library_ids ? JSON.parse(rule.target_library_ids) : null,
    notify_webhook_ids: rule.notify_webhook_ids ? JSON.parse(rule.notify_webhook_ids) : null,
    smart_enabled: !!rule.smart_enabled,
    smart_require_all_users_watched: rule.smart_require_all_users_watched !== 0,
    smart_proactive_redownload: rule.smart_proactive_redownload !== 0
  });
});

// Create rule
app.post('/api/rules', authenticate, requireAdmin, (req, res) => {
  const {
    name, description, target_type, target_library_ids,
    conditions, actions, buffer_days, schedule, priority, notify_webhook_ids,
    smart_enabled, smart_min_days_since_watch, smart_velocity_buffer_days,
    smart_protect_episodes_ahead, smart_active_viewer_days,
    smart_require_all_users_watched, smart_proactive_redownload, smart_redownload_lead_days
  } = req.body;

  if (!name || !target_type || !conditions || !actions) {
    return res.status(400).json({ error: 'Name, target_type, conditions, and actions are required' });
  }

  const result = db.prepare(`
    INSERT INTO rules (
      name, description, target_type, target_library_ids, conditions, actions,
      buffer_days, schedule, priority, notify_webhook_ids,
      smart_enabled, smart_min_days_since_watch, smart_velocity_buffer_days,
      smart_protect_episodes_ahead, smart_active_viewer_days,
      smart_require_all_users_watched, smart_proactive_redownload, smart_redownload_lead_days
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name, description, target_type,
    target_library_ids ? JSON.stringify(target_library_ids) : null,
    JSON.stringify(conditions), JSON.stringify(actions),
    buffer_days || 15, schedule, priority || 0,
    notify_webhook_ids ? JSON.stringify(notify_webhook_ids) : null,
    smart_enabled ? 1 : 0,
    smart_min_days_since_watch || 15, smart_velocity_buffer_days || 7,
    smart_protect_episodes_ahead || 3, smart_active_viewer_days || 30,
    smart_require_all_users_watched !== false ? 1 : 0,
    smart_proactive_redownload !== false ? 1 : 0,
    smart_redownload_lead_days || 3
  );

  log('info', 'rule', 'Rule created', { rule_id: result.lastInsertRowid, name, user_id: req.user.userId });
  res.json({ id: result.lastInsertRowid, success: true });
});

// Update rule
app.put('/api/rules/:id', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;
  const {
    name, description, target_type, target_library_ids,
    conditions, actions, buffer_days, schedule, priority, is_active, notify_webhook_ids,
    smart_enabled, smart_min_days_since_watch, smart_velocity_buffer_days,
    smart_protect_episodes_ahead, smart_active_viewer_days,
    smart_require_all_users_watched, smart_proactive_redownload, smart_redownload_lead_days
  } = req.body;

  const rule = db.prepare('SELECT * FROM rules WHERE id = ?').get(id);
  if (!rule) {
    return res.status(404).json({ error: 'Rule not found' });
  }

  db.prepare(`
    UPDATE rules SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      target_type = COALESCE(?, target_type),
      target_library_ids = ?,
      conditions = COALESCE(?, conditions),
      actions = COALESCE(?, actions),
      buffer_days = COALESCE(?, buffer_days),
      schedule = ?,
      priority = COALESCE(?, priority),
      is_active = COALESCE(?, is_active),
      notify_webhook_ids = ?,
      smart_enabled = COALESCE(?, smart_enabled),
      smart_min_days_since_watch = COALESCE(?, smart_min_days_since_watch),
      smart_velocity_buffer_days = COALESCE(?, smart_velocity_buffer_days),
      smart_protect_episodes_ahead = COALESCE(?, smart_protect_episodes_ahead),
      smart_active_viewer_days = COALESCE(?, smart_active_viewer_days),
      smart_require_all_users_watched = COALESCE(?, smart_require_all_users_watched),
      smart_proactive_redownload = COALESCE(?, smart_proactive_redownload),
      smart_redownload_lead_days = COALESCE(?, smart_redownload_lead_days),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name, description, target_type,
    target_library_ids !== undefined ? JSON.stringify(target_library_ids) : rule.target_library_ids,
    conditions ? JSON.stringify(conditions) : null,
    actions ? JSON.stringify(actions) : null,
    buffer_days, schedule, priority, is_active,
    notify_webhook_ids !== undefined ? JSON.stringify(notify_webhook_ids) : rule.notify_webhook_ids,
    smart_enabled !== undefined ? (smart_enabled ? 1 : 0) : null,
    smart_min_days_since_watch, smart_velocity_buffer_days,
    smart_protect_episodes_ahead, smart_active_viewer_days,
    smart_require_all_users_watched !== undefined ? (smart_require_all_users_watched ? 1 : 0) : null,
    smart_proactive_redownload !== undefined ? (smart_proactive_redownload ? 1 : 0) : null,
    smart_redownload_lead_days,
    id
  );

  log('info', 'rule', 'Rule updated', { rule_id: id, user_id: req.user.userId });
  res.json({ success: true });
});

// Delete rule
app.delete('/api/rules/:id', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;
  const rule = db.prepare('SELECT id FROM rules WHERE id = ?').get(id);
  if (!rule) {
    return res.status(404).json({ error: 'Rule not found' });
  }
  db.prepare('DELETE FROM rules WHERE id = ?').run(id);
  log('info', 'rule', 'Rule deleted', { rule_id: id, user_id: req.user.userId });
  res.json({ success: true });
});

// Toggle rule active status
app.post('/api/rules/:id/toggle', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;
  const rule = db.prepare('SELECT id, is_active FROM rules WHERE id = ?').get(id);
  if (!rule) {
    return res.status(404).json({ error: 'Rule not found' });
  }
  const newStatus = rule.is_active ? 0 : 1;
  db.prepare('UPDATE rules SET is_active = ?, updated_at = ? WHERE id = ?').run(newStatus, new Date().toISOString(), id);
  log('info', 'rule', `Rule ${newStatus ? 'enabled' : 'disabled'}`, { rule_id: id, user_id: req.user.userId });
  res.json({ success: true, is_active: newStatus === 1 });
});

// Run single rule (async - returns immediately, runs in background)
app.post('/api/rules/:id/run', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { dryRun } = req.body;

  // Check if rule is already running
  if (runningRules.has(id) && runningRules.get(id).status === 'running') {
    return res.json({
      status: 'already_running',
      startedAt: runningRules.get(id).startedAt
    });
  }

  const effectiveDryRun = dryRun !== undefined ? dryRun : getSetting('dry_run') === 'true';

  // Mark rule as running
  runningRules.set(id, {
    status: 'running',
    startedAt: new Date().toISOString(),
    dryRun: effectiveDryRun,
    results: null,
    error: null
  });

  // Return immediately
  res.json({
    status: 'started',
    message: 'Rule execution started in background',
    dryRun: effectiveDryRun
  });

  // Run in background
  try {
    const results = await scheduler.runRule(id, effectiveDryRun);
    runningRules.set(id, {
      status: 'completed',
      startedAt: runningRules.get(id).startedAt,
      completedAt: new Date().toISOString(),
      dryRun: effectiveDryRun,
      results,
      error: null
    });
  } catch (error) {
    console.error(`[Rules] Background rule ${id} failed:`, error.message);
    runningRules.set(id, {
      status: 'error',
      startedAt: runningRules.get(id).startedAt,
      completedAt: new Date().toISOString(),
      dryRun: effectiveDryRun,
      results: null,
      error: error.message
    });
  }
});

// Get rule execution status
app.get('/api/rules/:id/status', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;

  if (!runningRules.has(id)) {
    return res.json({ status: 'idle' });
  }

  res.json(runningRules.get(id));
});

// Clear rule status (after viewing results)
app.delete('/api/rules/:id/status', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;
  runningRules.delete(id);
  res.json({ success: true });
});

// Get ALL rule execution statuses
app.get('/api/rules/status/all', authenticate, requireAdmin, (req, res) => {
  const statuses = {};
  for (const [ruleId, status] of runningRules.entries()) {
    statuses[ruleId] = status;
  }
  res.json(statuses);
});

// Run ALL active rules
app.post('/api/rules/run-all', authenticate, requireAdmin, async (req, res) => {
  const { dryRun } = req.body;

  // Check if scheduler is already running
  if (scheduler.isRunning) {
    return res.status(409).json({ error: 'Scheduler is already running' });
  }

  // Get all active rules
  const activeRules = db.prepare('SELECT id, name FROM rules WHERE is_active = 1').all();
  if (activeRules.length === 0) {
    return res.json({ message: 'No active rules to run', count: 0 });
  }

  const effectiveDryRun = dryRun !== undefined ? dryRun : getSetting('dry_run') === 'true';

  // Mark all rules as running
  for (const rule of activeRules) {
    runningRules.set(String(rule.id), {
      status: 'running',
      startedAt: new Date().toISOString(),
      dryRun: effectiveDryRun,
      results: null,
      error: null
    });
  }

  // Return immediately with rules array for frontend
  res.json({
    status: 'started',
    message: `Running ${activeRules.length} active rules in background`,
    count: activeRules.length,
    rules: activeRules,
    dryRun: effectiveDryRun
  });

  // Run all rules in background (sequentially to avoid conflicts)
  for (const rule of activeRules) {
    const ruleId = String(rule.id);
    try {
      const results = await scheduler.runRule(rule.id, effectiveDryRun);
      runningRules.set(ruleId, {
        status: 'completed',
        startedAt: runningRules.get(ruleId).startedAt,
        completedAt: new Date().toISOString(),
        dryRun: effectiveDryRun,
        results,
        error: null
      });
    } catch (error) {
      console.error(`[Rules] Rule ${rule.name} (${rule.id}) failed:`, error.message);
      runningRules.set(ruleId, {
        status: 'error',
        startedAt: runningRules.get(ruleId).startedAt,
        completedAt: new Date().toISOString(),
        dryRun: effectiveDryRun,
        results: null,
        error: error.message
      });
    }
  }
});

// Preview rule matches
app.get('/api/rules/:id/preview', authenticate, requireAdmin, async (req, res) => {
  try {
    const matches = await scheduler.previewRule(req.params.id);
    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================
// RULE TEMPLATES ROUTES
// =========================

// Get all templates
app.get('/api/templates', authenticate, (req, res) => {
  const templates = db.prepare('SELECT * FROM rule_templates ORDER BY is_builtin DESC, downloads DESC').all();
  res.json(templates.map(t => ({
    ...t,
    rule_config: JSON.parse(t.rule_config)
  })));
});

// Create rule from template (Admin only)
app.post('/api/templates/:id/use', authenticate, requireAdmin, (req, res) => {
  const template = db.prepare('SELECT * FROM rule_templates WHERE id = ?').get(req.params.id);
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  const config = JSON.parse(template.rule_config);
  const { customName } = req.body;

  const result = db.prepare(`
    INSERT INTO rules (name, description, target_type, conditions, actions, buffer_days)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    customName || template.name,
    template.description,
    config.target_type,
    JSON.stringify(config.conditions),
    JSON.stringify(config.actions),
    config.buffer_days || 15
  );

  db.prepare('UPDATE rule_templates SET downloads = downloads + 1 WHERE id = ?').run(template.id);

  log('info', 'rule', 'Rule created from template', { rule_id: result.lastInsertRowid, template: template.name, user_id: req.user.userId });
  res.json({ id: result.lastInsertRowid, success: true });
});

// =========================
// LEAVING SOON QUEUE ROUTES
// =========================

// Get queue items
app.get('/api/queue', authenticate, async (req, res) => {
  console.log('[Queue] Fetching queue items...');
  try {
    const { status, rule_id } = req.query;

    let query = `
      SELECT qi.*, r.name as rule_name
      FROM queue_items qi
      LEFT JOIN rules r ON qi.rule_id = r.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ' AND qi.status = ?';
      params.push(status);
    }

    if (rule_id) {
      query += ' AND qi.rule_id = ?';
      params.push(rule_id);
    }

    query += ' ORDER BY qi.action_at ASC';

    const items = db.prepare(query).all(...params);

    // Use shared TMDB utility for image fetching with caching
    const posterCache = {};

    const results = await Promise.all(items.map(async (item) => {
      const posterUrl = await TMDBService.getQueueItemImage(item, posterCache);

      return {
        id: item.id,
        rule_id: item.rule_id,
        rule_name: item.rule_name,
        plex_rating_key: item.plex_rating_key,
        media_type: item.media_type,
        title: item.title,
        year: item.year,
        poster_url: posterUrl,
        tmdb_id: item.tmdb_id,
        metadata: item.metadata ? JSON.parse(item.metadata) : {},
        added_at: item.added_at,
        action_at: item.action_at,
        status: item.status,
        is_dry_run: item.is_dry_run,
        daysRemaining: Math.max(0, Math.ceil((new Date(item.action_at) - new Date()) / (1000 * 60 * 60 * 24)))
      };
    }));

    res.json(results);
  } catch (error) {
    console.error('[API] Get queue error:', error);
    res.status(500).json({ error: 'Failed to retrieve queue items' });
  }
});

// Save item (remove from queue)
app.delete('/api/queue/:id', authenticate, (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM queue_items WHERE id = ?').get(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    db.prepare("UPDATE queue_items SET status = 'cancelled' WHERE id = ?").run(req.params.id);
    log('info', 'rule', 'Item saved by user', { media_title: item.title, user_id: req.user.userId });
    res.json({ success: true });
  } catch (error) {
    console.error('[API] Delete queue item error:', error);
    res.status(500).json({ error: 'Failed to save item' });
  }
});

// Delete item immediately (Admin only)
app.post('/api/queue/:id/delete-now', authenticate, requireAdmin, async (req, res) => {
  const item = db.prepare('SELECT * FROM queue_items WHERE id = ?').get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Item not found' });
  }

  try {
    const engine = new RulesEngine();
    await engine.initialize();

    const plex = PlexService.fromDb();
    const metadata = JSON.parse(item.metadata || '{}');

    await plex.deleteItem(item.plex_rating_key);

    if (item.media_type === 'movie') {
      const radarrs = RadarrService.getAllFromDb();
      for (const radarr of radarrs) {
        const movie = await radarr.findMovieByGuid(metadata.guids || []);
        if (movie) {
          await radarr.deleteMovie(movie.id, getSetting('delete_files') === 'true', true);
          break;
        }
      }
    } else {
      const sonarrs = SonarrService.getAllFromDb();
      for (const sonarr of sonarrs) {
        const series = await sonarr.findSeriesByGuid(metadata.guids || []);
        if (series) {
          await sonarr.deleteSeries(series.id, getSetting('delete_files') === 'true', true);
          break;
        }
      }
    }

    db.prepare("UPDATE queue_items SET status = 'completed' WHERE id = ?").run(item.id);
    log('info', 'deletion', 'Item deleted immediately', { media_title: item.title, user_id: req.user.userId });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Extend queue item buffer period
app.post('/api/queue/:id/extend', authenticate, (req, res) => {
  try {
    const { days = 7 } = req.body;
    const item = db.prepare('SELECT * FROM queue_items WHERE id = ?').get(req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (item.status !== 'pending') {
      return res.status(400).json({ error: 'Can only extend pending items' });
    }

    // Extend the action_at date by the specified number of days
    const currentActionAt = new Date(item.action_at);
    const newActionAt = new Date(currentActionAt.getTime() + (days * 24 * 60 * 60 * 1000));

    db.prepare('UPDATE queue_items SET action_at = ? WHERE id = ?').run(
      newActionAt.toISOString(),
      req.params.id
    );

    log('info', 'rule', `Extended buffer by ${days} days`, {
      media_title: item.title,
      user_id: req.user.userId,
      old_action_at: item.action_at,
      new_action_at: newActionAt.toISOString()
    });

    res.json({ success: true, new_action_at: newActionAt.toISOString() });
  } catch (error) {
    console.error('[API] Extend queue item error:', error);
    res.status(500).json({ error: 'Failed to extend buffer' });
  }
});

// =========================
// WEBHOOKS ROUTES (Admin Only)
// =========================

// Map DB columns to frontend field names
const mapWebhookToFrontend = (w) => ({
  ...w,
  settings: w.settings ? JSON.parse(w.settings) : {},
  user_ids: w.user_ids ? JSON.parse(w.user_ids) : [],
  // All trigger flags - use actual DB column names for clarity
  on_request: !!w.on_request,
  on_available: !!w.on_available,
  on_leaving_soon: !!w.on_leaving_soon,
  on_delete: !!w.on_delete,
  on_restore: !!w.on_restore,
  on_error: !!w.on_error,
  on_viper_cleanup: !!w.on_viper_cleanup,
  on_user_joined: !!w.on_user_joined,
  on_download_started: !!w.on_download_started,
  on_download_complete: !!w.on_download_complete
});

app.get('/api/webhooks', authenticate, requireAdmin, (req, res) => {
  const webhooks = db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all();
  res.json(webhooks.map(mapWebhookToFrontend));
});

app.post('/api/webhooks', authenticate, requireAdmin, (req, res) => {
  const {
    type, name, url, settings,
    on_request, on_available, on_leaving_soon, on_delete, on_restore, on_error,
    on_viper_cleanup, on_user_joined, on_download_started, on_download_complete,
    user_ids
  } = req.body;

  if (!type || !name) {
    return res.status(400).json({ error: 'Type and name are required' });
  }

  const result = db.prepare(`
    INSERT INTO webhooks (
      type, name, url, settings,
      on_request, on_available, on_leaving_soon, on_delete, on_restore, on_error,
      on_viper_cleanup, on_user_joined, on_download_started, on_download_complete,
      user_ids
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    type, name, url,
    settings ? JSON.stringify(settings) : null,
    on_request ? 1 : 0,
    on_available ? 1 : 0,
    on_leaving_soon ? 1 : 0,
    on_delete ? 1 : 0,
    on_restore ? 1 : 0,
    on_error ? 1 : 0,
    on_viper_cleanup !== false ? 1 : 0,  // Default ON
    on_user_joined ? 1 : 0,
    on_download_started ? 1 : 0,
    on_download_complete !== false ? 1 : 0,  // Default ON
    user_ids ? JSON.stringify(user_ids) : null
  );

  log('info', 'system', 'Webhook added', { type, name, user_id: req.user.userId });
  res.json({ id: result.lastInsertRowid, success: true });
});

app.put('/api/webhooks/:id', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;
  const {
    type, name, url, settings, is_active,
    on_request, on_available, on_leaving_soon, on_delete, on_restore, on_error,
    on_viper_cleanup, on_user_joined, on_download_started, on_download_complete,
    user_ids
  } = req.body;

  const existing = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Webhook not found' });
  }

  db.prepare(`
    UPDATE webhooks SET
      type = ?, name = ?, url = ?, settings = ?, is_active = ?,
      on_request = ?, on_available = ?, on_leaving_soon = ?,
      on_delete = ?, on_restore = ?, on_error = ?,
      on_viper_cleanup = ?, on_user_joined = ?, on_download_started = ?, on_download_complete = ?,
      user_ids = ?
    WHERE id = ?
  `).run(
    type ?? existing.type,
    name ?? existing.name,
    url ?? existing.url,
    settings !== undefined ? JSON.stringify(settings) : existing.settings,
    is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
    on_request !== undefined ? (on_request ? 1 : 0) : existing.on_request,
    on_available !== undefined ? (on_available ? 1 : 0) : existing.on_available,
    on_leaving_soon !== undefined ? (on_leaving_soon ? 1 : 0) : existing.on_leaving_soon,
    on_delete !== undefined ? (on_delete ? 1 : 0) : existing.on_delete,
    on_restore !== undefined ? (on_restore ? 1 : 0) : existing.on_restore,
    on_error !== undefined ? (on_error ? 1 : 0) : existing.on_error,
    on_viper_cleanup !== undefined ? (on_viper_cleanup ? 1 : 0) : existing.on_viper_cleanup,
    on_user_joined !== undefined ? (on_user_joined ? 1 : 0) : existing.on_user_joined,
    on_download_started !== undefined ? (on_download_started ? 1 : 0) : existing.on_download_started,
    on_download_complete !== undefined ? (on_download_complete ? 1 : 0) : existing.on_download_complete,
    user_ids !== undefined ? JSON.stringify(user_ids) : existing.user_ids,
    id
  );

  log('info', 'system', 'Webhook updated', { webhook_id: id, user_id: req.user.userId });
  res.json({ success: true });
});

app.delete('/api/webhooks/:id', authenticate, requireAdmin, (req, res) => {
  const webhook = db.prepare('SELECT id FROM webhooks WHERE id = ?').get(req.params.id);
  if (!webhook) {
    return res.status(404).json({ error: 'Webhook not found' });
  }
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Test endpoint for existing webhook by ID
app.post('/api/webhooks/:id/test', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);

  if (!webhook) {
    return res.status(404).json({ error: 'Webhook not found' });
  }

  try {
    const testData = {
      title: 'Test Notification',
      year: 2024,
      rule: 'Test Rule',
      action: 'This is a test notification from Flexerr'
    };

    await NotificationService.sendWebhook(webhook, 'on_rule_complete', testData);
    res.json({ success: true, message: 'Test notification sent successfully' });
  } catch (error) {
    console.error('[Webhook Test] Error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to send test notification' });
  }
});

// Test endpoint for new webhook (before saving)
app.post('/api/webhooks/test', authenticate, requireAdmin, async (req, res) => {
  const { type, url, settings } = req.body;

  if (!type || !url) {
    return res.status(400).json({ error: 'Type and URL are required' });
  }

  try {
    const testData = {
      title: 'Test Notification',
      year: 2024,
      rule: 'Test Rule',
      action: 'This is a test notification from Flexerr'
    };

    // Create a temporary webhook object
    const webhook = {
      type,
      url,
      settings: typeof settings === 'string' ? settings : JSON.stringify(settings || {})
    };

    await NotificationService.sendWebhook(webhook, 'on_rule_complete', testData);
    res.json({ success: true, message: 'Test notification sent successfully' });
  } catch (error) {
    console.error('[Webhook Test] Error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to send test notification' });
  }
});

// =========================
// LOGS ROUTES
// =========================

app.get('/api/logs', authenticate, requireAdmin, (req, res) => {
  const { level, category, rule_id, limit = 100, offset = 0 } = req.query;

  let query = 'SELECT * FROM logs WHERE 1=1';
  const params = [];

  if (level) {
    query += ' AND level = ?';
    params.push(level);
  }

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  if (rule_id) {
    query += ' AND rule_id = ?';
    params.push(rule_id);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const logs = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM logs').get().count;

  res.json({
    logs: logs.map(l => ({
      ...l,
      details: l.details ? JSON.parse(l.details) : {}
    })),
    total,
    limit: parseInt(limit),
    offset: parseInt(offset)
  });
});

// =========================
// STATS ROUTES
// =========================

app.get('/api/stats', authenticate, (req, res) => {
  const isAdmin = req.user.isAdmin;

  // Basic stats for all users
  const pendingQueue = db.prepare("SELECT COUNT(*) as count FROM queue_items WHERE status = 'pending'").get().count;

  // User's watchlist count
  const userWatchlist = db.prepare('SELECT COUNT(*) as count FROM watchlist WHERE user_id = ? AND is_active = 1').get(req.user.userId).count;

  // User's requests
  const userRequests = db.prepare('SELECT COUNT(*) as count FROM requests WHERE user_id = ?').get(req.user.userId).count;

  const stats = {
    pendingQueue,
    userWatchlist,
    userRequests
  };

  // Admin-only stats
  if (isAdmin) {
    // Rule stats
    stats.activeRules = db.prepare('SELECT COUNT(*) as count FROM rules WHERE is_active = 1').get().count;
    stats.totalRules = db.prepare('SELECT COUNT(*) as count FROM rules').get().count;

    // User stats
    stats.totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    stats.adminUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1').get().count;

    // Request stats
    stats.totalRequests = db.prepare('SELECT COUNT(*) as count FROM requests').get().count;
    stats.movieRequests = db.prepare("SELECT COUNT(*) as count FROM requests WHERE media_type = 'movie'").get().count;
    stats.tvRequests = db.prepare("SELECT COUNT(*) as count FROM requests WHERE media_type = 'tv'").get().count;

    // Request status breakdown
    stats.requestsByStatus = {
      pending: db.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'pending'").get().count,
      downloading: db.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'downloading'").get().count,
      available: db.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'available'").get().count,
      failed: db.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'failed'").get().count
    };

    // Watchlist stats (all users)
    stats.totalWatchlistItems = db.prepare('SELECT COUNT(*) as count FROM watchlist WHERE is_active = 1').get().count;
    stats.watchlistMovies = db.prepare("SELECT COUNT(*) as count FROM watchlist WHERE is_active = 1 AND media_type = 'movie'").get().count;
    stats.watchlistTV = db.prepare("SELECT COUNT(*) as count FROM watchlist WHERE is_active = 1 AND media_type = 'tv'").get().count;

    // Queue stats
    stats.queuePending = db.prepare("SELECT COUNT(*) as count FROM queue_items WHERE status = 'pending'").get().count;
    stats.queueCompleted = db.prepare("SELECT COUNT(*) as count FROM queue_items WHERE status = 'completed'").get().count;

    // Weekly stats
    const weekStats = db.prepare(`
      SELECT
        COALESCE(SUM(deletions_count), 0) as deletions,
        COALESCE(SUM(storage_saved_bytes), 0) as storage_saved,
        COALESCE(SUM(requests_count), 0) as requests,
        COALESCE(SUM(available_count), 0) as available
      FROM stats_daily
      WHERE date >= date('now', '-7 days')
    `).get();
    stats.weekDeletions = weekStats.deletions;
    stats.weekStorageSaved = weekStats.storage_saved;
    stats.weekRequests = weekStats.requests;
    stats.weekAvailable = weekStats.available;

    // Monthly stats
    const monthStats = db.prepare(`
      SELECT
        COALESCE(SUM(deletions_count), 0) as deletions,
        COALESCE(SUM(storage_saved_bytes), 0) as storage_saved,
        COALESCE(SUM(requests_count), 0) as requests,
        COALESCE(SUM(available_count), 0) as available
      FROM stats_daily
      WHERE date >= date('now', '-30 days')
    `).get();
    stats.monthDeletions = monthStats.deletions;
    stats.monthStorageSaved = monthStats.storage_saved;
    stats.monthRequests = monthStats.requests;
    stats.monthAvailable = monthStats.available;

    // All-time stats
    const allTimeStats = db.prepare(`
      SELECT
        COALESCE(SUM(deletions_count), 0) as deletions,
        COALESCE(SUM(storage_saved_bytes), 0) as storage_saved,
        COALESCE(SUM(requests_count), 0) as requests,
        COALESCE(SUM(available_count), 0) as available
      FROM stats_daily
    `).get();
    stats.allTimeDeletions = allTimeStats.deletions;
    stats.allTimeStorageSaved = allTimeStats.storage_saved;
    stats.allTimeRequests = allTimeStats.requests;
    stats.allTimeAvailable = allTimeStats.available;

    // Recent log counts
    stats.recentErrors = db.prepare("SELECT COUNT(*) as count FROM logs WHERE level = 'error' AND created_at >= datetime('now', '-24 hours')").get().count;
    stats.recentWarnings = db.prepare("SELECT COUNT(*) as count FROM logs WHERE level = 'warning' AND created_at >= datetime('now', '-24 hours')").get().count;

    // Services
    stats.services = db.prepare('SELECT type, name, is_active, last_connected FROM services').all();
    stats.connectedServices = stats.services.filter(s => s.is_active).length;

    // Scheduler
    stats.scheduler = scheduler.getStatus();

    // Top rules by matches
    stats.topRules = db.prepare(`
      SELECT id, name, last_run_matches, last_run
      FROM rules
      WHERE last_run IS NOT NULL
      ORDER BY last_run_matches DESC
      LIMIT 5
    `).all();
  }

  res.json(stats);
});

// =========================
// CONVERSION JOBS ROUTES
// =========================

// Get conversion jobs (admin only)
app.get('/api/conversions', authenticate, requireAdmin, (req, res) => {
  try {
    const { status, limit = 20 } = req.query;
    const MediaConverterService = require('./services/media-converter');

    const jobs = MediaConverterService.getJobs(status || null, parseInt(limit));

    res.json({
      jobs: jobs.map(job => ({
        id: job.id,
        title: job.title,
        media_type: job.media_type,
        conversion_type: job.conversion_type,
        reason: job.reason,
        status: job.status,
        duration: job.duration,
        error_message: job.error_message,
        created_at: job.created_at,
        completed_at: job.completed_at,
        progress: MediaConverterService.getJobProgress(job.id)
      })),
      stats: {
        pending: jobs.filter(j => j.status === 'pending').length,
        processing: jobs.filter(j => j.status === 'processing').length,
        completed: jobs.filter(j => j.status === 'completed').length,
        failed: jobs.filter(j => j.status === 'failed').length
      },
      isEnabled: MediaConverterService.isEnabled(),
      settings: MediaConverterService.getHWAccelSettings()
    });
  } catch (error) {
    console.error('[API] Get conversions error:', error);
    res.status(500).json({ error: 'Failed to get conversion jobs' });
  }
});

// Retry a failed conversion job (admin only)
app.post('/api/conversions/:id/retry', authenticate, requireAdmin, async (req, res) => {
  try {
    const jobId = parseInt(req.params.id);
    const job = db.prepare('SELECT * FROM conversion_jobs WHERE id = ?').get(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'failed') {
      return res.status(400).json({ error: 'Only failed jobs can be retried' });
    }

    // Reset to pending
    db.prepare(`UPDATE conversion_jobs SET status = 'pending', error_message = NULL WHERE id = ?`).run(jobId);

    // Queue it
    const MediaConverterService = require('./services/media-converter');
    const converter = new MediaConverterService();
    converter.addToQueue({
      jobId: job.id,
      filePath: job.file_path,
      title: job.title,
      mediaType: job.media_type,
      tmdbId: job.tmdb_id,
      type: job.conversion_type,
      reason: job.reason
    });

    log('info', 'convert', 'Conversion job retried: ' + job.title, { job_id: jobId, user_id: req.user.userId });
    res.json({ success: true, message: 'Job queued for retry' });
  } catch (error) {
    console.error('[API] Retry conversion error:', error);
    res.status(500).json({ error: 'Failed to retry conversion' });
  }
});

// Cancel a pending conversion job (admin only)
app.delete('/api/conversions/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const jobId = parseInt(req.params.id);
    const job = db.prepare('SELECT * FROM conversion_jobs WHERE id = ?').get(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status === 'processing') {
      return res.status(400).json({ error: 'Cannot cancel a job that is currently processing' });
    }

    db.prepare('DELETE FROM conversion_jobs WHERE id = ?').run(jobId);

    log('info', 'convert', 'Conversion job cancelled: ' + job.title, { job_id: jobId, user_id: req.user.userId });
    res.json({ success: true });
  } catch (error) {
    console.error('[API] Cancel conversion error:', error);
    res.status(500).json({ error: 'Failed to cancel conversion' });
  }
});

// =========================
// ALTERNATE SEARCH QUEUE ROUTES
// =========================

// Get alternate search queue (admin only)
app.get('/api/alternate-searches', authenticate, requireAdmin, (req, res) => {
  try {
    const { status } = req.query;
    const MediaConverterService = require('./services/media-converter');
    const entries = MediaConverterService.getAlternateSearchQueue(status || null);

    res.json({
      entries: entries.map(e => ({
        id: e.id,
        title: e.title,
        media_type: e.media_type,
        tmdb_id: e.tmdb_id,
        incompatible_reason: e.incompatible_reason,
        conversion_type: e.conversion_type,
        status: e.status,
        search_attempts: e.search_attempts,
        created_at: e.created_at,
        expires_at: e.expires_at,
        resolved_at: e.resolved_at,
        resolution: e.resolution
      })),
      settings: {
        preferAlternate: MediaConverterService.isPreferAlternateEnabled(),
        waitHours: MediaConverterService.getAlternateWaitHours(),
        blocklistBad: MediaConverterService.isBlocklistBadEnabled()
      }
    });
  } catch (error) {
    console.error('[API] Get alternate searches error:', error);
    res.status(500).json({ error: 'Failed to get alternate search queue' });
  }
});

// Cancel an alternate search and optionally convert (admin only)
app.post('/api/alternate-searches/:id/cancel', authenticate, requireAdmin, (req, res) => {
  try {
    const searchId = parseInt(req.params.id);
    const { triggerConversion } = req.body;
    const MediaConverterService = require('./services/media-converter');

    const result = MediaConverterService.cancelAlternateSearch(searchId, triggerConversion === true);
    if (!result) {
      return res.status(404).json({ error: 'Alternate search entry not found' });
    }

    log('info', 'convert', 'Alternate search cancelled', { search_id: searchId, trigger_conversion: triggerConversion, user_id: req.user.userId });
    res.json({ success: true, message: triggerConversion ? 'Cancelled and conversion queued' : 'Cancelled' });
  } catch (error) {
    console.error('[API] Cancel alternate search error:', error);
    res.status(500).json({ error: 'Failed to cancel alternate search' });
  }
});

// Force convert an alternate search entry (admin only)
app.post('/api/alternate-searches/:id/convert', authenticate, requireAdmin, async (req, res) => {
  try {
    const searchId = parseInt(req.params.id);
    const entry = db.prepare('SELECT * FROM alternate_search_queue WHERE id = ?').get(searchId);

    if (!entry) {
      return res.status(404).json({ error: 'Alternate search entry not found' });
    }

    if (entry.status === 'resolved' || entry.status === 'converting') {
      return res.status(400).json({ error: 'Entry already resolved or converting' });
    }

    const MediaConverterService = require('./services/media-converter');
    const converter = new MediaConverterService();
    await converter.fallbackToConversion(entry);

    log('info', 'convert', 'Forced conversion for alternate search: ' + entry.title, { search_id: searchId, user_id: req.user.userId });
    res.json({ success: true, message: 'Conversion queued' });
  } catch (error) {
    console.error('[API] Force convert error:', error);
    res.status(500).json({ error: 'Failed to force conversion' });
  }
});

// =========================
// LIBRARY SCAN ROUTES
// =========================

// Initialize library scan table
db.exec(`
  CREATE TABLE IF NOT EXISTS library_scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT DEFAULT 'running',
    scanned INTEGER DEFAULT 0,
    total_items INTEGER DEFAULT 0,
    current_library TEXT,
    started_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    started_by INTEGER,
    error_message TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS library_scan_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id INTEGER NOT NULL,
    title TEXT,
    show_title TEXT,
    season INTEGER,
    episode INTEGER,
    year INTEGER,
    media_type TEXT,
    file_path TEXT,
    reason TEXT,
    conversion_type TEXT,
    rating_key TEXT,
    processed INTEGER DEFAULT 0,
    FOREIGN KEY (scan_id) REFERENCES library_scans(id) ON DELETE CASCADE
  )
`);

// Start a library scan (runs in background)
app.post('/api/scan/incompatible', authenticate, requireAdmin, async (req, res) => {
  try {
    // Check if a scan is already running
    const running = db.prepare("SELECT * FROM library_scans WHERE status = 'running'").get();
    if (running) {
      return res.status(400).json({ error: 'A scan is already in progress', scanId: running.id });
    }

    const PlexService = require('./services/plex');
    const plex = PlexService.fromDb();
    if (!plex) {
      return res.status(400).json({ error: 'Plex not configured' });
    }

    // Create scan record
    const result = db.prepare(`
      INSERT INTO library_scans (status, started_by) VALUES ('running', ?)
    `).run(req.user.userId);
    const scanId = result.lastInsertRowid;

    console.log('[API] Starting background library scan, ID:', scanId);

    // Return immediately with scan ID
    res.json({ success: true, scanId, message: 'Scan started in background' });

    // Run scan in background
    runLibraryScan(scanId, plex);

  } catch (error) {
    console.error('[API] Start scan error:', error);
    res.status(500).json({ error: 'Failed to start scan: ' + error.message });
  }
});

// Background scan function
async function runLibraryScan(scanId, plex) {
  const MediaConverterService = require('./services/media-converter');
  const converter = new MediaConverterService();

  try {
    // Get all libraries and count total items
    const libraries = await plex.getLibraries();
    let totalItems = 0;

    // Count movies
    const movieLibraries = libraries.filter(lib => lib.type === 'movie');
    for (const lib of movieLibraries) {
      const movies = await plex.getLibraryContents(lib.id);
      totalItems += movies.length;
    }

    // Count episodes (approximate by counting shows * avg episodes)
    const tvLibraries = libraries.filter(lib => lib.type === 'show');
    for (const lib of tvLibraries) {
      const shows = await plex.getLibraryContents(lib.id);
      // Estimate ~20 episodes per show for progress (will be refined as we scan)
      totalItems += shows.length * 20;
    }

    db.prepare('UPDATE library_scans SET total_items = ? WHERE id = ?').run(totalItems, scanId);

    let scanned = 0;

    // Scan movie libraries
    for (const lib of movieLibraries) {
      db.prepare('UPDATE library_scans SET current_library = ? WHERE id = ?').run(lib.title, scanId);

      try {
        const movies = await plex.getLibraryContents(lib.id);
        for (const movie of movies) {
          try {
            const metadata = await plex.getItemMetadata(movie.ratingKey);
            const filePath = metadata?.Media?.[0]?.Part?.[0]?.file;
            if (!filePath) {
              scanned++;
              continue;
            }

            const check = await converter.needsConversion(filePath);

            if (check.needs) {
              db.prepare(`
                INSERT INTO library_scan_results (scan_id, title, year, media_type, file_path, reason, conversion_type, rating_key)
                VALUES (?, ?, ?, 'movie', ?, ?, ?, ?)
              `).run(scanId, movie.title, movie.year, filePath, check.reason, check.type, movie.ratingKey);
            }

            scanned++;
            if (scanned % 10 === 0) {
              db.prepare('UPDATE library_scans SET scanned = ? WHERE id = ?').run(scanned, scanId);
            }
          } catch (e) {
            scanned++;
            console.error('[Scan] Error scanning movie:', movie.title, e.message);
          }
        }
      } catch (e) {
        console.error('[Scan] Error scanning library:', lib.title, e.message);
      }
    }

    // Scan TV libraries
    for (const lib of tvLibraries) {
      db.prepare('UPDATE library_scans SET current_library = ? WHERE id = ?').run(lib.title, scanId);

      try {
        const shows = await plex.getLibraryContents(lib.id);
        for (const show of shows) {
          try {
            const seasons = await plex.getShowSeasons(show.ratingKey);
            for (const season of seasons) {
              const episodes = await plex.getSeasonEpisodes(season.ratingKey);
              for (const episode of episodes) {
                try {
                  const metadata = await plex.getItemMetadata(episode.ratingKey);
                  const filePath = metadata?.Media?.[0]?.Part?.[0]?.file;
                  if (!filePath) {
                    scanned++;
                    continue;
                  }

                  const check = await converter.needsConversion(filePath);

                  if (check.needs) {
                    const title = `${show.title} - S${String(season.index).padStart(2, '0')}E${String(episode.index).padStart(2, '0')} - ${episode.title}`;
                    db.prepare(`
                      INSERT INTO library_scan_results (scan_id, title, show_title, season, episode, media_type, file_path, reason, conversion_type, rating_key)
                      VALUES (?, ?, ?, ?, ?, 'episode', ?, ?, ?, ?)
                    `).run(scanId, title, show.title, season.index, episode.index, filePath, check.reason, check.type, episode.ratingKey);
                  }

                  scanned++;
                  if (scanned % 10 === 0) {
                    db.prepare('UPDATE library_scans SET scanned = ? WHERE id = ?').run(scanned, scanId);
                  }
                } catch (e) {
                  scanned++;
                }
              }
            }
          } catch (e) {
            console.error('[Scan] Error scanning show:', show.title, e.message);
          }
        }
      } catch (e) {
        console.error('[Scan] Error scanning library:', lib.title, e.message);
      }
    }

    // Mark scan as complete
    db.prepare(`
      UPDATE library_scans SET status = 'completed', scanned = ?, completed_at = CURRENT_TIMESTAMP, current_library = NULL
      WHERE id = ?
    `).run(scanned, scanId);

    const incompatibleCount = db.prepare('SELECT COUNT(*) as count FROM library_scan_results WHERE scan_id = ?').get(scanId).count;
    console.log(`[Scan] Complete. Scanned: ${scanned}, Incompatible: ${incompatibleCount}`);

    log('info', 'convert', `Library scan complete: ${incompatibleCount} incompatible files found`, {
      scan_id: scanId,
      scanned,
      incompatible_count: incompatibleCount
    });

  } catch (error) {
    console.error('[Scan] Error:', error);
    db.prepare(`
      UPDATE library_scans SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(error.message, scanId);
  }
}

// Get scan status and results
app.get('/api/scan/incompatible', authenticate, requireAdmin, (req, res) => {
  try {
    // Get latest scan
    const scan = db.prepare('SELECT * FROM library_scans ORDER BY id DESC LIMIT 1').get();
    if (!scan) {
      return res.json({ scan: null, results: [] });
    }

    // Get results with processing status from alternate_search_queue
    const results = db.prepare(`
      SELECT r.*,
             asq.status as processing_status,
             asq.resolution as processing_resolution,
             asq.search_attempts,
             asq.created_at as queued_at,
             asq.resolved_at
      FROM library_scan_results r
      LEFT JOIN alternate_search_queue asq ON r.file_path = asq.file_path
      WHERE r.scan_id = ?
      ORDER BY r.id
    `).all(scan.id);

    res.json({
      scan: {
        id: scan.id,
        status: scan.status,
        scanned: scan.scanned,
        totalItems: scan.total_items,
        currentLibrary: scan.current_library,
        startedAt: scan.started_at,
        completedAt: scan.completed_at,
        errorMessage: scan.error_message,
        incompatibleCount: results.length
      },
      results
    });
  } catch (error) {
    console.error('[API] Get scan error:', error);
    res.status(500).json({ error: 'Failed to get scan status' });
  }
});

// Delete scan results
app.delete('/api/scan/incompatible/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const scanId = parseInt(req.params.id);
    db.prepare('DELETE FROM library_scan_results WHERE scan_id = ?').run(scanId);
    db.prepare('DELETE FROM library_scans WHERE id = ?').run(scanId);
    res.json({ success: true });
  } catch (error) {
    console.error('[API] Delete scan error:', error);
    res.status(500).json({ error: 'Failed to delete scan' });
  }
});

// Queue incompatible items for processing (admin only)
app.post('/api/scan/incompatible/process', authenticate, requireAdmin, async (req, res) => {
  try {
    const { items } = req.body; // Array of item IDs from scan results
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }

    const MediaConverterService = require('./services/media-converter');
    const converter = new MediaConverterService();

    const results = {
      queued: 0,
      skipped: 0,
      errors: []
    };

    for (const itemId of items) {
      try {
        const item = db.prepare('SELECT * FROM library_scan_results WHERE id = ?').get(itemId);
        if (!item || item.processed) {
          results.skipped++;
          continue;
        }

        // Get Sonarr/Radarr info if available
        let arrInfo = null;
        if (MediaConverterService.isPreferAlternateEnabled()) {
          arrInfo = await converter.getArrInfoForFile(item.file_path, item.media_type);
        }

        const result = await converter.processFile(
          item.file_path,
          item.title,
          item.media_type,
          null,
          arrInfo
        );

        if (result.processed) {
          results.queued++;
          db.prepare('UPDATE library_scan_results SET processed = 1 WHERE id = ?').run(itemId);
        } else {
          results.skipped++;
        }
      } catch (e) {
        results.errors.push({ itemId, error: e.message });
      }
    }

    log('info', 'convert', `Queued ${results.queued} items for processing`, {
      queued: results.queued,
      skipped: results.skipped
    });

    res.json(results);
  } catch (error) {
    console.error('[API] Process items error:', error);
    res.status(500).json({ error: 'Failed to process items: ' + error.message });
  }
});

// =========================
// MEDIA STATISTICS ROUTES
// =========================

// Get detailed stats for a specific media item (by TMDB ID)
app.get('/api/stats/media/:mediaType/:tmdbId', authenticate, async (req, res) => {
  const { mediaType, tmdbId } = req.params;
  const isAdmin = req.user.isAdmin;

  try {
    const stats = {
      tmdb_id: parseInt(tmdbId),
      media_type: mediaType
    };

    // Get request info
    const request = db.prepare(`
      SELECT r.*, u.username as requested_by_name
      FROM requests r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.tmdb_id = ? AND r.media_type = ?
    `).get(tmdbId, mediaType);
    stats.request = request || null;

    // Get watchlist info (who has it on their watchlist)
    stats.watchlisted_by = db.prepare(`
      SELECT w.*, u.username, u.thumb as user_thumb
      FROM watchlist w
      JOIN users u ON w.user_id = u.id
      WHERE w.tmdb_id = ? AND w.media_type = ?
      ORDER BY w.added_at DESC
    `).all(tmdbId, mediaType);

    // Get queue items (scheduled for deletion)
    stats.queue_items = db.prepare(`
      SELECT q.*, r.name as rule_name
      FROM queue_items q
      LEFT JOIN rules r ON q.rule_id = r.id
      WHERE q.tmdb_id = ? AND q.media_type = ? AND q.status = 'pending'
    `).all(tmdbId, mediaType);

    // Get watch history from Flexerr's tracking (admin only - shows all users)
    if (isAdmin) {
      stats.watch_history = db.prepare(`
        SELECT wh.*, u.username
        FROM watch_history wh
        JOIN users u ON wh.user_id = u.id
        WHERE wh.tmdb_id = ? AND wh.media_type = ?
        ORDER BY wh.watched_at DESC
        LIMIT 20
      `).all(tmdbId, mediaType);
    } else {
      // Non-admins only see their own watch history
      stats.watch_history = db.prepare(`
        SELECT wh.*, u.username
        FROM watch_history wh
        JOIN users u ON wh.user_id = u.id
        WHERE wh.tmdb_id = ? AND wh.media_type = ? AND wh.user_id = ?
        ORDER BY wh.watched_at DESC
        LIMIT 20
      `).all(tmdbId, mediaType, req.user.userId);
    }

    // Try to get Plex info if we have a Plex service configured
    try {
      const PlexService = require('./services/plex');
      const plex = PlexService.fromDb();
      if (plex && request) {
        // Try to find the item in Plex by title/year
        const libraries = await plex.getLibraries();
        for (const lib of libraries) {
          if ((mediaType === 'movie' && lib.type === 'movie') ||
              (mediaType === 'tv' && lib.type === 'show')) {
            const contents = await plex.getLibraryContents(lib.id);
            const match = contents.find(c =>
              c.title?.toLowerCase() === request.title?.toLowerCase() &&
              (!request.year || c.year === request.year)
            );
            if (match) {
              // Get detailed info for this item
              const details = await plex.getItem(match.ratingKey);
              // Get full metadata including collections
              const fullMeta = await plex.client.get(`/library/metadata/${match.ratingKey}`);
              const fullDetails = fullMeta.data?.MediaContainer?.Metadata?.[0] || details;

              stats.plex_info = {
                rating_key: match.ratingKey,
                view_count: details?.viewCount || 0,
                last_viewed_at: details?.lastViewedAt ? new Date(details.lastViewedAt * 1000).toISOString() : null,
                added_at: details?.addedAt ? new Date(details.addedAt * 1000).toISOString() : null,
                file_size: details?.Media?.[0]?.Part?.[0]?.size || 0,
                resolution: details?.Media?.[0]?.videoResolution || null,
                video_codec: details?.Media?.[0]?.videoCodec || null,
                collections: fullDetails?.Collection?.map(c => c.tag) || []
              };

              // Get velocity data using the Plex ratingKey (for TV shows)
              // Note: user_velocity stores ratingKey in the tmdb_id column
              if (mediaType === 'tv') {
                if (isAdmin) {
                  stats.velocity_data = db.prepare(`
                    SELECT v.*, u.username
                    FROM user_velocity v
                    JOIN users u ON v.user_id = u.id
                    WHERE v.tmdb_id = ?
                    ORDER BY v.last_watched_at DESC
                  `).all(match.ratingKey);
                } else {
                  // Non-admins only see their own velocity
                  stats.velocity_data = db.prepare(`
                    SELECT v.*, u.username
                    FROM user_velocity v
                    JOIN users u ON v.user_id = u.id
                    WHERE v.tmdb_id = ? AND v.user_id = ?
                    ORDER BY v.last_watched_at DESC
                  `).all(match.ratingKey, req.user.userId);
                }
                
                // Get recently watched episode info per user
                try {
                  stats.recently_watched_by = await plex.getRecentlyWatchedByUsers(match.ratingKey);
                } catch (rwErr) {
                  console.error('[Stats] Error fetching recently watched:', rwErr.message);
                  stats.recently_watched_by = [];
                }
              }
              break;
            }
          }
        }
      }
    } catch (plexErr) {
      console.error('[Stats] Error fetching Plex info:', plexErr.message);
    }

    res.json(stats);
  } catch (error) {
    console.error('[Stats] Error fetching media stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get stats for a specific Plex item by rating key
app.get('/api/stats/plex/:ratingKey', authenticate, async (req, res) => {
  const { ratingKey } = req.params;
  const isAdmin = req.user.isAdmin;

  try {
    const stats = {
      rating_key: ratingKey
    };

    // Try to get Plex info
    try {
      const PlexService = require('./services/plex');
      const plex = PlexService.fromDb();
      if (plex) {
        const details = await plex.getItem(ratingKey);
        if (details) {
          stats.plex_info = {
            title: details.title,
            view_count: details.viewCount || 0,
            last_viewed_at: details.lastViewedAt ? new Date(details.lastViewedAt * 1000).toISOString() : null,
            added_at: details.addedAt ? new Date(details.addedAt * 1000).toISOString() : null,
            file_size: details.Media?.[0]?.Part?.[0]?.size || 0,
            resolution: details.Media?.[0]?.videoResolution || null,
            video_codec: details.Media?.[0]?.videoCodec || null,
            duration: details.duration || null
          };
        }
      }
    } catch (plexErr) {
      console.error('[Stats] Error fetching Plex metadata:', plexErr.message);
    }

    // Get watch history for this rating key (admin sees all, user sees own)
    if (isAdmin) {
      stats.watch_history = db.prepare(`
        SELECT wh.*, u.username
        FROM watch_history wh
        JOIN users u ON wh.user_id = u.id
        WHERE wh.plex_rating_key = ?
        ORDER BY wh.watched_at DESC
        LIMIT 10
      `).all(ratingKey);
    } else {
      stats.watch_history = db.prepare(`
        SELECT wh.*, u.username
        FROM watch_history wh
        JOIN users u ON wh.user_id = u.id
        WHERE wh.plex_rating_key = ? AND wh.user_id = ?
        ORDER BY wh.watched_at DESC
        LIMIT 10
      `).all(ratingKey, req.user.userId);
    }

    // Check if in deletion queue
    stats.queue_items = db.prepare(`
      SELECT q.*, r.name as rule_name
      FROM queue_items q
      LEFT JOIN rules r ON q.rule_id = r.id
      WHERE q.plex_rating_key = ? AND q.status = 'pending'
    `).all(ratingKey);

    res.json(stats);
  } catch (error) {
    console.error('[Stats] Error fetching Plex stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// =========================
// SCHEDULER ROUTES (Admin Only)
// =========================

app.get('/api/scheduler/status', authenticate, requireAdmin, (req, res) => {
  res.json(scheduler.getStatus());
});

app.post('/api/scheduler/run', authenticate, requireAdmin, async (req, res) => {
  const { dryRun } = req.body;

  try {
    const results = await scheduler.runNow(dryRun);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================
// PLEX SYNC ROUTES (Admin Only)
// =========================

// Get Plex sync status
app.get('/api/sync/status', authenticate, requireAdmin, (req, res) => {
  res.json(scheduler.getPlexSyncStatus());
});

// Trigger manual sync
app.post('/api/sync/run', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await scheduler.runPlexSync();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Force full resync (clears cache)
app.post('/api/sync/full', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await scheduler.forceFullPlexSync();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Process pending requests that weren't sent to Sonarr/Radarr
app.post('/api/sync/process-pending', authenticate, requireAdmin, async (req, res) => {
  try {
    const WatchlistTriggerService = require('./services/watchlist-trigger');
    const result = await WatchlistTriggerService.processPendingRequests();
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user velocities (watch speed data)
app.get('/api/sync/velocities', authenticate, requireAdmin, (req, res) => {
  const velocities = db.prepare(`
    SELECT
      v.*,
      u.username,
      u.thumb as user_thumb
    FROM user_velocity v
    JOIN users u ON v.user_id = u.id
    ORDER BY v.last_watched_at DESC
    LIMIT 100
  `).all();

  res.json(velocities);
});

// Get recent watch history
app.get('/api/sync/history', authenticate, requireAdmin, (req, res) => {
  const { limit = 50, userId } = req.query;

  let query = `
    SELECT
      h.*,
      u.username,
      u.thumb as user_thumb
    FROM watch_history h
    JOIN users u ON h.user_id = u.id
  `;

  const params = [];
  if (userId) {
    query += ' WHERE h.user_id = ?';
    params.push(userId);
  }

  query += ' ORDER BY h.watched_at DESC LIMIT ?';
  params.push(parseInt(limit) || 50);

  const history = db.prepare(query).all(...params);
  res.json(history);
});

// =========================
// VELOCITY CLEANUP ROUTES (Admin Only)
// =========================

// Get velocity cleanup status and summary
app.get('/api/cleanup/status', authenticate, requireAdmin, async (req, res) => {
  try {
    const status = await scheduler.getVelocityCleanupStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Run velocity cleanup (dry run by default)
app.post('/api/cleanup/run', authenticate, requireAdmin, async (req, res) => {
  const { dryRun = true } = req.body;

  try {
    const result = await scheduler.runVelocityCleanupNow(dryRun);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get cleanup candidates without running cleanup
app.get('/api/cleanup/preview', authenticate, requireAdmin, async (req, res) => {
  try {
    const Viper = require('./services/smart-episodes');
    const smartManager = new Viper();
    await smartManager.initialize();

    // Run as dry run to get candidates
    const episodeResults = await smartManager.runVelocityCleanup(true);
    const movieResults = await smartManager.runMovieCleanup(true);

    res.json({
      timestamp: new Date(),
      episodes: {
        analyzed: episodeResults.episodesAnalyzed,
        candidates: episodeResults.deletionCandidates,
        protected: episodeResults.protected?.length || 0
      },
      movies: {
        analyzed: movieResults.moviesAnalyzed,
        candidates: movieResults.deletionCandidates,
        protected: movieResults.protected?.length || 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Analyze a specific show's cleanup status
app.get('/api/cleanup/show/:ratingKey', authenticate, requireAdmin, async (req, res) => {
  const { ratingKey } = req.params;

  try {
    const Viper = require('./services/smart-episodes');
    const smartManager = new Viper();
    await smartManager.initialize();

    const analysis = await smartManager.analyzeShow(ratingKey);

    // Also get synced velocity data
    const velocityData = smartManager.getAllVelocitiesForShow(ratingKey);

    // Get historical episode stats (includes deleted episodes)
    const historicalStats = smartManager.getEpisodeStats(ratingKey);

    // Merge historical deleted episodes into the analysis
    const deletedEpisodes = historicalStats
      .filter(s => !s.is_available)
      .map(s => ({
        seasonNumber: s.season_number,
        episodeNumber: s.episode_number,
        title: s.episode_title,
        velocityPosition: s.velocity_position,
        safeToDelete: true,
        deletionReason: s.deletion_reason || 'Previously deleted',
        isDeleted: true,
        deletedAt: s.deleted_at,
        deletedByCleanup: s.deleted_by_cleanup === 1,
        usersBeyond: JSON.parse(s.users_beyond || '[]'),
        usersApproaching: JSON.parse(s.users_approaching || '[]'),
        lastAnalyzedAt: s.last_analyzed_at
      }));

    res.json({
      ...analysis,
      syncedVelocityData: velocityData,
      deletedEpisodes,
      historicalStats: {
        totalTracked: historicalStats.length,
        currentlyAvailable: historicalStats.filter(s => s.is_available).length,
        deleted: deletedEpisodes.length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all shows with active viewers
app.get('/api/cleanup/active-shows', authenticate, requireAdmin, async (req, res) => {
  const { days = 30 } = req.query;

  try {
    const Viper = require('./services/smart-episodes');
    const smartManager = new Viper();
    await smartManager.initialize();

    const activeShows = smartManager.getShowsWithActiveViewers(parseInt(days));

    res.json({
      timestamp: new Date(),
      daysActive: parseInt(days),
      shows: activeShows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get protection stats for troubleshooting
app.get('/api/cleanup/protection-stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const Viper = require('./services/smart-episodes');
    const smartManager = new Viper();
    await smartManager.initialize();

    const settings = smartManager.getSettings();

    // Get velocity data
    const velocities = db.prepare(`
      SELECT v.*, u.username
      FROM user_velocity v
      JOIN users u ON v.user_id = u.id
      ORDER BY v.last_watched_at DESC
    `).all();

    // Get watchlist stats
    const watchlistStats = db.prepare(`
      SELECT
        w.tmdb_id,
        w.title,
        w.media_type,
        u.username,
        julianday('now') - julianday(w.added_at) as days_since_added,
        w.added_at
      FROM watchlist w
      JOIN users u ON w.user_id = u.id
      WHERE w.is_active = 1 AND w.media_type = 'tv'
      ORDER BY w.added_at DESC
    `).all();

    // Get shows with protection reasons
    const protectionSummary = [];
    const activeShows = smartManager.getShowsWithActiveViewers(settings.activeViewerDays);

    for (const show of activeShows.slice(0, 20)) {
      const velocity = velocities.find(v => v.tmdb_id == show.show_rating_key);
      const watchlist = watchlistStats.filter(w => {
        // Try to match by title hash
        let hash = 0;
        for (let i = 0; i < (w.title || '').length; i++) {
          hash = ((hash << 5) - hash) + w.title.charCodeAt(i);
          hash = hash & hash;
        }
        return Math.abs(hash).toString() === show.show_rating_key;
      });

      protectionSummary.push({
        ratingKey: show.show_rating_key,
        activeViewers: show.active_viewers,
        slowestPosition: show.slowest_position,
        fastestPosition: show.fastest_position,
        avgVelocity: show.avg_velocity,
        lastActivity: show.last_activity,
        velocityData: velocity ? {
          username: velocity.username,
          position: velocity.current_position,
          season: velocity.current_season,
          episode: velocity.current_episode,
          epsPerDay: velocity.episodes_per_day
        } : null,
        watchlistUsers: watchlist.map(w => ({
          username: w.username,
          title: w.title,
          daysAgo: Math.round(w.days_since_added)
        }))
      });
    }

    res.json({
      timestamp: new Date(),
      settings: {
        enabled: settings.enabled,
        minDaysSinceWatch: settings.minDaysSinceWatch,
        velocityBufferDays: settings.velocityBufferDays,
        protectEpisodesAhead: settings.protectEpisodesAhead,
        maxEpisodesAhead: settings.maxEpisodesAhead,
        trimAheadEnabled: settings.trimAheadEnabled,
        watchlistGraceDays: settings.watchlistGraceDays,
        activeViewerDays: settings.activeViewerDays
      },
      velocities: velocities.map(v => ({
        username: v.username,
        showId: v.tmdb_id,
        position: `S${v.current_season}E${v.current_episode}`,
        epsPerDay: v.episodes_per_day?.toFixed(2),
        lastWatched: v.last_watched_at
      })),
      watchlistWithinGrace: watchlistStats.filter(w => w.days_since_added <= settings.watchlistGraceDays).map(w => ({
        title: w.title,
        username: w.username,
        daysAgo: Math.round(w.days_since_added)
      })),
      protectionReasons: {
        minDaysSinceWatch: `Episodes watched within last ${settings.minDaysSinceWatch} days are protected`,
        velocityBuffer: `${settings.velocityBufferDays} days buffer for approaching users`,
        maxAhead: `Max ${settings.maxEpisodesAhead} episodes ahead before trim`,
        graceperiod: `${settings.watchlistGraceDays} days grace for new watchlist adds`
      },
      activeShows: protectionSummary
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================
// RESTORATION ROUTES
// =========================

// Get user's restoration history
app.get('/api/restorations', authenticate, (req, res) => {
  const { limit = 50 } = req.query;
  const WatchlistTrigger = require('./services/watchlist-trigger');

  // Admin sees all, users see their own
  if (req.user.isAdmin) {
    const restorations = WatchlistTrigger.getAllRestorations({ limit: parseInt(limit) });
    res.json(restorations);
  } else {
    const restorations = WatchlistTrigger.getRestorationHistory(req.user.userId, parseInt(limit));
    res.json(restorations);
  }
});

// Get pending restorations (admin only)
app.get('/api/restorations/pending', authenticate, requireAdmin, (req, res) => {
  const WatchlistTrigger = require('./services/watchlist-trigger');
  const pending = WatchlistTrigger.getPendingRestorations();
  res.json(pending);
});

// Check if content needs restoration
app.get('/api/restorations/check/:mediaType/:tmdbId', authenticate, (req, res) => {
  const { mediaType, tmdbId } = req.params;

  // Validate mediaType
  if (!['movie', 'tv'].includes(mediaType)) {
    return res.status(400).json({ error: 'Invalid media type (must be movie or tv)' });
  }

  const WatchlistTrigger = require('./services/watchlist-trigger');

  const needsRestoration = WatchlistTrigger.needsRestoration(parseInt(tmdbId), mediaType);

  // Also get lifecycle and exclusion info
  const lifecycle = db.prepare(`
    SELECT * FROM lifecycle WHERE tmdb_id = ? AND media_type = ?
  `).get(parseInt(tmdbId), mediaType);

  const exclusion = db.prepare(`
    SELECT * FROM exclusions WHERE tmdb_id = ? AND media_type = ?
  `).get(parseInt(tmdbId), mediaType);

  res.json({
    needsRestoration,
    lifecycle,
    exclusion,
    wasDeleted: lifecycle?.deleted_at ? true : false,
    isExcluded: exclusion ? true : false
  });
});

// Manually trigger restoration for content
app.post('/api/restorations/restore', authenticate, async (req, res) => {
  const { tmdbId, mediaType } = req.body;

  if (!tmdbId || !mediaType) {
    return res.status(400).json({ error: 'tmdbId and mediaType required' });
  }

  try {
    const WatchlistTrigger = require('./services/watchlist-trigger');
    const TMDBService = require('./services/tmdb');

    await WatchlistTrigger.initialize();

    // Get TMDB details
    const details = mediaType === 'movie'
      ? await TMDBService.getMovie(tmdbId)
      : await TMDBService.getTVShow(tmdbId);

    // Perform restoration
    const result = await WatchlistTrigger.handleRestoration(tmdbId, mediaType, details, req.user.userId);

    // Also trigger download if restoration was successful
    if (result.restored) {
      const downloadResult = await WatchlistTrigger.triggerDownload(tmdbId, mediaType, details);
      result.downloadTriggered = downloadResult.success;
      result.downloadResult = downloadResult;
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get exclusions with TMDB info (admin only)
app.get('/api/exclusions', authenticate, requireAdmin, (req, res) => {
  const { type, mediaType } = req.query;

  let query = 'SELECT * FROM exclusions WHERE 1=1';
  const params = [];

  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }

  if (mediaType) {
    query += ' AND media_type = ?';
    params.push(mediaType);
  }

  query += ' ORDER BY created_at DESC';

  const exclusions = db.prepare(query).all(...params);
  res.json(exclusions);
});

// Add to exclusions (admin only)
app.post('/api/exclusions', authenticate, requireAdmin, (req, res) => {
  const { type, tmdbId, mediaType, title, reason, expiresAt } = req.body;

  if (!type) {
    return res.status(400).json({ error: 'type is required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO exclusions (type, tmdb_id, media_type, title, reason, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(type, tmdbId || null, mediaType || null, title || null, reason || null, expiresAt || null);

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// =====================================================
// MEDIA PROTECTION API
// =====================================================

// Get protection status for a media item
app.get('/api/protection/:mediaType/:tmdbId', authenticate, async (req, res) => {
  const { mediaType, tmdbId } = req.params;

  if (!['movie', 'tv'].includes(mediaType)) {
    return res.status(400).json({ error: 'Invalid media type' });
  }

  try {
    const protection = db.prepare(`
      SELECT * FROM exclusions
      WHERE tmdb_id = ? AND media_type = ? AND type = 'manual_protection'
    `).get(parseInt(tmdbId), mediaType);

    res.json({
      protected: !!protection,
      protection: protection || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle protection for a media item
app.post('/api/protection/:mediaType/:tmdbId', authenticate, async (req, res) => {
  const { mediaType, tmdbId } = req.params;
  const { title, protect } = req.body;

  if (!['movie', 'tv'].includes(mediaType)) {
    return res.status(400).json({ error: 'Invalid media type' });
  }

  try {
    const existing = db.prepare(`
      SELECT * FROM exclusions
      WHERE tmdb_id = ? AND media_type = ? AND type = 'manual_protection'
    `).get(parseInt(tmdbId), mediaType);

    if (protect === false || (protect === undefined && existing)) {
      if (existing) {
        db.prepare(`
          DELETE FROM exclusions
          WHERE tmdb_id = ? AND media_type = ? AND type = 'manual_protection'
        `).run(parseInt(tmdbId), mediaType);

        log('info', 'protection', 'Media protection removed', {
          tmdb_id: parseInt(tmdbId),
          media_type: mediaType,
          title,
          user_id: req.user.userId
        });
      }
      res.json({ protected: false, message: 'Protection removed' });
    } else {
      if (!existing) {
        db.prepare(`
          INSERT INTO exclusions (type, tmdb_id, media_type, title, reason, created_at)
          VALUES ('manual_protection', ?, ?, ?, 'Manual protection by user', CURRENT_TIMESTAMP)
        `).run(parseInt(tmdbId), mediaType, title || 'Unknown');

        log('info', 'protection', 'Media protection added', {
          tmdb_id: parseInt(tmdbId),
          media_type: mediaType,
          title,
          user_id: req.user.userId
        });

        // Monitor in Sonarr/Radarr and trigger search to ensure all content is available
        try {
          if (mediaType === 'tv') {
            // Find and monitor TV show in Sonarr
            const sonarrs = SonarrService.getAllFromDb();
            for (const sonarr of sonarrs) {
              const series = await sonarr.getSeries();
              const match = series.find(s => {
                // Try to match by TMDB ID or title
                const tmdbMatch = s.tvdbId && s.tvdbId === parseInt(tmdbId);
                const titleMatch = title && (
                  s.title.toLowerCase() === title.toLowerCase() ||
                  s.sortTitle?.toLowerCase() === title.toLowerCase()
                );
                return tmdbMatch || titleMatch;
              });

              if (match) {
                console.log(`[Protection] Found "${title}" in Sonarr, monitoring all episodes...`);

                // Set series to monitored
                if (!match.monitored) {
                  match.monitored = true;
                  await sonarr.client.put(`/series/${match.id}`, match);
                  console.log(`[Protection] Set series "${title}" to monitored`);
                }

                // Get all episodes and monitor them
                const episodes = await sonarr.getEpisodes(match.id);
                const unmonitoredIds = episodes.filter(e => !e.monitored).map(e => e.id);

                if (unmonitoredIds.length > 0) {
                  await sonarr.client.put('/episode/monitor', {
                    episodeIds: unmonitoredIds,
                    monitored: true
                  });
                  console.log(`[Protection] Monitored ${unmonitoredIds.length} episodes for "${title}"`);
                }

                // Trigger series search to download any missing episodes
                await sonarr.searchSeries(match.id);
                console.log(`[Protection] Triggered search for all episodes of "${title}"`);
                break;
              }
            }
          } else if (mediaType === 'movie') {
            // Find and monitor movie in Radarr
            const radarrs = RadarrService.getAllFromDb();
            let movieFound = false;
            for (const radarr of radarrs) {
              const movies = await radarr.getMovies();
              const match = movies.find(m => {
                // Try to match by TMDB ID or title
                const tmdbMatch = m.tmdbId && m.tmdbId === parseInt(tmdbId);
                const titleMatch = title && m.title.toLowerCase() === title.toLowerCase();
                return tmdbMatch || titleMatch;
              });

              if (match) {
                movieFound = true;
                if (!match.monitored) {
                  console.log(`[Protection] Found "${title}" in Radarr, setting to monitored...`);
                  match.monitored = true;
                  await radarr.client.put(`/movie/${match.id}`, match);
                  console.log(`[Protection] Set movie "${title}" to monitored`);
                }
                // Trigger search to download if missing
                if (!match.hasFile) {
                  await radarr.searchMovie(match.id);
                  console.log(`[Protection] Triggered search for movie "${title}"`);
                }
                break;
              }
            }

            // If not found in Radarr, add it via WatchlistTriggerService
            if (!movieFound) {
              console.log(`[Protection] Movie "${title}" not in Radarr, adding via WatchlistTrigger...`);
              const WatchlistTriggerService = require('./services/watchlist-trigger');
              const TMDBService = require('./services/tmdb');
              const details = await TMDBService.getMovie(parseInt(tmdbId));
              if (details) {
                const result = await WatchlistTriggerService.triggerDownload(parseInt(tmdbId), 'movie', details);
                console.log(`[Protection] Added movie "${title}" to Radarr:`, result.success ? 'success' : result.error);
              }
            }
          }

          // Also add to Sonarr/Radarr if not found (TV shows)
          if (mediaType === 'tv') {
            const sonarrs = SonarrService.getAllFromDb();
            let showFound = false;
            for (const sonarr of sonarrs) {
              const series = await sonarr.getSeries();
              if (series.some(s => s.tvdbId === parseInt(tmdbId) || (title && s.title.toLowerCase() === title.toLowerCase()))) {
                showFound = true;
                break;
              }
            }
            if (!showFound) {
              console.log(`[Protection] TV show "${title}" not in Sonarr, adding via WatchlistTrigger...`);
              const WatchlistTriggerService = require('./services/watchlist-trigger');
              const TMDBService = require('./services/tmdb');
              const details = await TMDBService.getTVShow(parseInt(tmdbId));
              if (details) {
                const result = await WatchlistTriggerService.triggerDownload(parseInt(tmdbId), 'tv', details);
                console.log(`[Protection] Added TV show "${title}" to Sonarr:`, result.success ? 'success' : result.error);
              }
            }
          }
        } catch (sonarrRadarrErr) {
          console.error('[Protection] Error updating Sonarr/Radarr monitoring:', sonarrRadarrErr.message);
          // Don't fail the protection if Sonarr/Radarr update fails
        }
      }
      res.json({ protected: true, message: 'Protection added' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all protected media (admin only)
app.get('/api/protection', authenticate, requireAdmin, (req, res) => {
  try {
    const protectedItems = db.prepare(`
      SELECT * FROM exclusions
      WHERE type = 'manual_protection'
      ORDER BY created_at DESC
    `).all();
    res.json(protectedItems);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove from exclusions (admin only)
app.delete('/api/exclusions/:id', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;

  try {
    const exclusion = db.prepare('SELECT id FROM exclusions WHERE id = ?').get(id);
    if (!exclusion) {
      return res.status(404).json({ error: 'Exclusion not found' });
    }
    db.prepare('DELETE FROM exclusions WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk remove exclusions by TMDB ID (admin only)
app.delete('/api/exclusions/tmdb/:mediaType/:tmdbId', authenticate, requireAdmin, async (req, res) => {
  const { mediaType, tmdbId } = req.params;
  const { removeFromArr = true } = req.query;

  // Validate mediaType
  if (!['movie', 'tv'].includes(mediaType)) {
    return res.status(400).json({ error: 'Invalid media type (must be movie or tv)' });
  }

  try {
    // Remove from Flexerr exclusions
    const result = db.prepare(`
      DELETE FROM exclusions WHERE tmdb_id = ? AND media_type = ?
    `).run(parseInt(tmdbId), mediaType);

    let arrResult = null;

    // Also remove from Sonarr/Radarr if requested
    if (removeFromArr === 'true') {
      const WatchlistTrigger = require('./services/watchlist-trigger');
      await WatchlistTrigger.initialize();

      if (mediaType === 'movie' && WatchlistTrigger.radarr) {
        try {
          await WatchlistTrigger.radarr.removeExclusionByTmdbId(parseInt(tmdbId));
          arrResult = 'Removed from Radarr';
        } catch (e) {
          arrResult = `Radarr: ${e.message}`;
        }
      } else if (mediaType === 'tv' && WatchlistTrigger.sonarr) {
        try {
          const TMDBService = require('./services/tmdb');
          const externalIds = await TMDBService.getExternalIds(parseInt(tmdbId), 'tv');
          if (externalIds?.tvdb_id) {
            await WatchlistTrigger.sonarr.removeExclusionByTvdbId(externalIds.tvdb_id);
            arrResult = 'Removed from Sonarr';
          }
        } catch (e) {
          arrResult = `Sonarr: ${e.message}`;
        }
      }
    }

    res.json({
      success: true,
      flexerrRemoved: result.changes,
      arrResult
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================
// LEAVING SOON ROUTES
// =========================

// Get items scheduled for deletion (leaving soon)
app.get('/api/leaving-soon', authenticate, async (req, res) => {
  const { limit = 100, includeExpired = false } = req.query;

  let query = `
    SELECT
      q.*,
      r.name as rule_name,
      r.description as rule_description
    FROM queue_items q
    LEFT JOIN rules r ON q.rule_id = r.id
    WHERE q.status = 'pending'
  `;

  if (includeExpired !== 'true') {
    query += ` AND q.action_at > datetime('now')`;
  }

  query += ` ORDER BY q.action_at ASC LIMIT ?`;

  const items = db.prepare(query).all(parseInt(limit));

  // Use shared TMDB utility for image fetching with caching
  const posterCache = {};

  // Add days remaining, check watchlist, and fetch TMDB posters
  const enrichedItems = await Promise.all(items.map(async (item) => {
    const actionDate = new Date(item.action_at);
    const now = new Date();
    const daysRemaining = Math.ceil((actionDate - now) / (1000 * 60 * 60 * 24));

    // Check if manually protected (exclusions table - bypasses all rules)
    const mediaTypeForProtection = item.media_type === 'episode' ? 'tv' : item.media_type;
    const isProtected = item.tmdb_id ? db.prepare(`
      SELECT COUNT(*) as count FROM exclusions
      WHERE tmdb_id = ? AND media_type = ? AND type = 'manual_protection'
    `).get(item.tmdb_id, mediaTypeForProtection)?.count > 0 : false;

    // Use shared utility for image fetching
    const posterUrl = await TMDBService.getQueueItemImage(item, posterCache);

    return {
      ...item,
      poster_url: posterUrl,
      daysRemaining,
      isExpired: daysRemaining < 0,
      isProtected
    };
  }));

  res.json(enrichedItems);
});

// Get leaving soon stats
app.get('/api/leaving-soon/stats', authenticate, (req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN action_at <= datetime('now', '+7 days') THEN 1 ELSE 0 END) as within_week,
      SUM(CASE WHEN action_at <= datetime('now', '+1 day') THEN 1 ELSE 0 END) as within_day,
      SUM(CASE WHEN media_type = 'movie' THEN 1 ELSE 0 END) as movies,
      SUM(CASE WHEN media_type = 'episode' THEN 1 ELSE 0 END) as episodes,
      SUM(CASE WHEN media_type = 'show' THEN 1 ELSE 0 END) as shows
    FROM queue_items
    WHERE status = 'pending'
  `).get();

  res.json(stats);
});

// Protect item from deletion (add to watchlist)
app.post('/api/leaving-soon/:id/protect', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    // Get the queue item
    const item = db.prepare('SELECT * FROM queue_items WHERE id = ?').get(id);

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (!item.tmdb_id) {
      return res.status(400).json({ error: 'Item does not have TMDB ID for watchlist' });
    }

    // Add to user's watchlist
    const WatchlistTrigger = require('./services/watchlist-trigger');
    const result = await WatchlistTrigger.addToWatchlist(
      req.user.userId,
      item.tmdb_id,
      item.media_type === 'episode' ? 'tv' : item.media_type
    );

    if (result.success) {
      // Remove from queue since it's now protected
      db.prepare(`
        UPDATE queue_items SET status = 'cancelled', error_message = 'Protected by watchlist'
        WHERE id = ?
      `).run(id);

      res.json({
        success: true,
        message: `${item.title} added to your watchlist and protected from deletion`
      });
    } else {
      res.json({
        success: false,
        error: result.error || 'Could not add to watchlist'
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove item from leaving soon queue (admin only)
app.delete('/api/leaving-soon/:id', authenticate, requireAdmin, (req, res) => {
  const { id } = req.params;

  try {
    const item = db.prepare('SELECT id FROM queue_items WHERE id = ?').get(id);
    if (!item) {
      return res.status(404).json({ error: 'Queue item not found' });
    }
    db.prepare('DELETE FROM queue_items WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================
// MEDIA REPAIR ROUTES
// =========================

const MediaRepairService = require('./services/media-repair');

// Get episodes for a TV show (for repair selection)
app.get('/api/repairs/episodes/:tmdbId', authenticate, async (req, res) => {
  const { tmdbId } = req.params;

  try {
    const sonarr = SonarrService.fromDb();
    if (!sonarr) {
      return res.status(400).json({ error: 'Sonarr not configured' });
    }

    // Get TVDB ID from TMDB
    if (!TMDBService.isConfigured()) {
      return res.status(400).json({ error: 'TMDB not configured' });
    }

    const externalIds = await TMDBService.getExternalIds(tmdbId, 'tv');
    const tvdbId = externalIds?.tvdb_id;

    if (!tvdbId) {
      return res.status(404).json({ error: 'Could not find TVDB ID for this show' });
    }

    // Find series in Sonarr
    const series = await sonarr.getSeriesByTvdbId(tvdbId);
    if (!series) {
      return res.status(404).json({ error: 'Show not found in Sonarr' });
    }

    // Get episodes
    const episodes = await sonarr.getEpisodes(series.id);

    // Format response
    const formattedEpisodes = episodes.map(ep => ({
      id: ep.id,
      seasonNumber: ep.seasonNumber,
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      hasFile: ep.hasFile,
      episodeFileId: ep.episodeFileId,
      quality: ep.episodeFile?.quality?.quality?.name
    }));

    res.json({
      tvdbId,
      seriesId: series.id,
      episodes: formattedEpisodes
    });
  } catch (error) {
    console.error('[Repairs] Failed to get episodes:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get repair requests (user sees own, admin sees all)
app.get('/api/repairs', authenticate, (req, res) => {
  const { status } = req.query;

  let requests;
  if (req.user.isAdmin) {
    requests = MediaRepairService.getRepairRequests(null, status);
  } else {
    requests = MediaRepairService.getRepairRequests(req.user.userId, status);
  }

  res.json(requests.map(r => ({
    ...r,
    dv_profile: r.dv_profile ? JSON.parse(r.dv_profile) : null
  })));
});

// Get file info for content (to show current quality, DV status)
// NOTE: Must be BEFORE /api/repairs/:id to avoid route conflict
app.get('/api/repairs/file-info/:mediaType/:tmdbId', authenticate, async (req, res) => {
  const { mediaType, tmdbId } = req.params;

  try {
    const repairService = new MediaRepairService();
    const fileInfo = await repairService.getFileInfo(parseInt(tmdbId), mediaType);

    if (!fileInfo) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json(fileInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single repair request
app.get('/api/repairs/:id', authenticate, (req, res) => {
  const request = MediaRepairService.getRepairRequest(req.params.id);

  if (!request) {
    return res.status(404).json({ error: 'Repair request not found' });
  }

  // Non-admins can only see their own requests
  if (!req.user.isAdmin && request.user_id !== req.user.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json({
    ...request,
    dv_profile: request.dv_profile ? JSON.parse(request.dv_profile) : null
  });
});

// Create repair request (quality upgrade, wrong content, etc.)
app.post('/api/repairs', authenticate, async (req, res) => {
  const { tmdbId, mediaType, requestType, reason, requestedQuality, blacklistCurrent } = req.body;

  if (!tmdbId || !mediaType || !requestType) {
    return res.status(400).json({ error: 'tmdbId, mediaType, and requestType are required' });
  }

  try {
    const TMDBService = require('./services/tmdb');

    // Get TMDB details
    const details = mediaType === 'movie'
      ? await TMDBService.getMovie(tmdbId)
      : await TMDBService.getTVShow(tmdbId);

    // Get current file info
    const repairService = new MediaRepairService();
    const fileInfo = await repairService.getFileInfo(tmdbId, mediaType);

    // Build reason with blacklist preference
    const fullReason = blacklistCurrent
      ? `${reason || requestType} [BLACKLIST REQUESTED]`
      : reason || requestType;

    const requestId = MediaRepairService.createRepairRequest({
      user_id: req.user.userId,
      tmdb_id: tmdbId,
      media_type: mediaType,
      title: details.title || details.name,
      year: details.year || (details.first_air_date ? parseInt(details.first_air_date.split('-')[0]) : null),
      poster_path: details.poster_path,
      radarr_id: fileInfo?.radarrId,
      request_type: requestType,
      reason: fullReason,
      current_quality: fileInfo?.quality,
      requested_quality: requestedQuality,
      current_file_path: fileInfo?.path,
      file_size_bytes: fileInfo?.size,
      dv_profile: fileInfo?.dvInfo ? JSON.stringify(fileInfo.dvInfo) : null
    });

    // Log the repair request
    log('info', 'repair', `Repair request submitted: ${details.title || details.name}`, {
      user_id: req.user.userId,
      tmdb_id: tmdbId,
      media_type: mediaType,
      request_type: requestType,
      blacklist: blacklistCurrent
    });

    res.json({ success: true, id: requestId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Process repair request (admin only)
app.post('/api/repairs/:id/process', authenticate, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { blacklistCurrent = false } = req.body;

  try {
    const request = MediaRepairService.getRepairRequest(id);

    if (!request) {
      return res.status(404).json({ error: 'Repair request not found' });
    }

    const repairService = new MediaRepairService();
    let result;

    if (request.request_type === 'quality_upgrade' || request.request_type === 'wrong_content') {
      result = await repairService.processQualityUpgrade(id, blacklistCurrent);
    } else if (request.request_type === 'dv_conversion') {
      result = await repairService.processDVConversion(id);
    } else if (['audio_issue', 'subtitle_issue', 'other'].includes(request.request_type)) {
      // For these issues, just trigger a new search (blacklist if requested)
      result = await repairService.processQualityUpgrade(id, blacklistCurrent);
    } else {
      return res.status(400).json({ error: `Unknown request type: ${request.request_type}` });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel/delete repair request
app.delete('/api/repairs/:id', authenticate, (req, res) => {
  const { id } = req.params;

  const request = MediaRepairService.getRepairRequest(id);

  if (!request) {
    return res.status(404).json({ error: 'Repair request not found' });
  }

  // Non-admins can only delete their own pending requests
  if (!req.user.isAdmin) {
    if (request.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Can only cancel pending requests' });
    }
  }

  MediaRepairService.deleteRepairRequest(id);
  res.json({ success: true });
});

// Scan library for DV Profile 5 content (admin only)
app.get('/api/repairs/scan/dv5', authenticate, requireAdmin, async (req, res) => {
  try {
    const repairService = new MediaRepairService();
    const items = await repairService.scanForDVProfile5();
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auto-create repair requests for DV Profile 5 content (admin only)
app.post('/api/repairs/auto-detect/dv5', authenticate, requireAdmin, async (req, res) => {
  try {
    const repairService = new MediaRepairService();
    const created = await repairService.autoRepairDVProfile5(req.user.userId);
    res.json({
      success: true,
      created: created.length,
      items: created
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get repair stats (admin only)
app.get('/api/repairs/stats', authenticate, requireAdmin, (req, res) => {
  const stats = {
    total: db.prepare('SELECT COUNT(*) as count FROM repair_requests').get().count,
    pending: db.prepare("SELECT COUNT(*) as count FROM repair_requests WHERE status = 'pending'").get().count,
    processing: db.prepare("SELECT COUNT(*) as count FROM repair_requests WHERE status = 'processing'").get().count,
    completed: db.prepare("SELECT COUNT(*) as count FROM repair_requests WHERE status = 'completed'").get().count,
    failed: db.prepare("SELECT COUNT(*) as count FROM repair_requests WHERE status = 'failed'").get().count,
    byType: {
      quality_upgrade: db.prepare("SELECT COUNT(*) as count FROM repair_requests WHERE request_type = 'quality_upgrade'").get().count,
      dv_conversion: db.prepare("SELECT COUNT(*) as count FROM repair_requests WHERE request_type = 'dv_conversion'").get().count
    }
  };
  res.json(stats);
});

// =========================
// QUALITY PROFILE ROUTES (Admin Only)
// =========================

// Get Radarr quality profiles and settings
app.get('/api/quality/radarr', authenticate, requireAdmin, async (req, res) => {
  try {
    const radarr = RadarrService.fromDb();
    if (!radarr) {
      return res.status(400).json({ error: 'Radarr not configured' });
    }

    const [profiles, rootFolders] = await Promise.all([
      radarr.getQualityProfiles(),
      radarr.getRootFolders()
    ]);

    // Recommend a good profile for Plex compatibility
    const recommendations = [];
    for (const profile of profiles) {
      const hasRemux = profile.items?.some(i =>
        i.allowed && i.quality?.name?.toLowerCase().includes('remux')
      );
      const hasBluray = profile.items?.some(i =>
        i.allowed && i.quality?.name?.toLowerCase().includes('bluray')
      );
      const has4k = profile.items?.some(i =>
        i.allowed && (i.quality?.name?.includes('2160') || i.quality?.name?.toLowerCase().includes('4k'))
      );

      if (hasRemux && has4k) {
        recommendations.push({
          profileId: profile.id,
          profileName: profile.name,
          note: 'Good - Includes 4K Remux (may include DV Profile 5)'
        });
      } else if (hasBluray && has4k) {
        recommendations.push({
          profileId: profile.id,
          profileName: profile.name,
          note: 'Good - Includes 4K Bluray'
        });
      }
    }

    res.json({
      profiles,
      rootFolders,
      recommendations,
      note: 'For best Plex compatibility, use profiles that include Bluray/Remux qualities. DV Profile 5 content may need repair.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Sonarr quality profiles and settings
app.get('/api/quality/sonarr', authenticate, requireAdmin, async (req, res) => {
  try {
    const sonarr = SonarrService.fromDb();
    if (!sonarr) {
      return res.status(400).json({ error: 'Sonarr not configured' });
    }

    const [profiles, rootFolders] = await Promise.all([
      sonarr.getQualityProfiles(),
      sonarr.getRootFolders()
    ]);

    res.json({
      profiles,
      rootFolders,
      note: 'Sonarr quality profiles determine which releases are downloaded for TV shows.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get quality profile summary for dashboard
app.get('/api/quality/summary', authenticate, requireAdmin, async (req, res) => {
  const summary = {
    radarr: null,
    sonarr: null
  };

  try {
    const radarr = RadarrService.fromDb();
    if (radarr) {
      const profiles = await radarr.getQualityProfiles();
      summary.radarr = {
        profileCount: profiles.length,
        profiles: profiles.map(p => ({
          id: p.id,
          name: p.name,
          cutoff: p.cutoff?.name || 'Unknown'
        }))
      };
    }
  } catch (e) {
    summary.radarr = { error: e.message };
  }

  try {
    const sonarr = SonarrService.fromDb();
    if (sonarr) {
      const profiles = await sonarr.getQualityProfiles();
      summary.sonarr = {
        profileCount: profiles.length,
        profiles: profiles.map(p => ({
          id: p.id,
          name: p.name,
          cutoff: p.cutoff?.name || 'Unknown'
        }))
      };
    }
  } catch (e) {
    summary.sonarr = { error: e.message };
  }

  res.json(summary);
});

// =========================
// CATEGORIZATION RULES
// =========================

const CategorizationEngine = require('./services/categorization-engine');

// Get all categorization rules
app.get('/api/categorization', authenticate, requireAdmin, (req, res) => {
  try {
    const rules = db.prepare(`
      SELECT * FROM categorization_rules
      ORDER BY priority DESC, id ASC
    `).all();

    // Parse JSON fields
    const parsed = rules.map(rule => ({
      ...rule,
      conditions: JSON.parse(rule.conditions || '{"operator":"AND","conditions":[]}'),
      radarr_tags: JSON.parse(rule.radarr_tags || '[]'),
      sonarr_tags: JSON.parse(rule.sonarr_tags || '[]')
    }));

    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single categorization rule
app.get('/api/categorization/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const rule = db.prepare('SELECT * FROM categorization_rules WHERE id = ?').get(req.params.id);

    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    res.json({
      ...rule,
      conditions: JSON.parse(rule.conditions || '{"operator":"AND","conditions":[]}'),
      radarr_tags: JSON.parse(rule.radarr_tags || '[]'),
      sonarr_tags: JSON.parse(rule.sonarr_tags || '[]')
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create categorization rule
app.post('/api/categorization', authenticate, requireAdmin, (req, res) => {
  try {
    const {
      name, description, target_type, conditions,
      mode, collection_name,
      radarr_root_folder, radarr_quality_profile_id, radarr_tags,
      sonarr_root_folder, sonarr_quality_profile_id, sonarr_tags,
      priority, is_active
    } = req.body;

    if (!name || !target_type) {
      return res.status(400).json({ error: 'Name and target_type are required' });
    }

    // Validate collection mode has collection_name
    if (mode === 'collection' && !collection_name) {
      return res.status(400).json({ error: 'Collection name is required for collection mode' });
    }

    const result = db.prepare(`
      INSERT INTO categorization_rules (
        name, description, target_type, conditions,
        mode, collection_name,
        radarr_root_folder, radarr_quality_profile_id, radarr_tags,
        sonarr_root_folder, sonarr_quality_profile_id, sonarr_tags,
        priority, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      description || null,
      target_type,
      JSON.stringify(conditions || { operator: 'AND', conditions: [] }),
      mode || 'collection',
      collection_name || null,
      radarr_root_folder || null,
      radarr_quality_profile_id || null,
      JSON.stringify(radarr_tags || []),
      sonarr_root_folder || null,
      sonarr_quality_profile_id || null,
      JSON.stringify(sonarr_tags || []),
      priority || 0,
      is_active !== false ? 1 : 0
    );

    CategorizationEngine.clearCache();

    log('info', 'categorization', 'Rule created', {
      user_id: req.user.id,
      details: { ruleId: result.lastInsertRowid, name, mode: mode || 'collection' }
    });

    res.json({ id: result.lastInsertRowid, message: 'Rule created' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update categorization rule
app.put('/api/categorization/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const {
      name, description, target_type, conditions,
      mode, collection_name,
      radarr_root_folder, radarr_quality_profile_id, radarr_tags,
      sonarr_root_folder, sonarr_quality_profile_id, sonarr_tags,
      priority, is_active
    } = req.body;

    const existing = db.prepare('SELECT * FROM categorization_rules WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    // Validate collection mode has collection_name
    const newMode = mode !== undefined ? mode : existing.mode;
    const newCollectionName = collection_name !== undefined ? collection_name : existing.collection_name;
    if (newMode === 'collection' && !newCollectionName) {
      return res.status(400).json({ error: 'Collection name is required for collection mode' });
    }

    db.prepare(`
      UPDATE categorization_rules SET
        name = ?, description = ?, target_type = ?, conditions = ?,
        mode = ?, collection_name = ?,
        radarr_root_folder = ?, radarr_quality_profile_id = ?, radarr_tags = ?,
        sonarr_root_folder = ?, sonarr_quality_profile_id = ?, sonarr_tags = ?,
        priority = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name || existing.name,
      description !== undefined ? description : existing.description,
      target_type || existing.target_type,
      conditions ? JSON.stringify(conditions) : existing.conditions,
      newMode || 'collection',
      newCollectionName,
      radarr_root_folder !== undefined ? radarr_root_folder : existing.radarr_root_folder,
      radarr_quality_profile_id !== undefined ? radarr_quality_profile_id : existing.radarr_quality_profile_id,
      radarr_tags ? JSON.stringify(radarr_tags) : existing.radarr_tags,
      sonarr_root_folder !== undefined ? sonarr_root_folder : existing.sonarr_root_folder,
      sonarr_quality_profile_id !== undefined ? sonarr_quality_profile_id : existing.sonarr_quality_profile_id,
      sonarr_tags ? JSON.stringify(sonarr_tags) : existing.sonarr_tags,
      priority !== undefined ? priority : existing.priority,
      is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
      req.params.id
    );

    CategorizationEngine.clearCache();

    res.json({ message: 'Rule updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete categorization rule
app.delete('/api/categorization/:id', authenticate, requireAdmin, (req, res) => {
  try {
    const rule = db.prepare('SELECT * FROM categorization_rules WHERE id = ?').get(req.params.id);
    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    db.prepare('DELETE FROM categorization_rules WHERE id = ?').run(req.params.id);
    CategorizationEngine.clearCache();

    log('info', 'categorization', 'Rule deleted', {
      user_id: req.user.id,
      details: { ruleId: req.params.id, name: rule.name }
    });

    res.json({ message: 'Rule deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get available root folders and quality profiles from Radarr/Sonarr
app.get('/api/categorization/options', authenticate, requireAdmin, async (req, res) => {
  try {
    const options = {
      radarr: { rootFolders: [], qualityProfiles: [], tags: [] },
      sonarr: { rootFolders: [], qualityProfiles: [], tags: [] }
    };

    // Get Radarr options
    const radarrService = db.prepare("SELECT * FROM services WHERE type = 'radarr' AND is_active = 1").get();
    if (radarrService) {
      const RadarrService = require('./services/radarr');
      const radarr = new RadarrService(radarrService.url, radarrService.api_key);

      try {
        options.radarr.rootFolders = await radarr.getRootFolders();
        options.radarr.qualityProfiles = await radarr.getQualityProfiles();
        options.radarr.tags = await radarr.getTags();
      } catch (e) {
        console.error('[Categorization] Error fetching Radarr options:', e.message);
      }
    }

    // Get Sonarr options
    const sonarrService = db.prepare("SELECT * FROM services WHERE type = 'sonarr' AND is_active = 1").get();
    if (sonarrService) {
      const SonarrService = require('./services/sonarr');
      const sonarr = new SonarrService(sonarrService.url, sonarrService.api_key);

      try {
        options.sonarr.rootFolders = await sonarr.getRootFolders();
        options.sonarr.qualityProfiles = await sonarr.getQualityProfiles();
        options.sonarr.tags = await sonarr.getTags();
      } catch (e) {
        console.error('[Categorization] Error fetching Sonarr options:', e.message);
      }
    }

    res.json(options);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new root folder in Radarr or Sonarr
app.post('/api/categorization/rootfolder', authenticate, requireAdmin, async (req, res) => {
  try {
    const { path, service } = req.body;

    if (!path || !service) {
      return res.status(400).json({ error: 'Path and service (radarr/sonarr) are required' });
    }

    if (!['radarr', 'sonarr'].includes(service)) {
      return res.status(400).json({ error: 'Service must be radarr or sonarr' });
    }

    const serviceConfig = db.prepare(`SELECT * FROM services WHERE type = ? AND is_active = 1`).get(service);
    if (!serviceConfig) {
      return res.status(400).json({ error: `${service} is not configured` });
    }

    let result;
    if (service === 'radarr') {
      const RadarrService = require('./services/radarr');
      const radarr = new RadarrService(serviceConfig.url, serviceConfig.api_key);
      result = await radarr.addRootFolder(path);
    } else {
      const SonarrService = require('./services/sonarr');
      const sonarr = new SonarrService(serviceConfig.url, serviceConfig.api_key);
      result = await sonarr.addRootFolder(path);
    }

    log('info', 'categorization', 'Root folder created', {
      user_id: req.user.id,
      details: { service, path }
    });

    res.json({ success: true, rootFolder: result });
  } catch (error) {
    console.error('[Categorization] Error creating root folder:', error);
    res.status(500).json({ error: error.message });
  }
});

// Analyze library for categorization changes
app.get('/api/categorization/analyze', authenticate, requireAdmin, async (req, res) => {
  try {
    let radarr = null;
    let sonarr = null;

    const radarrService = db.prepare("SELECT * FROM services WHERE type = 'radarr' AND is_active = 1").get();
    if (radarrService) {
      const RadarrService = require('./services/radarr');
      radarr = new RadarrService(radarrService.url, radarrService.api_key);
    }

    const sonarrService = db.prepare("SELECT * FROM services WHERE type = 'sonarr' AND is_active = 1").get();
    if (sonarrService) {
      const SonarrService = require('./services/sonarr');
      sonarr = new SonarrService(sonarrService.url, sonarrService.api_key);
    }

    const analysis = await CategorizationEngine.analyzeLibrary(radarr, sonarr);
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Apply categorization to selected items
app.post('/api/categorization/apply', authenticate, requireAdmin, async (req, res) => {
  try {
    const { movies, shows } = req.body;

    let radarr = null;
    let sonarr = null;

    const radarrService = db.prepare("SELECT * FROM services WHERE type = 'radarr' AND is_active = 1").get();
    if (radarrService) {
      const RadarrService = require('./services/radarr');
      radarr = new RadarrService(radarrService.url, radarrService.api_key);
    }

    const sonarrService = db.prepare("SELECT * FROM services WHERE type = 'sonarr' AND is_active = 1").get();
    if (sonarrService) {
      const SonarrService = require('./services/sonarr');
      sonarr = new SonarrService(sonarrService.url, sonarrService.api_key);
    }

    const results = await CategorizationEngine.applyToExisting(radarr, sonarr, { movies, shows });

    log('info', 'categorization', 'Applied categorization', {
      user_id: req.user.id,
      details: {
        moviesSuccess: results.success.filter(r => r.type === 'movie').length,
        showsSuccess: results.success.filter(r => r.type === 'show').length,
        failed: results.failed.length
      }
    });

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sync all collection-mode categorization rules to Plex
app.post('/api/categorization/sync-all', authenticate, requireAdmin, async (req, res) => {
  try {
    const CollectionSync = require('./services/collection-sync');
    const results = await CollectionSync.syncAllCollections();
    res.json(results);
  } catch (error) {
    console.error('[Categorization] Collection sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sync a single collection-mode rule to Plex
app.post('/api/categorization/:id/sync', authenticate, requireAdmin, async (req, res) => {
  try {
    const CollectionSync = require('./services/collection-sync');
    const results = await CollectionSync.syncRule(parseInt(req.params.id));
    res.json(results);
  } catch (error) {
    console.error('[Categorization] Rule sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get collection sync status
app.get('/api/categorization/sync-status', authenticate, requireAdmin, (req, res) => {
  try {
    const CollectionSync = require('./services/collection-sync');
    res.json(CollectionSync.getSyncStatus());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =========================
// HEALTH CHECK
// =========================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    name: 'Flexerr'
  });
});

// =========================
// CATCH-ALL FOR SPA
// =========================

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
});

// =========================
// START SERVER
// =========================

app.listen(PORT, () => {
  console.log(`[Flexerr] Server running on port ${PORT}`);

  // Start scheduler if setup is complete
  if (getSetting('setup_complete') === 'true') {
    scheduler.start().catch(err => {
      console.error('[Scheduler] Failed to start:', err.message);
    });

    // Start collection sync scheduler (every 30 minutes)
    const CollectionSync = require('./services/collection-sync');
    setInterval(async () => {
      try {
        console.log('[CollectionSync] Running scheduled sync...');
        await CollectionSync.syncAllCollections();
      } catch (err) {
        console.error('[CollectionSync] Scheduled sync error:', err.message);
      }
    }, 30 * 60 * 1000); // 30 minutes

    // Run initial collection sync after 2 minutes (let everything else start first)
    setTimeout(async () => {
      try {
        console.log('[CollectionSync] Running initial sync...');
        await CollectionSync.syncAllCollections();
      } catch (err) {
        console.error('[CollectionSync] Initial sync error:', err.message);
      }
    }, 2 * 60 * 1000); // 2 minutes after startup
  }
});
