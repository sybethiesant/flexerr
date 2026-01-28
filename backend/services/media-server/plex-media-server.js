/**
 * PlexMediaServer
 *
 * Plex implementation of the MediaServer interface.
 * Handles all Plex-specific API calls and data normalization.
 */

const axios = require('axios');
const MediaServer = require('./media-server');
const { db, log, getMediaServerById } = require('../../database');

const PLEX_CLIENT_ID = 'flexerr-media-manager';
const PLEX_PRODUCT = 'Flexerr';
const PLEX_DEVICE = 'Web';

class PlexMediaServer extends MediaServer {
  constructor(config) {
    super({
      ...config,
      type: 'plex'
    });

    this.token = config.apiKey || config.adminToken;
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

  // =====================================================
  // STATIC METHODS - OAuth Flow
  // =====================================================

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

  static async getServers(token) {
    const response = await axios.get('https://plex.tv/api/v2/resources', {
      params: { includeHttps: 1, includeRelay: 0 },
      headers: {
        'Accept': 'application/json',
        'X-Plex-Token': token,
        'X-Plex-Client-Identifier': PLEX_CLIENT_ID
      }
    });

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

  static fromDb() {
    const service = db.prepare("SELECT * FROM services WHERE type = 'plex' AND is_active = 1").get();
    if (!service) return null;

    return new PlexMediaServer({
      id: service.id,
      name: service.name,
      url: service.url,
      apiKey: service.api_key
    });
  }

  static fromMediaServer(mediaServer) {
    if (!mediaServer || mediaServer.type !== 'plex') return null;

    return new PlexMediaServer({
      id: mediaServer.id,
      name: mediaServer.name,
      url: mediaServer.url,
      apiKey: mediaServer.api_key,
      adminToken: mediaServer.admin_token,
      adminUserId: mediaServer.admin_user_id
    });
  }

  // =====================================================
  // CONNECTION & AUTHENTICATION
  // =====================================================

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

  async getServerInfo() {
    const response = await this.client.get('/');
    const data = response.data.MediaContainer;
    return {
      name: data.friendlyName,
      version: data.version,
      id: data.machineIdentifier,
      platform: data.platform
    };
  }

  async getServerId() {
    const response = await this.client.get('/');
    return response.data.MediaContainer.machineIdentifier;
  }

  // =====================================================
  // LIBRARIES
  // =====================================================

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

  async getLibraryContents(libraryId) {
    const response = await this.client.get(`/library/sections/${libraryId}/all`);
    return response.data.MediaContainer.Metadata || [];
  }

  // =====================================================
  // ITEMS
  // =====================================================

  async getItem(itemId) {
    const response = await this.client.get(`/library/metadata/${itemId}`);
    return response.data.MediaContainer.Metadata?.[0];
  }

  async getItemChildren(itemId) {
    const response = await this.client.get(`/library/metadata/${itemId}/children`);
    return response.data.MediaContainer.Metadata || [];
  }

  async getItemMetadata(itemId) {
    const item = await this.getItem(itemId);
    if (!item) {
      return null;
    }
    return {
      id: item.ratingKey,
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
      grandparentId: item.grandparentRatingKey,
      grandparentTitle: item.grandparentTitle,
      parentId: item.parentRatingKey,
      parentTitle: item.parentTitle,
      seasonNumber: item.parentIndex,
      episodeNumber: item.index,
      // Media/file info
      Media: item.Media
    };
  }

  async deleteItem(itemId) {
    await this.client.delete(`/library/metadata/${itemId}`);
    log('info', 'deletion', 'Deleted item from Plex', { media_id: itemId });
  }

  // =====================================================
  // WATCH HISTORY & STATUS
  // =====================================================

  async getWatchHistory(options = {}) {
    const { userId, since, limit = 500 } = options;

    const params = {
      sort: 'viewedAt:desc',
      'X-Plex-Container-Size': limit
    };

    if (since) {
      params['viewedAt>'] = Math.floor(since.getTime() / 1000);
    }

    const response = await this.client.get('/status/sessions/history/all', { params });
    let history = response.data.MediaContainer?.Metadata || [];

    if (userId) {
      history = history.filter(h => h.accountID?.toString() === userId.toString());
    }

    return history.map(entry => ({
      id: entry.historyKey,
      itemId: entry.ratingKey,
      userId: entry.accountID?.toString(),
      title: entry.title,
      grandparentTitle: entry.grandparentTitle,
      parentTitle: entry.parentTitle,
      type: entry.type,
      seasonNumber: entry.parentIndex,
      episodeNumber: entry.index,
      viewedAt: entry.viewedAt ? new Date(entry.viewedAt * 1000) : null,
      duration: entry.duration,
      viewOffset: entry.viewOffset
    }));
  }

  async getItemWatchStatus(itemId, userId = null) {
    const item = await this.getItem(itemId);
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

  async getShowEpisodesWithUserStatus(showId) {
    const episodes = [];
    const seasons = await this.getItemChildren(showId);

    for (const season of seasons) {
      if (season.title === 'Specials') continue;

      const seasonEpisodes = await this.getItemChildren(season.ratingKey);
      for (const ep of seasonEpisodes) {
        episodes.push({
          id: ep.ratingKey,
          ratingKey: ep.ratingKey,
          title: ep.title,
          seasonNumber: ep.parentIndex || season.index,
          episodeNumber: ep.index,
          absoluteIndex: episodes.length + 1,
          duration: ep.duration,
          addedAt: ep.addedAt ? new Date(ep.addedAt * 1000) : null,
          viewCount: ep.viewCount || 0,
          lastViewedAt: ep.lastViewedAt ? new Date(ep.lastViewedAt * 1000) : null,
          grandparentId: showId
        });
      }
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

  // =====================================================
  // USERS
  // =====================================================

  async getAllUsers() {
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

      for (const user of homeRes.data || []) {
        users.push({
          id: user.id?.toString(),
          uuid: user.uuid,
          username: user.title || user.username,
          thumb: user.thumb,
          isAdmin: user.admin === true,
          isManaged: user.restricted === true
        });
      }
    } catch (err) {
      console.log('[Plex] Could not fetch home users:', err.message);
    }

    try {
      // Get friends/shared users
      const friendsRes = await axios.get('https://plex.tv/api/users', {
        headers: {
          'X-Plex-Token': this.token,
          'Accept': 'application/json'
        }
      });

      const friendUsers = friendsRes.data?.MediaContainer?.User || [];
      for (const user of friendUsers) {
        if (!users.find(u => u.id === user.id?.toString())) {
          users.push({
            id: user.id?.toString(),
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

  // =====================================================
  // WATCHLIST
  // =====================================================

  async getWatchlist(userId = null) {
    try {
      console.log('[Plex] Fetching watchlist...');
      const response = await axios.get('https://discover.provider.plex.tv/library/sections/watchlist/all', {
        headers: {
          'X-Plex-Token': this.token,
          'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
          'Accept': 'application/json'
        }
      });
      const items = response.data.MediaContainer?.Metadata || [];
      console.log(`[Plex] Got ${items.length} watchlist items`);
      return items.map(item => this.normalizeItem(item));
    } catch (error) {
      console.error('[Plex] Watchlist fetch failed:', error.response?.status, error.response?.data || error.message);
      return [];
    }
  }

  async isOnWatchlist(itemId, itemMetadata = null) {
    const watchlist = await this.getWatchlist();

    // Direct ID match
    const directMatch = watchlist.some(item =>
      item.id === itemId ||
      item.id === String(itemId)
    );

    if (directMatch) return true;

    // Title/year match
    if (itemMetadata) {
      const titleYear = `${itemMetadata.title?.toLowerCase()}|${itemMetadata.year}`;
      return watchlist.some(w => `${w.title?.toLowerCase()}|${w.year}` === titleYear);
    }

    // Fetch metadata for matching
    try {
      const item = await this.getItemMetadata(itemId);
      if (item) {
        const titleYear = `${item.title?.toLowerCase()}|${item.year}`;
        return watchlist.some(w => `${w.title?.toLowerCase()}|${w.year}` === titleYear);
      }
    } catch (e) {
      // Item might not exist
    }

    return false;
  }

  async addToWatchlist(itemId) {
    try {
      await axios.put(
        'https://discover.provider.plex.tv/actions/addToWatchlist',
        null,
        {
          params: { ratingKey: itemId },
          headers: {
            'X-Plex-Token': this.token,
            'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
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

  async removeFromWatchlist(itemId) {
    try {
      await axios.put(
        'https://discover.provider.plex.tv/actions/removeFromWatchlist',
        null,
        {
          params: { ratingKey: itemId },
          headers: {
            'X-Plex-Token': this.token,
            'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
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

  // =====================================================
  // COLLECTIONS
  // =====================================================

  async getCollections(libraryId) {
    const response = await this.client.get(`/library/sections/${libraryId}/collections`);
    return response.data.MediaContainer.Metadata || [];
  }

  async createCollection(libraryId, title, description = '') {
    const response = await this.client.post('/library/collections', null, {
      params: {
        type: 1,
        title: title,
        smart: 0,
        sectionId: libraryId,
        summary: description
      }
    });
    return response.data;
  }

  async getOrCreateCollection(libraryId, title, description = '', itemType = null) {
    const collections = await this.getCollections(libraryId);
    let collection = collections.find(c => c.title === title);

    // Handle episode collections in TV libraries
    if (collection && itemType === 'episode' && collection.subtype === 'show') {
      const episodeTitle = title + ' (Episodes)';
      collection = collections.find(c => c.title === episodeTitle);
      if (!collection) {
        await this.client.post('/library/collections', null, {
          params: {
            type: 4,
            title: episodeTitle,
            smart: 0,
            sectionId: libraryId,
            summary: description || 'Episodes scheduled for removal'
          }
        });

        const newCollections = await this.getCollections(libraryId);
        collection = newCollections.find(c => c.title === episodeTitle);
      }
      return collection;
    }

    if (!collection) {
      const libs = await this.getLibraries();
      const lib = libs.find(l => l.id === libraryId.toString());

      let type;
      if (lib?.type === 'movie') {
        type = 1;
      } else if (itemType === 'episode') {
        type = 4;
      } else {
        type = 2;
      }

      await this.client.post('/library/collections', null, {
        params: {
          type: type,
          title: title,
          smart: 0,
          sectionId: libraryId,
          summary: description
        }
      });

      const newCollections = await this.getCollections(libraryId);
      collection = newCollections.find(c => c.title === title);
    }

    return collection;
  }

  async addToCollection(collectionId, itemId) {
    const machineId = await this.getServerId();
    await this.client.put(`/library/collections/${collectionId}/items`, null, {
      params: {
        uri: `server://${machineId}/com.plexapp.plugins.library/library/metadata/${itemId}`
      }
    });
  }

  async removeFromCollection(collectionId, itemId) {
    await this.client.delete(`/library/collections/${collectionId}/items/${itemId}`);
  }

  // =====================================================
  // UTILITY METHODS
  // =====================================================

  extractExternalIds(item) {
    const guids = item.Guid || item.guids || [];
    let tmdbId = null;
    let tvdbId = null;
    let imdbId = null;

    for (const guid of guids) {
      const id = typeof guid === 'string' ? guid : guid?.id;
      if (!id) continue;

      if (id.startsWith('tmdb://')) {
        tmdbId = parseInt(id.replace('tmdb://', ''), 10);
      } else if (id.startsWith('tvdb://')) {
        tvdbId = parseInt(id.replace('tvdb://', ''), 10);
      } else if (id.startsWith('imdb://')) {
        imdbId = id.replace('imdb://', '');
      }
    }

    return { tmdbId, tvdbId, imdbId };
  }

  normalizeItem(item) {
    const externalIds = this.extractExternalIds(item);
    return {
      id: item.ratingKey,
      title: item.title,
      year: item.year,
      type: item.type,
      thumb: item.thumb,
      addedAt: item.addedAt ? new Date(item.addedAt * 1000) : null,
      viewCount: item.viewCount || 0,
      lastViewedAt: item.lastViewedAt ? new Date(item.lastViewedAt * 1000) : null,
      ...externalIds,
      // Keep original for compatibility
      ratingKey: item.ratingKey,
      guid: item.guid,
      guids: item.Guid?.map(g => g.id) || []
    };
  }

  getThumbnailUrl(itemId) {
    return `${this.url}/library/metadata/${itemId}/thumb?X-Plex-Token=${this.token}`;
  }

  // =====================================================
  // PLEX-SPECIFIC METHODS
  // =====================================================

  async getShowActivity(showId) {
    const seasons = await this.getItemChildren(showId);
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

  async searchDiscover(query, mediaType = null) {
    try {
      const searchType = mediaType === 'movie' ? 1 : mediaType === 'tv' ? 2 : null;
      const response = await axios.get(
        'https://discover.provider.plex.tv/library/search',
        {
          params: {
            query: query,
            searchTypes: searchType || 'movie,show',
            limit: 10
          },
          headers: {
            'X-Plex-Token': this.token,
            'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
            'Accept': 'application/json'
          }
        }
      );
      return response.data.MediaContainer?.Metadata || [];
    } catch (error) {
      console.error('[Plex] Error searching discover:', error.message);
      return [];
    }
  }

  async getDetailedWatchHistory(libraryId = null, days = 90) {
    try {
      const params = new URLSearchParams();
      if (libraryId) params.append('librarySectionID', libraryId);

      const response = await this.client.get(`/status/sessions/history/all?${params}`);
      const history = response.data.MediaContainer?.Metadata || [];

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
            grandparentTitle: entry.grandparentTitle,
            parentTitle: entry.parentTitle,
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
}

module.exports = PlexMediaServer;
