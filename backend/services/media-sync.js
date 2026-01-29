/**
 * Media Sync Service
 *
 * Unified synchronization service that works with any media server (Plex or Jellyfin).
 * Handles:
 * - Library content tracking (additions/removals)
 * - Watch history sync for velocity calculation
 * - User import from media server
 *
 * Uses the MediaServerFactory to get the appropriate server implementation.
 */

const { db, log, getSetting, setSetting, createOrUpdateUser, createOrUpdateUserGeneric, getUserByPlexId, getUserByMediaServerId } = require('../database');
const { MediaServerFactory } = require('./media-server');

// Sync state stored in memory (persisted to settings table)
const syncState = {
  lastLibrarySync: null,
  lastWatchHistorySync: null,
  lastUserSync: null,
  lastLifecycleRepair: null,
  libraryCache: new Map(), // itemId -> { title, addedAt, type }
  isRunning: false,
  consecutiveErrors: 0,
  lastError: null
};

// Lifecycle repair interval (5 minutes)
const LIFECYCLE_REPAIR_INTERVAL = 5 * 60 * 1000;

// Rate limiting
const API_DELAY = 100;
const MAX_CONSECUTIVE_ERRORS = 5;
const ERROR_BACKOFF_MS = 30000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Extract TMDB ID from various GUID formats
 * Plex: 'tmdb://225171'
 * Jellyfin: ProviderIds.Tmdb = '225171'
 */
function extractTmdbId(item) {
  // Already extracted
  if (item.tmdbId) return item.tmdbId;

  // Jellyfin ProviderIds
  if (item.ProviderIds?.Tmdb) {
    return parseInt(item.ProviderIds.Tmdb, 10);
  }

  // Plex GUIDs
  const guids = item.guids || item.Guid || [];
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
    const lastLibrary = getSetting('media_sync_last_library');
    const lastHistory = getSetting('media_sync_last_history');
    const lastUsers = getSetting('media_sync_last_users');
    const cache = getSetting('media_sync_library_cache');

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

    console.log('[MediaSync] Loaded sync state:', {
      lastLibrarySync: syncState.lastLibrarySync,
      lastWatchHistorySync: syncState.lastWatchHistorySync,
      lastUserSync: syncState.lastUserSync,
      cacheSize: syncState.libraryCache.size
    });
  } catch (error) {
    console.error('[MediaSync] Error loading sync state:', error.message);
  }
}

/**
 * Save sync state to database
 */
function saveSyncState() {
  try {
    if (syncState.lastLibrarySync) {
      setSetting('media_sync_last_library', syncState.lastLibrarySync.toISOString());
    }
    if (syncState.lastWatchHistorySync) {
      setSetting('media_sync_last_history', syncState.lastWatchHistorySync.toISOString());
    }
    if (syncState.lastUserSync) {
      setSetting('media_sync_last_users', syncState.lastUserSync.toISOString());
    }

    // Convert Map to object for storage
    const cacheObj = Object.fromEntries(syncState.libraryCache);
    setSetting('media_sync_library_cache', JSON.stringify(cacheObj));
  } catch (error) {
    console.error('[MediaSync] Error saving sync state:', error.message);
  }
}

/**
 * Get the primary media server
 */
function getMediaServer() {
  const server = MediaServerFactory.getPrimary();
  if (!server) {
    throw new Error('No media server configured');
  }
  return server;
}

/**
 * Sync library content - detect additions and removals
 */
async function syncLibraryContent() {
  const server = getMediaServer();
  const now = new Date();
  const changes = { added: [], removed: [], updated: [] };

  try {
    const libraries = await server.getLibraries();
    await sleep(API_DELAY);

    const currentItems = new Map();

    for (const library of libraries) {
      if (!['movie', 'show'].includes(library.type)) continue;

      const items = await server.getLibraryContents(library.id);
      await sleep(API_DELAY);

      for (const item of items) {
        const key = item.id || item.ratingKey;
        const normalized = {
          id: key,
          ratingKey: key,
          title: item.title,
          year: item.year,
          type: item.type,
          libraryId: library.id,
          libraryTitle: library.title,
          addedAt: item.addedAt || now,
          viewCount: item.viewCount || 0,
          lastViewedAt: item.lastViewedAt || null,
          tmdbId: extractTmdbId(item),
          thumb: item.thumb
        };

        currentItems.set(key, normalized);

        // Check if new
        if (!syncState.libraryCache.has(key)) {
          changes.added.push(normalized);
        } else {
          // Check if updated
          const cached = syncState.libraryCache.get(key);
          if (cached.viewCount !== normalized.viewCount) {
            changes.updated.push(normalized);
          }
        }
      }
    }

    // Detect removals (less frequently)
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    if (!syncState.lastLibrarySync || syncState.lastLibrarySync < fiveMinutesAgo) {
      for (const [key, cached] of syncState.libraryCache) {
        if (!currentItems.has(key)) {
          changes.removed.push(cached);
        }
      }
    }

    // Update cache
    if (currentItems.size > 0) {
      for (const [key, item] of currentItems) {
        syncState.libraryCache.set(key, {
          ...item,
          lastViewedAt: item.lastViewedAt?.getTime?.() || null
        });
      }
    }

    // Remove deleted items from cache
    for (const removed of changes.removed) {
      syncState.libraryCache.delete(removed.id || removed.ratingKey);
    }

    syncState.lastLibrarySync = now;
    saveSyncState();

    return changes;
  } catch (error) {
    console.error('[MediaSync] Library sync error:', error.message);
    throw error;
  }
}

/**
 * Sync watch history and update user velocity
 */
async function syncWatchHistory() {
  const server = getMediaServer();
  const now = new Date();
  const processed = { entries: 0, users: new Set(), shows: new Set() };

  try {
    const options = {
      limit: 500
    };

    if (syncState.lastWatchHistorySync) {
      options.since = syncState.lastWatchHistorySync;
    } else {
      // First sync - get last 7 days
      options.since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    const history = await server.getWatchHistory(options);
    await sleep(API_DELAY);

    const insertHistory = db.prepare(`
      INSERT OR IGNORE INTO watch_history
      (user_id, plex_rating_key, media_item_key, tmdb_id, media_type, title, season_number, episode_number, watched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    const userShowHistory = new Map();

    for (const entry of history) {
      const serverUserId = entry.userId;
      if (!serverUserId) continue;

      // Map server user to Flexerr user (using media_server_id for proper multi-server support)
      const user = server.isPlex()
        ? getUserByPlexId(serverUserId, server.id)
        : getUserByMediaServerId(serverUserId, server.id);

      if (!user) continue;

      processed.users.add(user.id);

      const watchedAt = entry.viewedAt?.toISOString?.() || now.toISOString();
      const mediaType = entry.type === 'episode' ? 'tv' : entry.type;

      try {
        insertHistory.run(
          user.id,
          entry.itemId, // plex_rating_key (for compatibility)
          entry.itemId, // media_item_key
          null,
          mediaType,
          entry.grandparentTitle || entry.title,
          entry.seasonNumber || null,
          entry.episodeNumber || null,
          watchedAt
        );
        processed.entries++;
      } catch (e) {
        // Ignore duplicates
      }

      // Track for velocity calculation
      if (entry.type === 'episode' && entry.grandparentTitle) {
        const showKey = entry.grandparentTitle;
        processed.shows.add(showKey);

        if (!userShowHistory.has(serverUserId)) {
          userShowHistory.set(serverUserId, new Map());
        }
        const userShows = userShowHistory.get(serverUserId);

        if (!userShows.has(showKey)) {
          userShows.set(showKey, []);
        }

        userShows.get(showKey).push({
          seasonNumber: entry.seasonNumber || 0,
          episodeNumber: entry.episodeNumber || 0,
          watchedAt: entry.viewedAt || new Date()
        });
      }
    }

    // Calculate and update velocity
    for (const [serverUserId, shows] of userShowHistory) {
      const user = server.isPlex()
        ? getUserByPlexId(serverUserId, server.id)
        : getUserByMediaServerId(serverUserId, server.id);

      if (!user) continue;

      for (const [showKey, episodes] of shows) {
        if (episodes.length === 0) continue;

        episodes.sort((a, b) => a.watchedAt - b.watchedAt);
        const latest = episodes[episodes.length - 1];
        const position = (latest.seasonNumber * 100) + latest.episodeNumber;

        let velocity = 0;
        if (episodes.length >= 2) {
          const firstWatch = episodes[0].watchedAt;
          const lastWatch = latest.watchedAt;
          const daysDiff = (lastWatch - firstWatch) / (1000 * 60 * 60 * 24);
          if (daysDiff > 0) {
            velocity = episodes.length / daysDiff;
          }
        }

        // Create hash of show title for lookup
        let hash = 0;
        for (let i = 0; i < showKey.length; i++) {
          hash = ((hash << 5) - hash) + showKey.charCodeAt(i);
          hash = hash & hash;
        }
        const showId = Math.abs(hash).toString();

        try {
          updateVelocity.run(
            user.id,
            showId,
            position,
            latest.seasonNumber,
            latest.episodeNumber,
            velocity,
            latest.watchedAt.toISOString()
          );
        } catch (e) {
          console.error('[MediaSync] Error updating velocity:', e.message);
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
    console.error('[MediaSync] Watch history sync error:', error.message);
    throw error;
  }
}

/**
 * Import users from media server
 */
async function syncUsers() {
  const autoImport = getSetting('auto_import_plex_users') === 'true';
  if (!autoImport) return { imported: 0, updated: 0 };

  const now = new Date();

  // Only sync every 5 minutes
  if (syncState.lastUserSync) {
    const timeSinceLastSync = now - syncState.lastUserSync;
    if (timeSinceLastSync < 5 * 60 * 1000) {
      return { skipped: true, reason: 'Too soon since last sync' };
    }
  }

  const server = getMediaServer();
  const results = { imported: 0, updated: 0 };

  try {
    const serverUsers = await server.getAllUsers();
    await sleep(API_DELAY);

    const serverOwnerIsAdmin = getSetting('server_owner_is_admin') === 'true';
    const serverType = server.type;

    for (const serverUser of serverUsers) {
      const existingUser = serverType === 'plex'
        ? getUserByPlexId(serverUser.id, server.id)
        : getUserByMediaServerId(serverUser.id, server.id);

      if (existingUser) {
        // Update existing user if needed
        if (existingUser.username !== serverUser.username || existingUser.thumb !== serverUser.thumb) {
          db.prepare(`
            UPDATE users SET username = ?, thumb = ?
            WHERE id = ?
          `).run(serverUser.username, serverUser.thumb, existingUser.id);
          results.updated++;
        }
      } else {
        // Import new user
        const isAdmin = serverOwnerIsAdmin && serverUser.isAdmin;

        if (serverType === 'plex') {
          createOrUpdateUser({
            plex_id: serverUser.id,
            plex_token: null,
            username: serverUser.username,
            email: serverUser.email || null,
            thumb: serverUser.thumb || null,
            is_admin: isAdmin,
            is_owner: serverUser.isAdmin || false,
            media_server_id: server.id
          });
        } else {
          createOrUpdateUserGeneric({
            server_user_id: serverUser.id,
            server_token: null,
            username: serverUser.username,
            thumb: serverUser.thumb || null,
            is_admin: isAdmin,
            media_server_id: server.id,
            is_owner: serverUser.isAdmin || false,
            media_server_type: 'jellyfin'
          });
        }

        results.imported++;
        log('info', 'user-sync', `Imported user from ${serverType}: ${serverUser.username}`);
      }
    }

    syncState.lastUserSync = now;
    saveSyncState();

    return results;
  } catch (error) {
    console.error('[MediaSync] User sync error:', error.message);
    throw error;
  }
}

/**
 * Process library changes
 */
async function processLibraryChanges(changes) {
  const { added, removed } = changes;
  const server = getMediaServer();

  for (const item of added) {
    const mediaType = item.type === 'movie' ? 'movie' : 'tv';
    let tmdbId = item.tmdbId;

    // Try to get TMDB ID from metadata if not already present
    if (!tmdbId) {
      try {
        const metadata = await server.getItemMetadata(item.id);
        if (metadata) {
          tmdbId = extractTmdbId(metadata);
        }
      } catch (e) {
        // Ignore
      }
    }

    // Try title match in database
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

    // Update request status if matching
    if (tmdbId) {
      const request = db.prepare(`
        SELECT * FROM requests
        WHERE tmdb_id = ? AND media_type = ? AND status IN ('pending', 'downloading')
      `).get(tmdbId, mediaType);

      if (request) {
        db.prepare(`
          UPDATE requests SET status = 'available', available_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(request.id);

        const today = new Date().toISOString().split('T')[0];
        db.prepare(`
          INSERT INTO stats_daily (date, available_count)
          VALUES (?, 1)
          ON CONFLICT(date) DO UPDATE SET available_count = available_count + 1
        `).run(today);

        log('info', 'library-sync', `Content now available: ${item.title}`, {
          tmdb_id: tmdbId,
          media_type: mediaType
        });
      }

      // Update lifecycle
      db.prepare(`
        INSERT OR REPLACE INTO lifecycle (tmdb_id, media_type, plex_rating_key, media_item_key, status)
        VALUES (?, ?, ?, ?, 'available')
      `).run(tmdbId, mediaType, item.id, item.id);
    }
  }

  // Process removed items
  for (const item of removed) {
    log('info', 'library-sync', `Content removed: ${item.title}`);

    db.prepare(`
      UPDATE lifecycle SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP
      WHERE plex_rating_key = ? OR media_item_key = ?
    `).run(item.id, item.id);
  }

  return {
    addedProcessed: added.length,
    removedProcessed: removed.length
  };
}

/**
 * Main sync function
 */
async function runSync() {
  if (syncState.isRunning) {
    console.log('[MediaSync] Sync already running, skipping');
    return { skipped: true };
  }

  // Check for error backoff
  if (syncState.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    const timeSinceError = Date.now() - (syncState.lastError?.getTime() || 0);
    if (timeSinceError < ERROR_BACKOFF_MS) {
      return { skipped: true, reason: 'Error backoff active' };
    }
    syncState.consecutiveErrors = 0;
  }

  syncState.isRunning = true;
  const startTime = Date.now();
  const results = {
    library: null,
    watchHistory: null,
    users: null,
    duration: 0
  };

  try {
    // Check if any server is configured
    if (!MediaServerFactory.hasAnyServer()) {
      syncState.isRunning = false;
      return { skipped: true, reason: 'No media server configured' };
    }

    // Run library sync
    try {
      const changes = await syncLibraryContent();
      results.library = {
        added: changes.added.length,
        removed: changes.removed.length,
        updated: changes.updated.length
      };

      if (changes.added.length > 0 || changes.removed.length > 0) {
        await processLibraryChanges(changes);
      }
    } catch (e) {
      console.error('[MediaSync] Library sync failed:', e.message);
      results.library = { error: e.message };
    }

    await sleep(API_DELAY);

    // Run watch history sync
    try {
      results.watchHistory = await syncWatchHistory();
    } catch (e) {
      console.error('[MediaSync] Watch history sync failed:', e.message);
      results.watchHistory = { error: e.message };
    }

    await sleep(API_DELAY);

    // Run user sync
    try {
      results.users = await syncUsers();
    } catch (e) {
      console.error('[MediaSync] User sync failed:', e.message);
      results.users = { error: e.message };
    }

    results.duration = Date.now() - startTime;
    syncState.consecutiveErrors = 0;

    const hasChanges =
      (results.library?.added > 0 || results.library?.removed > 0) ||
      (results.watchHistory?.entries > 0) ||
      (results.users?.imported > 0);

    if (hasChanges) {
      console.log('[MediaSync] Sync complete:', {
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
    console.error('[MediaSync] Sync failed:', error.message);
    log('error', 'media-sync', 'Sync failed', { error: error.message });
    return { error: error.message };
  } finally {
    syncState.isRunning = false;
  }
}

/**
 * Force full resync
 */
async function forceFullSync() {
  console.log('[MediaSync] Starting full resync...');

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

// Load state on module init
loadSyncState();

module.exports = {
  runSync,
  forceFullSync,
  syncLibraryContent,
  syncWatchHistory,
  syncUsers,
  getStatus,
  loadSyncState
};
