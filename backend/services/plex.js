const axios = require('axios');
const { db, log } = require('../database');

const PLEX_CLIENT_ID = 'flexerr-media-manager';
const PLEX_PRODUCT = 'Flexerr';
const PLEX_DEVICE = 'Web';

class PlexService {
  // OAuth: Create a PIN for authentication
  static async createAuthPin() {
    const response = await axios.post('https://plex.tv/api/v2/pins', null, {
      params: { strong: true },
      headers: {
        'Accept': 'application/json',
        'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
        'X-Plex-Product': PLEX_PRODUCT,
        'X-Plex-Device': PLEX_DEVICE,
        'X-Plex-Version': '1.0.0'
      }
    });

    return {
      id: response.data.id,
      code: response.data.code,
      authUrl: `https://app.plex.tv/auth#?clientID=${PLEX_CLIENT_ID}&code=${response.data.code}&context%5Bdevice%5D%5Bproduct%5D=${PLEX_PRODUCT}`
    };
  }

  // OAuth: Check if PIN has been claimed and get token
  static async checkAuthPin(pinId) {
    const response = await axios.get(`https://plex.tv/api/v2/pins/${pinId}`, {
      headers: {
        'Accept': 'application/json',
        'X-Plex-Client-Identifier': PLEX_CLIENT_ID
      }
    });

    if (response.data.authToken) {
      return {
        success: true,
        token: response.data.authToken
      };
    }

    return { success: false };
  }

  // OAuth: Get user's servers after authentication
  static async getServers(token) {
    const response = await axios.get('https://plex.tv/api/v2/resources', {
      params: { includeHttps: 1, includeRelay: 0 },
      headers: {
        'Accept': 'application/json',
        'X-Plex-Token': token,
        'X-Plex-Client-Identifier': PLEX_CLIENT_ID
      }
    });

    // Filter to only Plex Media Servers
    const servers = response.data.filter(r => r.provides === 'server');

    return servers.map(server => ({
      name: server.name,
      clientId: server.clientIdentifier,
      owned: server.owned,
      connections: server.connections.map(c => ({
        uri: c.uri,
        local: c.local,
        relay: c.relay
      }))
    }));
  }


  constructor(url, token) {
    this.url = url?.replace(/\/$/, '');
    this.token = token;
    this.client = null;
    if (this.url && this.token) {
      this.initClient();
    }
  }

  initClient() {
    this.client = axios.create({
      baseURL: this.url,
      headers: {
        'X-Plex-Token': this.token,
        'Accept': 'application/json'
      },
      timeout: 30000
    });
  }

  static fromDb() {
    const service = db.prepare("SELECT * FROM services WHERE type = 'plex' AND is_active = 1").get();
    if (!service) return null;
    return new PlexService(service.url, service.api_key);
  }

  async testConnection() {
    try {
      const response = await this.client.get('/');
      const data = response.data;
      return {
        success: true,
        version: data.MediaContainer?.version,
        name: data.MediaContainer?.friendlyName,
        platform: data.MediaContainer?.platform
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getLibraries() {
    const response = await this.client.get('/library/sections');
    return response.data.MediaContainer.Directory.map(lib => ({
      id: lib.key,
      title: lib.title,
      type: lib.type,
      agent: lib.agent,
      scanner: lib.scanner,
      location: lib.Location?.[0]?.path
    }));
  }

  async getLibraryContents(libraryId, type = null) {
    const response = await this.client.get(`/library/sections/${libraryId}/all`);
    return response.data.MediaContainer.Metadata || [];
  }

  async getItem(ratingKey) {
    const response = await this.client.get(`/library/metadata/${ratingKey}`);
    return response.data.MediaContainer.Metadata?.[0];
  }

  async getItemChildren(ratingKey) {
    try {
      const response = await this.client.get(`/library/metadata/${ratingKey}/children`);
      return response.data.MediaContainer.Metadata || [];
    } catch (err) {
      console.error(`[Plex] Error getting children for ${ratingKey}:`, err.message);
      return [];
    }
  }

  async getWatchHistory(ratingKey = null) {
    let url = '/status/sessions/history/all';
    if (ratingKey) {
      url += `?metadataItemID=${ratingKey}`;
    }
    const response = await this.client.get(url);
    return response.data.MediaContainer.Metadata || [];
  }

  async getUsers() {
    // Note: This requires Plex Pass and admin access
    try {
      const response = await axios.get('https://plex.tv/api/users', {
        headers: {
          'X-Plex-Token': this.token,
          'Accept': 'application/json'
        }
      });
      return response.data.MediaContainer?.User || [];
    } catch (error) {
      // Fall back to local users
      const response = await this.client.get('/accounts');
      return response.data.MediaContainer?.Account || [];
    }
  }

  async getWatchlist(userId = null) {
    // Plex watchlist - discover.provider.plex.tv with pagination support
    try {
      console.log('[Plex] Fetching watchlist...');
      const allItems = [];
      let offset = 0;
      const pageSize = 50;
      let totalSize = null;

      while (totalSize === null || offset < totalSize) {
        const response = await axios.get('https://discover.provider.plex.tv/library/sections/watchlist/all', {
          headers: {
            'X-Plex-Token': this.token,
            'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
            'Accept': 'application/json',
            'X-Plex-Container-Start': String(offset),
            'X-Plex-Container-Size': String(pageSize)
          }
        });

        const container = response.data.MediaContainer;
        const items = container?.Metadata || [];
        totalSize = container?.totalSize || 0;

        allItems.push(...items);
        offset += items.length;

        // Safety: break if no items returned to avoid infinite loop
        if (items.length === 0) break;
      }

      console.log(`[Plex] Got ${allItems.length} watchlist items (total: ${totalSize})`);
      return allItems;
    } catch (error) {
      console.error('[Plex] Watchlist fetch failed:', error.response?.status, error.response?.data || error.message);
      return [];
    }
  }

  async isOnWatchlist(ratingKey, itemMetadata = null) {
    const watchlist = await this.getWatchlist();

    // Direct ratingKey match (rare - only works if item was added from same server)
    const directMatch = watchlist.some(item =>
      item.ratingKey === ratingKey ||
      item.ratingKey === String(ratingKey) ||
      item.guid === ratingKey ||
      item.Guid?.some(g => g.id === ratingKey)
    );

    if (directMatch) return true;

    // If we have item metadata, try matching by title+year (more reliable)
    if (itemMetadata) {
      const titleYear = `${itemMetadata.title?.toLowerCase()}|${itemMetadata.year}`;
      return watchlist.some(w => `${w.title?.toLowerCase()}|${w.year}` === titleYear);
    }

    // Fetch item metadata to get title+year for matching
    try {
      const item = await this.getItemMetadata(ratingKey);
      if (item) {
        const titleYear = `${item.title?.toLowerCase()}|${item.year}`;
        return watchlist.some(w => `${w.title?.toLowerCase()}|${w.year}` === titleYear);
      }
    } catch (e) {
      // Item might not exist anymore
    }

    return false;
  }

  async getCollections(libraryId) {
    const response = await this.client.get(`/library/sections/${libraryId}/collections`);
    return response.data.MediaContainer.Metadata || [];
  }

  /**
   * Pin all collections in all libraries to Recommended with proper sorting
   * Order: New Releases first, then genres alphabetically, Leaving Soon last
   */
  async promoteAllCollectionsToRecommended() {
    const results = { promoted: [], failed: [] };

    try {
      const libraries = await this.getLibraries();

      for (const library of libraries) {
        console.log(`[Plex] Processing library: ${library.title}`);

        // Get and sort collections
        const collections = await this.getCollections(library.id);
        const sorted = collections.sort((a, b) => {
          const aTitle = a.title.toLowerCase();
          const bTitle = b.title.toLowerCase();
          if (aTitle.includes('new release')) return -1;
          if (bTitle.includes('new release')) return 1;
          if (aTitle === 'leaving soon') return 1;
          if (bTitle === 'leaving soon') return -1;
          return aTitle.localeCompare(bTitle);
        });

        // Unpin existing collections first to reset order
        try {
          const managedRes = await this.client.get(`/hubs/sections/${library.id}/manage`);
          const hubs = managedRes.data?.MediaContainer?.Hub || [];
          const collectionHubs = hubs.filter(h => h.identifier.startsWith('custom.collection'));
          for (const hub of collectionHubs) {
            try {
              await this.client.delete(`/hubs/sections/${library.id}/manage/${encodeURIComponent(hub.identifier)}`);
            } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }

        // Pin in sorted order
        for (const collection of sorted) {
          try {
            await this.pinCollectionToRecommended(library.id, collection.ratingKey, collection.title);
            results.promoted.push({ library: library.title, collection: collection.title });
          } catch (error) {
            results.failed.push({ library: library.title, collection: collection.title, error: error.message });
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    } catch (error) {
      console.error(`[Plex] Failed to promote collections: ${error.message}`);
    }

    return results;
  }

  async createCollection(libraryId, title, description = '') {
    const response = await this.client.post(`/library/collections`, null, {
      params: {
        type: 1, // 1 = movie, 2 = show
        title: title,
        smart: 0,
        sectionId: libraryId,
        summary: description
      }
    });
    return response.data;
  }

  async addToCollection(collectionRatingKey, itemRatingKey) {
    await this.client.put(`/library/collections/${collectionRatingKey}/items`, null, {
      params: {
        uri: `server://${await this.getMachineId()}/com.plexapp.plugins.library/library/metadata/${itemRatingKey}`
      }
    });
  }

  async removeFromCollection(collectionRatingKey, itemRatingKey) {
    await this.client.delete(`/library/collections/${collectionRatingKey}/items/${itemRatingKey}`);
  }

  /**
   * Pin a collection to the library's Recommended tab using hub management API
   */
  async pinCollectionToRecommended(libraryId, collectionRatingKey, collectionTitle) {
    try {
      // Pin collection to Recommended using hub management API
      await this.client.post(`/hubs/sections/${libraryId}/manage`, null, {
        params: {
          metadataItemId: collectionRatingKey,
          promotedToRecommended: 1
        }
      });

      // Set visibility options
      const identifier = `custom.collection.${libraryId}.${collectionRatingKey}`;
      await this.client.put(`/hubs/sections/${libraryId}/manage/${encodeURIComponent(identifier)}`, null, {
        params: {
          promotedToRecommended: 1,
          recommendationsVisibility: 'all'
        }
      });

      console.log(`[Plex] Pinned collection "${collectionTitle}" to Recommended in library ${libraryId}`);
      return true;
    } catch (error) {
      console.error(`[Plex] Failed to pin collection to recommended: ${error.message}`);
      return false;
    }
  }

  /**
   * Reorder all collection hubs in a library to maintain proper sort order
   * Order: New Releases first, then genres alphabetically, Leaving Soon last
   */
  async reorderCollectionHubs(libraryId) {
    try {
      // Get current managed hubs
      const managedRes = await this.client.get(`/hubs/sections/${libraryId}/manage`);
      const hubs = managedRes.data?.MediaContainer?.Hub || [];

      // Find all collection hubs
      const collectionHubs = hubs.filter(h => h.identifier.startsWith('custom.collection'));
      if (collectionHubs.length === 0) return;

      // Unpin all collections
      for (const hub of collectionHubs) {
        try {
          await this.client.delete(`/hubs/sections/${libraryId}/manage/${encodeURIComponent(hub.identifier)}`);
        } catch (e) {
          // Ignore errors
        }
      }

      // Sort collections: New Releases first, then alphabetically, Leaving Soon last
      collectionHubs.sort((a, b) => {
        const aTitle = a.title.toLowerCase();
        const bTitle = b.title.toLowerCase();

        if (aTitle.includes('new release')) return -1;
        if (bTitle.includes('new release')) return 1;
        if (aTitle === 'leaving soon') return 1;
        if (bTitle === 'leaving soon') return -1;
        return aTitle.localeCompare(bTitle);
      });

      // Re-pin in sorted order
      for (const hub of collectionHubs) {
        const match = hub.identifier.match(/custom\.collection\.(\d+)\.(\d+)/);
        if (match) {
          const ratingKey = match[2];
          await this.client.post(`/hubs/sections/${libraryId}/manage`, null, {
            params: { metadataItemId: ratingKey, promotedToRecommended: 1 }
          });
        }
      }

      console.log(`[Plex] Reordered ${collectionHubs.length} collection hubs in library ${libraryId}`);
    } catch (error) {
      console.error(`[Plex] Failed to reorder collection hubs: ${error.message}`);
    }
  }

  /**
   * Legacy method - kept for compatibility
   */
  async promoteCollectionToRecommended(collectionRatingKey) {
    try {
      await this.client.put(`/library/collections/${collectionRatingKey}/prefs`, null, {
        params: {
          'collectionMode': 2,
          'contentRating': ''
        }
      });
      return true;
    } catch (error) {
      console.error(`[Plex] Failed to promote collection: ${error.message}`);
      return false;
    }
  }

  async getOrCreateCollection(libraryId, title, description = '', itemType = null, promoteToRecommended = true) {
    const collections = await this.getCollections(libraryId);
    let collection = collections.find(c => c.title === title);

    // Check if existing collection matches the item type (for TV libraries)
    // Collections have subtypes: 'show' for shows, 'episode' for episodes
    if (collection && itemType === 'episode' && collection.subtype === 'show') {
      // Need episode collection, but found show collection - look for episode version
      const episodeTitle = title + ' (Episodes)';
      collection = collections.find(c => c.title === episodeTitle);
      if (!collection) {
        // Create episode-specific collection
        const response = await this.client.post(`/library/collections`, null, {
          params: {
            type: 4, // 4 = episode
            title: episodeTitle,
            smart: 0,
            sectionId: libraryId,
            summary: description || 'Episodes scheduled for removal'
          }
        });

        const newCollections = await this.getCollections(libraryId);
        collection = newCollections.find(c => c.title === episodeTitle);

        // Pin to Recommended tab and reorder
        if (collection && promoteToRecommended) {
          await this.pinCollectionToRecommended(libraryId, collection.ratingKey, episodeTitle);
          await this.reorderCollectionHubs(libraryId);
        }
      }
      return collection;
    }

    let isNewCollection = false;
    if (!collection) {
      isNewCollection = true;
      // Create the collection
      const libs = await this.getLibraries();
      const lib = libs.find(l => l.id === libraryId.toString());

      // Determine collection type: 1=movie, 2=show, 4=episode
      let type;
      if (lib?.type === 'movie') {
        type = 1;
      } else if (itemType === 'episode') {
        type = 4;
      } else {
        type = 2; // show
      }

      const response = await this.client.post(`/library/collections`, null, {
        params: {
          type: type,
          title: title,
          smart: 0,
          sectionId: libraryId,
          summary: description
        }
      });

      // Fetch the created collection
      const newCollections = await this.getCollections(libraryId);
      collection = newCollections.find(c => c.title === title);
    }

    // Pin newly created collections to Recommended tab and reorder
    if (collection && isNewCollection && promoteToRecommended) {
      await this.pinCollectionToRecommended(libraryId, collection.ratingKey, title);
      await this.reorderCollectionHubs(libraryId);
    }

    return collection;
  }

  async getMachineId() {
    const response = await this.client.get('/');
    return response.data.MediaContainer.machineIdentifier;
  }

  async deleteItem(ratingKey) {
    await this.client.delete(`/library/metadata/${ratingKey}`);
    log('info', 'deletion', 'Deleted item from Plex', { media_id: ratingKey });
  }

  async getItemWatchStatus(ratingKey) {
    const item = await this.getItem(ratingKey);
    if (!item) {
      return {
        viewCount: 0,
        lastViewedAt: null,
        viewOffset: 0,
        duration: 0
      };
    }
    return {
      viewCount: item.viewCount || 0,
      lastViewedAt: item.lastViewedAt ? new Date(item.lastViewedAt * 1000) : null,
      viewOffset: item.viewOffset || 0,
      duration: item.duration || 0
    };
  }

  async getShowActivity(showRatingKey) {
    // Get all episodes and find most recent activity
    const seasons = await this.getItemChildren(showRatingKey);
    let lastActivity = null;
    let totalWatched = 0;
    let totalEpisodes = 0;

    for (const season of seasons) {
      const episodes = await this.getItemChildren(season.ratingKey);
      for (const episode of episodes) {
        totalEpisodes++;
        if (episode.viewCount > 0) {
          totalWatched++;
          if (episode.lastViewedAt) {
            const viewDate = new Date(episode.lastViewedAt * 1000);
            if (!lastActivity || viewDate > lastActivity) {
              lastActivity = viewDate;
            }
          }
        }
      }
    }

    return {
      lastActivity,
      totalWatched,
      totalEpisodes,
      watchedPercentage: totalEpisodes > 0 ? (totalWatched / totalEpisodes) * 100 : 0
    };
  }

  async getItemMetadata(ratingKey) {
    const item = await this.getItem(ratingKey);
    if (!item) {
      return null;
    }
    return {
      ratingKey: item.ratingKey,
      title: item.title,
      year: item.year,
      type: item.type,
      thumb: item.thumb ? `${this.url}${item.thumb}?X-Plex-Token=${this.token}` : null,
      rating: item.rating,
      audienceRating: item.audienceRating,
      contentRating: item.contentRating,
      genres: item.Genre?.map(g => g.tag) || [],
      addedAt: item.addedAt ? new Date(item.addedAt * 1000) : null,
      originallyAvailableAt: item.originallyAvailableAt,
      duration: item.duration,
      viewCount: item.viewCount || 0,
      lastViewedAt: item.lastViewedAt ? new Date(item.lastViewedAt * 1000) : null,
      guid: item.guid,
      guids: item.Guid?.map(g => g.id) || [],
      // Episode/Season specific fields
      grandparentRatingKey: item.grandparentRatingKey,
      grandparentTitle: item.grandparentTitle,
      parentRatingKey: item.parentRatingKey,
      parentTitle: item.parentTitle,
      parentIndex: item.parentIndex,
      index: item.index,
      // Media/file info for path-based matching
      Media: item.Media
    };
  }

  // =====================================================
  // MULTI-USER WATCH TRACKING
  // =====================================================

  /**
   * Get all users with access to this server (home users + friends)
   */
  async getAllSharedUsers() {
    const users = [];

    try {
      // Get home/managed users
      const homeRes = await axios.get('https://plex.tv/api/v2/home/users', {
        headers: {
          'X-Plex-Token': this.token,
          'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
          'Accept': 'application/json'
        }
      });

      // API may return array directly or nested in an object
      const homeUsers = Array.isArray(homeRes.data) ? homeRes.data :
                        Array.isArray(homeRes.data?.users) ? homeRes.data.users : [];

      for (const user of homeUsers) {
        users.push({
          id: user.id,
          uuid: user.uuid,
          username: user.title || user.username,
          thumb: user.thumb,
          isAdmin: user.admin === true,
          isManaged: user.restricted === true,
          token: null // Will need to switch user context to get token
        });
      }
    } catch (err) {
      console.log('[Plex] Could not fetch home users:', err.message);
    }

    try {
      // Get friends/shared users via older API
      const friendsRes = await axios.get('https://plex.tv/api/users', {
        headers: {
          'X-Plex-Token': this.token,
          'Accept': 'application/json'
        }
      });

      const friendUsers = friendsRes.data?.MediaContainer?.User || [];
      for (const user of friendUsers) {
        if (!users.find(u => u.id === user.id)) {
          users.push({
            id: user.id,
            username: user.title || user.username,
            email: user.email,
            thumb: user.thumb,
            isAdmin: false,
            isManaged: false
          });
        }
      }
    } catch (err) {
      console.log('[Plex] Could not fetch friends:', err.message);
    }

    return users;
  }

  /**
   * Get detailed watch history with per-user breakdown
   * Uses the watch history endpoint which includes accountID
   */
  async getDetailedWatchHistory(libraryId = null, days = 90) {
    try {
      const params = new URLSearchParams();
      if (libraryId) params.append('librarySectionID', libraryId);

      const response = await this.client.get(`/status/sessions/history/all?${params}`);
      const history = response.data.MediaContainer?.Metadata || [];

      // Group by accountID and item
      const userHistory = {};
      const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

      for (const entry of history) {
        const viewedAt = entry.viewedAt * 1000;
        if (viewedAt < cutoff) continue;

        const accountId = entry.accountID;
        const ratingKey = entry.ratingKey;

        if (!userHistory[accountId]) {
          userHistory[accountId] = {};
        }

        if (!userHistory[accountId][ratingKey]) {
          userHistory[accountId][ratingKey] = {
            ratingKey,
            title: entry.title,
            grandparentTitle: entry.grandparentTitle, // Show name
            parentTitle: entry.parentTitle, // Season name
            type: entry.type,
            viewCount: 0,
            views: []
          };
        }

        userHistory[accountId][ratingKey].viewCount++;
        userHistory[accountId][ratingKey].views.push({
          viewedAt: new Date(viewedAt),
          duration: entry.duration,
          viewOffset: entry.viewOffset
        });
      }

      return userHistory;
    } catch (err) {
      console.error('[Plex] Error getting detailed watch history:', err.message);
      return {};
    }
  }

  /**
   * Get all episodes of a show with per-user watch status
   */
  async getShowEpisodesWithUserStatus(showRatingKey) {
    const episodes = [];
    try {
      const seasons = await this.getItemChildren(showRatingKey);

      if (!seasons || seasons.length === 0) {
        console.log(`[Plex] Show ${showRatingKey} has no seasons`);
        return episodes;
      }

      for (const season of seasons) {
        if (season.title === 'Specials') continue; // Skip specials by default

        const seasonEpisodes = await this.getItemChildren(season.ratingKey);
        for (const ep of seasonEpisodes) {
          episodes.push({
            ratingKey: ep.ratingKey,
            title: ep.title,
            seasonNumber: ep.parentIndex || season.index,
            episodeNumber: ep.index,
            absoluteIndex: episodes.length + 1,
            duration: ep.duration,
            addedAt: ep.addedAt ? new Date(ep.addedAt * 1000) : null,
            viewCount: ep.viewCount || 0,
            lastViewedAt: ep.lastViewedAt ? new Date(ep.lastViewedAt * 1000) : null,
            grandparentRatingKey: showRatingKey
          });
        }
      }
    } catch (err) {
      console.error(`[Plex] Error fetching episodes for show ${showRatingKey}:`, err.message);
    }

    // Sort by season and episode number
    episodes.sort((a, b) => {
      if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
      return a.episodeNumber - b.episodeNumber;
    });

    // Re-assign absolute index after sorting
    episodes.forEach((ep, i) => ep.absoluteIndex = i + 1);

    return episodes;
  }

  /**
   * Analyze multi-user watch progress for a show
   * Returns per-user progress, velocity, and projected timelines
   */
  async analyzeShowWatchProgress(showRatingKey, watchHistoryDays = 90) {
    const show = await this.getItem(showRatingKey);
    const episodes = await this.getShowEpisodesWithUserStatus(showRatingKey);
    const history = await this.getDetailedWatchHistory(null, watchHistoryDays);

    // Build episode lookup
    const episodeMap = new Map(episodes.map(ep => [ep.ratingKey, ep]));

    // Analyze each user's progress
    const userProgress = {};

    for (const [accountId, userItems] of Object.entries(history)) {
      // Filter to episodes from this show
      const showEpisodes = Object.values(userItems).filter(item => {
        const ep = episodeMap.get(item.ratingKey);
        return ep !== undefined;
      });

      if (showEpisodes.length === 0) continue;

      // Find last watched episode (by absolute index)
      let lastWatchedIndex = 0;
      let lastWatchedDate = null;
      let firstWatchedDate = null;
      const watchedEpisodes = new Set();
      const watchDates = [];

      for (const item of showEpisodes) {
        const ep = episodeMap.get(item.ratingKey);
        if (!ep) continue;

        watchedEpisodes.add(ep.ratingKey);

        for (const view of item.views) {
          watchDates.push(view.viewedAt);
          if (!firstWatchedDate || view.viewedAt < firstWatchedDate) {
            firstWatchedDate = view.viewedAt;
          }
          if (!lastWatchedDate || view.viewedAt > lastWatchedDate) {
            lastWatchedDate = view.viewedAt;
            lastWatchedIndex = ep.absoluteIndex;
          }
        }
      }

      // Calculate watch velocity (episodes per day)
      let velocity = 0;
      if (watchDates.length > 1 && firstWatchedDate && lastWatchedDate) {
        const daysDiff = (lastWatchedDate - firstWatchedDate) / (1000 * 60 * 60 * 24);
        if (daysDiff > 0) {
          velocity = watchedEpisodes.size / daysDiff;
        }
      } else if (watchedEpisodes.size > 0) {
        // Single viewing session, assume 1 episode per day as baseline
        velocity = 1;
      }

      // Find current position (highest consecutive watched episode)
      let currentPosition = 0;
      for (const ep of episodes) {
        if (watchedEpisodes.has(ep.ratingKey)) {
          currentPosition = ep.absoluteIndex;
        } else {
          break; // Stop at first unwatched
        }
      }

      // If they've skipped around, use last watched instead
      if (lastWatchedIndex > currentPosition) {
        currentPosition = lastWatchedIndex;
      }

      userProgress[accountId] = {
        accountId,
        watchedCount: watchedEpisodes.size,
        totalEpisodes: episodes.length,
        currentPosition,
        lastWatchedIndex,
        lastWatchedDate,
        firstWatchedDate,
        velocity, // episodes per day
        isActive: lastWatchedDate && (Date.now() - lastWatchedDate.getTime()) < (30 * 24 * 60 * 60 * 1000), // Active if watched in last 30 days
        daysSinceLastWatch: lastWatchedDate ? Math.floor((Date.now() - lastWatchedDate.getTime()) / (1000 * 60 * 60 * 24)) : null
      };
    }

    return {
      show: {
        ratingKey: showRatingKey,
        title: show.title,
        totalEpisodes: episodes.length
      },
      episodes,
      userProgress,
      activeViewers: Object.values(userProgress).filter(u => u.isActive).length
    };
  }

  /**
   * Get recently watched episode info per user for a show
   * Returns the most recently watched episode for each user who has watched the show
   */
  async getRecentlyWatchedByUsers(showRatingKey) {
    const analysis = await this.analyzeShowWatchProgress(showRatingKey);
    const { episodes, userProgress } = analysis;
    
    // Build episode lookup by absoluteIndex
    const episodeByIndex = {};
    for (const ep of episodes) {
      episodeByIndex[ep.absoluteIndex] = ep;
    }
    
    // Get user details from database
    const { db } = require('../database');
    
    const recentlyWatched = [];
    
    for (const [accountId, progress] of Object.entries(userProgress)) {
      const lastEp = episodeByIndex[progress.lastWatchedIndex];
      if (!lastEp) continue;
      
      // Try to get username from database
      let username = accountId;
      try {
        const user = db.prepare('SELECT username FROM users WHERE plex_id = ?').get(accountId);
        if (user) username = user.username;
      } catch (e) {
        // Use accountId as fallback
      }
      
      recentlyWatched.push({
        username,
        accountId,
        episodeTitle: lastEp.title,
        seasonNumber: lastEp.seasonNumber,
        episodeNumber: lastEp.episodeNumber,
        watchedAt: progress.lastWatchedDate,
        currentPosition: progress.currentPosition,
        totalWatched: progress.watchedCount,
        totalEpisodes: progress.totalEpisodes,
        velocity: progress.velocity,
        isActive: progress.isActive,
        daysSinceLastWatch: progress.daysSinceLastWatch
      });
    }
    
    // Sort by most recent watch first
    recentlyWatched.sort((a, b) => {
      if (!a.watchedAt) return 1;
      if (!b.watchedAt) return -1;
      return b.watchedAt - a.watchedAt;
    });
    
    return recentlyWatched;
  }

  /**
   * Determine which episodes are safe to delete based on multi-user analysis
   *
   * An episode is safe to delete if:
   * 1. All active viewers have watched past it
   * 2. No viewer will need it within the buffer period (based on velocity)
   * 3. It hasn't been watched by anyone in minDaysSinceWatch days
   */
  async getSmartEpisodeDeletionCandidates(showRatingKey, options = {}) {
    const {
      minDaysSinceWatch = 15,      // Minimum days since last watch
      velocityBufferDays = 7,      // Extra days buffer for velocity projection
      protectAhead = 3,            // Always protect X episodes ahead of slowest viewer
    } = options;

    const analysis = await this.analyzeShowWatchProgress(showRatingKey);
    const { episodes, userProgress } = analysis;

    const activeUsers = Object.values(userProgress).filter(u => u.isActive);
    const deletionCandidates = [];

    // If no active users, all watched episodes older than minDaysSinceWatch are candidates
    if (activeUsers.length === 0) {
      for (const ep of episodes) {
        if (ep.viewCount > 0 && ep.lastViewedAt) {
          const daysSinceWatch = (Date.now() - ep.lastViewedAt.getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceWatch >= minDaysSinceWatch) {
            deletionCandidates.push({
              ...ep,
              reason: 'No active viewers, unwatched for ' + Math.floor(daysSinceWatch) + ' days',
              safeToDelete: true
            });
          }
        }
      }
      return { analysis, deletionCandidates, protectedEpisodes: [] };
    }

    // Find the "slowest" viewer (lowest current position among active users)
    const slowestViewer = activeUsers.reduce((min, u) =>
      u.currentPosition < min.currentPosition ? u : min
    , activeUsers[0]);

    // Calculate how far ahead we need to protect based on velocity
    let protectionBuffer = protectAhead;
    for (const user of activeUsers) {
      if (user.velocity > 0) {
        // Protect enough episodes for velocityBufferDays of watching
        const velocityProtection = Math.ceil(user.velocity * velocityBufferDays);
        protectionBuffer = Math.max(protectionBuffer, velocityProtection);
      }
    }

    // The "safe deletion threshold" is the slowest viewer's position minus the buffer
    // We also check that ALL active viewers are past the episode
    const minActivePosition = Math.min(...activeUsers.map(u => u.currentPosition));
    const safeThreshold = minActivePosition - 1; // Episodes before the earliest active viewer

    const protectedEpisodes = [];

    for (const ep of episodes) {
      const daysSinceWatch = ep.lastViewedAt
        ? (Date.now() - ep.lastViewedAt.getTime()) / (1000 * 60 * 60 * 24)
        : null;

      // Check if episode is behind ALL active viewers
      const behindAllViewers = activeUsers.every(u => ep.absoluteIndex < u.currentPosition);

      // Check if any viewer might need this episode soon (velocity projection)
      let neededSoon = false;
      for (const user of activeUsers) {
        if (user.velocity > 0 && ep.absoluteIndex >= user.currentPosition) {
          const episodesToReach = ep.absoluteIndex - user.currentPosition;
          const daysToReach = episodesToReach / user.velocity;
          if (daysToReach <= velocityBufferDays) {
            neededSoon = true;
            break;
          }
        }
      }

      // Check minimum days since watch
      const oldEnough = daysSinceWatch !== null && daysSinceWatch >= minDaysSinceWatch;

      if (behindAllViewers && oldEnough && !neededSoon && ep.viewCount > 0) {
        deletionCandidates.push({
          ...ep,
          daysSinceWatch: Math.floor(daysSinceWatch),
          reason: `Behind all ${activeUsers.length} active viewers, unwatched for ${Math.floor(daysSinceWatch)} days`,
          safeToDelete: true
        });
      } else {
        let protectionReason = [];
        if (!behindAllViewers) protectionReason.push('ahead of active viewer');
        if (neededSoon) protectionReason.push('viewer approaching based on velocity');
        if (!oldEnough && ep.viewCount > 0) protectionReason.push(`only ${Math.floor(daysSinceWatch || 0)} days since watch`);
        if (ep.viewCount === 0) protectionReason.push('never watched');

        protectedEpisodes.push({
          ...ep,
          protectionReason: protectionReason.join(', '),
          safeToDelete: false
        });
      }
    }

    return {
      analysis,
      deletionCandidates,
      protectedEpisodes,
      summary: {
        totalEpisodes: episodes.length,
        activeViewers: activeUsers.length,
        slowestViewerPosition: slowestViewer.currentPosition,
        candidatesForDeletion: deletionCandidates.length,
        protectedCount: protectedEpisodes.length
      }
    };
  }

  // =====================================================
  // SERVER SHARING / USER INVITES
  // =====================================================

  /**
   * Get list of users who have access to this server (friends/shared users)
   * Uses the admin's token
   */
  static async getSharedServerUsers(adminToken, machineIdentifier) {
    try {
      const response = await axios.get(`https://plex.tv/api/v2/shared_servers/${machineIdentifier}`, {
        headers: {
          'X-Plex-Token': adminToken,
          'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
          'Accept': 'application/json'
        }
      });
      return response.data || [];
    } catch (error) {
      console.error('[Plex] Error getting shared users:', error.response?.status, error.message);
      return [];
    }
  }

  /**
   * Check if a user (by email or Plex ID) has access to the server
   */
  static async userHasServerAccess(adminToken, machineIdentifier, userEmail, userPlexId = null) {
    try {
      // Get all friends/shared users
      const response = await axios.get('https://plex.tv/api/users', {
        headers: {
          'X-Plex-Token': adminToken,
          'Accept': 'application/json'
        }
      });

      const users = response.data?.MediaContainer?.User || [];

      // Check if user exists in friends list
      const friend = users.find(u =>
        (userEmail && u.email?.toLowerCase() === userEmail.toLowerCase()) ||
        (userPlexId && u.id?.toString() === userPlexId?.toString())
      );

      if (!friend) {
        return { hasAccess: false, reason: 'not_friend' };
      }

      // Check if they have access to this specific server
      const serverAccess = friend.Server?.find(s =>
        s.machineIdentifier === machineIdentifier
      );

      if (!serverAccess) {
        return { hasAccess: false, reason: 'no_server_access', friendId: friend.id };
      }

      return {
        hasAccess: true,
        friendId: friend.id,
        sharedLibraries: serverAccess.numLibraries || 0
      };
    } catch (error) {
      console.error('[Plex] Error checking user access:', error.message);
      return { hasAccess: false, reason: 'error', error: error.message };
    }
  }

  /**
   * Invite a user to the Plex server with access to specific libraries
   * @param {string} adminToken - The server owner's Plex token
   * @param {string} machineIdentifier - The server's machine ID
   * @param {string} userPlexId - Plex user ID of the user to invite
   * @param {Array<string>} librarySectionIds - Library section IDs to share (empty = all)
   */
  static async inviteUserToServer(adminToken, machineIdentifier, userPlexId, librarySectionIds = []) {
    try {
      console.log(`[Plex] Inviting user ${userPlexId} to server ${machineIdentifier}`);
      console.log(`[Plex] Libraries to share: ${librarySectionIds.length > 0 ? librarySectionIds.join(', ') : 'all'}`);

      // Use Plex.tv API - requires invited_id (Plex user ID), not email
      // POST to /api/servers/{machineId}/shared_servers
      const sharedServer = {
        invited_id: parseInt(userPlexId)
      };
      if (librarySectionIds.length > 0) {
        sharedServer.library_section_ids = librarySectionIds.map(id => parseInt(id));
      }
      const shareData = {
        server_id: machineIdentifier,
        shared_server: sharedServer
      };

      console.log(`[Plex] Request URL: https://plex.tv/api/servers/${machineIdentifier}/shared_servers`);
      console.log(`[Plex] Request body: ${JSON.stringify(shareData)}`);

      const response = await axios.post(
        `https://plex.tv/api/servers/${machineIdentifier}/shared_servers`,
        shareData,
        {
          headers: {
            'X-Plex-Token': adminToken,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`[Plex] Successfully invited user ${userPlexId}`);
      return {
        success: true,
        message: `Invitation sent to user ${userPlexId}`,
        data: response.data
      };
    } catch (error) {
      const errorMsg = error.response?.data?.errors?.[0]?.message || error.message;
      console.error(`[Plex] Error inviting user: ${errorMsg}`);

      // Handle common errors
      if (error.response?.status === 422) {
        // User may already have access or invalid email
        if (errorMsg.includes('already')) {
          return { success: true, message: 'User already has access', alreadyShared: true };
        }
      }

      return { success: false, error: errorMsg };
    }
  }

  /**
   * Update library access for an existing shared user
   */
  static async updateSharedLibraries(adminToken, sharedServerId, librarySectionIds) {
    try {
      const response = await axios.put(
        `https://plex.tv/api/v2/shared_servers/${sharedServerId}`,
        {
          shared_server: {
            library_section_ids: librarySectionIds
          }
        },
        {
          headers: {
            'X-Plex-Token': adminToken,
            'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        }
      );

      return { success: true, data: response.data };
    } catch (error) {
      console.error('[Plex] Error updating shared libraries:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add item to Plex watchlist
   * Uses the discover.provider.plex.tv API
   */
  async addToPlexWatchlist(ratingKey) {
    try {
      // Note: Don't use X-Plex-Client-Identifier for Plex.tv APIs - causes 401
      const response = await axios.put(
        `https://discover.provider.plex.tv/actions/addToWatchlist`,
        null,
        {
          params: {
            ratingKey: ratingKey
          },
          headers: {
            'X-Plex-Token': this.token,
            'Accept': 'application/json'
          }
        }
      );
      return { success: true };
    } catch (error) {
      console.error('[Plex] Error adding to watchlist:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove item from Plex watchlist by ratingKey
   */
  async removeFromPlexWatchlist(ratingKey) {
    try {
      // Note: Don't use X-Plex-Client-Identifier for Plex.tv APIs - causes 401
      const response = await axios.put(
        `https://discover.provider.plex.tv/actions/removeFromWatchlist`,
        null,
        {
          params: {
            ratingKey: ratingKey
          },
          headers: {
            'X-Plex-Token': this.token,
            'Accept': 'application/json'
          }
        }
      );
      return { success: true };
    } catch (error) {
      console.error('[Plex] Error removing from watchlist:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove item from Plex watchlist by title and year match
   * More reliable when we don't have the exact ratingKey
   */
  async removeFromPlexWatchlistByTitle(title, year, mediaType) {
    try {
      const watchlist = await this.getWatchlist();
      const item = watchlist.find(w =>
        w.title?.toLowerCase() === title?.toLowerCase() &&
        (!year || w.year === year) &&
        (mediaType === 'movie' ? w.type === 'movie' : w.type === 'show')
      );

      if (item && item.ratingKey) {
        return await this.removeFromPlexWatchlist(item.ratingKey);
      }

      return { success: false, error: 'Item not found in Plex watchlist' };
    } catch (error) {
      console.error('[Plex] Error removing from watchlist by title:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Search Plex metadata for an item by title (to get ratingKey for watchlist operations)
   * Uses metadata.provider.plex.tv which is more reliable than the search endpoint
   * Note: Don't pass year to API - it returns wrong matches. Post-filter by IMDB/TMDB instead.
   */
  async searchDiscover(query, mediaType = null) {
    try {
      const type = mediaType === 'movie' ? 1 : mediaType === 'tv' ? 2 : 1;
      const agent = mediaType === 'tv' ? 'tv.plex.agents.series' : 'tv.plex.agents.movie';

      // Extract year from query if present (e.g., "Green Room 2016") - for logging only
      const yearMatch = query.match(/\s+(\d{4})$/);
      const title = yearMatch ? query.replace(/\s+\d{4}$/, '').trim() : query;

      // Don't include year in API params - causes incorrect matches
      // We'll post-filter by IMDB/TMDB ID or title+year match instead
      const params = {
        type,
        title,
        agent
      };

      // Note: metadata API doesn't use X-Plex-Client-Identifier - causes 401
      const response = await axios.get(
        'https://metadata.provider.plex.tv/library/metadata/matches',
        {
          params,
          headers: {
            'X-Plex-Token': this.token,
            'Accept': 'application/json'
          }
        }
      );
      return response.data.MediaContainer?.Metadata || [];
    } catch (error) {
      console.error('[Plex] Error searching metadata:', error.message);
      return [];
    }
  }

  /**
   * Add item to user's Plex watchlist by searching Discover and adding
   * This syncs items added via Flexerr to the user's actual Plex watchlist
   */
  async addToWatchlistBySearch(title, year, mediaType, imdbId = null) {
    try {
      const plexType = mediaType === 'tv' ? 'show' : 'movie';

      // Search by title + year first (more reliable)
      let searchQuery = `${title} ${year || ''}`.trim();
      console.log(`[Plex] Searching Discover for: "${searchQuery}" (${plexType})`);

      let results = await this.searchDiscover(searchQuery, mediaType);

      // If no results with year, try without year
      if ((!results || results.length === 0) && year) {
        console.log(`[Plex] No results with year, trying title only: "${title}"`);
        results = await this.searchDiscover(title, mediaType);
      }

      if (!results || results.length === 0) {
        console.log(`[Plex] No results found for "${title}"`);
        return { success: false, error: 'Not found on Plex Discover' };
      }

      // Find best match - prefer IMDB match, then exact title+year, then title only
      let match = null;

      // First try IMDB match (most reliable)
      if (imdbId) {
        match = results.find(r => {
          if (r.Guid) {
            const guids = Array.isArray(r.Guid) ? r.Guid : [];
            return guids.some(g => g.id === `imdb://${imdbId}`);
          }
          return false;
        });
        if (match) {
          console.log(`[Plex] Found by IMDB match: "${match.title}" (${match.year})`);
        }
      }

      // Then try exact title+year match
      if (!match) {
        match = results.find(r => {
          const titleMatch = r.title?.toLowerCase() === title?.toLowerCase();
          const yearMatch = !year || r.year === parseInt(year);
          return titleMatch && yearMatch;
        });
      }

      // Then try title only (allow year mismatch)
      if (!match) {
        match = results.find(r => r.title?.toLowerCase() === title?.toLowerCase());
        if (match) {
          console.log(`[Plex] Found by title match (year differs): "${match.title}" (${match.year})`);
        }
      }

      // Fallback to first result if no exact match
      if (!match) {
        match = results[0];
        console.log(`[Plex] No exact match, using first result: "${match.title}" (${match.year})`);
      }

      if (!match.ratingKey) {
        console.log('[Plex] Match found but no ratingKey:', match);
        return { success: false, error: 'No ratingKey for match' };
      }

      console.log(`[Plex] Adding "${match.title}" (${match.year}) to watchlist, ratingKey: ${match.ratingKey}`);

      // Add to watchlist using the ratingKey
      const result = await this.addToPlexWatchlist(match.ratingKey);

      if (result.success) {
        console.log(`[Plex] Successfully added "${match.title}" to watchlist`);
      }

      return result;
    } catch (error) {
      console.error('[Plex] Error adding to watchlist by search:', error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = PlexService;
