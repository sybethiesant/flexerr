/**
 * Collection Sync Service
 * Syncs Plex collections based on categorization rules
 *
 * This service evaluates all items in the lifecycle table against
 * collection-mode categorization rules and updates Plex collections accordingly.
 */

const { db, log } = require('../database');
const PlexService = require('./plex');
const TMDBService = require('./tmdb');
const CategorizationEngine = require('./categorization-engine');

// Track sync state
let syncState = {
  isRunning: false,
  lastSyncAt: null,
  lastResults: null
};

/**
 * Get all collection-mode categorization rules
 */
function getCollectionRules() {
  return db.prepare(`
    SELECT * FROM categorization_rules
    WHERE is_active = 1 AND mode = 'collection' AND collection_name IS NOT NULL
    ORDER BY priority DESC, id ASC
  `).all().map(rule => ({
    ...rule,
    conditions: JSON.parse(rule.conditions || '{"operator":"AND","conditions":[]}'),
    radarr_tags: rule.radarr_tags ? JSON.parse(rule.radarr_tags) : [],
    sonarr_tags: rule.sonarr_tags ? JSON.parse(rule.sonarr_tags) : []
  }));
}

/**
 * Get all items from lifecycle that have a plex_rating_key
 */
function getLifecycleItems(mediaType = null) {
  let query = `
    SELECT l.*, r.title
    FROM lifecycle l
    LEFT JOIN requests r ON l.tmdb_id = r.tmdb_id AND l.media_type = r.media_type
    WHERE l.plex_rating_key IS NOT NULL AND l.status = 'available'
  `;

  if (mediaType) {
    query += ` AND l.media_type = ?`;
    return db.prepare(query).all(mediaType);
  }

  return db.prepare(query).all();
}

/**
 * Get unique TV shows from Plex library with their TMDB IDs
 * This is more reliable than using lifecycle table for TV shows
 */
async function getTVShowsFromPlex(plex, libraryId) {
  const shows = [];

  try {
    // Get all shows from the TV library
    const response = await plex.client.get(`/library/sections/${libraryId}/all`, {
      params: { type: 2 } // type 2 = shows
    });

    const plexShows = response.data?.MediaContainer?.Metadata || [];

    for (const show of plexShows) {
      // Get TMDB ID from Guid
      if (!show.Guid) {
        // Need to fetch full metadata for Guid
        try {
          const fullShow = await plex.client.get(`/library/metadata/${show.ratingKey}`);
          const showData = fullShow.data?.MediaContainer?.Metadata?.[0];
          if (showData?.Guid) {
            const tmdbGuid = showData.Guid.find(g => g.id?.startsWith('tmdb://'));
            if (tmdbGuid) {
              const tmdbId = parseInt(tmdbGuid.id.replace('tmdb://', ''));
              shows.push({
                ratingKey: show.ratingKey,
                title: show.title,
                tmdbId: tmdbId
              });
            }
          }
        } catch (e) {
          // Skip shows we can't get metadata for
        }
      } else {
        const tmdbGuid = show.Guid.find(g => g.id?.startsWith('tmdb://'));
        if (tmdbGuid) {
          const tmdbId = parseInt(tmdbGuid.id.replace('tmdb://', ''));
          shows.push({
            ratingKey: show.ratingKey,
            title: show.title,
            tmdbId: tmdbId
          });
        }
      }
    }
  } catch (error) {
    console.error(`[CollectionSync] Failed to get TV shows from Plex: ${error.message}`);
  }

  return shows;
}

/**
 * Fetch TMDB metadata for an item
 */
async function fetchTMDBMetadata(tmdbId, mediaType) {
  try {
    if (mediaType === 'movie') {
      return await TMDBService.getMovie(tmdbId);
    } else {
      return await TMDBService.getTVShow(tmdbId);
    }
  } catch (error) {
    console.error(`[CollectionSync] Failed to fetch TMDB data for ${mediaType} ${tmdbId}: ${error.message}`);
    return null;
  }
}

/**
 * Get current items in a Plex collection
 */
async function getCollectionItems(plex, collectionRatingKey) {
  try {
    const response = await plex.client.get(`/library/collections/${collectionRatingKey}/children`);
    const container = response.data?.MediaContainer;
    return container?.Metadata || [];
  } catch (error) {
    console.error(`[CollectionSync] Failed to get collection items: ${error.message}`);
    return [];
  }
}

/**
 * Sync a single rule's collection
 */
async function syncRuleCollection(plex, rule, libraries) {
  const results = {
    ruleName: rule.name,
    collectionName: rule.collection_name,
    added: [],
    removed: [],
    errors: []
  };

  // Determine which media type this rule targets
  const mediaTypes = [];
  if (rule.target_type === 'all' || rule.target_type === 'movies') {
    mediaTypes.push('movie');
  }
  if (rule.target_type === 'all' || rule.target_type === 'shows') {
    mediaTypes.push('tv');
  }

  for (const mediaType of mediaTypes) {
    // Find the appropriate Plex library
    const libraryType = mediaType === 'movie' ? 'movie' : 'show';
    const library = libraries.find(lib => lib.type === libraryType);

    if (!library) {
      console.log(`[CollectionSync] No ${libraryType} library found for rule "${rule.name}"`);
      continue;
    }

    // Get or create the collection
    let collection;
    try {
      collection = await plex.getOrCreateCollection(
        library.id,
        rule.collection_name,
        rule.description || `Items matching the "${rule.name}" categorization rule`,
        libraryType
      );
    } catch (error) {
      results.errors.push(`Failed to create collection: ${error.message}`);
      continue;
    }

    if (!collection) {
      results.errors.push(`Could not get/create collection "${rule.collection_name}"`);
      continue;
    }

    // Get items to evaluate - different approach for movies vs TV
    let itemsToEvaluate = [];

    if (mediaType === 'movie') {
      // For movies, use lifecycle items
      const lifecycleItems = getLifecycleItems(mediaType);
      itemsToEvaluate = lifecycleItems.map(item => ({
        ratingKey: item.plex_rating_key,
        tmdbId: item.tmdb_id,
        title: item.title
      }));
    } else {
      // For TV shows, get directly from Plex library with correct TMDB IDs
      itemsToEvaluate = await getTVShowsFromPlex(plex, library.id);
      console.log(`[CollectionSync] Found ${itemsToEvaluate.length} TV shows in Plex library`);
    }

    // Get current collection members
    const currentMembers = await getCollectionItems(plex, collection.ratingKey);
    const currentRatingKeys = new Set(currentMembers.map(m => m.ratingKey));

    // Track which items should be in the collection
    const shouldBeInCollection = new Set();

    // Evaluate each item against this rule
    for (const item of itemsToEvaluate) {
      try {
        // Fetch TMDB metadata
        const metadata = await fetchTMDBMetadata(item.tmdbId, mediaType);
        if (!metadata) continue;

        // Evaluate against rule conditions
        const tmdbMediaType = mediaType === 'movie' ? 'movie' : 'tv';
        if (CategorizationEngine.evaluateConditions(rule.conditions, metadata, tmdbMediaType)) {
          shouldBeInCollection.add(item.ratingKey);

          // Add to collection if not already a member
          if (!currentRatingKeys.has(item.ratingKey)) {
            await plex.addToCollection(collection.ratingKey, item.ratingKey);
            results.added.push({
              title: item.title || metadata.title || metadata.name,
              tmdbId: item.tmdbId,
              ratingKey: item.ratingKey
            });
            console.log(`[CollectionSync] Added "${item.title || metadata.title || metadata.name}" to "${rule.collection_name}"`);
          }
        }

        // Small delay to avoid hammering APIs
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        results.errors.push(`Error processing ${item.tmdbId}: ${error.message}`);
      }
    }

    // Remove items that no longer match
    for (const member of currentMembers) {
      if (!shouldBeInCollection.has(member.ratingKey)) {
        try {
          await plex.removeFromCollection(collection.ratingKey, member.ratingKey);
          results.removed.push({
            title: member.title,
            ratingKey: member.ratingKey
          });
          console.log(`[CollectionSync] Removed "${member.title}" from "${rule.collection_name}"`);
        } catch (error) {
          results.errors.push(`Failed to remove ${member.title}: ${error.message}`);
        }
      }
    }
  }

  return results;
}

/**
 * Sync all collection-mode rules
 */
async function syncAllCollections() {
  if (syncState.isRunning) {
    console.log('[CollectionSync] Sync already in progress, skipping');
    return { skipped: true, reason: 'already running' };
  }

  syncState.isRunning = true;
  const startTime = Date.now();

  try {
    const plex = PlexService.fromDb();
    if (!plex) {
      console.log('[CollectionSync] Plex not configured');
      return { success: false, error: 'Plex not configured' };
    }

    // Get Plex libraries
    const libraries = await plex.getLibraries();
    if (!libraries || libraries.length === 0) {
      console.log('[CollectionSync] No Plex libraries found');
      return { success: false, error: 'No Plex libraries' };
    }

    // Get all collection-mode rules
    const rules = getCollectionRules();
    console.log(`[CollectionSync] Syncing ${rules.length} collection rules`);

    if (rules.length === 0) {
      return { success: true, message: 'No collection rules to sync', results: [] };
    }

    const allResults = [];

    for (const rule of rules) {
      try {
        const result = await syncRuleCollection(plex, rule, libraries);
        allResults.push(result);

        // Update last_matched_count
        const matchCount = result.added.length + (await getCollectionItemCount(plex, rule, libraries));
        db.prepare('UPDATE categorization_rules SET last_matched_count = ? WHERE id = ?')
          .run(matchCount, rule.id);

      } catch (error) {
        console.error(`[CollectionSync] Error syncing rule "${rule.name}": ${error.message}`);
        allResults.push({
          ruleName: rule.name,
          error: error.message
        });
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[CollectionSync] Completed in ${duration}ms`);

    syncState.lastSyncAt = new Date().toISOString();
    syncState.lastResults = allResults;

    log('info', 'categorization', 'Collection sync completed', {
      rules_synced: rules.length,
      duration_ms: duration
    });

    return {
      success: true,
      duration: duration,
      results: allResults
    };

  } catch (error) {
    console.error(`[CollectionSync] Sync failed: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    syncState.isRunning = false;
  }
}

/**
 * Get count of items currently in a rule's collection
 */
async function getCollectionItemCount(plex, rule, libraries) {
  try {
    const libraryType = rule.target_type === 'movies' ? 'movie' :
                        rule.target_type === 'shows' ? 'show' : 'movie';
    const library = libraries.find(lib => lib.type === libraryType);
    if (!library) return 0;

    const collections = await plex.getCollections(library.id);
    const collection = collections.find(c => c.title === rule.collection_name);
    if (!collection) return 0;

    const items = await getCollectionItems(plex, collection.ratingKey);
    return items.length;
  } catch (error) {
    return 0;
  }
}

/**
 * Sync a single rule by ID
 */
async function syncRule(ruleId) {
  const rule = db.prepare('SELECT * FROM categorization_rules WHERE id = ?').get(ruleId);
  if (!rule) {
    return { success: false, error: 'Rule not found' };
  }

  if (rule.mode !== 'collection') {
    return { success: false, error: 'Rule is not in collection mode' };
  }

  const plex = PlexService.fromDb();
  if (!plex) {
    return { success: false, error: 'Plex not configured' };
  }

  const libraries = await plex.getLibraries();

  const parsedRule = {
    ...rule,
    conditions: JSON.parse(rule.conditions || '{"operator":"AND","conditions":[]}')
  };

  return await syncRuleCollection(plex, parsedRule, libraries);
}

/**
 * Add a single item to matching collections
 * Called when a new item is added to the library
 */
async function addItemToCollections(tmdbId, mediaType, plexRatingKey) {
  const plex = PlexService.fromDb();
  if (!plex) return { success: false, error: 'Plex not configured' };

  // Fetch TMDB metadata
  const metadata = await fetchTMDBMetadata(tmdbId, mediaType);
  if (!metadata) return { success: false, error: 'Could not fetch metadata' };

  // Get matching collection rules
  const tmdbMediaType = mediaType === 'movie' ? 'movie' : 'tv';
  const matchingRules = CategorizationEngine.evaluateAllCollections(metadata, tmdbMediaType);

  if (matchingRules.length === 0) {
    return { success: true, collections: [] };
  }

  // Get Plex libraries
  const libraries = await plex.getLibraries();
  const libraryType = mediaType === 'movie' ? 'movie' : 'show';
  const library = libraries.find(lib => lib.type === libraryType);

  if (!library) {
    return { success: false, error: 'Library not found' };
  }

  const addedTo = [];

  for (const match of matchingRules) {
    try {
      const collection = await plex.getOrCreateCollection(
        library.id,
        match.collectionName,
        `Items matching the "${match.ruleName}" categorization rule`,
        libraryType
      );

      if (collection) {
        await plex.addToCollection(collection.ratingKey, plexRatingKey);
        addedTo.push(match.collectionName);
        console.log(`[CollectionSync] Added item to collection "${match.collectionName}"`);
      }
    } catch (error) {
      console.error(`[CollectionSync] Failed to add to "${match.collectionName}": ${error.message}`);
    }
  }

  return { success: true, collections: addedTo };
}

/**
 * Get sync status
 */
function getSyncStatus() {
  return {
    isRunning: syncState.isRunning,
    lastSyncAt: syncState.lastSyncAt,
    lastResults: syncState.lastResults
  };
}

module.exports = {
  syncAllCollections,
  syncRule,
  addItemToCollections,
  getSyncStatus,
  getCollectionRules
};
