const { db, getSetting, log } = require('../database');
const PlexService = require('./plex');
const { MediaServerFactory } = require('./media-server');
const SonarrService = require('./sonarr');
const RadarrService = require('./radarr');
const Viper = require('./smart-episodes');

class RulesEngine {
  constructor() {
    this.plex = null;
    this.mediaServer = null;
    this.mediaServerType = null;
    this.sonarr = [];
    this.radarr = [];
  }

  async initialize() {
    // Use MediaServerFactory to support both Plex and Jellyfin
    const mediaServer = MediaServerFactory.getPrimary();

    if (mediaServer) {
      this.mediaServer = mediaServer;
      this.mediaServerType = mediaServer.type;
    } else {
      // Fallback to legacy PlexService for backward compatibility
      const plexService = PlexService.fromDb();
      if (plexService) {
        this.mediaServer = plexService;
        this.mediaServerType = 'plex';
      }
    }

    // Keep backwards compatibility for code that references this.plex
    this.plex = this.mediaServer;

    this.sonarr = SonarrService.getAllFromDb();
    this.radarr = RadarrService.getAllFromDb();

    if (!this.mediaServer) {
      throw new Error('No media server configured. Please configure Plex or Jellyfin.');
    }

    console.log(`[RulesEngine] Initialized with ${this.mediaServerType} media server`);
  }

  // Get all active rules sorted by priority

  /**
   * Check if a media item is manually protected from deletion
   */
  isManuallyProtected(tmdbId, mediaType) {
    if (!tmdbId || !mediaType) return { protected: false, reason: null };
    const normalizedType = mediaType === 'show' ? 'tv' : mediaType;
    try {
      const protection = db.prepare(`
        SELECT * FROM exclusions WHERE tmdb_id = ? AND media_type = ? AND type = 'manual_protection'
      `).get(parseInt(tmdbId), normalizedType);
      if (protection) return { protected: true, reason: 'Manually protected from deletion' };
      return { protected: false, reason: null };
    } catch (err) {
      console.error('[Protection] Error:', err.message);
      return { protected: false, reason: null };
    }
  }

  getActiveRules() {
    return db.prepare(`
      SELECT * FROM rules
      WHERE is_active = 1
      ORDER BY priority DESC, created_at ASC
    `).all();
  }

  // Get a single rule by ID
  getRule(ruleId) {
    return db.prepare('SELECT * FROM rules WHERE id = ?').get(ruleId);
  }

  // Evaluate a condition against an item
  evaluateCondition(condition, item, context) {
    const { field, operator, value } = condition;
    let itemValue;

    // Get the field value from item or context
    switch (field) {
      // Watch status conditions
      case 'watched':
        itemValue = item.viewCount > 0;
        break;
      case 'view_count':
        itemValue = item.viewCount || 0;
        break;
      case 'days_since_watched':
        if (!item.lastViewedAt) {
          itemValue = Infinity; // Never watched = infinite days
        } else {
          const lastWatched = new Date(item.lastViewedAt);
          itemValue = Math.floor((Date.now() - lastWatched.getTime()) / (1000 * 60 * 60 * 24));
        }
        break;
      case 'watch_progress':
        if (!item.duration) {
          itemValue = 0;
        } else {
          itemValue = ((item.viewOffset || 0) / item.duration) * 100;
        }
        break;

      // Activity conditions (for shows)
      case 'days_since_activity':
        if (!context.lastActivity) {
          itemValue = Infinity;
        } else {
          itemValue = Math.floor((Date.now() - context.lastActivity.getTime()) / (1000 * 60 * 60 * 24));
        }
        break;

      // Watchlist conditions (Flexerr handles watchlists internally)
      case 'on_watchlist':
        itemValue = context.onWatchlist || false;
        break;

      // Date & Time conditions
      case 'days_since_added':
        if (!item.addedAt) {
          itemValue = 0;
        } else {
          const addedAt = new Date(item.addedAt);
          itemValue = Math.floor((Date.now() - addedAt.getTime()) / (1000 * 60 * 60 * 24));
        }
        break;
      case 'days_since_release':
        // Calculate days since original release date
        if (item.originallyAvailableAt) {
          const releaseDate = new Date(item.originallyAvailableAt);
          itemValue = Math.floor((Date.now() - releaseDate.getTime()) / (1000 * 60 * 60 * 24));
        } else if (item.year) {
          // Fallback: assume January 1st of release year
          const releaseDate = new Date(item.year, 0, 1);
          itemValue = Math.floor((Date.now() - releaseDate.getTime()) / (1000 * 60 * 60 * 24));
        } else {
          itemValue = Infinity;
        }
        break;
      case 'year':
        itemValue = item.year || 0;
        break;
      case 'duration_minutes':
        // Duration is in milliseconds in Plex
        itemValue = item.duration ? Math.round(item.duration / 60000) : 0;
        break;

      // Media Info conditions
      case 'rating':
        itemValue = item.rating || item.audienceRating || 0;
        break;
      case 'genre':
        itemValue = item.genres || [];
        break;
      case 'content_rating':
        itemValue = item.contentRating || '';
        break;
      case 'studio':
        itemValue = item.studio || '';
        break;
      case 'language':
        // Try to get original language
        itemValue = item.originalLanguage || item.language || '';
        break;

      // TV Show specific
      case 'season_count':
        itemValue = item.childCount || 0;
        break;
      case 'episode_count':
        itemValue = item.leafCount || 0;
        break;
      case 'is_continuing':
        // Check if show status indicates it's still airing
        const status = (context.arrItem?.status || '').toLowerCase();
        itemValue = status === 'continuing' || status === 'returning series';
        break;

      // File & Quality conditions
      case 'resolution':
        itemValue = context.resolution || item.Media?.[0]?.videoResolution || '';
        break;
      case 'file_size_gb':
        itemValue = (context.fileSize || 0) / (1024 * 1024 * 1024);
        break;
      case 'video_codec':
        itemValue = item.Media?.[0]?.videoCodec || context.arrItem?.movieFile?.mediaInfo?.videoCodec || '';
        break;
      case 'audio_codec':
        itemValue = item.Media?.[0]?.audioCodec || context.arrItem?.movieFile?.mediaInfo?.audioCodec || '';
        break;
      case 'is_4k':
        const res = context.resolution || item.Media?.[0]?.videoResolution || '';
        itemValue = res === '4k' || res === '2160' || parseInt(res) >= 2160;
        break;
      case 'is_hdr':
        const hdrTypes = ['hdr', 'hdr10', 'hdr10+', 'dolby vision', 'dv', 'hlg'];
        const videoRange = (item.Media?.[0]?.Part?.[0]?.Stream?.[0]?.displayTitle || '').toLowerCase();
        const mediaInfo = context.arrItem?.movieFile?.mediaInfo?.videoDynamicRangeType || '';
        itemValue = hdrTypes.some(h => videoRange.includes(h) || mediaInfo.toLowerCase().includes(h));
        break;

      // Sonarr/Radarr conditions
      case 'monitored':
        itemValue = context.arrItem?.monitored ?? true;
        break;
      case 'quality_profile':
        itemValue = context.arrItem?.qualityProfileId?.toString() || context.arrItem?.qualityProfile?.name || '';
        break;
      case 'tags':
        // Get tag names from arr item
        const tagIds = context.arrItem?.tags || [];
        itemValue = tagIds.map(id => context.arrTagMap?.[id] || id.toString());
        break;
      case 'root_folder':
        itemValue = context.arrItem?.rootFolderPath || context.arrItem?.path || '';
        break;

      // Request conditions
      case 'has_request':
        itemValue = context.hasRequest || false;
        break;
      case 'requested_by':
        itemValue = context.requestedBy || '';
        break;
      case 'days_since_requested':
        if (!context.requestDate) {
          itemValue = Infinity;
        } else {
          itemValue = Math.floor((Date.now() - context.requestDate.getTime()) / (1000 * 60 * 60 * 24));
        }
        break;

      default:
        console.warn(`Unknown condition field: ${field}`);
        return true; // Unknown fields pass by default
    }

    // Evaluate the operator
    return this.evaluateOperator(itemValue, operator, value);
  }

  evaluateOperator(itemValue, operator, compareValue) {
    switch (operator) {
      case 'equals':
        return itemValue === compareValue;
      case 'not_equals':
        return itemValue !== compareValue;
      case 'greater_than':
        return itemValue > compareValue;
      case 'less_than':
        return itemValue < compareValue;
      case 'greater_than_or_equals':
        return itemValue >= compareValue;
      case 'less_than_or_equals':
        return itemValue <= compareValue;
      case 'contains':
        if (Array.isArray(itemValue)) {
          return itemValue.some(v =>
            v.toLowerCase().includes(compareValue.toLowerCase())
          );
        }
        return String(itemValue).toLowerCase().includes(String(compareValue).toLowerCase());
      case 'not_contains':
        if (Array.isArray(itemValue)) {
          return !itemValue.some(v =>
            v.toLowerCase().includes(compareValue.toLowerCase())
          );
        }
        return !String(itemValue).toLowerCase().includes(String(compareValue).toLowerCase());
      case 'in':
        if (Array.isArray(compareValue)) {
          return compareValue.includes(itemValue);
        }
        return false;
      case 'not_in':
        if (Array.isArray(compareValue)) {
          return !compareValue.includes(itemValue);
        }
        return true;
      case 'is_empty':
        if (Array.isArray(itemValue)) {
          return itemValue.length === 0;
        }
        return !itemValue;
      case 'is_not_empty':
        if (Array.isArray(itemValue)) {
          return itemValue.length > 0;
        }
        return !!itemValue;
      default:
        console.warn(`Unknown operator: ${operator}`);
        return true;
    }
  }

  // Evaluate a condition group (AND/OR logic)
  evaluateConditionGroup(group, item, context) {
    if (!group.conditions || group.conditions.length === 0) {
      return true;
    }

    const operator = group.operator || 'AND';
    const results = group.conditions.map(condition => {
      // Check if it's a nested group
      if (condition.conditions) {
        return this.evaluateConditionGroup(condition, item, context);
      }
      return this.evaluateCondition(condition, item, context);
    });

    if (operator === 'AND') {
      return results.every(r => r);
    } else {
      return results.some(r => r);
    }
  }

  // Check if an item is excluded
  isExcluded(item, context) {
    const exclusions = db.prepare(`
      SELECT * FROM exclusions
      WHERE (expires_at IS NULL OR expires_at > datetime('now'))
    `).all();

    for (const exclusion of exclusions) {
      switch (exclusion.type) {
        case 'media':
          if (exclusion.plex_id && item.ratingKey === exclusion.plex_id.toString()) {
            return true;
          }
          break;
        case 'user':
          if (context.watchedByUsers?.includes(exclusion.plex_user_id)) {
            return true;
          }
          break;
        case 'collection':
          if (context.collections?.includes(exclusion.value)) {
            return true;
          }
          break;
        case 'genre':
          if (item.genres?.some(g => g.toLowerCase() === exclusion.value.toLowerCase())) {
            return true;
          }
          break;
        case 'tag':
          if (context.arrItem?.tags?.includes(parseInt(exclusion.value))) {
            return true;
          }
          break;
        case 'regex':
          try {
            const regex = new RegExp(exclusion.value, 'i');
            if (regex.test(item.title)) {
              return true;
            }
          } catch (e) {
            console.warn(`Invalid regex exclusion: ${exclusion.value}`);
          }
          break;
      }
    }

    return false;
  }

  // Build context for an item (gather additional data)
  async buildContext(item, targetType) {
    const context = {
      onWatchlist: false,
      lastActivity: null,
      arrItem: null,
      fileSize: 0,
      hasRequest: false,
      requestedBy: null,
      requestDate: null,
      resolution: null,
      wantedBy: null,
      wantedReason: null
    };

    try {
      // For episodes, check the PARENT SHOW's watchlist status (not the episode)
      // Episodes are never directly watchlisted - shows are.
      if (item.type === 'episode' && item.grandparentRatingKey && this.plex) {
        // Get the parent show's metadata to check its watchlist status
        const showMeta = await this.plex.getItemMetadata(item.grandparentRatingKey);
        const showGuids = showMeta?.guids || [];
        const showTmdbGuid = showGuids.find(g => g.includes('tmdb://'));
        if (showTmdbGuid) {
          const showTmdbId = showTmdbGuid.replace('tmdb://', '');
          const watchlistEntry = db.prepare(`
            SELECT w.*, u.username FROM watchlist w
            JOIN users u ON w.user_id = u.id
            WHERE w.tmdb_id = ? AND w.is_active = 1
            LIMIT 1
          `).get(showTmdbId);
          if (watchlistEntry) {
            context.onWatchlist = true;
            context.wantedBy = watchlistEntry.username;
            context.wantedReason = 'parent_show_on_watchlist';
          }
        }
      } else {
        // For movies and shows, check directly
        // Check Plex watchlist (admin's only) - skip if Plex not configured
        if (this.plex) {
          context.onWatchlist = await this.plex.isOnWatchlist(item.ratingKey);
        }

        // Get Plex guids for fallback matching
        const guids = item.guids || [];

        // FIRST: Check Radarr/Sonarr for this item - their IDs are more reliable than Plex
        // Plex sometimes mismatches content, but Radarr/Sonarr track what was actually requested
        let arrTmdbId = null;
        let arrImdbId = null;

        if (item.type === 'movie') {
          // Get file path from Plex for fallback matching
          let filePath = null;
          if (item.Media?.[0]?.Part?.[0]?.file) {
            filePath = item.Media[0].Part[0].file;
          }

          for (const radarr of this.radarr) {
            try {
              // First try GUID matching
              let movie = await radarr.findMovieByGuid(guids);

              // If GUID fails, try path matching (handles Plex metadata mismatches)
              if (!movie && filePath) {
                movie = await radarr.findMovieByPath(filePath);
              }

              if (movie) {
                arrTmdbId = movie.tmdbId;
                arrImdbId = movie.imdbId;
                context.arrItem = movie;
                context.arrService = radarr;
                break;
              }
            } catch (e) { /* continue */ }
          }
        } else if (item.type === 'show') {
          for (const sonarr of this.sonarr) {
            try {
              const series = await sonarr.findSeriesByGuid(guids);
              if (series) {
                arrTmdbId = series.tmdbId;
                arrImdbId = series.imdbId;
                context.arrItem = series;
                context.arrService = sonarr;
                break;
              }
            } catch (e) { /* continue */ }
          }
        }

        // Check watchlist using Radarr/Sonarr IDs first (more reliable)
        if (!context.onWatchlist && arrTmdbId) {
          const watchlistEntry = db.prepare(`
            SELECT w.*, u.username FROM watchlist w
            JOIN users u ON w.user_id = u.id
            WHERE w.tmdb_id = ? AND w.is_active = 1
            LIMIT 1
          `).get(arrTmdbId);
          if (watchlistEntry) {
            context.onWatchlist = true;
            context.wantedBy = watchlistEntry.username;
            context.wantedReason = 'watchlist_via_radarr';
          }
        }

        if (!context.onWatchlist && arrImdbId) {
          const watchlistEntry = db.prepare(`
            SELECT w.*, u.username FROM watchlist w
            JOIN users u ON w.user_id = u.id
            WHERE w.imdb_id = ? AND w.is_active = 1
            LIMIT 1
          `).get(arrImdbId);
          if (watchlistEntry) {
            context.onWatchlist = true;
            context.wantedBy = watchlistEntry.username;
            context.wantedReason = 'watchlist_via_radarr_imdb';
          }
        }

        // Fallback: Try Plex TMDB ID
        if (!context.onWatchlist) {
          const tmdbGuid = guids.find(g => g.includes('tmdb://'));
          if (tmdbGuid) {
            const tmdbId = tmdbGuid.replace('tmdb://', '');
            const watchlistEntry = db.prepare(`
              SELECT w.*, u.username FROM watchlist w
              JOIN users u ON w.user_id = u.id
              WHERE w.tmdb_id = ? AND w.is_active = 1
              LIMIT 1
            `).get(tmdbId);
            if (watchlistEntry) {
              context.onWatchlist = true;
              context.wantedBy = watchlistEntry.username;
              context.wantedReason = 'watchlist';
            }
          }
        }

        // Fallback: Try Plex IMDB ID
        if (!context.onWatchlist) {
          const imdbGuid = guids.find(g => g.includes('imdb://'));
          if (imdbGuid) {
            const imdbId = imdbGuid.replace('imdb://', '');
            const watchlistEntry = db.prepare(`
              SELECT w.*, u.username FROM watchlist w
              JOIN users u ON w.user_id = u.id
              WHERE w.imdb_id = ? AND w.is_active = 1
              LIMIT 1
            `).get(imdbId);
            if (watchlistEntry) {
              context.onWatchlist = true;
              context.wantedBy = watchlistEntry.username;
              context.wantedReason = 'watchlist_imdb_match';
            }
          }
        }

        // Final fallback: check by title (case-insensitive)
        if (!context.onWatchlist && item.title) {
          const watchlistEntry = db.prepare(`
            SELECT w.*, u.username FROM watchlist w
            JOIN users u ON w.user_id = u.id
            WHERE LOWER(w.title) = LOWER(?) AND w.is_active = 1
            LIMIT 1
          `).get(item.title);
          if (watchlistEntry) {
            context.onWatchlist = true;
            context.wantedBy = watchlistEntry.username;
            context.wantedReason = 'watchlist_title_match';
          }
        }
      }

      // Get activity for shows
      // Note: targetType can be 'shows'/'show' (Plex uses 'show', rules use 'shows')
      const isShow = targetType === 'shows' || targetType === 'show';
      const isMovie = targetType === 'movies' || targetType === 'movie';
      const isTVContent = isShow || targetType === 'seasons' || targetType === 'episodes' || targetType === 'episode';

      if (isShow && this.plex) {
        const activity = await this.plex.getShowActivity(item.ratingKey);
        context.lastActivity = activity.lastActivity;
        context.watchedEpisodes = activity.totalWatched;
        context.totalEpisodes = activity.totalEpisodes;
      }

      // Get Sonarr/Radarr info if not already set above
      // For episodes, use parent show's guids to find the series
      const itemGuids = item.guids || [];
      if (!context.arrItem && isTVContent) {
        for (const sonarr of this.sonarr) {
          const series = await sonarr.findSeriesByGuid(itemGuids);
          if (series) {
            context.arrItem = series;
            context.arrService = sonarr;
            context.fileSize = await sonarr.getSeriesSize(series.id);
            break;
          }
        }
      } else if (!context.arrItem && isMovie) {
        for (const radarr of this.radarr) {
          const movie = await radarr.findMovieByGuid(itemGuids);
          if (movie) {
            context.arrItem = movie;
            context.arrService = radarr;
            context.fileSize = await radarr.getMovieSize(movie.id);
            context.resolution = movie.movieFile?.quality?.quality?.resolution;
            break;
          }
        }
      }

      // Get file size if we have arr info but didn't get size yet
      if (context.arrItem && !context.fileSize) {
        if (context.arrService && isMovie && typeof context.arrService.getMovieSize === 'function') {
          context.fileSize = await context.arrService.getMovieSize(context.arrItem.id);
        } else if (context.arrService && typeof context.arrService.getSeriesSize === 'function') {
          context.fileSize = await context.arrService.getSeriesSize(context.arrItem.id);
        }
      }

      // Note: Flexerr handles requests internally via its watchlist table
      // The hasRequest/requestedBy context is populated from Flexerr's own database above
    } catch (error) {
      console.error(`Error building context for ${item.title}:`, error.message);
    }

    return context;
  }

  // Run a single rule and return matching items
  async evaluateRule(rule, dryRun = true) {
    await this.initialize();

    // Check if smart mode is enabled for episode/show rules
    if (rule.smart_enabled && ['episodes', 'shows', 'seasons'].includes(rule.target_type)) {
      return await this.evaluateSmartRule(rule, dryRun);
    }

    const conditions = typeof rule.conditions === 'string'
      ? JSON.parse(rule.conditions)
      : rule.conditions;

    const targetLibraryIds = rule.target_library_ids
      ? (typeof rule.target_library_ids === 'string'
        ? JSON.parse(rule.target_library_ids)
        : rule.target_library_ids)
      : null;

    // Note: Flexerr uses its internal watchlist table instead of Overseerr

    const matches = [];

    // Skip if Plex not configured
    if (!this.plex) {
      console.warn('[RulesEngine] Plex not configured, skipping rule evaluation');
      return matches;
    }

    const libraries = await this.plex.getLibraries();

    // Filter libraries by target type and configured library IDs
    const targetLibraries = libraries.filter(lib => {
      // Match library type
      const typeMatch = (
        (rule.target_type === 'movies' && lib.type === 'movie') ||
        (['shows', 'seasons', 'episodes'].includes(rule.target_type) && lib.type === 'show')
      );

      // Match configured library IDs (if any)
      const idMatch = !targetLibraryIds || targetLibraryIds.length === 0 ||
        targetLibraryIds.includes(lib.id) ||
        targetLibraryIds.includes(parseInt(lib.id));

      return typeMatch && idMatch;
    });

    for (const library of targetLibraries) {
      const items = await this.plex.getLibraryContents(library.id);

      for (const item of items) {
        try {
          // Get full metadata
          const fullItem = await this.plex.getItemMetadata(item.ratingKey);

          // Build context (pass overseerr cache for efficient lookups)
          const context = await this.buildContext(fullItem, rule.target_type, );

          // Check exclusions
          if (this.isExcluded(fullItem, context)) {
            continue;
          }

          // Evaluate conditions
          if (this.evaluateConditionGroup(conditions, fullItem, context)) {
            matches.push({
              item: fullItem,
              context,
              library: library.title
            });
          }
        } catch (error) {
          console.error(`Error evaluating item ${item.title}:`, error.message);
        }
      }
    }

    // Update rule stats
    db.prepare(`
      UPDATE rules
      SET last_run = datetime('now'), last_run_matches = ?
      WHERE id = ?
    `).run(matches.length, rule.id);

    log('info', 'rule', `Rule "${rule.name}" evaluated`, {
      rule_id: rule.id,
      matches: matches.length,
      dry_run: dryRun
    });

    return matches;
  }

  // Execute actions for a matched item
  // fromQueue=true means buffer has expired, execute delete actions
  // fromQueue=false means initial rule run, only add to collection
  async executeActions(rule, match, dryRun = true, fromQueue = false) {
    const actions = typeof rule.actions === 'string'
      ? JSON.parse(rule.actions)
      : rule.actions;

    const { item, context } = match;
    const results = [];


    // CHECK: Manual protection - Priority 1 bypass
    // Extract TMDB ID from item guids for protection check
    let checkTmdbId = null;
    if (item.guids && Array.isArray(item.guids)) {
      const tmdbGuid = item.guids.find(g => g.includes('tmdb://'));
      if (tmdbGuid) {
        checkTmdbId = parseInt(tmdbGuid.replace('tmdb://', ''));
      }
    }

    if (checkTmdbId) {
      const protectionCheck = this.isManuallyProtected(checkTmdbId, item.type);
      if (protectionCheck.protected) {
        log('info', 'rules', 'Skipped due to manual protection', {
          title: item.title,
          tmdb_id: checkTmdbId,
          rule_id: rule.id,
          rule_name: rule.name
        });
        return [{
          action: 'skipped',
          success: true,
          message: protectionCheck.reason,
          skippedDueToProtection: true
        }];
      }
    }

    const collectionName = getSetting('collection_name') || 'Leaving Soon';
    const collectionDesc = getSetting('collection_description') || '';
    // Check if delete_files action is included in this rule's actions (per-rule setting, no global override)
    const shouldDeleteFiles = actions.some(a => a.type === 'delete_files');

    // Determine which actions to run based on context
    const destructiveActions = ['delete_from_plex', 'delete_from_sonarr', 'delete_from_radarr', 'delete_files'];

    for (const action of actions) {
      // Skip destructive actions unless we're processing from the queue (buffer expired)
      if (!fromQueue && destructiveActions.includes(action.type)) {
        continue;
      }

      // Skip add_to_collection when processing from queue (already done)
      if (fromQueue && action.type === 'add_to_collection') {
        continue;
      }

      try {
        const actionResult = { action: action.type, success: false, message: '' };

        // Special handling for add_to_collection in dry-run mode:
        // Add to queue with is_dry_run flag so users can see what would be queued
        if (action.type === 'add_to_collection') {
          const bufferDays = rule.buffer_days || parseInt(getSetting('buffer_days')) || 15;
          const actionAt = new Date();
          actionAt.setDate(actionAt.getDate() + bufferDays);

          // Extract tmdb_id from guids (format: tmdb://12345)
          let tmdbId = null;
          if (item.guids && Array.isArray(item.guids)) {
            const tmdbGuid = item.guids.find(g => g.includes('tmdb://'));
            if (tmdbGuid) {
              tmdbId = parseInt(tmdbGuid.replace('tmdb://', ''));
            }
          }

          if (dryRun) {
            // In dry-run mode: add to queue with is_dry_run=1, don't add to Plex collection
            // Skip if already in queue as a real entry
            const existingReal = db.prepare(`
              SELECT id FROM queue_items
              WHERE plex_rating_key = ? AND is_dry_run = 0 AND status = 'pending'
            `).get(item.ratingKey);

            if (!existingReal) {
              // Remove existing dry-run entry for this item (to update with new rule/date)
              db.prepare(`
                DELETE FROM queue_items
                WHERE plex_rating_key = ? AND is_dry_run = 1
              `).run(item.ratingKey);

              db.prepare(`
                INSERT INTO queue_items
                (rule_id, tmdb_id, plex_id, plex_rating_key, media_type, title, year, poster_url, metadata, action_at, is_dry_run)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
              `).run(
                rule.id,
                tmdbId || 0,
                item.ratingKey,
                item.ratingKey,
                item.type,
                item.title,
                item.year,
                item.thumb ? this.plex.url + item.thumb + '?X-Plex-Token=' + this.plex.token : null,
                JSON.stringify({ guids: item.guids, library: match.library }),
                actionAt.toISOString()
              );
            }
            actionResult.success = true;
            actionResult.message = existingReal
              ? `[DRY RUN] Already in queue (real entry exists)`
              : `[DRY RUN] Would add to "Leaving Soon" queue`;
            results.push(actionResult);
            continue;
          }

          // Live mode: add to queue first, then optionally add to Plex collection
          // Check if already in queue as a real entry
          const existingReal = db.prepare(`
            SELECT id FROM queue_items
            WHERE plex_rating_key = ? AND is_dry_run = 0 AND status = 'pending'
          `).get(item.ratingKey);

          if (!existingReal) {
            // Remove any existing dry-run entries for this item
            db.prepare(`
              DELETE FROM queue_items
              WHERE plex_rating_key = ? AND is_dry_run = 1
            `).run(item.ratingKey);

            // Add to queue (is_dry_run=0) - this is the core functionality
            db.prepare(`
              INSERT INTO queue_items
              (rule_id, tmdb_id, plex_id, plex_rating_key, media_type, title, year, poster_url, metadata, action_at, is_dry_run)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            `).run(
              rule.id,
              tmdbId || 0,  // Use 0 if tmdb_id not found (schema requires NOT NULL)
              item.ratingKey,
              item.ratingKey,
              item.type,
              item.title,
              item.year,
              item.thumb ? this.plex.url + item.thumb + '?X-Plex-Token=' + this.plex.token : null,
              JSON.stringify({ guids: item.guids, library: match.library }),
              actionAt.toISOString()
            );
            actionResult.success = true;
            actionResult.message = `Added to "Leaving Soon" queue`;
          } else {
            actionResult.success = true;
            actionResult.message = `Already in queue`;
          }

          // Optionally add to Plex collection (nice to have, not required)
          const targetCollectionName = action.collection_name || collectionName;
          try {
            const libraries = await this.plex.getLibraries();
            const library = libraries.find(l =>
              (item.type === 'movie' && l.type === 'movie') ||
              (item.type === 'show' && l.type === 'show') ||
              (item.type === 'episode' && l.type === 'show') ||
              (item.type === 'season' && l.type === 'show')
            );

            if (library) {
              const collection = await this.plex.getOrCreateCollection(
                library.id,
                targetCollectionName,
                collectionDesc,
                item.type
              );

              if (collection) {
                await this.plex.addToCollection(collection.ratingKey, item.ratingKey);
                actionResult.message += ` and Plex collection "${collection.title}"`;
              }
            }
          } catch (plexError) {
            // Plex collection is optional, don't fail the action
            console.warn(`[Rules] Could not add "${item.title}" to Plex collection: ${plexError.message}`);
          }

          results.push(actionResult);
          continue;
        }

        // For all other actions, skip if dry-run
        if (dryRun) {
          actionResult.success = true;
          actionResult.message = `[DRY RUN] Would execute: ${action.type}`;
          results.push(actionResult);
          continue;
        }

        switch (action.type) {

          case 'delete_from_plex':
            await this.plex.deleteItem(item.ratingKey);
            actionResult.success = true;
            actionResult.message = 'Deleted from Plex';
            break;

          case 'delete_from_sonarr':
            if (context.arrService && context.arrItem) {
              // Check if this is an episode-level deletion
              if (item.type === 'episode') {
                // For episodes: unmonitor the episode and delete the episode file
                // This prevents Sonarr from re-downloading the episode
                try {
                  const episodes = await context.arrService.getEpisodes(context.arrItem.id);
                  const sonarrEp = episodes.find(e =>
                    e.seasonNumber === item.parentIndex && e.episodeNumber === item.index
                  );

                  if (sonarrEp) {
                    // Unmonitor the episode first (prevents re-download)
                    await context.arrService.unmonitorEpisodes(context.arrItem.id, [sonarrEp.id]);

                    // Delete the episode file if it exists and delete_files is enabled
                    if (shouldDeleteFiles && sonarrEp.episodeFileId) {
                      await context.arrService.deleteEpisodeFile(sonarrEp.episodeFileId);
                      actionResult.message = 'Episode unmonitored and file deleted from Sonarr';
                    } else {
                      actionResult.message = 'Episode unmonitored in Sonarr';
                    }
                    actionResult.success = true;
                  } else {
                    actionResult.success = true;
                    actionResult.message = 'Episode not found in Sonarr (skipped)';
                  }
                } catch (epErr) {
                  console.error('[Rules] Error handling episode in Sonarr:', epErr.message);
                  actionResult.success = true;
                  actionResult.message = 'Episode handling failed: ' + epErr.message;
                }
              } else {
                // For series: delete the entire series
                await context.arrService.deleteSeries(
                  context.arrItem.id,
                  shouldDeleteFiles,  // Only delete files if rule explicitly has delete_files action
                  action.add_exclusion !== false
                );
                actionResult.success = true;
                actionResult.message = shouldDeleteFiles ? 'Deleted from Sonarr (files removed)' : 'Deleted from Sonarr (files kept)';
              }
            } else {
              // Not found in Sonarr is OK - item might have been added directly to Plex or already removed
              actionResult.success = true;
              actionResult.message = 'Not in Sonarr (skipped)';
            }
            break;

          case 'delete_from_radarr':
            if (context.arrService && context.arrItem) {
              await context.arrService.deleteMovie(
                context.arrItem.id,
                shouldDeleteFiles,  // Only delete files if rule explicitly has delete_files action
                action.add_exclusion !== false
              );
              actionResult.success = true;
              actionResult.message = shouldDeleteFiles ? 'Deleted from Radarr (files removed)' : 'Deleted from Radarr (files kept)';
            } else {
              // Not found in Radarr is OK - item might have been added directly to Plex or already removed
              actionResult.success = true;
              actionResult.message = 'Not in Radarr (skipped)';
            }
            break;

          case 'unmonitor_sonarr':
            if (context.arrService && context.arrItem) {
              await context.arrService.unmonitorSeries(context.arrItem.id);
              actionResult.success = true;
              actionResult.message = 'Unmonitored in Sonarr';
            }
            break;

          case 'unmonitor_radarr':
            if (context.arrService && context.arrItem) {
              await context.arrService.unmonitorMovie(context.arrItem.id);
              actionResult.success = true;
              actionResult.message = 'Unmonitored in Radarr';
            }
            break;

          case 'clear_overseerr_request':
            // Note: Flexerr doesn't use Overseerr - requests are managed internally
            actionResult.success = true;
            actionResult.message = 'Skipped (Flexerr uses internal request management)';
            break;

          case 'add_tag':
            if (context.arrService && context.arrItem && action.tag_name) {
              const tag = await context.arrService.getOrCreateTag(action.tag_name);
              if (item.type === 'movie') {
                await context.arrService.addTag(context.arrItem.id, tag.id);
              } else {
                await context.arrService.addTag(context.arrItem.id, tag.id);
              }
              actionResult.success = true;
              actionResult.message = `Added tag "${action.tag_name}"`;
            }
            break;

          case 'remove_tag':
            if (context.arrService && context.arrItem && action.tag_id) {
              if (item.type === 'movie') {
                await context.arrService.removeTag(context.arrItem.id, action.tag_id);
              } else {
                await context.arrService.removeTag(context.arrItem.id, action.tag_id);
              }
              actionResult.success = true;
              actionResult.message = 'Removed tag';
            }
            break;

          case 'delete_files':
            // This is handled by the delete_from_* actions with delete_files flag
            actionResult.success = true;
            actionResult.message = 'Files will be deleted';
            break;

          default:
            actionResult.message = `Unknown action: ${action.type}`;
        }

        results.push(actionResult);

        if (actionResult.success) {
          log('info', 'rule', `Executed action: ${action.type}`, {
            rule_id: rule.id,
            media_title: item.title,
            media_id: item.ratingKey
          });
        }
      } catch (error) {
        results.push({
          action: action.type,
          success: false,
          message: error.message
        });
        log('error', 'rule', `Action failed: ${action.type}`, {
          rule_id: rule.id,
          media_title: item.title,
          error: error.message
        });
      }
    }

    return results;
  }

  // Process items in the queue whose buffer has expired
  async processQueue() {
    await this.initialize();

    // First, clean up any stale items that no longer match rules
    await this.cleanupStaleQueueItems();

    // Only process non-dry-run items that are due
    const dueItems = db.prepare(`
      SELECT qi.*, r.actions
      FROM queue_items qi
      JOIN rules r ON qi.rule_id = r.id
      WHERE qi.status = 'pending'
      AND qi.action_at <= datetime('now')
      AND (qi.is_dry_run = 0 OR qi.is_dry_run IS NULL)
    `).all();

    const dryRun = getSetting('dry_run') === 'true';
    const maxDeletions = parseInt(getSetting('max_deletions_per_run')) || 50;

    let processed = 0;

    for (const queueItem of dueItems) {
      if (processed >= maxDeletions) {
        log('warn', 'system', `Reached max deletions per run (${maxDeletions})`);
        break;
      }

      try {
        const actions = JSON.parse(queueItem.actions);
        const metadata = JSON.parse(queueItem.metadata || '{}');

        // Get fresh item data from Plex
        let item;
        try {
          item = await this.plex.getItemMetadata(queueItem.plex_rating_key);
        } catch (error) {
          // Item might already be deleted
          db.prepare("UPDATE queue_items SET status = 'completed' WHERE id = ?").run(queueItem.id);
          continue;
        }

        // Re-check if still on watchlist (user might have saved it)
        // Check Plex watchlist and Flexerr's internal watchlist
        let onWatchlist = await this.plex.isOnWatchlist(queueItem.plex_rating_key);

        // Also check Flexerr's internal watchlist table
        if (!onWatchlist) {
          const guids = metadata.guids || [];
          const tmdbGuid = guids.find(g => g.includes('tmdb://'));
          if (tmdbGuid) {
            const tmdbId = tmdbGuid.replace('tmdb://', '');
            const watchlistCount = db.prepare(`
              SELECT COUNT(*) as count FROM watchlist
              WHERE tmdb_id = ? AND is_active = 1
            `).get(tmdbId)?.count || 0;
            if (watchlistCount > 0) {
              onWatchlist = true;
              log('info', 'rule', `Item on Flexerr watchlist: ${queueItem.title}`, {
                media_id: queueItem.plex_id
              });
            }
          }
        }

        if (onWatchlist) {
          // User saved it, cancel the deletion
          db.prepare("UPDATE queue_items SET status = 'cancelled' WHERE id = ?").run(queueItem.id);
          log('info', 'rule', `Item saved by user (watchlist): ${queueItem.title}`, {
            media_id: queueItem.plex_id
          });
          continue;
        }

        // Build context for re-evaluation
        const context = await this.buildContext(item, queueItem.media_type);

        // Re-evaluate rule conditions - item may no longer match
        const fullRule = db.prepare('SELECT * FROM rules WHERE id = ?').get(queueItem.rule_id);
        if (fullRule && !fullRule.smart_enabled) {
          // For non-smart rules, re-evaluate conditions
          const conditions = typeof fullRule.conditions === 'string'
            ? JSON.parse(fullRule.conditions)
            : fullRule.conditions;

          const stillMatches = this.evaluateConditionGroup(conditions, item, context);

          if (!stillMatches) {
            // Item no longer matches rule conditions - remove from queue
            db.prepare("UPDATE queue_items SET status = 'cancelled' WHERE id = ?").run(queueItem.id);
            log('info', 'rule', `Item no longer matches rule conditions: ${queueItem.title}`, {
              media_id: queueItem.plex_id,
              rule_name: fullRule.name
            });
            continue;
          }
        }

        const rule = { id: queueItem.rule_id, actions };

        // Check if there are any delete actions to execute
        const hasDeleteActions = actions.some(a =>
          ['delete_from_plex', 'delete_from_sonarr', 'delete_from_radarr', 'delete_files'].includes(a.type)
        );

        if (hasDeleteActions) {
          const results = await this.executeActions(
            rule,
            { item, context },
            dryRun,
            true  // fromQueue=true - execute delete actions now
          );

          const allSuccess = results.every(r => r.success);
          db.prepare(`
            UPDATE queue_items
            SET status = ?, error_message = ?
            WHERE id = ?
          `).run(
            allSuccess ? 'completed' : 'error',
            allSuccess ? null : results.find(r => !r.success)?.message,
            queueItem.id
          );

          if (allSuccess && !dryRun) {
            // Update daily stats
            const today = new Date().toISOString().split('T')[0];
            db.prepare(`
              INSERT INTO stats_daily (date, deletions_count, storage_saved_bytes)
              VALUES (?, 1, ?)
              ON CONFLICT(date) DO UPDATE SET
                deletions_count = deletions_count + 1,
                storage_saved_bytes = storage_saved_bytes + excluded.storage_saved_bytes
            `).run(today, context.fileSize || 0);
          }

          processed++;
        }
      } catch (error) {
        db.prepare(`
          UPDATE queue_items
          SET status = 'error', error_message = ?
          WHERE id = ?
        `).run(error.message, queueItem.id);

        log('error', 'rule', `Queue processing failed for: ${queueItem.title}`, {
          media_id: queueItem.plex_id,
          error: error.message
        });
      }
    }

    return processed;
  }

  // Evaluate a rule using Smart Episode logic
  async evaluateSmartRule(rule, dryRun = true) {
    await this.initialize();

    const smartManager = new Viper();
    await smartManager.initialize();

    // Build smart options from rule settings
    const smartOptions = {
      minDaysSinceWatch: rule.smart_min_days_since_watch || 15,
      velocityBufferDays: rule.smart_velocity_buffer_days || 7,
      protectEpisodesAhead: rule.smart_protect_episodes_ahead || 3,
      activeViewerDays: rule.smart_active_viewer_days || 30,
      requireAllUsersWatched: rule.smart_require_all_users_watched !== 0,
      proactiveRedownload: rule.smart_proactive_redownload !== 0,
      redownloadLeadDays: rule.smart_redownload_lead_days || 3
    };

    const targetLibraryIds = rule.target_library_ids
      ? (typeof rule.target_library_ids === 'string'
        ? JSON.parse(rule.target_library_ids)
        : rule.target_library_ids)
      : null;

    const conditions = typeof rule.conditions === 'string'
      ? JSON.parse(rule.conditions)
      : rule.conditions;

    // Note: Flexerr uses its internal watchlist table instead of Overseerr

    const matches = [];
    const libraries = await this.plex.getLibraries();

    // Filter to show libraries only
    const showLibraries = libraries.filter(lib => {
      const typeMatch = lib.type === 'show';
      const idMatch = !targetLibraryIds || targetLibraryIds.length === 0 ||
        targetLibraryIds.includes(lib.id) || targetLibraryIds.includes(parseInt(lib.id));
      return typeMatch && idMatch;
    });

    for (const library of showLibraries) {
      const shows = await this.plex.getLibraryContents(library.id);

      for (const show of shows) {
        try {
          // Check if the show is wanted by anyone via Flexerr's internal watchlist
          let showOnWatchlist = false;
          let showWantedBy = null;
          let showWantedReason = null;

          // Check Flexerr's internal watchlist table
          const showMeta = await this.plex.getItemMetadata(show.ratingKey);
          const showGuids = showMeta.guids || [];
          const tmdbGuid = showGuids.find(g => g.includes('tmdb://'));
          if (tmdbGuid) {
            const tmdbId = tmdbGuid.replace('tmdb://', '');
            const watchlistEntry = db.prepare(`
              SELECT w.*, u.username FROM watchlist w
              JOIN users u ON w.user_id = u.id
              WHERE w.tmdb_id = ? AND w.is_active = 1
              LIMIT 1
            `).get(tmdbId);
            if (watchlistEntry) {
              showOnWatchlist = true;
              showWantedBy = watchlistEntry.username;
              showWantedReason = 'watchlist';
            }
          }

          // Analyze this show with smart logic
          const analysis = await smartManager.analyzeShow(show.ratingKey);

          if (!analysis || !analysis.episodes) continue;

          // Filter to episodes that are safe to delete according to smart logic
          const deletableEpisodes = analysis.episodes.filter(ep => {
            if (!ep.safeToDelete) return false;

            // Build context with actual watchlist status from show
            const context = {
              onWatchlist: showOnWatchlist,
              wantedBy: showWantedBy,
              wantedReason: showWantedReason,
              lastActivity: ep.lastViewedAt ? new Date(ep.lastViewedAt) : null
            };

            // Evaluate additional conditions if present
            if (conditions.conditions && conditions.conditions.length > 0) {
              return this.evaluateConditionGroup(conditions, ep, context);
            }

            return true;
          });

          // Add each deletable episode as a match
          for (const ep of deletableEpisodes) {
            // Get full episode metadata
            let fullItem;
            try {
              fullItem = await this.plex.getItemMetadata(ep.ratingKey);
            } catch (err) {
              fullItem = {
                ...ep,
                title: `${show.title} - S${ep.seasonNumber}E${ep.episodeNumber}`,
                type: 'episode'
              };
            }

            const context = await this.buildContext(fullItem, 'episodes', );
            context.smartAnalysis = {
              usersBeyond: ep.usersBeyond,
              usersApproaching: ep.usersApproaching,
              deletionReason: ep.deletionReason,
              needsRedownload: ep.needsRedownload
            };

            // Check exclusions
            if (this.isExcluded(fullItem, context)) {
              continue;
            }

            matches.push({
              item: fullItem,
              context,
              library: library.title,
              show: show.title,
              smartMode: true
            });
          }

          // Handle proactive re-downloads if enabled
          if (smartOptions.proactiveRedownload && !dryRun) {
            const needsRedownload = analysis.episodes.filter(ep => ep.needsRedownload);
            for (const ep of needsRedownload) {
              // Check if episode file exists in Sonarr
              if (this.sonarr.length > 0) {
                const sonarr = this.sonarr[0];
                const series = await sonarr.findSeriesByGuid(show.guids || []);
                if (series) {
                  const hasFile = await sonarr.episodeHasFile(series.id, ep.seasonNumber, ep.episodeNumber);
                  if (!hasFile) {
                    // Trigger re-download
                    const episodes = await sonarr.getEpisodes(series.id);
                    const sonarrEp = episodes.find(e =>
                      e.seasonNumber === ep.seasonNumber && e.episodeNumber === ep.episodeNumber
                    );
                    if (sonarrEp) {
                      await sonarr.monitorEpisode(sonarrEp.id, true);
                      await sonarr.searchEpisode(sonarrEp.id);
                      log('info', 'viper', 'Triggered proactive re-download', {
                        rule_id: rule.id,
                        media_title: `${show.title} S${ep.seasonNumber}E${ep.episodeNumber}`,
                        media_type: 'episode'
                      });
                    }
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error(`Error evaluating show ${show.title} with smart mode:`, error.message);
        }
      }
    }

    // Update rule stats
    db.prepare(`
      UPDATE rules
      SET last_run = datetime('now'), last_run_matches = ?
      WHERE id = ?
    `).run(matches.length, rule.id);

    log('info', 'rule', `Smart rule "${rule.name}" evaluated`, {
      rule_id: rule.id,
      matches: matches.length,
      dry_run: dryRun,
      smart_mode: true
    });

    return matches;
  }

  // Run all active rules
  async runAllRules(dryRun = null) {
    if (dryRun === null) {
      dryRun = getSetting('dry_run') === 'true';
    }

    // Clean up stale queue items before running rules (only for real runs)
    if (!dryRun) {
      await this.cleanupStaleQueueItems();
    }

    const rules = this.getActiveRules();
    const results = [];

    for (const rule of rules) {
      try {
        const matches = await this.evaluateRule(rule, dryRun);

        for (const match of matches) {
          const actionResults = await this.executeActions(rule, match, dryRun);
          results.push({
            rule: rule.name,
            item: match.item.title,
            actions: actionResults
          });
        }
      } catch (error) {
        log('error', 'rule', `Rule "${rule.name}" failed`, {
          rule_id: rule.id,
          error: error.message
        });
        results.push({
          rule: rule.name,
          error: error.message
        });
      }
    }

    // Process queue (items whose buffer has expired)
    const processed = await this.processQueue();

    // Update daily stats
    const today = new Date().toISOString().split('T')[0];
    db.prepare(`
      INSERT INTO stats_daily (date, rules_run, queue_size)
      VALUES (?, ?, (SELECT COUNT(*) FROM queue_items WHERE status = 'pending'))
      ON CONFLICT(date) DO UPDATE SET
        rules_run = rules_run + excluded.rules_run,
        queue_size = excluded.queue_size
    `).run(today, rules.length);

    return {
      rulesRun: rules.length,
      matches: results.length,
      queueProcessed: processed,
      dryRun,
      results
    };
  }

  // Clean up queue items that no longer match their rules
  async cleanupStaleQueueItems() {
    await this.initialize();

    const pendingItems = db.prepare(`
      SELECT qi.*, r.conditions, r.smart_enabled, r.name as rule_name
      FROM queue_items qi
      JOIN rules r ON qi.rule_id = r.id
      WHERE qi.status = 'pending'
      AND (qi.is_dry_run = 0 OR qi.is_dry_run IS NULL)
    `).all();

    let removed = 0;
    let kept = 0;

    for (const queueItem of pendingItems) {
      try {
        // Get fresh item data from Plex
        let item;
        try {
          item = await this.plex.getItemMetadata(queueItem.plex_rating_key);
        } catch (error) {
          // Item no longer exists in Plex - remove from queue
          db.prepare("DELETE FROM queue_items WHERE id = ?").run(queueItem.id);
          removed++;
          continue;
        }

        // Check if now on watchlist (Plex watchlist or Flexerr internal)
        const metadata = JSON.parse(queueItem.metadata || '{}');
        let onWatchlist = await this.plex.isOnWatchlist(queueItem.plex_rating_key);

        // Also check Flexerr's internal watchlist
        if (!onWatchlist) {
          const guids = metadata.guids || [];
          const tmdbGuid = guids.find(g => g.includes('tmdb://'));
          if (tmdbGuid) {
            const tmdbId = tmdbGuid.replace('tmdb://', '');
            const watchlistCount = db.prepare(`
              SELECT COUNT(*) as count FROM watchlist
              WHERE tmdb_id = ? AND is_active = 1
            `).get(tmdbId)?.count || 0;
            if (watchlistCount > 0) {
              onWatchlist = true;
            }
          }
        }

        if (onWatchlist) {
          // User saved it - remove from queue
          db.prepare("DELETE FROM queue_items WHERE id = ?").run(queueItem.id);
          log('info', 'rule', `Queue cleanup: removed watchlisted item: ${queueItem.title}`);
          removed++;
          continue;
        }

        // For non-smart rules, re-evaluate conditions
        if (!queueItem.smart_enabled) {
          const conditions = typeof queueItem.conditions === 'string'
            ? JSON.parse(queueItem.conditions)
            : queueItem.conditions;

          const context = await this.buildContext(item, queueItem.media_type);
          const stillMatches = this.evaluateConditionGroup(conditions, item, context);

          if (!stillMatches) {
            db.prepare("DELETE FROM queue_items WHERE id = ?").run(queueItem.id);
            log('info', 'rule', `Queue cleanup: ${queueItem.title} no longer matches rule "${queueItem.rule_name}"`);
            removed++;
            continue;
          }
        }

        kept++;
      } catch (error) {
        console.error(`[RulesEngine] Error checking queue item ${queueItem.id}:`, error.message);
      }
    }

    if (removed > 0) {
      log('info', 'system', `Queue cleanup: removed ${removed} stale items, kept ${kept}`);
    }

    return { removed, kept };
  }
}

module.exports = RulesEngine;
