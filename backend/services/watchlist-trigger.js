/**
 * Watchlist Trigger Service for Flexerr
 * Automatically downloads content when users add it to their watchlist
 * Handles restoration when users re-add deleted content
 */

const { db, log, getSetting, getMediaServerById } = require('../database');
const TMDBService = require('./tmdb');
const SonarrService = require('./sonarr');
const RadarrService = require('./radarr');
const PlexService = require('./plex');
const NotificationService = require('./notifications');
const JellyfinMediaServer = require('./media-server/jellyfin-media-server');

class WatchlistTriggerService {
  constructor() {
    this.sonarr = null;
    this.radarr = null;
    this.plex = null;
  }

  /**
   * Update daily stats for requests/availability
   */
  updateDailyStats(field) {
    const today = new Date().toISOString().split('T')[0];
    const updateField = field === 'requests' ? 'requests_count' : 'available_count';

    db.prepare(`
      INSERT INTO stats_daily (date, ${updateField})
      VALUES (?, 1)
      ON CONFLICT(date) DO UPDATE SET ${updateField} = ${updateField} + 1
    `).run(today);
  }

  /**
   * Initialize service connections
   */
  async initialize() {
    // Get Plex service
    const plexService = db.prepare("SELECT * FROM services WHERE type = 'plex' AND is_active = 1 LIMIT 1").get();
    if (plexService) {
      this.plex = new PlexService(plexService.url, plexService.api_key);
    }

    // Get Sonarr service
    const sonarrService = db.prepare("SELECT * FROM services WHERE type = 'sonarr' AND is_active = 1 LIMIT 1").get();
    if (sonarrService) {
      this.sonarr = new SonarrService(sonarrService.url, sonarrService.api_key);
    }

    // Get Radarr service
    const radarrService = db.prepare("SELECT * FROM services WHERE type = 'radarr' AND is_active = 1 LIMIT 1").get();
    if (radarrService) {
      this.radarr = new RadarrService(radarrService.url, radarrService.api_key);
    }
  }

  /**
   * Add item to user's watchlist and trigger download
   */
  async addToWatchlist(userId, tmdbId, mediaType) {
    try {
      await this.initialize();

      // Get TMDB details
      const details = mediaType === 'movie'
        ? await TMDBService.getMovie(tmdbId)
        : await TMDBService.getTVShow(tmdbId);

      // Check if already on user's watchlist
      const existing = db.prepare(`
        SELECT * FROM watchlist
        WHERE user_id = ? AND tmdb_id = ? AND media_type = ?
      `).get(userId, tmdbId, mediaType);

      if (existing && existing.is_active) {
        return { success: false, error: 'Already on watchlist' };
      }

      // Check if previously removed (re-add scenario)
      const wasRemoved = existing && !existing.is_active;

      // Get external IDs for IMDB
      const externalIds = details.external_ids || await TMDBService.getExternalIds(tmdbId, mediaType);
      const imdbId = externalIds?.imdb_id || null;

      // Add/update watchlist entry
      if (existing) {
        db.prepare(`
          UPDATE watchlist SET
            is_active = 1,
            added_at = CURRENT_TIMESTAMP,
            removed_at = NULL,
            imdb_id = COALESCE(?, imdb_id)
          WHERE id = ?
        `).run(imdbId, existing.id);
      } else {
        db.prepare(`
          INSERT INTO watchlist (user_id, tmdb_id, media_type, title, poster_path, imdb_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, tmdbId, mediaType, details.title, details.poster_path, imdbId);
      }

      // Create or update request
      let request = this.getRequest(tmdbId, mediaType);
      const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);

      if (!request) {
        // Create new request
        const externalIds = details.external_ids || await TMDBService.getExternalIds(tmdbId, mediaType);

        const result = db.prepare(`
          INSERT INTO requests (
            user_id, tmdb_id, tvdb_id, imdb_id, media_type, title, year,
            poster_path, backdrop_path, overview, status, seasons
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(
          userId,
          tmdbId,
          externalIds?.tvdb_id || null,
          externalIds?.imdb_id || null,
          mediaType,
          details.title,
          details.year,
          details.poster_path,
          details.backdrop_path,
          details.overview,
          mediaType === 'tv' ? JSON.stringify(details.seasons?.map(s => s.season_number).filter(n => n > 0)) : null
        );

        request = { id: result.lastInsertRowid };

        // Track new request in daily stats
        this.updateDailyStats('requests');
      }

      // If was previously removed or needs restoration, handle it
      const needsRestore = wasRemoved || this.needsRestoration(tmdbId, mediaType);
      if (needsRestore) {
        await this.handleRestoration(tmdbId, mediaType, details, userId);
      }

      // Trigger download
      const downloadResult = await this.triggerDownload(tmdbId, mediaType, details);

      // Update request status
      if (downloadResult.success) {
        // If already exists with file, mark as available; otherwise processing
        const status = downloadResult.alreadyHasFile ? 'available' : 'processing';
        db.prepare(`
          UPDATE requests SET
            status = ?,
            sonarr_id = ?,
            radarr_id = ?
          WHERE tmdb_id = ? AND media_type = ?
        `).run(
          status,
          downloadResult.sonarrId || null,
          downloadResult.radarrId || null,
          tmdbId,
          mediaType
        );

        // Track available in daily stats
        if (status === 'available') {
          this.updateDailyStats('available');
        }
      }

      log('info', 'watchlist', 'added_to_watchlist', {
        user_id: userId,
        tmdb_id: tmdbId,
        media_type: mediaType,
        media_title: details.title,
        was_restored: wasRemoved,
        username: user?.username
      });

      // Send Discord notification
      try {
        await NotificationService.notifyWatchlistAdd({
          title: details.title,
          year: details.year,
          poster_path: details.poster_path,
          media_type: mediaType
        }, user);
      } catch (notifyError) {
        console.error('[WatchlistTrigger] Notification error:', notifyError.message);
      }

      return {
        success: true,
        request: this.getRequest(tmdbId, mediaType),
        wasRestored: wasRemoved
      };
    } catch (error) {
      console.error('[WatchlistTrigger] Error adding to watchlist:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove item from user's watchlist (and optionally from Plex)
   */
  async removeFromWatchlist(userId, tmdbId, mediaType, removeFromPlex = true) {
    try {
      const existing = db.prepare(`
        SELECT w.*, r.year FROM watchlist w
        LEFT JOIN requests r ON w.tmdb_id = r.tmdb_id AND w.media_type = r.media_type
        WHERE w.user_id = ? AND w.tmdb_id = ? AND w.media_type = ? AND w.is_active = 1
      `).get(userId, tmdbId, mediaType);

      if (!existing) {
        return { success: false, error: 'Not on watchlist' };
      }

      // Mark as removed (don't delete - we track removal for restoration logic)
      db.prepare(`
        UPDATE watchlist SET
          is_active = 0,
          removed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(existing.id);

      // Also remove from Plex watchlist if requested
      if (removeFromPlex) {
        try {
          const user = db.prepare('SELECT plex_token FROM users WHERE id = ?').get(userId);
          if (user?.plex_token && this.plex) {
            const userPlex = new PlexService(this.plex.url, user.plex_token);
            await userPlex.removeFromPlexWatchlistByTitle(existing.title, existing.year, mediaType);
          }
        } catch (plexError) {
          console.warn('[WatchlistTrigger] Could not remove from Plex watchlist:', plexError.message);
        }
      }

      log('info', 'watchlist', 'removed_from_watchlist', {
        user_id: userId,
        tmdb_id: tmdbId,
        media_type: mediaType,
        media_title: existing.title
      });

      return { success: true };
    } catch (error) {
      console.error('[WatchlistTrigger] Error removing from watchlist:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user's watchlist
   */
  getWatchlist(userId) {
    return db.prepare(`
      SELECT w.*, r.status as request_status, r.available_at
      FROM watchlist w
      LEFT JOIN requests r ON w.tmdb_id = r.tmdb_id AND w.media_type = r.media_type
      WHERE w.user_id = ? AND w.is_active = 1
      ORDER BY w.added_at DESC
    `).all(userId);
  }

  /**
   * Get request by TMDB ID
   */
  getRequest(tmdbId, mediaType) {
    return db.prepare(`
      SELECT r.*, u.username as requested_by
      FROM requests r
      JOIN users u ON r.user_id = u.id
      WHERE r.tmdb_id = ? AND r.media_type = ?
    `).get(tmdbId, mediaType);
  }

  /**
   * Get all requests (for admin)
   */
  getAllRequests(filters = {}) {
    let query = `
      SELECT r.*, u.username as requested_by
      FROM requests r
      JOIN users u ON r.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.status) {
      query += ' AND r.status = ?';
      params.push(filters.status);
    }

    if (filters.media_type) {
      query += ' AND r.media_type = ?';
      params.push(filters.media_type);
    }

    if (filters.user_id) {
      query += ' AND r.user_id = ?';
      params.push(filters.user_id);
    }

    query += ' ORDER BY r.added_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    return db.prepare(query).all(...params);
  }

  /**
   * Trigger download in Sonarr/Radarr
   */
  async triggerDownload(tmdbId, mediaType, details) {
    try {
      if (mediaType === 'movie') {
        return await this.addToRadarr(tmdbId, details);
      } else {
        return await this.addToSonarr(tmdbId, details);
      }
    } catch (error) {
      console.error('[WatchlistTrigger] Error triggering download:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add movie to Radarr
   */
  async addToRadarr(tmdbId, details) {
    if (!this.radarr) {
      return { success: false, error: 'Radarr not configured' };
    }

    try {
      // Check if already in Radarr
      const existing = await this.radarr.getMovieByTmdbId(tmdbId);

      if (existing && existing.id) {
        // Already in Radarr - trigger search if not available
        if (!existing.hasFile) {
          await this.radarr.searchMovie(existing.id);
        }
        return { success: true, radarrId: existing.id, alreadyExists: true, alreadyHasFile: existing.hasFile };
      }

      // Get Radarr settings for defaults
      const rootFolders = await this.radarr.getRootFolders();
      const qualityProfiles = await this.radarr.getQualityProfiles();

      if (!rootFolders.length || !qualityProfiles.length) {
        return { success: false, error: 'Radarr not properly configured' };
      }

      // Add to Radarr
      const result = await this.radarr.addMovie(
        tmdbId,
        qualityProfiles[0].id,
        rootFolders[0].path,
        true,  // monitored
        true   // searchNow
      );

      return { success: true, radarrId: result.id };
    } catch (error) {
      console.error('[WatchlistTrigger] Radarr error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add TV show to Sonarr
   */
  async addToSonarr(tmdbId, details) {
    if (!this.sonarr) {
      return { success: false, error: 'Sonarr not configured' };
    }

    try {
      // Get TVDB ID
      const externalIds = details.external_ids || await TMDBService.getExternalIds(tmdbId, 'tv');
      const tvdbId = externalIds?.tvdb_id;

      if (!tvdbId) {
        return { success: false, error: 'Could not find TVDB ID for this show' };
      }

      // Check if already in Sonarr
      const existing = await this.sonarr.getSeriesByTvdbId(tvdbId);

      if (existing && existing.id) {
        // Already in Sonarr - ensure monitored and trigger search if needed
        if (!existing.monitored) {
          await this.sonarr.monitorSeries(existing.id);
        }
        // Only search if not all episodes have files
        const hasFiles = existing.episodeFileCount > 0;
        if (!hasFiles || existing.episodeFileCount < existing.episodeCount) {
          await this.sonarr.searchSeries(existing.id);
        }
        return { success: true, sonarrId: existing.id, alreadyExists: true, alreadyHasFile: hasFiles };
      }

      // Get Sonarr settings for defaults
      const rootFolders = await this.sonarr.getRootFolders();
      const qualityProfiles = await this.sonarr.getQualityProfiles();

      if (!rootFolders.length || !qualityProfiles.length) {
        return { success: false, error: 'Sonarr not properly configured' };
      }

      // Add to Sonarr - all seasons monitored by default
      const result = await this.sonarr.addSeries(
        tvdbId,
        qualityProfiles[0].id,
        rootFolders[0].path,
        true,  // monitored
        true   // searchNow
      );

      return { success: true, sonarrId: result.id };
    } catch (error) {
      console.error('[WatchlistTrigger] Sonarr error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle restoration of previously deleted content
   * This is called when a user re-adds content to their watchlist that was previously removed and deleted
   */
  async handleRestoration(tmdbId, mediaType, details, userId) {
    console.log(`[Restoration] Starting restoration for ${details.title} (${mediaType})`);

    const restoration = {
      restored: false,
      removedFromFlexerrExclusion: false,
      removedFromArrExclusion: false,
      reAddedToArr: false,
      searchTriggered: false,
      error: null
    };

    try {
      // Get external IDs for Sonarr/Radarr lookups
      const externalIds = details.external_ids || await TMDBService.getExternalIds(tmdbId, mediaType);

      // Check lifecycle table for deleted content
      const lifecycle = db.prepare(`
        SELECT * FROM lifecycle
        WHERE tmdb_id = ? AND media_type = ? AND (deleted_at IS NOT NULL OR added_to_exclusion = 1)
      `).get(tmdbId, mediaType);

      // Check Flexerr's own exclusions table
      const flexerrExclusion = db.prepare(`
        SELECT * FROM exclusions
        WHERE (tmdb_id = ? AND media_type = ?) OR (title = ? AND media_type = ?)
      `).get(tmdbId, mediaType, details.title, mediaType);

      // Track the original deletion date
      const originalDeletionAt = lifecycle?.deleted_at || null;

      // Create restoration record
      const restorationRecord = db.prepare(`
        INSERT INTO restorations (user_id, tmdb_id, media_type, title, original_deletion_at, status)
        VALUES (?, ?, ?, ?, ?, 'in_progress')
      `).run(userId, tmdbId, mediaType, details.title, originalDeletionAt);

      const restorationId = restorationRecord.lastInsertRowid;

      // Step 1: Remove from Flexerr's exclusions table
      if (flexerrExclusion) {
        try {
          db.prepare('DELETE FROM exclusions WHERE id = ?').run(flexerrExclusion.id);
          restoration.removedFromFlexerrExclusion = true;
          console.log(`[Restoration] Removed from Flexerr exclusions: ${details.title}`);
        } catch (e) {
          console.warn('[Restoration] Could not remove from Flexerr exclusions:', e.message);
        }
      }

      // Step 2: Remove from Sonarr/Radarr exclusions
      if (mediaType === 'movie' && this.radarr) {
        try {
          // Try to remove by TMDB ID
          await this.radarr.removeExclusionByTmdbId(tmdbId);
          restoration.removedFromArrExclusion = true;
          console.log(`[Restoration] Removed from Radarr exclusions: ${details.title}`);
        } catch (e) {
          // Might not be in exclusions, that's OK
          console.log(`[Restoration] Radarr exclusion removal: ${e.message}`);
        }
      } else if (mediaType === 'tv' && this.sonarr) {
        try {
          if (externalIds?.tvdb_id) {
            await this.sonarr.removeExclusionByTvdbId(externalIds.tvdb_id);
            restoration.removedFromArrExclusion = true;
            console.log(`[Restoration] Removed from Sonarr exclusions: ${details.title}`);
          }
        } catch (e) {
          console.log(`[Restoration] Sonarr exclusion removal: ${e.message}`);
        }
      }

      // Step 3: Update lifecycle status
      if (lifecycle) {
        db.prepare(`
          UPDATE lifecycle SET
            status = 'restoring',
            deleted_at = NULL,
            deletion_scheduled_at = NULL,
            added_to_exclusion = 0
          WHERE id = ?
        `).run(lifecycle.id);
      }

      // Step 4: Remove from queue_items if pending deletion
      db.prepare(`
        DELETE FROM queue_items
        WHERE tmdb_id = ? AND media_type = ? AND status = 'pending'
      `).run(tmdbId, mediaType);

      // Step 5: Re-add to Sonarr/Radarr if needed (this triggers download)
      // The triggerDownload method in addToWatchlist will handle this
      restoration.restored = true;

      // Update restoration record
      db.prepare(`
        UPDATE restorations SET
          removed_from_exclusion = ?,
          status = 'completed'
        WHERE id = ?
      `).run(restoration.removedFromFlexerrExclusion || restoration.removedFromArrExclusion ? 1 : 0, restorationId);

      log('info', 'restoration', 'Content restoration completed', {
        tmdb_id: tmdbId,
        media_type: mediaType,
        media_title: details.title,
        user_id: userId,
        removed_from_flexerr_exclusion: restoration.removedFromFlexerrExclusion,
        removed_from_arr_exclusion: restoration.removedFromArrExclusion
      });

      console.log(`[Restoration] Completed restoration for ${details.title}`);

      return restoration;
    } catch (error) {
      console.error('[Restoration] Error handling restoration:', error);
      restoration.error = error.message;

      // Update restoration record with error
      db.prepare(`
        UPDATE restorations SET
          status = 'failed',
          error_message = ?
        WHERE tmdb_id = ? AND media_type = ? AND status = 'in_progress'
      `).run(error.message, tmdbId, mediaType);

      return restoration;
    }
  }

  /**
   * Check if content was previously deleted and needs restoration
   */
  needsRestoration(tmdbId, mediaType) {
    // Check lifecycle for deletion
    const lifecycle = db.prepare(`
      SELECT * FROM lifecycle
      WHERE tmdb_id = ? AND media_type = ? AND (deleted_at IS NOT NULL OR added_to_exclusion = 1)
    `).get(tmdbId, mediaType);

    // Check exclusions table
    const exclusion = db.prepare(`
      SELECT * FROM exclusions
      WHERE tmdb_id = ? AND media_type = ?
    `).get(tmdbId, mediaType);

    return !!(lifecycle || exclusion);
  }

  /**
   * Get restoration history for a user
   */
  getRestorationHistory(userId, limit = 50) {
    return db.prepare(`
      SELECT * FROM restorations
      WHERE user_id = ?
      ORDER BY restored_at DESC
      LIMIT ?
    `).all(userId, limit);
  }

  /**
   * Get all restorations (admin view)
   */
  getAllRestorations(filters = {}) {
    let query = `
      SELECT r.*, u.username
      FROM restorations r
      JOIN users u ON r.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.status) {
      query += ' AND r.status = ?';
      params.push(filters.status);
    }

    if (filters.media_type) {
      query += ' AND r.media_type = ?';
      params.push(filters.media_type);
    }

    query += ' ORDER BY r.restored_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    return db.prepare(query).all(...params);
  }

  /**
   * Get pending restorations that need attention
   */
  getPendingRestorations() {
    return db.prepare(`
      SELECT r.*, u.username
      FROM restorations r
      JOIN users u ON r.user_id = u.id
      WHERE r.status IN ('pending', 'in_progress')
      ORDER BY r.restored_at ASC
    `).all();
  }

  /**
   * Check if content is protected by any user's watchlist
   */
  isProtectedByWatchlist(tmdbId, mediaType) {
    const count = db.prepare(`
      SELECT COUNT(*) as count FROM watchlist
      WHERE tmdb_id = ? AND media_type = ? AND is_active = 1
    `).get(tmdbId, mediaType);
    return count.count > 0;
  }

  /**
   * Get users who have item on watchlist
   */
  getWatchlistUsers(tmdbId, mediaType) {
    return db.prepare(`
      SELECT u.id, u.username, w.added_at
      FROM watchlist w
      JOIN users u ON w.user_id = u.id
      WHERE w.tmdb_id = ? AND w.media_type = ? AND w.is_active = 1
    `).all(tmdbId, mediaType);
  }

  /**
   * Update request status when content becomes available
   */
  markRequestAvailable(tmdbId, mediaType) {
    // Check if this will actually change status
    const current = db.prepare(`
      SELECT status FROM requests WHERE tmdb_id = ? AND media_type = ? AND status != 'available'
    `).get(tmdbId, mediaType);

    db.prepare(`
      UPDATE requests SET
        status = 'available',
        available_at = CURRENT_TIMESTAMP
      WHERE tmdb_id = ? AND media_type = ? AND status != 'available'
    `).run(tmdbId, mediaType);

    // Track in daily stats if status actually changed
    if (current) {
      this.updateDailyStats('available');
    }

    // Also update lifecycle
    db.prepare(`
      INSERT OR REPLACE INTO lifecycle (tmdb_id, media_type, status)
      VALUES (?, ?, 'available')
    `).run(tmdbId, mediaType);
  }

  /**
   * Check for availability updates (called periodically)
   * Updates status to: available, partial, or keeps processing
   */
  async checkAvailability() {
    try {
      await this.initialize();

      // Get processing requests
      const pendingRequests = db.prepare(`
        SELECT * FROM requests WHERE status IN ('pending', 'processing', 'partial')
      `).all();

      for (const request of pendingRequests) {
        let newStatus = null;

        try {
          if (request.media_type === 'movie' && request.radarr_id && this.radarr) {
            const movie = await this.radarr.getMovieById(request.radarr_id);
            if (movie?.hasFile === true) {
              newStatus = 'available';
            }
          } else if (request.media_type === 'tv' && request.sonarr_id && this.sonarr) {
            // Use detailed completion status for TV shows
            newStatus = await this.sonarr.getSeriesCompletionStatus(request.sonarr_id);
          }
        } catch (err) {
          // Handle 404 errors (deleted from Sonarr/Radarr) - clear the stale ID
          if (err.response?.status === 404) {
            console.warn(`[WatchlistTrigger] ${request.title} not found in arr - clearing stale ID`);
            if (request.media_type === 'movie') {
              db.prepare('UPDATE requests SET radarr_id = NULL WHERE id = ?').run(request.id);
            } else {
              db.prepare('UPDATE requests SET sonarr_id = NULL WHERE id = ?').run(request.id);
            }
          }
          continue; // Skip to next request
        }

        // Update status if changed
        if (newStatus && newStatus !== request.status) {
          this.updateRequestStatus(request.tmdb_id, request.media_type, newStatus);
          log('info', 'watchlist', `request_${newStatus}`, {
            tmdb_id: request.tmdb_id,
            media_type: request.media_type,
            media_title: request.title,
            old_status: request.status
          });
        }
      }
    } catch (error) {
      console.error('[WatchlistTrigger] Error checking availability:', error);
    }
  }

  /**
   * Update request status to a specific value
   */
  updateRequestStatus(tmdbId, mediaType, status) {
    const updates = status === 'available'
      ? 'status = ?, available_at = CURRENT_TIMESTAMP'
      : 'status = ?';

    db.prepare(`
      UPDATE requests SET ${updates}
      WHERE tmdb_id = ? AND media_type = ?
    `).run(status, tmdbId, mediaType);
  }

  /**
   * Process pending requests that haven't been sent to Sonarr/Radarr
   * This handles items imported from Plex watchlist sync that weren't downloaded
   */
  async processPendingRequests() {
    try {
      await this.initialize();

      // Get pending requests without Sonarr/Radarr IDs
      const pendingRequests = db.prepare(`
        SELECT * FROM requests
        WHERE status = 'pending'
        AND (radarr_id IS NULL AND sonarr_id IS NULL)
      `).all();

      if (pendingRequests.length === 0) {
        return { processed: 0 };
      }

      console.log(`[WatchlistTrigger] Processing ${pendingRequests.length} pending requests...`);
      let processed = 0;

      for (const request of pendingRequests) {
        try {
          // Get TMDB details
          const details = request.media_type === 'movie'
            ? await TMDBService.getMovie(request.tmdb_id)
            : await TMDBService.getTVShow(request.tmdb_id);

          if (!details) {
            console.warn(`[WatchlistTrigger] Could not get details for ${request.title}`);
            continue;
          }

          // Trigger download
          const downloadResult = await this.triggerDownload(request.tmdb_id, request.media_type, details);

          if (downloadResult.success) {
            const status = downloadResult.alreadyHasFile ? 'available' : 'processing';
            db.prepare(`
              UPDATE requests SET
                status = ?,
                sonarr_id = ?,
                radarr_id = ?
              WHERE id = ?
            `).run(
              status,
              downloadResult.sonarrId || null,
              downloadResult.radarrId || null,
              request.id
            );
            console.log(`[WatchlistTrigger] Triggered download for "${request.title}" - ${status}`);
            processed++;
          } else {
            console.warn(`[WatchlistTrigger] Failed to trigger download for "${request.title}": ${downloadResult.error}`);
          }
        } catch (reqError) {
          console.error(`[WatchlistTrigger] Error processing "${request.title}":`, reqError.message);
        }
      }

      return { processed, total: pendingRequests.length };
    } catch (error) {
      console.error('[WatchlistTrigger] Error processing pending requests:', error);
      throw error;
    }
  }

  /**
   * Sync Plex watchlist to Flexerr
   * Imports items from user's Plex watchlist and checks for existing media
   * Also detects removals and re-adds to trigger restoration workflow
   */
  async syncPlexWatchlist(userId, userPlexToken) {
    try {
      await this.initialize();

      if (!userPlexToken) {
        console.error('[WatchlistSync] No Plex token provided');
        return { error: 'No Plex token', imported: 0, errors: 1 };
      }

      console.log('[WatchlistSync] Fetching Plex watchlist with user token...');

      // Use user's token to get their personal watchlist
      // URL doesn't matter for watchlist - it's fetched from plex.tv
      const plex = new PlexService('https://plex.tv', userPlexToken);
      const plexWatchlist = await plex.getWatchlist();

      console.log(`[WatchlistSync] Found ${plexWatchlist.length} items in Plex watchlist`);

      if (plexWatchlist.length === 0) {
        console.log('[WatchlistSync] No items found - this could indicate an API issue');
      }

      const results = {
        imported: 0,
        alreadyExists: 0,
        available: 0,
        removed: 0,
        restored: 0,
        errors: 0,
        items: []
      };

      // Step 1: Get current active items in Flexerr's watchlist for this user
      const flexerrWatchlist = db.prepare(`
        SELECT tmdb_id, media_type, title FROM watchlist
        WHERE user_id = ? AND is_active = 1
      `).all(userId);

      // Step 2: Build a set of what's currently in Plex watchlist (we'll populate as we process)
      const plexWatchlistTmdbIds = new Set();

      for (const item of plexWatchlist) {
        try {
          // Determine media type from Plex item
          const mediaType = item.type === 'movie' ? 'movie' : 'tv';

          // Search TMDB to get the TMDB ID
          const searchResponse = mediaType === 'movie'
            ? await TMDBService.searchMovies(item.title)
            : await TMDBService.searchTV(item.title);

          const searchResults = searchResponse?.results || [];

          if (!searchResults || searchResults.length === 0) {
            console.log(`[WatchlistSync] Could not find "${item.title}" on TMDB`);
            results.errors++;
            continue;
          }

          // Find best match by title and year
          let tmdbMatch = searchResults.find(r =>
            r.title?.toLowerCase() === item.title?.toLowerCase() &&
            r.year === item.year
          ) || searchResults.find(r =>
            r.title?.toLowerCase() === item.title?.toLowerCase()
          ) || searchResults[0];

          const tmdbId = tmdbMatch.id;

          // Track this item as being in Plex watchlist
          plexWatchlistTmdbIds.add(`${tmdbId}-${mediaType}`);

          // Check if already in Flexerr watchlist (active)
          const existing = db.prepare(`
            SELECT * FROM watchlist
            WHERE user_id = ? AND tmdb_id = ? AND media_type = ? AND is_active = 1
          `).get(userId, tmdbId, mediaType);

          if (existing) {
            results.alreadyExists++;
            continue;
          }

          // Check if this was previously removed (re-add scenario)
          const previouslyRemoved = db.prepare(`
            SELECT * FROM watchlist
            WHERE user_id = ? AND tmdb_id = ? AND media_type = ? AND is_active = 0
          `).get(userId, tmdbId, mediaType);

          if (previouslyRemoved) {
            // This is a RE-ADD! User removed then re-added to watchlist
            console.log(`[WatchlistSync] Detected RE-ADD: "${item.title}" - triggering restoration`);

            // Get full TMDB details for restoration
            const details = mediaType === 'movie'
              ? await TMDBService.getMovie(tmdbId)
              : await TMDBService.getTVShow(tmdbId);

            // Re-activate the watchlist entry
            db.prepare(`
              UPDATE watchlist SET
                is_active = 1,
                added_at = CURRENT_TIMESTAMP,
                removed_at = NULL
              WHERE id = ?
            `).run(previouslyRemoved.id);

            // Reset the request status to trigger fresh download
            const existingRequest = this.getRequest(tmdbId, mediaType);
            if (existingRequest) {
              db.prepare(`
                UPDATE requests SET
                  status = 'pending',
                  available_at = NULL
                WHERE tmdb_id = ? AND media_type = ?
              `).run(tmdbId, mediaType);
            }

            // Handle restoration (remove from exclusions, reset lifecycle, etc.)
            await this.handleRestoration(tmdbId, mediaType, details, userId);

            // Trigger fresh download
            const downloadResult = await this.triggerDownload(tmdbId, mediaType, details);
            if (downloadResult.success) {
              const status = downloadResult.alreadyHasFile ? 'available' : 'processing';
              db.prepare(`
                UPDATE requests SET
                  status = ?,
                  sonarr_id = COALESCE(?, sonarr_id),
                  radarr_id = COALESCE(?, radarr_id)
                WHERE tmdb_id = ? AND media_type = ?
              `).run(
                status,
                downloadResult.sonarrId || null,
                downloadResult.radarrId || null,
                tmdbId,
                mediaType
              );
              console.log(`[WatchlistSync] Restoration triggered for "${details.title}" - ${status}`);
            }

            results.restored++;
            results.items.push({
              title: details.title,
              mediaType,
              tmdbId,
              restored: true
            });

            log('info', 'watchlist', 'watchlist_item_restored', {
              user_id: userId,
              tmdb_id: tmdbId,
              media_type: mediaType,
              media_title: details.title
            });

            continue;
          }

          // Get full TMDB details
          const details = mediaType === 'movie'
            ? await TMDBService.getMovie(tmdbId)
            : await TMDBService.getTVShow(tmdbId);

          // Check if media already exists in Plex/Sonarr/Radarr
          const existsInLibrary = await this.checkExistsInLibrary(tmdbId, mediaType, details);

          // Get IMDB ID for consistent matching
          const externalIds = details.external_ids || await TMDBService.getExternalIds(tmdbId, mediaType);
          const imdbId = externalIds?.imdb_id || null;

          // Add to Flexerr watchlist
          db.prepare(`
            INSERT INTO watchlist (user_id, tmdb_id, media_type, title, poster_path, imdb_id)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, tmdb_id, media_type) DO UPDATE SET
              is_active = 1,
              added_at = CURRENT_TIMESTAMP,
              removed_at = NULL,
              imdb_id = COALESCE(excluded.imdb_id, imdb_id)
          `).run(userId, tmdbId, mediaType, details.title, details.poster_path, imdbId);

          // Create request record (reuse externalIds from above)
          const existingRequest = this.getRequest(tmdbId, mediaType);

          if (!existingRequest) {
            db.prepare(`
              INSERT INTO requests (
                user_id, tmdb_id, tvdb_id, imdb_id, media_type, title, year,
                poster_path, backdrop_path, overview, status, sonarr_id, radarr_id, seasons
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              userId,
              tmdbId,
              externalIds?.tvdb_id || null,
              externalIds?.imdb_id || null,
              mediaType,
              details.title,
              details.year,
              details.poster_path,
              details.backdrop_path,
              details.overview,
              existsInLibrary.exists ? 'available' : 'pending',
              existsInLibrary.sonarrId || null,
              existsInLibrary.radarrId || null,
              mediaType === 'tv' ? JSON.stringify(details.seasons?.map(s => s.season_number).filter(n => n > 0)) : null
            );

            // Track new request in daily stats
            this.updateDailyStats('requests');

            if (existsInLibrary.exists) {
              // Already available - track it
              this.updateDailyStats('available');
              results.available++;
            } else {
              // Not in library - trigger download to Sonarr/Radarr
              try {
                const downloadResult = await this.triggerDownload(tmdbId, mediaType, details);
                if (downloadResult.success) {
                  // Update request with Sonarr/Radarr ID
                  const status = downloadResult.alreadyHasFile ? 'available' : 'processing';
                  db.prepare(`
                    UPDATE requests SET
                      status = ?,
                      sonarr_id = ?,
                      radarr_id = ?
                    WHERE tmdb_id = ? AND media_type = ?
                  `).run(
                    status,
                    downloadResult.sonarrId || null,
                    downloadResult.radarrId || null,
                    tmdbId,
                    mediaType
                  );
                  console.log(`[WatchlistSync] Triggered download for "${details.title}"`);
                } else {
                  console.warn(`[WatchlistSync] Failed to trigger download for "${details.title}": ${downloadResult.error}`);
                }
              } catch (dlError) {
                console.error(`[WatchlistSync] Download trigger error for "${details.title}":`, dlError.message);
              }
            }
          } else if (existsInLibrary.exists && existingRequest.status !== 'available') {
            // Update existing request to available
            this.markRequestAvailable(tmdbId, mediaType);
            results.available++;
          } else if (!existsInLibrary.exists && existingRequest) {
            // Files were deleted (cleaned up) but request exists - trigger re-download
            console.log(`[WatchlistSync] "${details.title}" was cleaned up, triggering re-download...`);
            try {
              if (mediaType === 'tv' && existingRequest.sonarr_id && this.sonarr) {
                await this.sonarr.searchSeries(existingRequest.sonarr_id);
                console.log(`[WatchlistSync] Triggered Sonarr search for "${details.title}" (ID: ${existingRequest.sonarr_id})`);
              } else if (mediaType === 'movie' && existingRequest.radarr_id && this.radarr) {
                await this.radarr.searchMovie(existingRequest.radarr_id);
                console.log(`[WatchlistSync] Triggered Radarr search for "${details.title}" (ID: ${existingRequest.radarr_id})`);
              } else {
                // No existing *arr ID - trigger fresh download
                const downloadResult = await this.triggerDownload(tmdbId, mediaType, details);
                if (downloadResult.success) {
                  db.prepare(`
                    UPDATE requests SET
                      status = 'processing',
                      sonarr_id = COALESCE(?, sonarr_id),
                      radarr_id = COALESCE(?, radarr_id)
                    WHERE tmdb_id = ? AND media_type = ?
                  `).run(
                    downloadResult.sonarrId || null,
                    downloadResult.radarrId || null,
                    tmdbId,
                    mediaType
                  );
                  console.log(`[WatchlistSync] Triggered fresh download for "${details.title}"`);
                }
              }
              // Update request status back to processing
              db.prepare(`UPDATE requests SET status = 'processing' WHERE tmdb_id = ? AND media_type = ?`)
                .run(tmdbId, mediaType);
            } catch (searchErr) {
              console.error(`[WatchlistSync] Failed to trigger re-download for "${details.title}":`, searchErr.message);
            }
          }

          results.imported++;
          results.items.push({
            title: details.title,
            mediaType,
            tmdbId,
            existsInLibrary: existsInLibrary.exists
          });

          console.log(`[WatchlistSync] Imported "${details.title}" (${existsInLibrary.exists ? 'available' : 'pending'})`);
        } catch (itemError) {
          console.error(`[WatchlistSync] Error processing "${item.title}":`, itemError.message);
          results.errors++;
        }
      }

      // Step 3: Detect items REMOVED from Plex watchlist
      // Items that are in Flexerr (active) but NOT in Plex anymore
      for (const flexerrItem of flexerrWatchlist) {
        const key = `${flexerrItem.tmdb_id}-${flexerrItem.media_type}`;
        if (!plexWatchlistTmdbIds.has(key)) {
          // This item was removed from Plex watchlist
          console.log(`[WatchlistSync] Detected REMOVAL: "${flexerrItem.title}" no longer in Plex watchlist`);

          // Mark as removed in Flexerr
          db.prepare(`
            UPDATE watchlist SET
              is_active = 0,
              removed_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND tmdb_id = ? AND media_type = ? AND is_active = 1
          `).run(userId, flexerrItem.tmdb_id, flexerrItem.media_type);

          results.removed++;

          log('info', 'watchlist', 'watchlist_item_removed', {
            user_id: userId,
            tmdb_id: flexerrItem.tmdb_id,
            media_type: flexerrItem.media_type,
            media_title: flexerrItem.title
          });
        }
      }

      log('info', 'watchlist', 'plex_watchlist_synced', {
        user_id: userId,
        imported: results.imported,
        available: results.available,
        removed: results.removed,
        restored: results.restored,
        errors: results.errors
      });

      return results;
    } catch (error) {
      console.error('[WatchlistSync] Error syncing Plex watchlist:', error);
      throw error;
    }
  }

  /**
   * Sync Jellyfin favorites to Flexerr
   * Imports items from user's Jellyfin favorites and checks for existing media
   * Also detects removals and re-adds to trigger restoration workflow
   */
  async syncJellyfinFavorites(userId, jellyfinUserId, mediaServerId) {
    try {
      await this.initialize();

      // Get the Jellyfin server from media_servers table
      const mediaServer = getMediaServerById(mediaServerId);
      if (!mediaServer || mediaServer.type !== 'jellyfin') {
        console.error('[JellyfinSync] Invalid or inactive Jellyfin server');
        return { error: 'Invalid Jellyfin server', imported: 0, errors: 1 };
      }

      const jellyfin = JellyfinMediaServer.fromMediaServer(mediaServer);
      if (!jellyfin) {
        console.error('[JellyfinSync] Could not initialize Jellyfin client');
        return { error: 'Could not connect to Jellyfin', imported: 0, errors: 1 };
      }

      console.log('[JellyfinSync] Fetching Jellyfin favorites...');

      // Get user's favorites (Jellyfin's watchlist equivalent)
      const jellyfinFavorites = await jellyfin.getWatchlist(jellyfinUserId);

      console.log(`[JellyfinSync] Found ${jellyfinFavorites.length} items in Jellyfin favorites`);

      const results = {
        imported: 0,
        alreadyExists: 0,
        available: 0,
        removed: 0,
        restored: 0,
        errors: 0,
        items: []
      };

      // Step 1: Get current active items in Flexerr's watchlist for this user
      const flexerrWatchlist = db.prepare(`
        SELECT tmdb_id, media_type, title FROM watchlist
        WHERE user_id = ? AND is_active = 1
      `).all(userId);

      // Step 2: Build a set of what's currently in Jellyfin favorites
      const jellyfinFavoritesTmdbIds = new Set();

      for (const item of jellyfinFavorites) {
        try {
          // Jellyfin items already have TMDB IDs extracted
          const tmdbId = item.tmdbId;
          const mediaType = item.type === 'movie' ? 'movie' : 'tv';

          if (!tmdbId) {
            console.log(`[JellyfinSync] Could not find TMDB ID for "${item.title}"`);
            results.errors++;
            continue;
          }

          // Track this item as being in Jellyfin favorites
          jellyfinFavoritesTmdbIds.add(`${tmdbId}-${mediaType}`);

          // Check if already in Flexerr watchlist (active)
          const existing = db.prepare(`
            SELECT * FROM watchlist
            WHERE user_id = ? AND tmdb_id = ? AND media_type = ? AND is_active = 1
          `).get(userId, tmdbId, mediaType);

          if (existing) {
            results.alreadyExists++;
            continue;
          }

          // Check if this was previously removed (re-add scenario)
          const previouslyRemoved = db.prepare(`
            SELECT * FROM watchlist
            WHERE user_id = ? AND tmdb_id = ? AND media_type = ? AND is_active = 0
          `).get(userId, tmdbId, mediaType);

          if (previouslyRemoved) {
            // This is a RE-ADD! User removed then re-added to favorites
            console.log(`[JellyfinSync] Detected RE-ADD: "${item.title}" - triggering restoration`);

            // Get full TMDB details for restoration
            const details = mediaType === 'movie'
              ? await TMDBService.getMovie(tmdbId)
              : await TMDBService.getTVShow(tmdbId);

            // Re-activate the watchlist entry
            db.prepare(`
              UPDATE watchlist SET
                is_active = 1,
                added_at = CURRENT_TIMESTAMP,
                removed_at = NULL
              WHERE id = ?
            `).run(previouslyRemoved.id);

            // Reset the request status to trigger fresh download
            const existingRequest = this.getRequest(tmdbId, mediaType);
            if (existingRequest) {
              db.prepare(`
                UPDATE requests SET
                  status = 'pending',
                  available_at = NULL
                WHERE tmdb_id = ? AND media_type = ?
              `).run(tmdbId, mediaType);
            }

            // Handle restoration
            await this.handleRestoration(tmdbId, mediaType, details, userId);

            // Trigger fresh download
            const downloadResult = await this.triggerDownload(tmdbId, mediaType, details);
            if (downloadResult.success) {
              const status = downloadResult.alreadyHasFile ? 'available' : 'processing';
              db.prepare(`
                UPDATE requests SET
                  status = ?,
                  sonarr_id = COALESCE(?, sonarr_id),
                  radarr_id = COALESCE(?, radarr_id)
                WHERE tmdb_id = ? AND media_type = ?
              `).run(
                status,
                downloadResult.sonarrId || null,
                downloadResult.radarrId || null,
                tmdbId,
                mediaType
              );
              console.log(`[JellyfinSync] Restoration triggered for "${details.title}" - ${status}`);
            }

            results.restored++;
            results.items.push({
              title: details.title,
              mediaType,
              tmdbId,
              restored: true
            });

            log('info', 'watchlist', 'jellyfin_favorite_restored', {
              user_id: userId,
              tmdb_id: tmdbId,
              media_type: mediaType,
              media_title: details.title
            });

            continue;
          }

          // New item - get full TMDB details
          const details = mediaType === 'movie'
            ? await TMDBService.getMovie(tmdbId)
            : await TMDBService.getTVShow(tmdbId);

          // Check if media already exists in library
          const existsInLibrary = await this.checkExistsInLibrary(tmdbId, mediaType, details);

          // Get external IDs
          const externalIds = details.external_ids || await TMDBService.getExternalIds(tmdbId, mediaType);
          const imdbId = externalIds?.imdb_id || null;

          // Add to Flexerr watchlist
          db.prepare(`
            INSERT INTO watchlist (user_id, tmdb_id, media_type, title, poster_path, imdb_id)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, tmdb_id, media_type) DO UPDATE SET
              is_active = 1,
              added_at = CURRENT_TIMESTAMP,
              removed_at = NULL,
              imdb_id = COALESCE(excluded.imdb_id, imdb_id)
          `).run(userId, tmdbId, mediaType, details.title, details.poster_path, imdbId);

          // Create request record if needed
          const existingRequest = this.getRequest(tmdbId, mediaType);

          if (!existingRequest) {
            db.prepare(`
              INSERT INTO requests (
                user_id, tmdb_id, tvdb_id, imdb_id, media_type, title, year,
                poster_path, backdrop_path, overview, status, sonarr_id, radarr_id, seasons, media_server_id
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              userId,
              tmdbId,
              externalIds?.tvdb_id || null,
              externalIds?.imdb_id || null,
              mediaType,
              details.title,
              details.year,
              details.poster_path,
              details.backdrop_path,
              details.overview,
              existsInLibrary.exists ? 'available' : 'pending',
              existsInLibrary.sonarrId || null,
              existsInLibrary.radarrId || null,
              mediaType === 'tv' ? JSON.stringify(details.seasons?.map(s => s.season_number).filter(n => n > 0)) : null,
              mediaServerId
            );

            this.updateDailyStats('requests');

            if (existsInLibrary.exists) {
              this.updateDailyStats('available');
              results.available++;
            } else {
              // Trigger download
              try {
                const downloadResult = await this.triggerDownload(tmdbId, mediaType, details);
                if (downloadResult.success) {
                  const status = downloadResult.alreadyHasFile ? 'available' : 'processing';
                  db.prepare(`
                    UPDATE requests SET
                      status = ?,
                      sonarr_id = ?,
                      radarr_id = ?
                    WHERE tmdb_id = ? AND media_type = ?
                  `).run(
                    status,
                    downloadResult.sonarrId || null,
                    downloadResult.radarrId || null,
                    tmdbId,
                    mediaType
                  );
                  console.log(`[JellyfinSync] Triggered download for "${details.title}"`);
                }
              } catch (dlError) {
                console.error(`[JellyfinSync] Download trigger error for "${details.title}":`, dlError.message);
              }
            }
          }

          results.imported++;
          results.items.push({
            title: details.title,
            mediaType,
            tmdbId,
            existsInLibrary: existsInLibrary.exists
          });

          console.log(`[JellyfinSync] Imported "${details.title}" (${existsInLibrary.exists ? 'available' : 'pending'})`);
        } catch (itemError) {
          console.error(`[JellyfinSync] Error processing "${item.title}":`, itemError.message);
          results.errors++;
        }
      }

      // Step 3: Detect items REMOVED from Jellyfin favorites
      for (const flexerrItem of flexerrWatchlist) {
        const key = `${flexerrItem.tmdb_id}-${flexerrItem.media_type}`;
        if (!jellyfinFavoritesTmdbIds.has(key)) {
          console.log(`[JellyfinSync] Detected REMOVAL: "${flexerrItem.title}" no longer in Jellyfin favorites`);

          db.prepare(`
            UPDATE watchlist SET
              is_active = 0,
              removed_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND tmdb_id = ? AND media_type = ? AND is_active = 1
          `).run(userId, flexerrItem.tmdb_id, flexerrItem.media_type);

          results.removed++;

          log('info', 'watchlist', 'jellyfin_favorite_removed', {
            user_id: userId,
            tmdb_id: flexerrItem.tmdb_id,
            media_type: flexerrItem.media_type,
            media_title: flexerrItem.title
          });
        }
      }

      log('info', 'watchlist', 'jellyfin_favorites_synced', {
        user_id: userId,
        imported: results.imported,
        available: results.available,
        removed: results.removed,
        restored: results.restored,
        errors: results.errors
      });

      return results;
    } catch (error) {
      console.error('[JellyfinSync] Error syncing Jellyfin favorites:', error);
      throw error;
    }
  }

  /**
   * Check if media already exists in Plex library or Sonarr/Radarr
   */
  async checkExistsInLibrary(tmdbId, mediaType, details) {
    const result = { exists: false, sonarrId: null, radarrId: null, plexRatingKey: null };

    try {
      // Check Radarr for movies
      if (mediaType === 'movie' && this.radarr) {
        try {
          const movie = await this.radarr.getMovieByTmdbId(tmdbId);
          if (movie && movie.id) {
            result.radarrId = movie.id;
            if (movie.hasFile) {
              result.exists = true;
            }
          }
        } catch (e) {
          // Not in Radarr
        }
      }

      // Check Sonarr for TV shows
      if (mediaType === 'tv' && this.sonarr) {
        try {
          const externalIds = details.external_ids || await TMDBService.getExternalIds(tmdbId, 'tv');
          if (externalIds?.tvdb_id) {
            const series = await this.sonarr.getSeriesByTvdbId(externalIds.tvdb_id);
            if (series && series.id) {
              result.sonarrId = series.id;
              if (series.episodeFileCount > 0) {
                result.exists = true;
              }
            }
          }
        } catch (e) {
          // Not in Sonarr
        }
      }

      // Check Plex library directly if not found in *arr
      if (!result.exists && this.plex) {
        try {
          const libraries = await this.plex.getLibraries();
          for (const lib of libraries) {
            if ((mediaType === 'movie' && lib.type === 'movie') ||
                (mediaType === 'tv' && lib.type === 'show')) {
              const contents = await this.plex.getLibraryContents(lib.id);
              // Match by title and year
              const match = contents.find(c =>
                c.title?.toLowerCase() === details.title?.toLowerCase() &&
                (!details.year || c.year === details.year)
              );
              if (match) {
                result.exists = true;
                result.plexRatingKey = match.ratingKey;
                break;
              }
            }
          }
        } catch (e) {
          console.warn('[WatchlistSync] Error checking Plex library:', e.message);
        }
      }
    } catch (error) {
      console.warn('[WatchlistSync] Error checking library existence:', error.message);
    }

    return result;
  }
}

module.exports = new WatchlistTriggerService();
