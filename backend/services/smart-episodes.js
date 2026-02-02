/**
 * VIPER - Velocity-Informed Protection & Episode Removal
 *
 * Intelligent episode lifecycle management system:
 * 1. Tracks multi-user watch progress and velocity
 * 2. Determines safe deletion candidates based on ALL users' positions
 * 3. Proactively re-downloads episodes before slower viewers need them
 * 4. Uses synced velocity data from plex-sync for efficiency
 */

const { db, getSetting, log } = require('../database');
const { MediaServerFactory } = require('./media-server');
const PlexService = require('./plex');
const SonarrService = require('./sonarr');
const RadarrService = require('./radarr');
const NotificationService = require('./notifications');

/**
 * Normalize a title for fuzzy matching
 * Handles leetspeak substitutions (1→I, 0→O, 3→E, etc.) and removes special chars
 */
function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/1/g, 'i')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/[^a-z0-9]/g, ''); // Remove all non-alphanumeric
}

class Viper {
  constructor() {
    this.plex = null;
    this.mediaServer = null;
    this.mediaServerType = null;
    this.sonarr = null;
  }

  /**
   * Convert season/episode to velocity position format (season * 100 + episode)
   * This is used for consistent position comparison with velocity data
   */
  toVelocityPosition(seasonNumber, episodeNumber) {
    return (seasonNumber * 100) + episodeNumber;
  }

  /**
   * Check if a media item is manually protected from deletion
   * @param {number} tmdbId - TMDB ID
   * @param {string} mediaType - 'movie' or 'tv'
   * @returns {Object} { protected: boolean, reason: string|null }
   */
  isManuallyProtected(tmdbId, mediaType) {
    if (!tmdbId || !mediaType) {
      return { protected: false, reason: null };
    }

    try {
      const protection = db.prepare(`
        SELECT * FROM exclusions
        WHERE tmdb_id = ? AND media_type = ? AND type = 'manual_protection'
      `).get(tmdbId, mediaType);

      if (protection) {
        return {
          protected: true,
          reason: 'Manually protected from deletion'
        };
      }

      return { protected: false, reason: null };
    } catch (err) {
      console.error('[Protection] Error checking protection status:', err.message);
      return { protected: false, reason: null };
    }
  }


  /**
   * Convert velocity position back to season/episode
   */
  fromVelocityPosition(position) {
    const season = Math.floor(position / 100);
    const episode = position % 100;
    return { season, episode };
  }

  /**
   * Compare if an episode is before, at, or after a velocity position
   * Returns: -1 if episode is before position, 0 if at, 1 if after
   */
  compareEpisodeToPosition(seasonNumber, episodeNumber, velocityPosition) {
    const episodePos = this.toVelocityPosition(seasonNumber, episodeNumber);
    if (episodePos < velocityPosition) return -1;
    if (episodePos > velocityPosition) return 1;
    return 0;
  }

  async initialize() {
    // IMPORTANT: Smart Episode Manager requires Plex-specific methods that aren't
    // in the media server abstraction yet. Always use PlexService directly.
    const plexService = PlexService.fromDb();
    if (plexService) {
      this.plex = plexService;
      this.mediaServer = plexService;
      this.mediaServerType = 'plex';
    } else {
      console.error('[VIPER] Plex service not configured - required for smart cleanup');
    }

    this.sonarr = SonarrService.fromDb();
    this.radarr = RadarrService.fromDb();
    return this;
  }

  // =========================================
  // EPISODE STATS PERSISTENCE
  // =========================================

  /**
   * Persist episode analysis to the database for historical tracking
   * Called after analyzing a show to save stats even after episodes are deleted
   */
  persistEpisodeStats(showRatingKey, showTitle, episodes) {
    const upsert = db.prepare(`
      INSERT INTO episode_stats (
        show_rating_key, show_title, season_number, episode_number, episode_title,
        velocity_position, is_available, safe_to_delete, deletion_reason,
        users_beyond, users_approaching, last_analyzed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(show_rating_key, season_number, episode_number) DO UPDATE SET
        show_title = excluded.show_title,
        episode_title = excluded.episode_title,
        velocity_position = excluded.velocity_position,
        is_available = excluded.is_available,
        safe_to_delete = excluded.safe_to_delete,
        deletion_reason = excluded.deletion_reason,
        users_beyond = excluded.users_beyond,
        users_approaching = excluded.users_approaching,
        last_analyzed_at = CURRENT_TIMESTAMP
    `);

    const transaction = db.transaction((eps) => {
      for (const ep of eps) {
        const velocityPos = this.toVelocityPosition(ep.seasonNumber, ep.episodeNumber);
        upsert.run(
          showRatingKey,
          showTitle,
          ep.seasonNumber,
          ep.episodeNumber,
          ep.title || null,
          velocityPos,
          1, // is_available = true (it's in Plex)
          ep.safeToDelete ? 1 : 0,
          ep.deletionReason || null,
          JSON.stringify(ep.usersBeyond || []),
          JSON.stringify(ep.usersApproaching || [])
        );
      }
    });

    try {
      transaction(episodes);
    } catch (e) {
      console.error('[VIPER] Error persisting episode stats:', e.message);
    }
  }

  /**
   * Mark an episode as deleted in the stats table
   */
  markEpisodeDeleted(showRatingKey, seasonNumber, episodeNumber, byCleanup = true) {
    try {
      db.prepare(`
        UPDATE episode_stats
        SET is_available = 0,
            deleted_at = CURRENT_TIMESTAMP,
            deleted_by_cleanup = ?
        WHERE show_rating_key = ? AND season_number = ? AND episode_number = ?
      `).run(byCleanup ? 1 : 0, showRatingKey, seasonNumber, episodeNumber);
    } catch (e) {
      console.error('[VIPER] Error marking episode deleted:', e.message);
    }
  }

  /**
   * Get all episode stats for a show (including deleted episodes)
   */
  getEpisodeStats(showRatingKey) {
    try {
      return db.prepare(`
        SELECT * FROM episode_stats
        WHERE show_rating_key = ?
        ORDER BY season_number, episode_number
      `).all(showRatingKey);
    } catch (e) {
      console.error('[VIPER] Error getting episode stats:', e.message);
      return [];
    }
  }

  /**
   * Get episode stats by show title (for when rating key changes)
   */
  getEpisodeStatsByTitle(showTitle) {
    try {
      return db.prepare(`
        SELECT * FROM episode_stats
        WHERE show_title = ?
        ORDER BY season_number, episode_number
      `).all(showTitle);
    } catch (e) {
      console.error('[VIPER] Error getting episode stats by title:', e.message);
      return [];
    }
  }

  // =========================================
  // SYNCED VELOCITY DATA ACCESS
  // =========================================

  /**
   * Get velocity data for a user/show from the synced user_velocity table
   * This is much faster than recalculating from Plex API
   */
  getSyncedVelocity(userId, showRatingKey) {
    try {
      // The plex-sync stores velocity using ratingKey as tmdb_id placeholder
      return db.prepare(`
        SELECT * FROM user_velocity
        WHERE user_id = ? AND tmdb_id = ?
      `).get(userId, showRatingKey);
    } catch (e) {
      return null;
    }
  }

  /**
   * Get all velocity data for a show (all users)
   */
  getAllVelocitiesForShow(showRatingKey) {
    try {
      return db.prepare(`
        SELECT v.*, u.username, u.plex_id
        FROM user_velocity v
        JOIN users u ON v.user_id = u.id
        WHERE v.tmdb_id = ?
        ORDER BY v.last_watched_at DESC
      `).all(showRatingKey);
    } catch (e) {
      return [];
    }
  }

  /**
   * Get all active velocities (users who watched in last N days)
   * Supports both Plex and Jellyfin velocity data
   */
  getActiveVelocities(daysActive = 30) {
    try {
      // Get Plex velocities from user_velocity table
      const plexVelocities = db.prepare(`
        SELECT v.*, u.username, u.plex_id, 'plex' as source
        FROM user_velocity v
        JOIN users u ON v.user_id = u.id
        WHERE v.last_watched_at >= datetime('now', '-' || ? || ' days')
        ORDER BY v.last_watched_at DESC
      `).all(daysActive);

      // Get Jellyfin velocities from jellyfin_user_velocity table
      const jellyfinVelocities = db.prepare(`
        SELECT
          jv.user_id,
          jv.series_id as tmdb_id,
          jv.series_name as title_hash,
          jv.velocity as episodes_per_day,
          (jv.current_season * 100 + jv.current_episode) as current_position,
          jv.last_watch as last_watched_at,
          u.username,
          u.plex_id,
          'jellyfin' as source
        FROM jellyfin_user_velocity jv
        JOIN users u ON jv.user_id = u.plex_id
        WHERE jv.last_watch >= datetime('now', '-' || ? || ' days')
        ORDER BY jv.last_watch DESC
      `).all(daysActive);

      // Combine and return both
      return [...plexVelocities, ...jellyfinVelocities];
    } catch (e) {
      console.error('[VIPER] Error getting active velocities:', e.message);
      return [];
    }
  }

  /**
   * Get shows with active viewers (for prioritized cleanup)
   * Combines data from both Plex and Jellyfin sources
   */
  getShowsWithActiveViewers(daysActive = 30) {
    try {
      // Get Plex shows
      const plexShows = db.prepare(`
        SELECT
          v.tmdb_id as show_rating_key,
          COUNT(DISTINCT v.user_id) as active_viewers,
          MIN(v.current_position) as slowest_position,
          MAX(v.current_position) as fastest_position,
          AVG(v.episodes_per_day) as avg_velocity,
          MAX(v.last_watched_at) as last_activity,
          'plex' as source
        FROM user_velocity v
        WHERE v.last_watched_at >= datetime('now', '-' || ? || ' days')
        GROUP BY v.tmdb_id
        HAVING COUNT(DISTINCT v.user_id) > 0
      `).all(daysActive);

      // Get Jellyfin shows
      const jellyfinShows = db.prepare(`
        SELECT
          jv.series_id as show_rating_key,
          COUNT(DISTINCT jv.user_id) as active_viewers,
          MIN(jv.current_season * 100 + jv.current_episode) as slowest_position,
          MAX(jv.current_season * 100 + jv.current_episode) as fastest_position,
          AVG(jv.velocity) as avg_velocity,
          MAX(jv.last_watch) as last_activity,
          'jellyfin' as source
        FROM jellyfin_user_velocity jv
        WHERE jv.last_watch >= datetime('now', '-' || ? || ' days')
        GROUP BY jv.series_id
        HAVING COUNT(DISTINCT jv.user_id) > 0
      `).all(daysActive);

      // Combine results - merge shows that appear in both sources
      const showsMap = new Map();

      for (const show of [...plexShows, ...jellyfinShows]) {
        if (showsMap.has(show.show_rating_key)) {
          const existing = showsMap.get(show.show_rating_key);
          // Merge data - take most conservative approach
          existing.active_viewers += show.active_viewers;
          existing.slowest_position = Math.min(existing.slowest_position, show.slowest_position);
          existing.fastest_position = Math.max(existing.fastest_position, show.fastest_position);
          existing.avg_velocity = (existing.avg_velocity + show.avg_velocity) / 2;
          existing.last_activity = existing.last_activity > show.last_activity ? existing.last_activity : show.last_activity;
          existing.source = 'both';
        } else {
          showsMap.set(show.show_rating_key, show);
        }
      }

      // Convert back to array and sort by last activity
      return Array.from(showsMap.values())
        .sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity));
    } catch (e) {
      console.error('[VIPER] Error getting shows with active viewers:', e.message);
      return [];
    }
  }

  /**
   * Get per-user buffer zone information for a show
   * Returns details about each user's watch position and required buffer
   *
   * SMART VELOCITY-BASED BUFFER CALCULATION:
   * - If user has reliable velocity data (>= minVelocitySamples): buffer = velocity × trimDaysAhead
   * - If velocity is unknown/unreliable: buffer = unknownVelocityBuffer (safe fallback)
   * - Buffer is capped at maxEpisodesAhead to prevent excessive storage use
   * - Always adds protectEpisodesAhead as minimum safety margin
   *
   * @param {string} showRatingKey - Plex rating key for the show
   * @returns {Array} Array of user buffer info
   */
  getUserBufferZones(showRatingKey, showTitle = null) {
    try {
      // Get all velocity data for this show
      // First try by ratingKey
      let velocities = db.prepare(`
        SELECT v.*, u.username, u.plex_id
        FROM user_velocity v
        JOIN users u ON v.user_id = u.id
        WHERE v.tmdb_id = ?
        ORDER BY v.last_watched_at DESC
      `).all(showRatingKey);

      // If not found and we have a title, try by title hash
      // (velocity calculated from watch_history uses title hash as tmdb_id)
      if (velocities.length === 0 && showTitle) {
        let hash = 0;
        for (let i = 0; i < showTitle.length; i++) {
          hash = ((hash << 5) - hash) + showTitle.charCodeAt(i);
          hash = hash & hash;
        }
        const titleHash = Math.abs(hash).toString();
        velocities = db.prepare(`
          SELECT v.*, u.username, u.plex_id
          FROM user_velocity v
          JOIN users u ON v.user_id = u.id
          WHERE v.tmdb_id = ?
          ORDER BY v.last_watched_at DESC
        `).all(titleHash);
      }

      const settings = this.getSettings();

      return velocities.map(v => {
        // Calculate days since last watch
        const lastWatchedDate = v.last_watched_at ? new Date(v.last_watched_at) : null;
        const daysSinceWatch = lastWatchedDate
          ? (Date.now() - lastWatchedDate.getTime()) / (1000 * 60 * 60 * 24)
          : null;

        // Determine if we have reliable velocity data
        const episodesWatched = v.episodes_watched || 0;
        const hasReliableVelocity = episodesWatched >= settings.minVelocitySamples;
        const rawVelocity = v.episodes_per_day || 0;

        // Calculate effective velocity
        let effectiveVelocity;
        let velocitySource;

        if (hasReliableVelocity && rawVelocity > 0) {
          // Use actual velocity data
          effectiveVelocity = rawVelocity;
          velocitySource = 'measured';
        } else if (rawVelocity > 0) {
          // Have some velocity but not enough samples - use it but note it's unreliable
          effectiveVelocity = rawVelocity;
          velocitySource = 'estimated';
        } else {
          // No velocity data - use default
          effectiveVelocity = settings.defaultVelocity;
          velocitySource = 'default';
        }

        // SMART BUFFER CALCULATION:
        // 1. Calculate velocity-based buffer (days ahead × episodes per day)
        // 2. Add minimum safety margin (protectEpisodesAhead)
        // 3. Apply fallback for unknown velocity
        // 4. Cap at maxEpisodesAhead to prevent excessive storage use

        let bufferAhead;
        if (velocitySource === 'measured') {
          // Reliable velocity: use velocity × days
          bufferAhead = Math.ceil(effectiveVelocity * settings.trimDaysAhead) + settings.protectEpisodesAhead;
        } else if (velocitySource === 'estimated') {
          // Unreliable velocity: use larger of velocity calculation or unknown buffer
          const velocityBuffer = Math.ceil(effectiveVelocity * settings.trimDaysAhead);
          bufferAhead = Math.max(velocityBuffer, settings.unknownVelocityBuffer) + settings.protectEpisodesAhead;
        } else {
          // No velocity: use safe fallback
          bufferAhead = settings.unknownVelocityBuffer + settings.protectEpisodesAhead;
        }

        // Apply hard cap to prevent excessive storage use
        bufferAhead = Math.min(bufferAhead, settings.maxEpisodesAhead);

        // The furthest episode position that should be protected for this user
        const protectUntilPosition = (v.current_position || 0) + bufferAhead;

        return {
          userId: v.user_id,
          username: v.username,
          plexId: v.plex_id,
          currentPosition: v.current_position || 0,
          velocity: rawVelocity,
          effectiveVelocity: effectiveVelocity,
          velocitySource: velocitySource,
          episodesWatched: episodesWatched,
          hasReliableVelocity: hasReliableVelocity,
          trimDaysAhead: settings.trimDaysAhead,
          bufferAhead: bufferAhead,
          protectUntilPosition: protectUntilPosition,
          lastWatched: v.last_watched_at,
          daysSinceWatch: daysSinceWatch,
          isActive: daysSinceWatch !== null && daysSinceWatch <= settings.activeViewerDays
        };
      });
    } catch (e) {
      console.error('[VIPER] Error getting user buffer zones:', e.message);
      return [];
    }
  }

  /**
   * Check if a specific episode position is in ANY user's buffer zone
   *
   * @param {string} showRatingKey - Plex rating key for the show
   * @param {number} episodePosition - Absolute position of the episode
   * @param {string} showTitle - Show title for fallback velocity lookup
   * @returns {Object} { protected: boolean, reason: string, users: Array }
   */
  isEpisodeInUserBuffer(showRatingKey, episodePosition, showTitle = null) {
    const bufferZones = this.getUserBufferZones(showRatingKey, showTitle);

    const protectingUsers = [];

    for (const zone of bufferZones) {
      // Episode is protected if it's between user's current position and their buffer limit
      if (episodePosition > zone.currentPosition && episodePosition <= zone.protectUntilPosition) {
        protectingUsers.push({
          username: zone.username,
          currentPosition: zone.currentPosition,
          protectUntilPosition: zone.protectUntilPosition,
          velocity: zone.velocity,
          daysUntilNeeded: zone.velocity > 0
            ? (episodePosition - zone.currentPosition) / zone.velocity
            : null
        });
      }
    }

    if (protectingUsers.length > 0) {
      return {
        protected: true,
        reason: `In buffer zone of ${protectingUsers.length} user(s): ${protectingUsers.map(u => u.username).join(', ')}`,
        users: protectingUsers
      };
    }

    return {
      protected: false,
      reason: 'Not in any user buffer zone',
      users: []
    };
  }

  /**
   * Get all settings for smart cleanup
   */
  getSettings() {
    return {
      // Core settings
      enabled: getSetting('smart_cleanup_enabled') === 'true',
      minDaysSinceWatch: parseInt(getSetting('smart_min_days_since_watch') || '15'),
      velocityBufferDays: parseInt(getSetting('smart_velocity_buffer_days') || '7'),
      protectEpisodesAhead: parseInt(getSetting('smart_protect_episodes_ahead') || '3'),
      activeViewerDays: parseInt(getSetting('smart_active_viewer_days') || '30'),
      requireAllUsersWatched: getSetting('smart_require_all_users_watched') === 'true',

      // Proactive redownload settings
      proactiveRedownload: getSetting('smart_proactive_redownload') === 'true',
      redownloadLeadDays: parseInt(getSetting('smart_redownload_lead_days') || '3'),

      // Velocity monitoring settings
      velocityMonitoringEnabled: getSetting('smart_velocity_monitoring_enabled') === 'true',
      velocityCheckInterval: parseInt(getSetting('smart_velocity_check_interval') || '120'),
      velocityChangeThreshold: parseInt(getSetting('smart_velocity_change_threshold') || '50'),
      velocityChangeAction: getSetting('smart_velocity_change_action') || 'redownload',
      velocityLookbackEpisodes: parseInt(getSetting('smart_velocity_lookback_episodes') || '5'),

      // Scheduled redownload settings
      redownloadEnabled: getSetting('smart_redownload_enabled') === 'true',
      redownloadCheckInterval: parseInt(getSetting('smart_redownload_check_interval') || '360'),
      emergencyBufferHours: parseInt(getSetting('smart_emergency_buffer_hours') || '24'),

      // Far-ahead episode trimming - velocity-based smart deletion
      trimAheadEnabled: getSetting('smart_trim_ahead_enabled') === 'true',
      trimDaysAhead: parseInt(getSetting('smart_trim_days_ahead') || '10'),  // Days of buffer based on velocity
      maxEpisodesAhead: parseInt(getSetting('smart_max_episodes_ahead') || '20'),  // Hard cap regardless of velocity
      unknownVelocityBuffer: parseInt(getSetting('smart_unknown_velocity_buffer') || '10'),  // Fallback when velocity unknown
      minVelocitySamples: parseInt(getSetting('smart_min_velocity_samples') || '3'),  // Min episodes watched to trust velocity
      defaultVelocity: parseFloat(getSetting('smart_default_velocity') || '1.0'),  // Default eps/day when unknown

      // Watchlist protection - grace period for newly watchlisted shows
      watchlistGraceDays: parseInt(getSetting('smart_watchlist_grace_days') || '14')
    };
  }

  /**
   * Check if a show is on any user's watchlist and within the grace period
   * Grace period = days since added to watchlist, protecting shows users haven't started yet
   *
   * @param {string} showRatingKey - Plex rating key for the show
   * @param {number} graceDays - Number of days for grace period (default 14)
   * @returns {boolean} True if show should be protected from far-ahead trimming
   */
  /**
   * Check if a show should be protected from cleanup based on watchlist status
   *
   * Protection is granted in these cases:
   * 1. GRACE PERIOD: User added to watchlist within graceDays (default 14 days)
   * 2. NOT STARTED: User has show on watchlist but hasn't watched ANY episodes yet
   *    (regardless of when they added it - they haven't had a chance to watch)
   * 3. PENDING REQUEST: Show has a pending/processing request
   *
   * This ensures users who add shows to their watchlist have time to start watching,
   * and that shows aren't deleted before users who requested them can watch.
   *
   * @param {string} showRatingKey - Plex rating key for the show
   * @param {number} graceDays - Number of days for add-time grace period (default 14)
   * @param {Object} showInfo - Optional show info with title for fallback lookup
   * @returns {boolean} True if show should be protected from cleanup
   */
  checkWatchlistGracePeriod(showRatingKey, graceDays = 14, showInfo = null) {
    try {
      let tmdbId = null;

      // Method 1: Look up via lifecycle table (has tmdb_id mapping)
      const lifecycleRecord = db.prepare(`
        SELECT tmdb_id FROM lifecycle WHERE plex_rating_key = ? AND media_type = 'tv'
      `).get(showRatingKey);

      if (lifecycleRecord?.tmdb_id) {
        tmdbId = lifecycleRecord.tmdb_id;
      }

      // Method 2: If no lifecycle entry, try to find by title in requests/watchlist
      // This handles shows that don't have a lifecycle entry yet
      if (!tmdbId && showInfo?.title) {
        console.log(`[VIPER] No lifecycle entry for ratingKey ${showRatingKey}, searching by title: "${showInfo.title}"`);

        const normalizedPlexTitle = normalizeTitle(showInfo.title);

        // Search watchlist by title - first try exact match, then fuzzy
        const watchlistByTitle = db.prepare(`
          SELECT DISTINCT tmdb_id, title FROM watchlist
          WHERE lower(title) = lower(?)
            AND media_type = 'tv'
            AND is_active = 1
          LIMIT 1
        `).get(showInfo.title);

        if (watchlistByTitle?.tmdb_id) {
          tmdbId = watchlistByTitle.tmdb_id;
          console.log(`[VIPER] Found tmdb_id ${tmdbId} via watchlist exact title match`);
        } else {
          // Fuzzy match: Get all TV watchlist entries and compare normalized titles
          const allWatchlistTitles = db.prepare(`
            SELECT DISTINCT tmdb_id, title FROM watchlist
            WHERE media_type = 'tv' AND is_active = 1
          `).all();

          for (const entry of allWatchlistTitles) {
            if (normalizeTitle(entry.title) === normalizedPlexTitle) {
              tmdbId = entry.tmdb_id;
              console.log(`[VIPER] Found tmdb_id ${tmdbId} via watchlist fuzzy match: "${showInfo.title}" ≈ "${entry.title}"`);
              break;
            }
          }
        }

        // If still not found, try requests table
        if (!tmdbId) {
          const requestByTitle = db.prepare(`
            SELECT DISTINCT tmdb_id, title FROM requests
            WHERE lower(title) = lower(?)
              AND media_type = 'tv'
            LIMIT 1
          `).get(showInfo.title);

          if (requestByTitle?.tmdb_id) {
            tmdbId = requestByTitle.tmdb_id;
            console.log(`[VIPER] Found tmdb_id ${tmdbId} via requests exact title match`);
          } else {
            // Fuzzy match requests too
            const allRequestTitles = db.prepare(`
              SELECT DISTINCT tmdb_id, title FROM requests
              WHERE media_type = 'tv'
            `).all();

            for (const entry of allRequestTitles) {
              if (normalizeTitle(entry.title) === normalizedPlexTitle) {
                tmdbId = entry.tmdb_id;
                console.log(`[VIPER] Found tmdb_id ${tmdbId} via requests fuzzy match: "${showInfo.title}" ≈ "${entry.title}"`);
                break;
              }
            }
          }
        }
      }

      if (tmdbId) {
        // Get ALL users who have this show on their active watchlist
        let allWatchlistUsers = [];
        try {
          allWatchlistUsers = db.prepare(`
            SELECT w.*, u.username, u.id as user_id, u.plex_id,
                   julianday('now') - julianday(w.added_at) as days_since_added
            FROM watchlist w
            JOIN users u ON w.user_id = u.id
            WHERE w.tmdb_id = ?
              AND w.media_type = 'tv'
              AND w.is_active = 1
            ORDER BY w.added_at DESC
          `).all(tmdbId);
        } catch (sqlErr) {
          console.error('[VIPER] SQL error getting watchlist users:', sqlErr.message);
          // If SQL fails, protect the show (fail safe)
          return true;
        }

        for (const entry of allWatchlistUsers) {
          // Check velocity FIRST to see if user has started watching
          // Check velocity table - try by ratingKey first, then by title hash
          let userVelocity = db.prepare(`
            SELECT * FROM user_velocity
            WHERE user_id = ? AND tmdb_id = ?
          `).get(entry.user_id, showRatingKey);

          // If not found, try by title hash (velocity calculated from watch_history uses title hash)
          if (!userVelocity && showInfo?.title) {
            // Generate same hash used in plex-sync.js calculateVelocityFromHistory
            let hash = 0;
            for (let i = 0; i < showInfo.title.length; i++) {
              hash = ((hash << 5) - hash) + showInfo.title.charCodeAt(i);
              hash = hash & hash;
            }
            const titleHash = Math.abs(hash).toString();
            userVelocity = db.prepare(`
              SELECT * FROM user_velocity
              WHERE user_id = ? AND tmdb_id = ?
            `).get(entry.user_id, titleHash);
          }

          const hasStartedWatching = userVelocity && userVelocity.current_position > 0;
          const isWithinGracePeriod = entry.days_since_added <= graceDays;

          if (hasStartedWatching) {
            // User has started watching - velocity-based cleanup can proceed
            // Log differently based on grace period
            if (isWithinGracePeriod) {
              console.log(`[VIPER] User ${entry.username} is ACTIVELY WATCHING show (position: ${userVelocity.current_position}, ${userVelocity.episodes_per_day?.toFixed(2) || 0} eps/day) - added ${Math.round(entry.days_since_added)} days ago - velocity cleanup can proceed`);
            } else {
              console.log(`[VIPER] User ${entry.username} has velocity data for show (position: ${userVelocity.current_position}) - not protecting based on watchlist`);
            }
          } else {
            // User hasn't started watching yet - protect all episodes
            if (isWithinGracePeriod) {
              console.log(`[VIPER] Grace period ACTIVE for show (ratingKey: ${showRatingKey}, tmdb: ${tmdbId}) - user ${entry.username} added ${Math.round(entry.days_since_added)} days ago and hasn't started watching yet`);
            } else {
              console.log(`[VIPER] PROTECTING show (ratingKey: ${showRatingKey}, tmdb: ${tmdbId}, title: "${entry.title}") - user ${entry.username} has it watchlisted but hasn't started watching yet (added ${Math.round(entry.days_since_added)} days ago)`);
            }
            return true;
          }
        }

        // If we reach here, all watchlisted users have started watching
        if (allWatchlistUsers.length > 0) {
          console.log(`[VIPER] All ${allWatchlistUsers.length} watchlisted user(s) have started watching show (ratingKey: ${showRatingKey}) - velocity cleanup can proceed`);
        }
      } else {
        console.log(`[VIPER] No tmdb_id found for show (ratingKey: ${showRatingKey}, title: "${showInfo?.title || 'unknown'}") - cannot check watchlist`);
      }

      // Method 3: Check requests table for any pending/processing requests by tmdb_id OR title
      // This catches shows that were just requested and may not be in lifecycle yet
      let pendingRequest = null;

      // First try by tmdb_id if we have it
      if (tmdbId) {
        pendingRequest = db.prepare(`
          SELECT r.*, u.username,
                 julianday('now') - julianday(r.added_at) as days_since_requested
          FROM requests r
          JOIN users u ON r.user_id = u.id
          WHERE r.tmdb_id = ?
            AND r.media_type = 'tv'
            AND r.status IN ('pending', 'processing', 'available')
          ORDER BY r.added_at DESC
          LIMIT 1
        `).get(tmdbId);
      }

      // If not found by tmdb_id, try by title
      if (!pendingRequest && showInfo?.title) {
        pendingRequest = db.prepare(`
          SELECT r.*, u.username,
                 julianday('now') - julianday(r.added_at) as days_since_requested
          FROM requests r
          JOIN users u ON r.user_id = u.id
          WHERE lower(r.title) = lower(?)
            AND r.media_type = 'tv'
            AND r.status IN ('pending', 'processing', 'available')
          ORDER BY r.added_at DESC
          LIMIT 1
        `).get(showInfo.title);
      }

      if (pendingRequest) {
        // Check if the requester has started watching
        // Try by ratingKey first, then by title hash
        let requesterVelocity = db.prepare(`
          SELECT * FROM user_velocity
          WHERE user_id = (SELECT id FROM users WHERE username = ?) AND tmdb_id = ?
        `).get(pendingRequest.username, showRatingKey);

        console.log(`[VIPER DEBUG] First query for ${pendingRequest.username}: ratingKey=${showRatingKey}, found=${!!requesterVelocity}`);

        // If not found, try by title hash
        if (!requesterVelocity && pendingRequest.title) {
          let hash = 0;
          for (let i = 0; i < pendingRequest.title.length; i++) {
            hash = ((hash << 5) - hash) + pendingRequest.title.charCodeAt(i);
            hash = hash & hash;
          }
          const titleHash = Math.abs(hash).toString();
          console.log(`[VIPER DEBUG] Fallback query: title="${pendingRequest.title}", hash=${titleHash}`);
          requesterVelocity = db.prepare(`
            SELECT * FROM user_velocity
            WHERE user_id = (SELECT id FROM users WHERE username = ?) AND tmdb_id = ?
          `).get(pendingRequest.username, titleHash);
          console.log(`[VIPER DEBUG] Fallback result: found=${!!requesterVelocity}, position=${requesterVelocity?.current_position}`);
        }

        if (!requesterVelocity || !requesterVelocity.current_position || requesterVelocity.current_position === 0) {
          console.log(`[VIPER] PROTECTING show via request (ratingKey: ${showRatingKey}, title: "${pendingRequest.title}") - requested by ${pendingRequest.username} who hasn't started watching`);
          return true;
        } else {
          console.log(`[VIPER] Requester ${pendingRequest.username} is ACTIVELY WATCHING "${pendingRequest.title}" (position: ${requesterVelocity.current_position}) - velocity cleanup can proceed`);
        }
      }

      return false;
    } catch (err) {
      console.error('[VIPER] Error checking watchlist grace period:', err.message);
      console.error('[VIPER] Error stack:', err.stack);
      console.error('[VIPER] Show ratingKey:', showRatingKey, 'Title:', showInfo?.title);
      // On error, PROTECT the show (fail safe) - don't delete if we can't verify
      return true;
    }
  }

  /**
   * Analyze a show and return comprehensive episode management data
   */
  async analyzeShow(showRatingKey) {
    if (!this.plex) await this.initialize();

    const settings = this.getSettings();
    const analysis = await this.plex.analyzeShowWatchProgress(showRatingKey, 90);

    // Debug: log episode count from Plex
    if (analysis.episodes.length === 0) {
      console.log(`[VIPER] Plex returned 0 episodes for show ${showRatingKey} (${analysis.show?.title})`);
    }

    const { episodes, userProgress } = analysis;
    let activeUsers = Object.values(userProgress).filter(u => u.isActive);

    // IMPORTANT: Augment with our velocity table data which is more accurate
    // Plex's viewCount-based positions are often wrong (returns 0 for everything)
    const velocityUsers = this.getUserBufferZones(showRatingKey, analysis.show?.title);

    if (velocityUsers.length > 0) {
      // Merge velocity data with Plex users or add new users
      for (const velUser of velocityUsers) {
        if (!velUser.isActive) continue;

        const existingUser = activeUsers.find(u => u.accountId === velUser.plexId);
        if (existingUser) {
          // Update with velocity data if it shows further progress
          if (velUser.currentPosition > existingUser.currentPosition) {
            existingUser.currentPosition = velUser.currentPosition;
            existingUser.velocity = velUser.velocity || existingUser.velocity;
            existingUser.lastWatchedDate = velUser.lastWatched ? new Date(velUser.lastWatched) : existingUser.lastWatchedDate;
          }
        } else {
          // Add user from velocity data
          activeUsers.push({
            accountId: velUser.plexId,
            currentPosition: velUser.currentPosition,
            velocity: velUser.velocity || 1,
            lastWatchedDate: velUser.lastWatched ? new Date(velUser.lastWatched) : new Date(),
            isActive: true
          });
        }
      }
    }

    // For each episode, calculate:
    // - Who has watched it
    // - Who is approaching it (and when they'll arrive)
    // - Whether it's safe to delete
    // - Whether it needs to be re-downloaded

    // Calculate fastest viewer position (furthest ahead among all active users)
    const fastestViewerPosition = activeUsers.length > 0
      ? Math.max(...activeUsers.map(u => u.currentPosition))
      : 0;

    // Check if show has any watch activity (at least one episode watched by anyone)
    // Use velocity data as additional signal since Plex viewCount is often unreliable
    const hasWatchActivity = episodes.some(ep => ep.viewCount > 0) ||
                             velocityUsers.some(v => v.isActive && v.currentPosition > 0);

    // Check if show is on any user's watchlist within grace period
    // This protects shows that users added but haven't started watching yet
    // Pass show info for fallback title-based lookup if lifecycle table doesn't have the show
    const watchlistGraceActive = this.checkWatchlistGracePeriod(showRatingKey, settings.watchlistGraceDays, {
      title: analysis.show?.title
    });

    const episodeAnalysis = episodes.map(ep => {
      const usersApproaching = [];
      const usersBeyond = [];
      let needsRedownload = false;
      let redownloadBy = null;

      // Convert episode to velocity position format (season * 100 + episode)
      // This matches how velocity data stores positions
      const episodeVelocityPos = this.toVelocityPosition(ep.seasonNumber, ep.episodeNumber);

      for (const user of activeUsers) {
        // Compare using velocity position format (season * 100 + episode)
        if (episodeVelocityPos <= user.currentPosition) {
          // User has passed this episode
          usersBeyond.push({
            accountId: user.accountId,
            daysSincePassed: this.calculateDaysSincePassed(user, ep)
          });
        } else {
          // User is approaching this episode
          const daysUntilNeeded = this.calculateDaysUntilNeeded(user, ep, episodeVelocityPos);
          usersApproaching.push({
            accountId: user.accountId,
            currentPosition: user.currentPosition,
            velocity: user.velocity,
            daysUntilNeeded,
            estimatedArrival: new Date(Date.now() + daysUntilNeeded * 24 * 60 * 60 * 1000)
          });

          // Check if we need to re-download for this user
          if (daysUntilNeeded <= settings.redownloadLeadDays) {
            needsRedownload = true;
            if (!redownloadBy || daysUntilNeeded < (redownloadBy - Date.now()) / (24 * 60 * 60 * 1000)) {
              redownloadBy = new Date(Date.now() + daysUntilNeeded * 24 * 60 * 60 * 1000);
            }
          }
        }
      }

      // Determine deletion safety - pass additional context for far-ahead trimming and buffer zones
      const safeToDelete = this.isEpisodeSafeToDelete(ep, usersBeyond, usersApproaching, settings, {
        fastestViewerPosition,
        hasWatchActivity,
        activeUserCount: activeUsers.length,
        watchlistGraceActive,
        showRatingKey,  // Pass for per-user buffer zone checking
        showTitle: analysis.show?.title  // Pass for velocity lookup by title hash
      });

      return {
        ...ep,
        usersApproaching,
        usersBeyond,
        safeToDelete: safeToDelete.safe,
        deletionReason: safeToDelete.reason,
        needsRedownload,
        redownloadBy,
        activeViewerCount: activeUsers.length
      };
    });

    // Persist episode stats to database for historical tracking
    this.persistEpisodeStats(showRatingKey, analysis.show?.title, episodeAnalysis);

    return {
      show: analysis.show,
      settings,
      activeUsers: activeUsers.map(u => ({
        accountId: u.accountId,
        currentPosition: u.currentPosition,
        velocity: u.velocity,
        lastWatchedDate: u.lastWatchedDate,
        projectedCompletion: this.projectCompletionDate(u, episodes.length)
      })),
      episodes: episodeAnalysis,
      summary: {
        totalEpisodes: episodes.length,
        safeToDelete: episodeAnalysis.filter(e => e.safeToDelete).length,
        needsRedownload: episodeAnalysis.filter(e => e.needsRedownload).length,
        activeViewers: activeUsers.length
      }
    };
  }

  /**
   * Calculate how many days until a user needs a specific episode
   * Uses velocity position format (season * 100 + episode) for accurate calculation
   */
  calculateDaysUntilNeeded(user, episode, episodeVelocityPos = null) {
    // Calculate velocity position if not provided
    const epPos = episodeVelocityPos || this.toVelocityPosition(episode.seasonNumber, episode.episodeNumber);

    if (!user.velocity || user.velocity === 0) {
      // No velocity data, assume 1 episode per day
      // This is a rough estimate since positions are in velocity format
      return Math.max(0, epPos - user.currentPosition);
    }
    const episodesAway = epPos - user.currentPosition;
    return Math.max(0, episodesAway / user.velocity);
  }

  /**
   * Calculate how many days since a user passed an episode
   * Uses velocity position format for consistency
   */
  calculateDaysSincePassed(user, episode) {
    // Rough estimate based on velocity
    if (!user.velocity || user.velocity === 0 || !user.lastWatchedDate) {
      return null;
    }
    const epPos = this.toVelocityPosition(episode.seasonNumber, episode.episodeNumber);
    const episodesPassed = user.currentPosition - epPos;
    const daysSinceLastWatch = (Date.now() - user.lastWatchedDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceLastWatch + (episodesPassed / user.velocity);
  }

  /**
   * Project when a user will finish the show
   */
  projectCompletionDate(user, totalEpisodes) {
    if (!user.velocity || user.velocity === 0) return null;
    const episodesRemaining = totalEpisodes - user.currentPosition;
    if (episodesRemaining <= 0) return new Date(); // Already done
    const daysRemaining = episodesRemaining / user.velocity;
    return new Date(Date.now() + daysRemaining * 24 * 60 * 60 * 1000);
  }

  /**
   * Determine if an episode is safe to delete
   * @param {Object} episode - Episode data
   * @param {Array} usersBeyond - Users who have passed this episode
   * @param {Array} usersApproaching - Users approaching this episode
   * @param {Object} settings - Smart cleanup settings
   * @param {Object} context - Additional context (fastestViewerPosition, hasWatchActivity, activeUserCount, showRatingKey)
   */
  isEpisodeSafeToDelete(episode, usersBeyond, usersApproaching, settings, context = {}) {
    const {
      fastestViewerPosition = 0,
      hasWatchActivity = false,
      activeUserCount = 0,
      watchlistGraceActive = false,
      showRatingKey = null,
      showTitle = null
    } = context;

    // Calculate velocity position for this episode (season * 100 + episode)
    // This must match how velocity data stores positions
    const episodeVelocityPos = this.toVelocityPosition(episode.seasonNumber, episode.episodeNumber);

    // CHECK 0: Manual protection - Priority 1 bypass (highest priority)
    // This check must come FIRST to ensure protected items are never deleted
    if (context.tmdbId) {
      const protectionCheck = this.isManuallyProtected(context.tmdbId, 'tv');
      if (protectionCheck.protected) {
        return {
          safe: false,
          reason: protectionCheck.reason
        };
      }
    }


    // CHECK 1: Watchlist grace period - protect ALL episodes for shows where users haven't started
    // This protects against re-downloads being deleted due to Plex preserving view history
    if (watchlistGraceActive) {
      return {
        safe: false,
        reason: 'Show is on watchlist within grace period or user hasn\'t started - protecting all episodes'
      };
    }

    // CHECK 2: Per-user buffer zones - protect episodes in any user's approach buffer
    // This is the key feature for independent buffer tracking per user
    // NOTE: Uses velocity position format (season * 100 + episode) for consistent comparison
    if (showRatingKey && episode.seasonNumber && episode.episodeNumber) {
      const bufferCheck = this.isEpisodeInUserBuffer(showRatingKey, episodeVelocityPos, showTitle);
      if (bufferCheck.protected) {
        return {
          safe: false,
          reason: bufferCheck.reason
        };
      }
    }

    // CHECK 3 & 4: Per-user buffer protection
    // IMPORTANT: Only protect episodes that are within a user's BUFFER ZONE
    // Episodes beyond ALL users' buffers can be deleted - this enables the "gap" deletion
    if (usersApproaching.length > 0 && episode.seasonNumber && episode.episodeNumber) {
      // Filter to only users whose buffer actually covers this episode
      // Using velocity position format for consistent comparison
      const usersNeedingThisEpisode = usersApproaching.filter(u => {
        const userBufferLimit = u.currentPosition + (settings.velocityBufferDays * (u.velocity || 1));
        return episodeVelocityPos <= userBufferLimit;
      });

      // CHECK 3: Users approaching within their buffer
      if (usersNeedingThisEpisode.length > 0) {
        const soonestArrival = Math.min(...usersNeedingThisEpisode.map(u => u.daysUntilNeeded));
        if (soonestArrival <= settings.velocityBufferDays) {
          return {
            safe: false,
            reason: `User approaching in ${Math.round(soonestArrival)} days (episode in their buffer)`
          };
        }

        // CHECK 4: Require all users with this episode in buffer to have watched
        if (settings.requireAllUsersWatched) {
          return {
            safe: false,
            reason: `${usersNeedingThisEpisode.length} user(s) have this episode in their buffer`
          };
        }
      }
      // If no users have this episode in their buffer, it's in the "gap" and can be deleted
    }

    // CHECK 5: Minimum days since last watch
    if (episode.lastViewedAt) {
      const daysSinceWatch = (Date.now() - episode.lastViewedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceWatch < settings.minDaysSinceWatch) {
        return {
          safe: false,
          reason: `Only ${Math.round(daysSinceWatch)} days since last watch (need ${settings.minDaysSinceWatch})`
        };
      }
    }

    // CHECK 6: SMART FAR-AHEAD TRIMMING - Velocity-based deletion of episodes too far ahead
    // Only applies when:
    // 1. trimAheadEnabled is true
    // 2. Show has some watch activity (prevents deleting fresh downloads)
    // 3. There are active viewers
    // 4. Episode is unwatched
    // 5. NOT in watchlist grace period
    // 6. Episode is beyond ALL users' velocity-based buffer zones
    if (settings.trimAheadEnabled && hasWatchActivity && activeUserCount > 0 && episode.viewCount === 0 && !watchlistGraceActive) {
      // Get all user buffer zones for this show
      const bufferZones = showRatingKey ? this.getUserBufferZones(showRatingKey, showTitle) : [];

      // Calculate the maximum buffer needed (furthest protect position across all users)
      let maxProtectPosition = fastestViewerPosition + settings.protectEpisodesAhead;
      let bufferReason = 'default minimum';

      if (bufferZones.length > 0) {
        for (const zone of bufferZones) {
          if (zone.isActive && zone.protectUntilPosition > maxProtectPosition) {
            maxProtectPosition = zone.protectUntilPosition;
            bufferReason = `${zone.username}'s velocity buffer (${zone.bufferAhead} eps, ${zone.velocitySource})`;
          }
        }
      } else {
        // No velocity data at all - use safe fallback
        maxProtectPosition = fastestViewerPosition + settings.unknownVelocityBuffer + settings.protectEpisodesAhead;
        bufferReason = 'unknown velocity fallback';
      }

      // Apply hard cap
      const hardCap = fastestViewerPosition + settings.maxEpisodesAhead;
      if (maxProtectPosition > hardCap) {
        maxProtectPosition = hardCap;
        bufferReason += ` (capped at ${settings.maxEpisodesAhead})`;
      }

      // If episode is beyond the maximum protect position, it's safe to delete
      // Using velocity position format for consistent comparison
      if (episodeVelocityPos > maxProtectPosition) {
        const episodesAhead = episodeVelocityPos - fastestViewerPosition;
        return {
          safe: true,
          reason: `Too far ahead: S${episode.seasonNumber}E${episode.episodeNumber} beyond fastest viewer (buffer: ${bufferReason})`
        };
      }
    }

    // CHECK 7: Never watched episodes (not far-ahead trim candidates) are not safe
    // IMPORTANT: Use velocity data to determine if watched, not just Plex's viewCount
    // (Plex viewCount is often 0 because it requires user-specific tokens to access)
    const wasWatchedByVelocity = usersBeyond.length > 0; // Users have passed this episode

    if (episode.viewCount === 0 && !wasWatchedByVelocity) {
      return {
        safe: false,
        reason: 'Never watched (no users have passed this episode)'
      };
    }

    // Episode has been watched (either by Plex viewCount or velocity position)
    // It's past all users' buffer zones and meets time requirements
    const daysSinceWatch = episode.lastViewedAt
      ? Math.round((Date.now() - episode.lastViewedAt.getTime()) / (1000 * 60 * 60 * 24))
      : 'unknown';
    return {
      safe: true,
      reason: wasWatchedByVelocity
        ? `${usersBeyond.length} user(s) have passed this episode - safe to delete`
        : `Watched ${daysSinceWatch} days ago, all active users past`
    };
  }

  /**
   * Get all shows with active viewers that need management
   */
  async getShowsNeedingAttention() {
    if (!this.plex) await this.initialize();
    if (!this.plex) return { error: 'No media server configured' };

    const libraries = await this.plex.getLibraries();
    const showLibraries = libraries.filter(l => l.type === 'show');
    const results = [];

    for (const lib of showLibraries) {
      const shows = await this.plex.getLibraryContents(lib.id);

      for (const show of shows) {
        try {
          const analysis = await this.analyzeShow(show.ratingKey);

          if (analysis.activeUsers.length > 0 ||
              analysis.summary.safeToDelete > 0 ||
              analysis.summary.needsRedownload > 0) {
            results.push({
              ratingKey: show.ratingKey,
              title: show.title,
              library: lib.title,
              ...analysis.summary,
              activeUsers: analysis.activeUsers
            });
          }
        } catch (err) {
          console.error(`[VIPER] Error analyzing ${show.title}:`, err.message);
        }
      }
    }

    return results;
  }

  /**
   * Get episodes that need to be re-downloaded proactively
   */
  async getEpisodesNeedingRedownload() {
    if (!this.plex || !this.sonarr) await this.initialize();

    const settings = this.getSettings();
    if (!settings.proactiveRedownload) {
      return { enabled: false, episodes: [] };
    }

    const shows = await this.getShowsNeedingAttention();
    const needsRedownload = [];

    for (const show of shows) {
      if (show.needsRedownload > 0) {
        const analysis = await this.analyzeShow(show.ratingKey);
        const missing = analysis.episodes.filter(e => e.needsRedownload);

        for (const ep of missing) {
          // Check if episode exists in Plex
          const exists = await this.checkEpisodeExists(ep.ratingKey);

          if (!exists) {
            needsRedownload.push({
              show: show.title,
              showRatingKey: show.ratingKey,
              ...ep,
              priority: Math.max(0, settings.redownloadLeadDays - (ep.redownloadBy - Date.now()) / (24 * 60 * 60 * 1000))
            });
          }
        }
      }
    }

    // Sort by priority (soonest needed first)
    needsRedownload.sort((a, b) => b.priority - a.priority);

    return {
      enabled: true,
      leadDays: settings.redownloadLeadDays,
      episodes: needsRedownload
    };
  }

  /**
   * Check if an episode exists in Plex
   */
  async checkEpisodeExists(ratingKey) {
    try {
      const item = await this.plex.getItem(ratingKey);
      return !!item;
    } catch (err) {
      return false;
    }
  }

  /**
   * Trigger re-download for an episode via Sonarr
   */
  async triggerRedownload(showTitle, seasonNumber, episodeNumber) {
    if (!this.sonarr) await this.initialize();
    if (!this.sonarr) {
      return { success: false, error: 'Sonarr not configured' };
    }

    try {
      // Find the series in Sonarr
      const series = await this.sonarr.getSeries();
      const match = series.find(s =>
        s.title.toLowerCase() === showTitle.toLowerCase() ||
        s.sortTitle?.toLowerCase() === showTitle.toLowerCase()
      );

      if (!match) {
        return { success: false, error: `Series "${showTitle}" not found in Sonarr` };
      }

      // Get episodes
      const episodes = await this.sonarr.getEpisodes(match.id);
      const episode = episodes.find(e =>
        e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber
      );

      if (!episode) {
        return { success: false, error: `Episode S${seasonNumber}E${episodeNumber} not found` };
      }

      // Monitor and search for the episode
      await this.sonarr.monitorEpisode(episode.id, true);
      await this.sonarr.searchEpisode(episode.id);

      log('info', 'viper', 'Triggered proactive re-download', {
        media_title: `${showTitle} S${seasonNumber}E${episodeNumber}`,
        media_type: 'episode'
      });

      return {
        success: true,
        message: `Re-download triggered for ${showTitle} S${seasonNumber}E${episodeNumber}`
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Run proactive re-download check and trigger downloads
   */
  async runProactiveRedownloads() {
    if (!this.plex) await this.initialize();
    if (!this.plex) return { error: 'Plex not configured - smart cleanup requires Plex' };

    const settings = this.getSettings();
    if (!settings.redownloadEnabled) {
      return { enabled: false };
    }

    const { episodes } = await this.getEpisodesNeedingRedownload();
    const results = [];

    for (const ep of episodes) {
      const result = await this.triggerRedownload(
        ep.show,
        ep.seasonNumber,
        ep.episodeNumber
      );
      results.push({
        episode: `${ep.show} S${ep.seasonNumber}E${ep.episodeNumber}`,
        ...result
      });
    }

    return {
      enabled: true,
      processed: results.length,
      results
    };
  }

  // =========================================
  // VELOCITY MONITORING SYSTEM
  // =========================================

  /**
   * Store velocity snapshot for a user
   */
  storeVelocitySnapshot(accountId, showRatingKey, velocity, position) {
    // Create velocity_snapshots table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS velocity_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        show_rating_key TEXT NOT NULL,
        velocity REAL NOT NULL,
        position INTEGER NOT NULL,
        recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_id, show_rating_key, recorded_at)
      )
    `);

    db.prepare(`
      INSERT INTO velocity_snapshots (account_id, show_rating_key, velocity, position)
      VALUES (?, ?, ?, ?)
    `).run(accountId, showRatingKey, velocity, position);

    // Clean up old snapshots (keep last 50 per user/show)
    db.prepare(`
      DELETE FROM velocity_snapshots
      WHERE id NOT IN (
        SELECT id FROM velocity_snapshots
        WHERE account_id = ? AND show_rating_key = ?
        ORDER BY recorded_at DESC
        LIMIT 50
      ) AND account_id = ? AND show_rating_key = ?
    `).run(accountId, showRatingKey, accountId, showRatingKey);
  }

  /**
   * Get recent velocity history for a user/show
   */
  getVelocityHistory(accountId, showRatingKey, limit = 10) {
    try {
      return db.prepare(`
        SELECT * FROM velocity_snapshots
        WHERE account_id = ? AND show_rating_key = ?
        ORDER BY recorded_at DESC
        LIMIT ?
      `).all(accountId, showRatingKey, limit);
    } catch (err) {
      // Table might not exist yet
      return [];
    }
  }

  /**
   * Calculate velocity change percentage
   */
  calculateVelocityChange(currentVelocity, previousVelocity) {
    if (!previousVelocity || previousVelocity === 0) {
      return 0; // No previous data to compare
    }
    return ((currentVelocity - previousVelocity) / previousVelocity) * 100;
  }

  /**
   * Check for significant velocity changes across all active users
   */
  async checkVelocityChanges() {
    if (!this.plex) await this.initialize();
    const settings = this.getSettings();

    if (!settings.velocityMonitoringEnabled) {
      return { enabled: false, changes: [] };
    }

    console.log('[VIPER] Running velocity change detection...');
    const changes = [];

    const libraries = await this.plex.getLibraries();
    const showLibraries = libraries.filter(l => l.type === 'show');

    for (const lib of showLibraries) {
      const shows = await this.plex.getLibraryContents(lib.id);

      for (const show of shows) {
        try {
          const analysis = await this.plex.analyzeShowWatchProgress(show.ratingKey, settings.activeViewerDays);
          const activeUsers = Object.values(analysis.userProgress).filter(u => u.isActive);

          for (const user of activeUsers) {
            // Get historical velocity
            const history = this.getVelocityHistory(user.accountId, show.ratingKey, 5);

            if (history.length > 0) {
              // Calculate average historical velocity
              const avgHistoricalVelocity = history.reduce((sum, h) => sum + h.velocity, 0) / history.length;

              // Calculate change
              const changePercent = this.calculateVelocityChange(user.velocity, avgHistoricalVelocity);

              if (Math.abs(changePercent) >= settings.velocityChangeThreshold) {
                const change = {
                  accountId: user.accountId,
                  showTitle: show.title,
                  showRatingKey: show.ratingKey,
                  previousVelocity: avgHistoricalVelocity,
                  currentVelocity: user.velocity,
                  changePercent: Math.round(changePercent),
                  direction: changePercent > 0 ? 'increased' : 'decreased',
                  currentPosition: user.currentPosition,
                  timestamp: new Date()
                };

                changes.push(change);

                log('info', 'viper', `Velocity change detected: ${show.title}`, {
                  media_title: show.title,
                  details: JSON.stringify({
                    user: user.accountId,
                    change: `${Math.round(changePercent)}%`,
                    from: avgHistoricalVelocity.toFixed(2),
                    to: user.velocity.toFixed(2)
                  })
                });
              }
            }

            // Store current velocity snapshot
            this.storeVelocitySnapshot(user.accountId, show.ratingKey, user.velocity, user.currentPosition);
          }
        } catch (err) {
          console.error(`[VIPER] Error checking velocity for ${show.title}:`, err.message);
        }
      }
    }

    return {
      enabled: true,
      threshold: settings.velocityChangeThreshold,
      action: settings.velocityChangeAction,
      changes
    };
  }

  /**
   * Handle velocity change - trigger appropriate action
   */
  async handleVelocityChanges() {
    if (!this.plex) await this.initialize();
    if (!this.plex) return { error: 'Plex not configured - smart cleanup requires Plex' };

    const settings = this.getSettings();
    const { enabled, changes, action } = await this.checkVelocityChanges();

    if (!enabled || changes.length === 0) {
      return { enabled, changesDetected: 0, actionsTriggered: [] };
    }

    const actionsTriggered = [];

    for (const change of changes) {
      // Only act on increases (user speeding up)
      if (change.direction === 'increased') {
        if (action === 'redownload' || action === 'both') {
          // Trigger proactive redownload for this show
          const analysis = await this.analyzeShow(change.showRatingKey);
          const needsRedownload = analysis.episodes.filter(e => e.needsRedownload);

          for (const ep of needsRedownload) {
            const exists = await this.checkEpisodeExists(ep.ratingKey);
            if (!exists) {
              const result = await this.triggerRedownload(
                change.showTitle,
                ep.seasonNumber,
                ep.episodeNumber
              );
              actionsTriggered.push({
                type: 'redownload',
                show: change.showTitle,
                episode: `S${ep.seasonNumber}E${ep.episodeNumber}`,
                reason: `User velocity increased ${change.changePercent}%`,
                result
              });
            }
          }
        }

        if (action === 'alert' || action === 'both') {
          // Log alert (could be extended to send notification)
          actionsTriggered.push({
            type: 'alert',
            show: change.showTitle,
            message: `User velocity increased by ${change.changePercent}%`,
            details: change
          });
        }
      }
    }

    return {
      enabled: true,
      changesDetected: changes.length,
      actionsTriggered
    };
  }

  /**
   * Emergency redownload check - episodes needed very soon
   */
  async checkEmergencyRedownloads() {
    if (!this.plex) await this.initialize();
    const settings = this.getSettings();

    if (!settings.redownloadEnabled) {
      return { enabled: false, emergencies: [] };
    }

    console.log('[VIPER] Checking for emergency redownloads...');
    const emergencies = [];
    const emergencyHours = settings.emergencyBufferHours;

    const shows = await this.getShowsNeedingAttention();

    for (const show of shows) {
      const analysis = await this.analyzeShow(show.ratingKey);

      for (const ep of analysis.episodes) {
        if (ep.usersApproaching && ep.usersApproaching.length > 0) {
          // Check if any user needs this episode within emergency window
          for (const user of ep.usersApproaching) {
            const hoursUntilNeeded = user.daysUntilNeeded * 24;

            if (hoursUntilNeeded <= emergencyHours) {
              // Check if episode exists
              const exists = await this.checkEpisodeExists(ep.ratingKey);

              if (!exists) {
                emergencies.push({
                  show: show.title,
                  showRatingKey: show.ratingKey,
                  seasonNumber: ep.seasonNumber,
                  episodeNumber: ep.episodeNumber,
                  episodeTitle: ep.title,
                  hoursUntilNeeded: Math.round(hoursUntilNeeded),
                  user: user.accountId,
                  priority: 'emergency'
                });
              }
            }
          }
        }
      }
    }

    return {
      enabled: true,
      emergencyWindowHours: emergencyHours,
      emergencies
    };
  }

  /**
   * Run emergency redownloads
   */
  async runEmergencyRedownloads() {
    if (!this.plex) await this.initialize();
    if (!this.plex) return { error: 'Plex not configured - smart cleanup requires Plex' };

    const { enabled, emergencies } = await this.checkEmergencyRedownloads();

    if (!enabled || emergencies.length === 0) {
      return { enabled, processed: 0, results: [] };
    }

    const results = [];

    for (const emergency of emergencies) {
      console.log(`[VIPER] EMERGENCY: User needs ${emergency.show} S${emergency.seasonNumber}E${emergency.episodeNumber} in ${emergency.hoursUntilNeeded} hours!`);

      const result = await this.triggerRedownload(
        emergency.show,
        emergency.seasonNumber,
        emergency.episodeNumber
      );

      results.push({
        episode: `${emergency.show} S${emergency.seasonNumber}E${emergency.episodeNumber}`,
        hoursUntilNeeded: emergency.hoursUntilNeeded,
        ...result
      });

      log('warn', 'viper', 'Emergency re-download triggered', {
        media_title: `${emergency.show} S${emergency.seasonNumber}E${emergency.episodeNumber}`,
        details: JSON.stringify({
          hoursUntilNeeded: emergency.hoursUntilNeeded,
          priority: 'emergency'
        })
      });
    }

    return {
      enabled: true,
      processed: results.length,
      results
    };
  }

  /**
   * Full background check - runs all monitoring tasks
   * Called by scheduler at configured intervals
   */
  async runBackgroundChecks() {
    console.log('[VIPER] Running background checks...');

    const results = {
      timestamp: new Date(),
      velocityCheck: null,
      emergencyCheck: null,
      redownloadCheck: null
    };

    try {
      // 1. Check for velocity changes
      results.velocityCheck = await this.handleVelocityChanges();
      console.log(`[VIPER] Velocity check: ${results.velocityCheck.changesDetected || 0} changes detected`);
    } catch (err) {
      console.error('[VIPER] Velocity check failed:', err.message);
      results.velocityCheck = { error: err.message };
    }

    try {
      // 2. Check for emergency redownloads
      results.emergencyCheck = await this.runEmergencyRedownloads();
      console.log(`[VIPER] Emergency check: ${results.emergencyCheck.processed || 0} emergencies handled`);
    } catch (err) {
      console.error('[VIPER] Emergency check failed:', err.message);
      results.emergencyCheck = { error: err.message };
    }

    try {
      // 3. Run standard proactive redownloads
      results.redownloadCheck = await this.runProactiveRedownloads();
      console.log(`[VIPER] Redownload check: ${results.redownloadCheck.processed || 0} episodes queued`);
    } catch (err) {
      console.error('[VIPER] Redownload check failed:', err.message);
      results.redownloadCheck = { error: err.message };
    }

    return results;
  }

  // =========================================
  // VELOCITY-BASED CLEANUP EXECUTION
  // =========================================

  /**
   * Run velocity-based smart cleanup
   * Uses synced velocity data to efficiently determine what can be deleted
   *
   * @param {boolean} dryRun - If true, only report what would be deleted
   * @returns {Object} Cleanup results
   */
  async runVelocityCleanup(dryRun = true) {
    if (!this.plex) await this.initialize();
    if (!this.plex) return { error: 'Plex not configured' };

    const settings = this.getSettings();
    if (!settings.enabled) {
      return { enabled: false, message: 'Smart cleanup is disabled' };
    }

    console.log(`[VIPER] Running velocity-based cleanup (dryRun: ${dryRun})...`);

    const results = {
      timestamp: new Date(),
      dryRun,
      settings: {
        minDaysSinceWatch: settings.minDaysSinceWatch,
        velocityBufferDays: settings.velocityBufferDays,
        protectEpisodesAhead: settings.protectEpisodesAhead,
        activeViewerDays: settings.activeViewerDays,
        requireAllUsersWatched: settings.requireAllUsersWatched
      },
      showsAnalyzed: 0,
      episodesAnalyzed: 0,
      deletionCandidates: [],
      deleted: [],
      protected: [],
      errors: []
    };

    try {
      // Get shows with active viewers using synced data
      const activeShows = this.getShowsWithActiveViewers(settings.activeViewerDays);
      console.log(`[VIPER] Found ${activeShows.length} shows with active viewers`);

      // Get all show libraries
      const libraries = await this.plex.getLibraries();
      console.log(`[VIPER] Found ${libraries.length} libraries: ${libraries.map(l => `${l.title}(${l.type})`).join(', ')}`);
      const showLibraries = libraries.filter(l => l.type === 'show');
      console.log(`[VIPER] Processing ${showLibraries.length} show libraries`);

      if (showLibraries.length === 0) {
        console.log('[VIPER] WARNING: No show libraries found! Check Plex library types.');
      }

      for (const library of showLibraries) {
        const shows = await this.plex.getLibraryContents(library.id);
        console.log(`[VIPER] Library "${library.title}" has ${shows.length} shows`);

        for (const show of shows) {
          try {
            results.showsAnalyzed++;

            // Check if this show has active viewers in synced data
            const activeShowData = activeShows.find(s => s.show_rating_key === show.ratingKey);
            const velocityData = this.getAllVelocitiesForShow(show.ratingKey);

            // Analyze the show
            const analysis = await this.analyzeShow(show.ratingKey);
            if (!analysis || !analysis.episodes) {
              console.log(`[VIPER] Show "${show.title}" returned null analysis`);
              continue;
            }

            // Count episodes IMMEDIATELY after analysis
            const episodeCount = analysis.episodes.length;
            results.episodesAnalyzed += episodeCount;

            if (episodeCount === 0) {
              console.log(`[VIPER] Show "${show.title}" has 0 episodes (empty array)`);
              continue; // Skip shows with no episodes
            }

            console.log(`[VIPER] Analyzing ${episodeCount} episodes for "${show.title}"`);

            // Find deletion candidates
            for (const episode of analysis.episodes) {
              if (episode.safeToDelete) {
                const candidate = {
                  showTitle: show.title,
                  showRatingKey: show.ratingKey,
                  seasonNumber: episode.seasonNumber,
                  episodeNumber: episode.episodeNumber,
                  episodeTitle: episode.title,
                  ratingKey: episode.ratingKey,
                  reason: episode.deletionReason,
                  daysSinceWatch: episode.lastViewedAt
                    ? Math.floor((Date.now() - new Date(episode.lastViewedAt).getTime()) / (1000 * 60 * 60 * 24))
                    : null,
                  activeViewers: analysis.activeUsers?.length || 0,
                  velocityInfo: velocityData.map(v => ({
                    user: v.username,
                    position: v.current_position,
                    velocity: v.episodes_per_day
                  }))
                };

                results.deletionCandidates.push(candidate);

                // Execute deletion if not dry run
                if (!dryRun) {
                  try {
                    const deleteResult = await this.deleteEpisode(
                      episode.ratingKey,
                      show.title,
                      episode.seasonNumber,
                      episode.episodeNumber,
                      show.ratingKey
                    );

                    if (deleteResult.success) {
                      results.deleted.push({
                        ...candidate,
                        deletedAt: new Date()
                      });
                    } else {
                      console.error(`[VIPER] Deletion failed for ${show.title} S${episode.seasonNumber}E${episode.episodeNumber}:`, deleteResult.error);
                      results.errors.push({
                        ...candidate,
                        error: deleteResult.error
                      });
                    }
                  } catch (deleteErr) {
                    console.error(`[VIPER] Exception during deletion of ${show.title} S${episode.seasonNumber}E${episode.episodeNumber}:`, deleteErr.message);
                    results.errors.push({
                      ...candidate,
                      error: deleteErr.message
                    });
                  }
                }
              } else {
                // Track protected episodes
                results.protected.push({
                  showTitle: show.title,
                  seasonNumber: episode.seasonNumber,
                  episodeNumber: episode.episodeNumber,
                  reason: episode.deletionReason
                });
              }
            }
          } catch (showErr) {
            console.error(`[VIPER] Error analyzing show "${show.title}":`, showErr.message);
            console.error(`[VIPER] Stack trace:`, showErr.stack);
            results.errors.push({
              showTitle: show.title,
              showRatingKey: show.ratingKey,
              error: showErr.message,
              stack: showErr.stack
            });
          }
        }
      }

      const successfulShows = results.showsAnalyzed - results.errors.length;
      console.log(`[VIPER] Analysis complete:`, {
        showsAnalyzed: results.showsAnalyzed,
        successfulShows: successfulShows,
        failedShows: results.errors.length,
        episodesAnalyzed: results.episodesAnalyzed,
        candidates: results.deletionCandidates.length,
        deleted: results.deleted.length,
        protected: results.protected.length
      });

      if (results.errors.length > 0) {
        console.log(`[VIPER] Shows with errors:`);
        results.errors.forEach(err => {
          console.log(`  - ${err.showTitle} (${err.showRatingKey}): ${err.error}`);
        });
      }

      // Log the cleanup run
      log(dryRun ? 'info' : 'warn', 'smart-cleanup', `Velocity cleanup ${dryRun ? '(dry run)' : 'executed'}`, {
        shows_analyzed: results.showsAnalyzed,
        episodes_analyzed: results.episodesAnalyzed,
        deletion_candidates: results.deletionCandidates.length,
        deleted: results.deleted.length
      });

      // Send Discord notification if deletions occurred (not dry run)
      if (!dryRun && results.deleted.length > 0) {
        try {
          // Group deletions by show for a cleaner summary
          const showGroups = {};
          for (const item of results.deleted) {
            if (!showGroups[item.showTitle]) {
              showGroups[item.showTitle] = [];
            }
            showGroups[item.showTitle].push(`S${item.seasonNumber}E${item.episodeNumber}`);
          }

          const showSummary = Object.entries(showGroups)
            .map(([show, eps]) => `**${show}**: ${eps.join(', ')}`)
            .join('\n');

          await NotificationService.notify('on_viper_cleanup', {
            title: 'VIPER Episode Cleanup Complete',
            message: `Deleted ${results.deleted.length} watched episode${results.deleted.length !== 1 ? 's' : ''} from ${Object.keys(showGroups).length} show${Object.keys(showGroups).length !== 1 ? 's' : ''}`,
            details: showSummary,
            type: 'smart_cleanup',
            stats: {
              shows_analyzed: results.showsAnalyzed,
              episodes_analyzed: results.episodesAnalyzed,
              deleted: results.deleted.length
            }
          });
          console.log(`[VIPER] Notification sent for ${results.deleted.length} episode deletions`);
        } catch (notifyErr) {
          console.error('[VIPER] Failed to send notification:', notifyErr.message);
        }
      }

    } catch (err) {
      console.error('[VIPER] Error:', err.message);
      results.errors.push({ error: err.message });
    }

    return results;
  }

  /**
   * Delete an episode from Plex and Sonarr
   */
  async deleteEpisode(ratingKey, showTitle, seasonNumber, episodeNumber, showRatingKey = null) {
    if (!this.plex) await this.initialize();

    const results = {
      success: false,
      plexDeleted: false,
      sonarrDeleted: false,
      error: null
    };

    try {
      // Delete from Plex
      try {
        await this.plex.deleteItem(ratingKey);
        results.plexDeleted = true;
        console.log(`[VIPER] Deleted from Plex: ${showTitle} S${seasonNumber}E${episodeNumber}`);
      } catch (plexErr) {
        console.error(`[VIPER] Plex delete failed: ${plexErr.message}`);
        results.error = `Plex: ${plexErr.message}`;
      }

      // Delete/unmonitor from Sonarr
      if (this.sonarr) {
        try {
          const series = await this.sonarr.getSeries();
          const match = series.find(s =>
            s.title.toLowerCase() === showTitle.toLowerCase() ||
            s.sortTitle?.toLowerCase() === showTitle.toLowerCase()
          );

          if (match) {
            const episodes = await this.sonarr.getEpisodes(match.id);
            const sonarrEp = episodes.find(e =>
              e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber
            );

            if (sonarrEp) {
              if (sonarrEp.episodeFileId) {
                // Delete the episode file from Sonarr
                await this.sonarr.deleteEpisodeFile(sonarrEp.episodeFileId);
                results.sonarrDeleted = true;
                console.log(`[VIPER] Deleted from Sonarr: ${showTitle} S${seasonNumber}E${episodeNumber}`);
              }

              // ALWAYS unmonitor after deletion to prevent automatic re-download
              await this.sonarr.monitorEpisode(sonarrEp.id, false);
              console.log(`[VIPER] Unmonitored in Sonarr: ${showTitle} S${seasonNumber}E${episodeNumber}`);
            }
          }
        } catch (sonarrErr) {
          console.error(`[VIPER] Sonarr operation failed: ${sonarrErr.message}`);
          if (!results.error) results.error = `Sonarr: ${sonarrErr.message}`;
        }
      }

      results.success = results.plexDeleted;

      // Log the deletion
      if (results.success) {
        log('info', 'deletion', `Velocity cleanup: deleted ${showTitle} S${seasonNumber}E${episodeNumber}`, {
          media_title: `${showTitle} S${seasonNumber}E${episodeNumber}`,
          media_type: 'episode',
          plex_deleted: results.plexDeleted,
          sonarr_deleted: results.sonarrDeleted
        });

        // Mark episode as deleted in stats table for historical tracking
        if (showRatingKey) {
          this.markEpisodeDeleted(showRatingKey, seasonNumber, episodeNumber, true);
        }
      }

    } catch (err) {
      results.error = err.message;
    }

    return results;
  }

  /**
   * Get a summary of velocity-based cleanup candidates
   * Quick check without actually deleting anything
   */
  async getCleanupSummary() {
    if (!this.plex) await this.initialize();
    if (!this.plex) return { error: 'Plex not configured - smart cleanup requires Plex' };

    const settings = this.getSettings();

    // Use synced data for quick summary
    const activeShows = this.getShowsWithActiveViewers(settings.activeViewerDays);
    const allVelocities = this.getActiveVelocities(settings.activeViewerDays);

    // Group velocities by user
    const userStats = {};
    for (const v of allVelocities) {
      if (!userStats[v.username]) {
        userStats[v.username] = {
          shows: 0,
          avgVelocity: 0,
          totalVelocity: 0
        };
      }
      userStats[v.username].shows++;
      userStats[v.username].totalVelocity += v.episodes_per_day || 0;
    }

    // Calculate averages
    for (const user of Object.keys(userStats)) {
      userStats[user].avgVelocity = userStats[user].totalVelocity / userStats[user].shows;
    }

    return {
      timestamp: new Date(),
      settings: {
        enabled: settings.enabled,
        minDaysSinceWatch: settings.minDaysSinceWatch,
        velocityBufferDays: settings.velocityBufferDays,
        activeViewerDays: settings.activeViewerDays
      },
      activeShows: activeShows.length,
      showsWithMultipleViewers: activeShows.filter(s => s.active_viewers > 1).length,
      activeUsers: Object.keys(userStats).length,
      userStats,
      showDetails: activeShows.slice(0, 10).map(s => ({
        ratingKey: s.show_rating_key,
        activeViewers: s.active_viewers,
        slowestPosition: s.slowest_position,
        fastestPosition: s.fastest_position,
        avgVelocity: s.avg_velocity?.toFixed(2),
        lastActivity: s.last_activity
      }))
    };
  }

  /**
   * Run velocity cleanup for movies (simpler - just watched status and age)
   */
  async runMovieCleanup(dryRun = true) {
    if (!this.plex) await this.initialize();
    if (!this.plex) return { error: 'Plex not configured' };

    const settings = this.getSettings();
    console.log(`[VIPER] Running movie cleanup (dryRun: ${dryRun})...`);

    const results = {
      timestamp: new Date(),
      dryRun,
      moviesAnalyzed: 0,
      deletionCandidates: [],
      deleted: [],
      protected: [],
      errors: []
    };

    try {
      const libraries = await this.plex.getLibraries();
      const movieLibraries = libraries.filter(l => l.type === 'movie');

      for (const library of movieLibraries) {
        const movies = await this.plex.getLibraryContents(library.id);

        for (const movie of movies) {
          results.moviesAnalyzed++;

          const daysSinceWatch = movie.lastViewedAt
            ? Math.floor((Date.now() - movie.lastViewedAt * 1000) / (1000 * 60 * 60 * 24))
            : null;

          const daysSinceAdded = movie.addedAt
            ? Math.floor((Date.now() - movie.addedAt * 1000) / (1000 * 60 * 60 * 24))
            : null;

          // Check if on any user's watchlist
          const onWatchlist = db.prepare(`
            SELECT COUNT(*) as count FROM watchlist
            WHERE title = ? AND media_type = 'movie' AND is_active = 1
          `).get(movie.title)?.count > 0;


          // Extract TMDB ID from guids for protection check
          let movieTmdbId = null;
          if (movie.guids) {
            const tmdbGuid = movie.guids.find(g => {
              const guidStr = g.id || g;
              return guidStr.includes('tmdb://');
            });
            if (tmdbGuid) {
              const guidStr = tmdbGuid.id || tmdbGuid;
              movieTmdbId = parseInt(guidStr.replace('tmdb://', ''));
            }
          }

          // CHECK: Manual protection - Priority 1 bypass
          if (movieTmdbId) {
            const protectionCheck = this.isManuallyProtected(movieTmdbId, 'movie');
            if (protectionCheck.protected) {
              results.protected.push({
                title: movie.title,
                year: movie.year,
                tmdbId: movieTmdbId,
                reason: protectionCheck.reason
              });
              continue; // Skip this movie entirely
            }
          }

          // Determine if safe to delete
          let safeToDelete = false;
          let reason = '';

          if (onWatchlist) {
            reason = 'On watchlist';
          } else if (movie.viewCount > 0 && daysSinceWatch >= settings.minDaysSinceWatch) {
            safeToDelete = true;
            reason = `Watched ${daysSinceWatch} days ago`;
          } else if (movie.viewCount === 0 && daysSinceAdded > 90) {
            safeToDelete = true;
            reason = `Unwatched for ${daysSinceAdded} days`;
          } else if (movie.viewCount === 0) {
            reason = 'Never watched (too recent)';
          } else {
            reason = `Recently watched (${daysSinceWatch} days ago)`;
          }

          if (safeToDelete) {
            const candidate = {
              title: movie.title,
              year: movie.year,
              ratingKey: movie.ratingKey,
              reason,
              daysSinceWatch,
              daysSinceAdded
            };

            results.deletionCandidates.push(candidate);

            if (!dryRun) {
              try {
                await this.plex.deleteItem(movie.ratingKey);
                results.deleted.push(candidate);

                // Also remove from Radarr if configured
                if (this.radarr) {
                  try {
                    const radarrMovies = await this.radarr.getMovies();
                    const match = radarrMovies.find(m =>
                      m.title.toLowerCase() === movie.title.toLowerCase() &&
                      m.year === movie.year
                    );
                    if (match) {
                      await this.radarr.deleteMovie(match.id, true); // deleteFiles=true
                    }
                  } catch (radarrErr) {
                    console.error(`[VIPER] Radarr delete failed: ${radarrErr.message}`);
                  }
                }

                log('info', 'deletion', `Movie cleanup: deleted ${movie.title}`, {
                  media_title: movie.title,
                  media_type: 'movie',
                  reason
                });
              } catch (deleteErr) {
                results.errors.push({
                  title: movie.title,
                  error: deleteErr.message
                });
              }
            }
          } else {
            results.protected.push({
              title: movie.title,
              reason
            });
          }
        }
      }

      console.log(`[VIPER] Movie cleanup complete:`, {
        analyzed: results.moviesAnalyzed,
        candidates: results.deletionCandidates.length,
        deleted: results.deleted.length
      });

      // Send Discord notification if movies were deleted (not dry run)
      if (!dryRun && results.deleted.length > 0) {
        try {
          const movieList = results.deleted.map(m => `**${m.title}** (${m.year || 'Unknown'})`).join('\n');

          await NotificationService.notify('on_viper_cleanup', {
            title: 'VIPER Movie Cleanup Complete',
            message: `Deleted ${results.deleted.length} watched movie${results.deleted.length !== 1 ? 's' : ''}`,
            details: movieList,
            type: 'movie_cleanup',
            stats: {
              movies_analyzed: results.moviesAnalyzed,
              deleted: results.deleted.length
            }
          });
          console.log(`[VIPER] Notification sent for ${results.deleted.length} movie deletions`);
        } catch (notifyErr) {
          console.error('[VIPER] Failed to send movie notification:', notifyErr.message);
        }
      }

    } catch (err) {
      results.errors.push({ error: err.message });
    }

    return results;
  }
}

module.exports = Viper;
