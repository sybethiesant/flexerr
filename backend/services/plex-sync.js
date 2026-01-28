/**
 * Plex Sync Service
 *
 * Handles efficient synchronization with Plex:
 * - Library content tracking (additions/removals)
 * - Watch history sync for velocity calculation
 * - User import from Plex server
 *
 * Uses delta-based syncing to minimize API calls:
 * - Tracks last sync timestamps
 * - Only fetches recently changed items
 * - Caches library state for comparison
 */

const { db, log, getSetting, setSetting, createOrUpdateUser, getUserByPlexId } = require('../database');
const PlexService = require('./plex');
const MediaConverterService = require('./media-converter');

// Sync state stored in memory (persisted to settings table)
const syncState = {
  lastLibrarySync: null,
  lastWatchHistorySync: null,
  lastUserSync: null,
  lastLifecycleRepair: null,
  libraryCache: new Map(), // ratingKey -> { title, addedAt, type }
  isRunning: false,
  consecutiveErrors: 0,
  lastError: null
};

// Lifecycle repair interval (5 minutes)
const LIFECYCLE_REPAIR_INTERVAL = 5 * 60 * 1000;

// Rate limiting - minimum ms between API calls
const API_DELAY = 100;
const MAX_CONSECUTIVE_ERRORS = 5;
const ERROR_BACKOFF_MS = 30000; // 30 seconds backoff after errors

/**
 * Sleep helper for rate limiting
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Extract TMDB ID from Plex GUIDs array
 * GUIDs format: ['tmdb://225171', 'tvdb://12345', 'imdb://tt1234567']
 */
function extractTmdbIdFromGuids(guids) {
  if (!guids || !Array.isArray(guids)) return null;
  for (const guid of guids) {
    const str = typeof guid === 'string' ? guid : guid?.id;
    if (str && str.startsWith('tmdb://')) {
      const id = parseInt(str.replace('tmdb://', ''), 10);
      if (id > 0) return id;
    }
  }
  return null;
}

/**
 * Normalize a title for fuzzy matching
 * Handles leetspeak substitutions (1→I, 0→O, 3→E, etc.)
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
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Load sync state from database
 */
function loadSyncState() {
  try {
    const lastLibrary = getSetting('plex_sync_last_library');
    const lastHistory = getSetting('plex_sync_last_history');
    const lastUsers = getSetting('plex_sync_last_users');
    const cache = getSetting('plex_sync_library_cache');

    if (lastLibrary) syncState.lastLibrarySync = new Date(lastLibrary);
    if (lastHistory) syncState.lastWatchHistorySync = new Date(lastHistory);
    if (lastUsers) syncState.lastUserSync = new Date(lastUsers);

    if (cache) {
      try {
        const cacheData = JSON.parse(cache);
        syncState.libraryCache = new Map(Object.entries(cacheData));
      } catch (e) {
        syncState.libraryCache = new Map();
      }
    }

    console.log('[PlexSync] Loaded sync state:', {
      lastLibrarySync: syncState.lastLibrarySync,
      lastWatchHistorySync: syncState.lastWatchHistorySync,
      lastUserSync: syncState.lastUserSync,
      cacheSize: syncState.libraryCache.size
    });
  } catch (error) {
    console.error('[PlexSync] Error loading sync state:', error.message);
  }
}

/**
 * Save sync state to database
 */
function saveSyncState() {
  try {
    if (syncState.lastLibrarySync) {
      setSetting('plex_sync_last_library', syncState.lastLibrarySync.toISOString());
    }
    if (syncState.lastWatchHistorySync) {
      setSetting('plex_sync_last_history', syncState.lastWatchHistorySync.toISOString());
    }
    if (syncState.lastUserSync) {
      setSetting('plex_sync_last_users', syncState.lastUserSync.toISOString());
    }

    // Convert Map to object for storage
    const cacheObj = Object.fromEntries(syncState.libraryCache);
    setSetting('plex_sync_library_cache', JSON.stringify(cacheObj));
  } catch (error) {
    console.error('[PlexSync] Error saving sync state:', error.message);
  }
}

/**
 * Get Plex service instance
 */
function getPlexService() {
  const plex = PlexService.fromDb();
  if (!plex) {
    throw new Error('Plex service not configured');
  }
  return plex;
}

/**
 * Sync library content - detect additions and removals
 * Uses recently added endpoint + comparison with cached state
 */
async function syncLibraryContent() {
  const plex = getPlexService();
  const now = new Date();
  const changes = { added: [], removed: [], updated: [] };

  try {
    // Get all libraries
    const libraries = await plex.getLibraries();
    await sleep(API_DELAY);

    const currentItems = new Map();

    for (const library of libraries) {
      // Only sync movie and show libraries
      if (!['movie', 'show'].includes(library.type)) continue;

      // Get library contents
      // Use recentlyAdded if we have a last sync time (more efficient)
      let items;

      if (syncState.lastLibrarySync) {
        // Get recently added items (since last sync)
        const sinceTimestamp = Math.floor(syncState.lastLibrarySync.getTime() / 1000);
        try {
          const response = await plex.client.get(`/library/sections/${library.id}/recentlyAdded`, {
            params: {
              'X-Plex-Container-Start': 0,
              'X-Plex-Container-Size': 500,
              'addedAt>': sinceTimestamp - 60 // 1 minute buffer
            }
          });
          items = response.data.MediaContainer.Metadata || [];
        } catch (e) {
          // Fallback to full library fetch if recentlyAdded fails
          items = await plex.getLibraryContents(library.id);
        }
      } else {
        // First sync - get all items
        items = await plex.getLibraryContents(library.id);
      }

      await sleep(API_DELAY);

      for (const item of items) {
        const key = item.ratingKey;
        currentItems.set(key, {
          ratingKey: key,
          title: item.title,
          year: item.year,
          type: item.type,
          libraryId: library.id,
          libraryTitle: library.title,
          addedAt: item.addedAt ? new Date(item.addedAt * 1000) : now,
          updatedAt: item.updatedAt ? new Date(item.updatedAt * 1000) : null,
          viewCount: item.viewCount || 0,
          lastViewedAt: item.lastViewedAt ? new Date(item.lastViewedAt * 1000) : null,
          guid: item.guid,
          thumb: item.thumb
        });

        // Check if this is a new item
        if (!syncState.libraryCache.has(key)) {
          changes.added.push(currentItems.get(key));
        } else {
          // Check if item was updated (view count changed, etc)
          const cached = syncState.libraryCache.get(key);
          if (cached.viewCount !== item.viewCount ||
              cached.lastViewedAt !== (item.lastViewedAt ? item.lastViewedAt * 1000 : null)) {
            changes.updated.push(currentItems.get(key));
          }
        }
      }
    }

    // Detect removals - items in cache but not in current
    // Only check this periodically (every 5 minutes) to reduce false positives
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    if (!syncState.lastLibrarySync || syncState.lastLibrarySync < fiveMinutesAgo) {
      for (const [key, cached] of syncState.libraryCache) {
        if (!currentItems.has(key)) {
          changes.removed.push(cached);
        }
      }
    }

    // Update cache with current items
    if (currentItems.size > 0) {
      // Merge with existing cache (don't replace entirely if we only got recent items)
      for (const [key, item] of currentItems) {
        syncState.libraryCache.set(key, {
          ...item,
          lastViewedAt: item.lastViewedAt?.getTime() || null
        });
      }
    }

    // Remove deleted items from cache
    for (const removed of changes.removed) {
      syncState.libraryCache.delete(removed.ratingKey);
    }

    syncState.lastLibrarySync = now;
    saveSyncState();

    return changes;
  } catch (error) {
    console.error('[PlexSync] Library sync error:', error.message);
    throw error;
  }
}

/**
 * Sync watch history and update user velocity
 * Uses the session history endpoint which includes per-user data
 */
async function syncWatchHistory() {
  const plex = getPlexService();
  const now = new Date();
  const processed = { entries: 0, users: new Set(), shows: new Set() };

  try {
    // Get watch history since last sync
    let history;

    if (syncState.lastWatchHistorySync) {
      // Fetch recent history only
      const sinceTimestamp = Math.floor(syncState.lastWatchHistorySync.getTime() / 1000);
      const response = await plex.client.get('/status/sessions/history/all', {
        params: {
          'viewedAt>': sinceTimestamp - 60, // 1 minute buffer
          sort: 'viewedAt:desc',
          'X-Plex-Container-Size': 500
        }
      });
      history = response.data.MediaContainer?.Metadata || [];
    } else {
      // First sync - get last 7 days of history
      const sevenDaysAgo = Math.floor((now.getTime() - 7 * 24 * 60 * 60 * 1000) / 1000);
      const response = await plex.client.get('/status/sessions/history/all', {
        params: {
          'viewedAt>': sevenDaysAgo,
          sort: 'viewedAt:desc',
          'X-Plex-Container-Size': 1000
        }
      });
      history = response.data.MediaContainer?.Metadata || [];
    }

    await sleep(API_DELAY);

    // Process history entries
    const insertHistory = db.prepare(`
      INSERT OR IGNORE INTO watch_history
      (user_id, plex_rating_key, tmdb_id, media_type, title, season_number, episode_number, watched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateVelocity = db.prepare(`
      INSERT INTO user_velocity (user_id, tmdb_id, current_position, current_season, current_episode, episodes_per_day, last_watched_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, tmdb_id) DO UPDATE SET
        current_position = CASE WHEN excluded.current_position > current_position THEN excluded.current_position ELSE current_position END,
        current_season = CASE WHEN excluded.current_position > current_position THEN excluded.current_season ELSE current_season END,
        current_episode = CASE WHEN excluded.current_position > current_position THEN excluded.current_episode ELSE current_episode END,
        last_watched_at = CASE WHEN excluded.last_watched_at > last_watched_at THEN excluded.last_watched_at ELSE last_watched_at END,
        updated_at = CURRENT_TIMESTAMP
    `);

    // Group by user and show for velocity calculation
    const userShowHistory = new Map(); // plexUserId -> showRatingKey -> [{episode, watchedAt}]

    for (const entry of history) {
      const plexUserId = entry.accountID?.toString();
      if (!plexUserId) continue;

      // Map Plex user to Flexerr user
      const user = getUserByPlexId(plexUserId);
      if (!user) continue;

      processed.users.add(user.id);

      const watchedAt = entry.viewedAt ? new Date(entry.viewedAt * 1000).toISOString() : now.toISOString();
      const mediaType = entry.type === 'episode' ? 'tv' : entry.type;

      // Insert watch history record
      try {
        insertHistory.run(
          user.id,
          entry.ratingKey,
          null, // tmdb_id - would need to look up
          mediaType,
          entry.grandparentTitle || entry.title,
          entry.parentIndex || null,
          entry.index || null,
          watchedAt
        );
        processed.entries++;
      } catch (e) {
        // Ignore duplicate entries
      }

      // Track for velocity calculation (episodes only)
      if (entry.type === 'episode' && entry.grandparentRatingKey) {
        const showKey = entry.grandparentRatingKey;
        processed.shows.add(showKey);

        if (!userShowHistory.has(plexUserId)) {
          userShowHistory.set(plexUserId, new Map());
        }
        const userShows = userShowHistory.get(plexUserId);

        if (!userShows.has(showKey)) {
          userShows.set(showKey, []);
        }

        userShows.get(showKey).push({
          seasonNumber: entry.parentIndex || 0,
          episodeNumber: entry.index || 0,
          watchedAt: new Date(entry.viewedAt * 1000)
        });
      }
    }

    // Calculate and update velocity for each user/show combination
    for (const [plexUserId, shows] of userShowHistory) {
      const user = getUserByPlexId(plexUserId);
      if (!user) continue;

      for (const [showKey, episodes] of shows) {
        if (episodes.length === 0) continue;

        // Sort by watch time
        episodes.sort((a, b) => a.watchedAt - b.watchedAt);

        // Find most recent episode
        const latest = episodes[episodes.length - 1];

        // Calculate absolute position (rough estimate: season * 100 + episode)
        const position = (latest.seasonNumber * 100) + latest.episodeNumber;

        // Calculate velocity (episodes per day) from this batch
        // Use stored data for more accurate long-term calculation
        const existingVelocity = db.prepare(
          'SELECT * FROM user_velocity WHERE user_id = ? AND tmdb_id = ?'
        ).get(user.id, showKey);

        let velocity = 0;
        if (episodes.length >= 2) {
          const firstWatch = episodes[0].watchedAt;
          const lastWatch = latest.watchedAt;
          const daysDiff = (lastWatch - firstWatch) / (1000 * 60 * 60 * 24);
          if (daysDiff > 0) {
            velocity = episodes.length / daysDiff;
          }
        } else if (existingVelocity && existingVelocity.episodes_per_day > 0) {
          // Keep existing velocity if we only have one new episode
          velocity = existingVelocity.episodes_per_day;
        }

        // Update velocity (using showKey as tmdb_id placeholder)
        try {
          updateVelocity.run(
            user.id,
            showKey, // Using ratingKey as tmdb_id for now
            position,
            latest.seasonNumber,
            latest.episodeNumber,
            velocity,
            latest.watchedAt.toISOString()
          );
        } catch (e) {
          console.error('[PlexSync] Error updating velocity:', e.message);
        }
      }
    }

    syncState.lastWatchHistorySync = now;
    saveSyncState();

    return {
      entries: processed.entries,
      users: processed.users.size,
      shows: processed.shows.size
    };
  } catch (error) {
    console.error('[PlexSync] Watch history sync error:', error.message);
    throw error;
  }
}

/**
 * Import users from Plex server
 * Only runs periodically (every 5 minutes) to avoid unnecessary API calls
 */
async function syncUsers() {
  const autoImport = getSetting('auto_import_plex_users') === 'true';
  if (!autoImport) return { imported: 0, updated: 0 };

  const now = new Date();

  // Only sync users every 5 minutes
  if (syncState.lastUserSync) {
    const timeSinceLastSync = now - syncState.lastUserSync;
    if (timeSinceLastSync < 5 * 60 * 1000) {
      return { skipped: true, reason: 'Too soon since last sync' };
    }
  }

  const plex = getPlexService();
  const results = { imported: 0, updated: 0 };

  try {
    const plexUsers = await plex.getAllSharedUsers();
    await sleep(API_DELAY);

    const serverOwnerIsAdmin = getSetting('server_owner_is_admin') === 'true';

    for (const plexUser of plexUsers) {
      const existingUser = getUserByPlexId(plexUser.id?.toString());

      if (existingUser) {
        // Update existing user if needed
        if (existingUser.username !== plexUser.username || existingUser.thumb !== plexUser.thumb) {
          db.prepare(`
            UPDATE users SET username = ?, thumb = ?, updated_at = CURRENT_TIMESTAMP
            WHERE plex_id = ?
          `).run(plexUser.username, plexUser.thumb, plexUser.id?.toString());
          results.updated++;
        }
      } else {
        // Import new user
        const isAdmin = serverOwnerIsAdmin && plexUser.isAdmin;
        createOrUpdateUser({
          plex_id: plexUser.id?.toString(),
          plex_token: null, // Token will be set when user logs in
          username: plexUser.username || plexUser.title,
          email: plexUser.email || null,
          thumb: plexUser.thumb || null,
          is_admin: isAdmin,
          is_owner: plexUser.isAdmin || false
        });
        results.imported++;

        log('info', 'user-sync', `Imported user from Plex: ${plexUser.username}`);
      }
    }

    syncState.lastUserSync = now;
    saveSyncState();

    return results;
  } catch (error) {
    console.error('[PlexSync] User sync error:', error.message);
    throw error;
  }
}

/**
 * Handle detected library changes
 * - New items: Check if on watchlist, update request status
 * - Removed items: Log removal, update lifecycle status
 */
async function processLibraryChanges(changes) {
  const { added, removed, updated } = changes;

  // Process new items
  const plex = getPlexService();

  for (const item of added) {
    const mediaType = item.type === 'movie' ? 'movie' : 'tv';
    let tmdbId = null;

    // Method 1: Try to get TMDB ID from Plex GUIDs (most accurate)
    try {
      const metadata = await plex.getItemMetadata(item.ratingKey);
      if (metadata?.guids) {
        tmdbId = extractTmdbIdFromGuids(metadata.guids);
        if (tmdbId) {
          console.log(`[PlexSync] Got TMDB ID ${tmdbId} from Plex GUIDs for "${item.title}"`);
        }
      }
    } catch (e) {
      console.warn(`[PlexSync] Could not fetch metadata for ${item.title}: ${e.message}`);
    }

    // Method 2: Try exact title match in requests/watchlist
    if (!tmdbId) {
      const exactMatch = db.prepare(`
        SELECT tmdb_id FROM requests WHERE title = ? AND media_type = ?
        UNION SELECT tmdb_id FROM watchlist WHERE title = ? AND media_type = ? AND is_active = 1
        LIMIT 1
      `).get(item.title, mediaType, item.title, mediaType);

      if (exactMatch?.tmdb_id) {
        tmdbId = exactMatch.tmdb_id;
        console.log(`[PlexSync] Got TMDB ID ${tmdbId} from exact title match for "${item.title}"`);
      }
    }

    // Method 3: Fuzzy title match (handles leetspeak like PLUR1BUS -> Pluribus)
    if (!tmdbId) {
      const normalizedPlexTitle = normalizeTitle(item.title);
      const allTitles = db.prepare(`
        SELECT tmdb_id, title FROM requests WHERE media_type = ?
        UNION SELECT tmdb_id, title FROM watchlist WHERE media_type = ? AND is_active = 1
      `).all(mediaType, mediaType);

      for (const entry of allTitles) {
        if (normalizeTitle(entry.title) === normalizedPlexTitle) {
          tmdbId = entry.tmdb_id;
          console.log(`[PlexSync] Got TMDB ID ${tmdbId} from fuzzy match: "${item.title}" ≈ "${entry.title}"`);
          break;
        }
      }
    }

    // Check if this matches a pending request
    let request = null;
    if (tmdbId) {
      // Match by TMDB ID (most accurate)
      request = db.prepare(`
        SELECT * FROM requests
        WHERE tmdb_id = ? AND media_type = ? AND status IN ('pending', 'downloading')
      `).get(tmdbId, mediaType);
    }

    if (!request) {
      // Fallback: match by title/year
      request = db.prepare(`
        SELECT * FROM requests
        WHERE title = ? AND year = ? AND media_type = ? AND status IN ('pending', 'downloading')
      `).get(item.title, item.year, mediaType);
    }

    if (request) {
      // Update request to available
      db.prepare(`
        UPDATE requests SET status = 'available', available_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(request.id);

      // Use request's TMDB ID if we didn't find one
      if (!tmdbId) tmdbId = request.tmdb_id;

      // Track in daily stats
      const today = new Date().toISOString().split('T')[0];
      db.prepare(`
        INSERT INTO stats_daily (date, available_count)
        VALUES (?, 1)
        ON CONFLICT(date) DO UPDATE SET available_count = available_count + 1
      `).run(today);

      log('info', 'library-sync', `Content now available: ${item.title}`, {
        tmdb_id: tmdbId,
        media_type: mediaType,
        plex_rating_key: item.ratingKey
      });
    }

    // Update lifecycle tracking with the TMDB ID we found
    if (tmdbId) {
      db.prepare(`
        INSERT OR REPLACE INTO lifecycle (tmdb_id, media_type, plex_rating_key, status)
        VALUES (?, ?, ?, 'available')
      `).run(tmdbId, mediaType, item.ratingKey);

      console.log(`[PlexSync] Created lifecycle entry: ratingKey=${item.ratingKey}, tmdb=${tmdbId}, title="${item.title}"`);
    } else {
      console.warn(`[PlexSync] Could not determine TMDB ID for "${item.title}" - lifecycle entry not created`);
    }
  }


  // Process new items for auto-conversion
  if (MediaConverterService.isEnabled() && added.length > 0) {
    console.log('[PlexSync] Checking ' + added.length + ' new items for conversion needs...');
    const plex = getPlexService();
    const mediaConverter = new MediaConverterService();
    
    for (const item of added) {
      try {
        // Get full metadata including file path
        const metadata = await plex.getItemMetadata(item.ratingKey);
        if (metadata) {
          const result = await mediaConverter.processNewImport(metadata);
          if (result && result.queued) {
            console.log('[PlexSync] Queued for conversion: ' + item.title);
          }
        }
      } catch (e) {
        console.error('[PlexSync] Error checking ' + item.title + ' for conversion:', e.message);
      }
    }
  }

  // Process removed items
  for (const item of removed) {
    log('info', 'library-sync', `Content removed from Plex: ${item.title}`, {
      plex_rating_key: item.ratingKey,
      media_type: item.type
    });

    // Update lifecycle status
    db.prepare(`
      UPDATE lifecycle SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP
      WHERE plex_rating_key = ?
    `).run(item.ratingKey);
  }

  // Process updated items (mainly for watch status changes)
  // This is handled by watch history sync

  return {
    addedProcessed: added.length,
    removedProcessed: removed.length,
    updatedProcessed: updated.length
  };
}

/**
 * Main sync function - runs all sync operations
 * Called every 60 seconds by scheduler
 */
/**
 * Repair lifecycle entries for existing Plex library items
 * This runs periodically to fix missing or broken (tmdb_id=0) entries
 */
async function repairLifecycleEntries() {
  const now = Date.now();

  // Only run every 5 minutes
  if (syncState.lastLifecycleRepair && (now - syncState.lastLifecycleRepair) < LIFECYCLE_REPAIR_INTERVAL) {
    return { skipped: true };
  }

  const plex = getPlexService();
  if (!plex) return { skipped: true, reason: 'Plex not configured' };

  console.log('[PlexSync] Running lifecycle repair...');
  syncState.lastLifecycleRepair = now;

  let repaired = 0;
  let checked = 0;

  try {
    // Get all items from the library cache
    for (const [ratingKey, item] of syncState.libraryCache) {
      checked++;
      const mediaType = item.type === 'movie' ? 'movie' : 'tv';

      // Check if lifecycle entry exists and has valid tmdb_id
      const existing = db.prepare(`
        SELECT * FROM lifecycle WHERE plex_rating_key = ?
      `).get(ratingKey);

      // Skip if already has valid tmdb_id
      if (existing?.tmdb_id > 0) continue;

      // Try to find TMDB ID
      let tmdbId = null;

      // Method 1: Get from Plex GUIDs
      try {
        const metadata = await plex.getItemMetadata(ratingKey);
        if (metadata?.guids) {
          tmdbId = extractTmdbIdFromGuids(metadata.guids);
          if (tmdbId) {
            console.log(`[PlexSync:Repair] Got TMDB ID ${tmdbId} from GUIDs for "${item.title}"`);
          }
        }
      } catch (e) {
        // Ignore metadata fetch errors
      }

      // Method 2: Exact title match
      if (!tmdbId) {
        const exactMatch = db.prepare(`
          SELECT tmdb_id FROM requests WHERE title = ? AND media_type = ?
          UNION SELECT tmdb_id FROM watchlist WHERE title = ? AND media_type = ? AND is_active = 1
          LIMIT 1
        `).get(item.title, mediaType, item.title, mediaType);
        if (exactMatch?.tmdb_id) {
          tmdbId = exactMatch.tmdb_id;
        }
      }

      // Method 3: Fuzzy title match
      if (!tmdbId) {
        const normalizedTitle = normalizeTitle(item.title);
        const allTitles = db.prepare(`
          SELECT tmdb_id, title FROM requests WHERE media_type = ?
          UNION SELECT tmdb_id, title FROM watchlist WHERE media_type = ? AND is_active = 1
        `).all(mediaType, mediaType);

        for (const entry of allTitles) {
          if (normalizeTitle(entry.title) === normalizedTitle) {
            tmdbId = entry.tmdb_id;
            console.log(`[PlexSync:Repair] Got TMDB ID ${tmdbId} from fuzzy match: "${item.title}" ≈ "${entry.title}"`);
            break;
          }
        }
      }

      // Create or update lifecycle entry
      if (tmdbId) {
        if (existing) {
          db.prepare('UPDATE lifecycle SET tmdb_id = ? WHERE id = ?').run(tmdbId, existing.id);
        } else {
          db.prepare(`
            INSERT OR REPLACE INTO lifecycle (tmdb_id, media_type, plex_rating_key, status)
            VALUES (?, ?, ?, 'available')
          `).run(tmdbId, mediaType, ratingKey);
        }
        console.log(`[PlexSync:Repair] Fixed lifecycle for "${item.title}" (ratingKey=${ratingKey}, tmdb=${tmdbId})`);
        repaired++;
      }

      // Rate limit API calls
      await sleep(50);
    }

    if (repaired > 0) {
      console.log(`[PlexSync:Repair] Complete: checked ${checked}, repaired ${repaired}`);
    }

    return { checked, repaired };
  } catch (error) {
    console.error('[PlexSync:Repair] Error:', error.message);
    return { error: error.message };
  }
}

async function runSync() {
  if (syncState.isRunning) {
    console.log('[PlexSync] Sync already running, skipping');
    return { skipped: true };
  }

  // Check for error backoff
  if (syncState.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    const timeSinceError = Date.now() - (syncState.lastError?.getTime() || 0);
    if (timeSinceError < ERROR_BACKOFF_MS) {
      return { skipped: true, reason: 'Error backoff active' };
    }
    // Reset error count after backoff
    syncState.consecutiveErrors = 0;
  }

  syncState.isRunning = true;
  const startTime = Date.now();
  const results = {
    library: null,
    watchHistory: null,
    users: null,
    lifecycleRepair: null,
    duration: 0
  };

  try {
    // Check if Plex is configured
    const plex = PlexService.fromDb();
    if (!plex) {
      syncState.isRunning = false;
      return { skipped: true, reason: 'Plex not configured' };
    }

    // Run library sync
    try {
      const changes = await syncLibraryContent();
      results.library = {
        added: changes.added.length,
        removed: changes.removed.length,
        updated: changes.updated.length
      };

      // Process changes if any
      if (changes.added.length > 0 || changes.removed.length > 0) {
        await processLibraryChanges(changes);
      }
    } catch (e) {
      console.error('[PlexSync] Library sync failed:', e.message);
      results.library = { error: e.message };
    }

    await sleep(API_DELAY);

    // Run watch history sync
    try {
      results.watchHistory = await syncWatchHistory();
    } catch (e) {
      console.error('[PlexSync] Watch history sync failed:', e.message);
      results.watchHistory = { error: e.message };
    }

    await sleep(API_DELAY);

    // Run user sync (only every 5 minutes)
    try {
      results.users = await syncUsers();
    } catch (e) {
      console.error('[PlexSync] User sync failed:', e.message);
      results.users = { error: e.message };
    }

    // Repair missing/broken lifecycle entries (runs every 5 minutes)
    try {
      results.lifecycleRepair = await repairLifecycleEntries();
    } catch (e) {
      console.error('[PlexSync] Lifecycle repair failed:', e.message);
      results.lifecycleRepair = { error: e.message };
    }

    results.duration = Date.now() - startTime;
    syncState.consecutiveErrors = 0;

    // Log summary if there were changes
    const hasChanges =
      (results.library?.added > 0 || results.library?.removed > 0) ||
      (results.watchHistory?.entries > 0) ||
      (results.users?.imported > 0);

    if (hasChanges) {
      console.log('[PlexSync] Sync complete:', {
        library: results.library,
        watchHistory: results.watchHistory,
        users: results.users,
        duration: `${results.duration}ms`
      });
    }

    return results;
  } catch (error) {
    syncState.consecutiveErrors++;
    syncState.lastError = new Date();
    console.error('[PlexSync] Sync failed:', error.message);
    log('error', 'plex-sync', 'Sync failed', { error: error.message });
    return { error: error.message };
  } finally {
    syncState.isRunning = false;
  }
}

/**
 * Force full resync (clears cache)
 */
async function forceFullSync() {
  console.log('[PlexSync] Starting full resync...');

  // Clear sync state
  syncState.lastLibrarySync = null;
  syncState.lastWatchHistorySync = null;
  syncState.lastUserSync = null;
  syncState.libraryCache.clear();

  saveSyncState();

  return await runSync();
}

/**
 * Get sync status
 */
function getStatus() {
  return {
    isRunning: syncState.isRunning,
    lastLibrarySync: syncState.lastLibrarySync,
    lastWatchHistorySync: syncState.lastWatchHistorySync,
    lastUserSync: syncState.lastUserSync,
    cacheSize: syncState.libraryCache.size,
    consecutiveErrors: syncState.consecutiveErrors,
    lastError: syncState.lastError
  };
}

/**
 * Calculate velocity from existing watch_history data
 * This is useful when watch_history was populated but velocity wasn't calculated
 * Groups by user and show title to calculate episodes per day
 */
async function calculateVelocityFromHistory() {
  console.log('[PlexSync] Calculating velocity from existing watch history...');

  try {
    // Get all TV episode watches grouped by user and show title
    const showWatches = db.prepare(`
      SELECT
        user_id,
        title as show_title,
        COUNT(*) as episode_count,
        MIN(watched_at) as first_watch,
        MAX(watched_at) as last_watch,
        MAX(season_number) as current_season,
        MAX(episode_number) as current_episode
      FROM watch_history
      WHERE media_type = 'tv'
        AND season_number IS NOT NULL
      GROUP BY user_id, title
      HAVING COUNT(*) >= 2
      ORDER BY user_id, title
    `).all();

    console.log(`[PlexSync] Found ${showWatches.length} user/show combinations with watch history`);

    let updated = 0;

    for (const show of showWatches) {
      // Calculate days between first and last watch
      const firstWatch = new Date(show.first_watch);
      const lastWatch = new Date(show.last_watch);
      const daysDiff = Math.max(1, (lastWatch - firstWatch) / (1000 * 60 * 60 * 24));

      // Calculate velocity (episodes per day)
      const velocity = show.episode_count / daysDiff;

      // Calculate absolute position (season * 100 + episode as rough estimate)
      const position = (show.current_season || 1) * 100 + (show.current_episode || 1);

      // Try to find a plex rating key for this show from the library cache
      // Use title matching as fallback
      let showRatingKey = null;
      for (const [ratingKey, item] of syncState.libraryCache) {
        if (item.title && item.title.toLowerCase() === show.show_title.toLowerCase() && item.type === 'show') {
          showRatingKey = ratingKey;
          break;
        }
      }

      // If no rating key found, use a hash of the title as identifier
      if (!showRatingKey) {
        // Create a simple numeric hash from the title
        let hash = 0;
        for (let i = 0; i < show.show_title.length; i++) {
          hash = ((hash << 5) - hash) + show.show_title.charCodeAt(i);
          hash = hash & hash; // Convert to 32bit integer
        }
        showRatingKey = Math.abs(hash).toString();
      }

      // Insert or update velocity
      try {
        db.prepare(`
          INSERT INTO user_velocity (user_id, tmdb_id, current_position, current_season, current_episode, episodes_per_day, last_watched_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, tmdb_id) DO UPDATE SET
            current_position = excluded.current_position,
            current_season = excluded.current_season,
            current_episode = excluded.current_episode,
            episodes_per_day = excluded.episodes_per_day,
            last_watched_at = excluded.last_watched_at,
            updated_at = CURRENT_TIMESTAMP
        `).run(
          show.user_id,
          showRatingKey,
          position,
          show.current_season || 1,
          show.current_episode || 1,
          velocity,
          show.last_watch
        );
        updated++;

        console.log(`[PlexSync] Velocity for user ${show.user_id} / "${show.show_title}": ${velocity.toFixed(2)} eps/day (${show.episode_count} eps over ${daysDiff.toFixed(1)} days)`);
      } catch (e) {
        console.error(`[PlexSync] Error updating velocity for ${show.show_title}:`, e.message);
      }
    }

    console.log(`[PlexSync] Velocity calculation complete: ${updated} entries updated`);
    return { success: true, updated };
  } catch (error) {
    console.error('[PlexSync] Error calculating velocity:', error.message);
    return { error: error.message };
  }
}

// Load state on module init
loadSyncState();

module.exports = {
  runSync,
  forceFullSync,
  syncLibraryContent,
  syncWatchHistory,
  syncUsers,
  repairLifecycleEntries,
  calculateVelocityFromHistory,
  getStatus,
  loadSyncState
};
