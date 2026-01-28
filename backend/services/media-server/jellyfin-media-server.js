/**
 * JellyfinMediaServer
 *
 * Jellyfin implementation of the MediaServer interface.
 * Handles all Jellyfin-specific API calls and data normalization.
 *
 * Key differences from Plex:
 * - Uses username/password authentication instead of OAuth
 * - Uses "Favorites" as watchlist equivalent (no native watchlist)
 * - Different API structure and endpoints
 * - Uses GUIDs in format like "tmdb.123" instead of "tmdb://123"
 */

const axios = require('axios');
const MediaServer = require('./media-server');
const { db, log, getMediaServerById } = require('../../database');

class JellyfinMediaServer extends MediaServer {
  constructor(config) {
    super({
      ...config,
      type: 'jellyfin'
    });

    this.apiKey = config.apiKey;
    this.userId = config.adminUserId;
    this.accessToken = config.adminToken;
    this.client = null;

    if (this.url && (this.apiKey || this.accessToken)) {
      this.initClient();
    }
  }

  initClient() {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['X-Emby-Token'] = this.apiKey;
    } else if (this.accessToken) {
      headers['X-Emby-Token'] = this.accessToken;
    }

    this.client = axios.create({
      baseURL: this.url,
      headers,
      timeout: 30000
    });
  }

  // =====================================================
  // STATIC METHODS - Authentication
  // =====================================================

  /**
   * Authenticate with username/password
   * Returns access token and user ID
   */
  static async authenticate(serverUrl, username, password) {
    try {
      const response = await axios.post(
        `${serverUrl}/Users/AuthenticateByName`,
        {
          Username: username,
          Pw: password
        },
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Emby-Authorization': `MediaBrowser Client="Flexerr", Device="Web", DeviceId="flexerr-${Date.now()}", Version="1.0.0"`
          }
        }
      );

      return {
        success: true,
        accessToken: response.data.AccessToken,
        userId: response.data.User.Id,
        user: {
          id: response.data.User.Id,
          username: response.data.User.Name,
          isAdmin: response.data.User.Policy?.IsAdministrator || false
        },
        serverId: response.data.ServerId
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.Message || error.message
      };
    }
  }

  /**
   * Get public server info (no auth required)
   */
  static async getPublicInfo(serverUrl) {
    try {
      const response = await axios.get(`${serverUrl}/System/Info/Public`);
      return {
        success: true,
        name: response.data.ServerName,
        version: response.data.Version,
        id: response.data.Id
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  static fromDb() {
    const server = db.prepare("SELECT * FROM media_servers WHERE type = 'jellyfin' AND is_active = 1").get();
    if (!server) return null;

    return new JellyfinMediaServer({
      id: server.id,
      name: server.name,
      url: server.url,
      apiKey: server.api_key,
      adminUserId: server.admin_user_id,
      adminToken: server.admin_token,
      settings: JSON.parse(server.settings || '{}')
    });
  }

  static fromMediaServer(mediaServer) {
    if (!mediaServer || mediaServer.type !== 'jellyfin') return null;

    return new JellyfinMediaServer({
      id: mediaServer.id,
      name: mediaServer.name,
      url: mediaServer.url,
      apiKey: mediaServer.api_key,
      adminUserId: mediaServer.admin_user_id,
      adminToken: mediaServer.admin_token,
      settings: JSON.parse(mediaServer.settings || '{}')
    });
  }

  // =====================================================
  // CONNECTION & AUTHENTICATION
  // =====================================================

  async testConnection() {
    try {
      const response = await this.client.get('/System/Info');
      return {
        success: true,
        version: response.data.Version,
        name: response.data.ServerName,
        platform: response.data.OperatingSystem
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getServerInfo() {
    const response = await this.client.get('/System/Info');
    return {
      name: response.data.ServerName,
      version: response.data.Version,
      id: response.data.Id,
      platform: response.data.OperatingSystem
    };
  }

  async getServerId() {
    const response = await this.client.get('/System/Info');
    return response.data.Id;
  }

  // =====================================================
  // LIBRARIES
  // =====================================================

  async getLibraries() {
    const response = await this.client.get(`/Users/${this.userId}/Views`);
    return (response.data.Items || []).map(lib => ({
      id: lib.Id,
      title: lib.Name,
      type: this.mapJellyfinLibraryType(lib.CollectionType),
      collectionType: lib.CollectionType
    }));
  }

  mapJellyfinLibraryType(collectionType) {
    const typeMap = {
      'movies': 'movie',
      'tvshows': 'show',
      'music': 'music',
      'homevideos': 'video',
      'photos': 'photo'
    };
    return typeMap[collectionType] || collectionType;
  }

  async getLibraryContents(libraryId) {
    const response = await this.client.get(`/Users/${this.userId}/Items`, {
      params: {
        ParentId: libraryId,
        Recursive: true,
        IncludeItemTypes: 'Movie,Series',
        Fields: 'ProviderIds,DateCreated,Overview,Genres'
      }
    });
    return (response.data.Items || []).map(item => this.normalizeItem(item));
  }

  // =====================================================
  // ITEMS
  // =====================================================

  async getItem(itemId) {
    const response = await this.client.get(`/Users/${this.userId}/Items/${itemId}`);
    return response.data;
  }

  async getItemChildren(itemId) {
    const response = await this.client.get(`/Users/${this.userId}/Items`, {
      params: {
        ParentId: itemId,
        Fields: 'ProviderIds,DateCreated,Overview'
      }
    });
    return (response.data.Items || []).map(item => this.normalizeItem(item));
  }

  async getItemMetadata(itemId) {
    const item = await this.getItem(itemId);
    if (!item) {
      return null;
    }

    const externalIds = this.extractExternalIds(item);

    return {
      id: item.Id,
      ratingKey: item.Id, // Alias for compatibility
      title: item.Name,
      year: item.ProductionYear,
      type: this.mapJellyfinItemType(item.Type),
      thumb: this.getThumbnailUrl(item.Id),
      rating: item.CommunityRating,
      contentRating: item.OfficialRating,
      genres: item.Genres || [],
      addedAt: item.DateCreated ? new Date(item.DateCreated) : null,
      originallyAvailableAt: item.PremiereDate,
      duration: item.RunTimeTicks ? Math.floor(item.RunTimeTicks / 10000) : null, // Convert ticks to ms
      viewCount: item.UserData?.PlayCount || 0,
      lastViewedAt: item.UserData?.LastPlayedDate ? new Date(item.UserData.LastPlayedDate) : null,
      ...externalIds,
      // Episode/Season specific fields
      grandparentId: item.SeriesId,
      grandparentTitle: item.SeriesName,
      parentId: item.SeasonId,
      parentTitle: item.SeasonName,
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber
    };
  }

  mapJellyfinItemType(type) {
    const typeMap = {
      'Movie': 'movie',
      'Series': 'show',
      'Season': 'season',
      'Episode': 'episode',
      'Audio': 'track',
      'MusicAlbum': 'album'
    };
    return typeMap[type] || type.toLowerCase();
  }

  async deleteItem(itemId) {
    await this.client.delete(`/Items/${itemId}`);
    log('info', 'deletion', 'Deleted item from Jellyfin', { media_id: itemId });
  }

  // =====================================================
  // WATCH HISTORY & STATUS
  // =====================================================

  async getWatchHistory(options = {}) {
    const { userId, since, limit = 500 } = options;

    const targetUserId = userId || this.userId;

    // Jellyfin doesn't have a direct watch history endpoint like Plex
    // We need to get items with UserData that indicates played
    const response = await this.client.get(`/Users/${targetUserId}/Items`, {
      params: {
        Recursive: true,
        IncludeItemTypes: 'Movie,Episode',
        IsPlayed: true,
        SortBy: 'DatePlayed',
        SortOrder: 'Descending',
        Limit: limit,
        Fields: 'DateCreated,UserData,SeriesName,SeasonName,ParentIndexNumber,IndexNumber'
      }
    });

    let history = response.data.Items || [];

    if (since) {
      history = history.filter(item => {
        const playedDate = item.UserData?.LastPlayedDate;
        return playedDate && new Date(playedDate) >= since;
      });
    }

    return history.map(item => ({
      id: item.Id,
      itemId: item.Id,
      userId: targetUserId,
      title: item.Name,
      grandparentTitle: item.SeriesName,
      parentTitle: item.SeasonName,
      type: this.mapJellyfinItemType(item.Type),
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber,
      viewedAt: item.UserData?.LastPlayedDate ? new Date(item.UserData.LastPlayedDate) : null,
      viewCount: item.UserData?.PlayCount || 0
    }));
  }

  async getItemWatchStatus(itemId, userId = null) {
    const targetUserId = userId || this.userId;
    const response = await this.client.get(`/Users/${targetUserId}/Items/${itemId}`);
    const item = response.data;

    return {
      viewCount: item.UserData?.PlayCount || 0,
      lastViewedAt: item.UserData?.LastPlayedDate ? new Date(item.UserData.LastPlayedDate) : null,
      viewOffset: item.UserData?.PlaybackPositionTicks ? Math.floor(item.UserData.PlaybackPositionTicks / 10000) : 0,
      duration: item.RunTimeTicks ? Math.floor(item.RunTimeTicks / 10000) : 0,
      isPlayed: item.UserData?.Played || false
    };
  }

  async getShowEpisodesWithUserStatus(showId) {
    const episodes = [];

    // Get all seasons
    const seasonsResponse = await this.client.get(`/Shows/${showId}/Seasons`, {
      params: { userId: this.userId }
    });
    const seasons = seasonsResponse.data.Items || [];

    for (const season of seasons) {
      // Skip specials (season 0)
      if (season.IndexNumber === 0) continue;

      // Get episodes for this season
      const episodesResponse = await this.client.get(`/Shows/${showId}/Episodes`, {
        params: {
          userId: this.userId,
          seasonId: season.Id,
          Fields: 'UserData,DateCreated'
        }
      });

      for (const ep of episodesResponse.data.Items || []) {
        episodes.push({
          id: ep.Id,
          ratingKey: ep.Id,
          title: ep.Name,
          seasonNumber: ep.ParentIndexNumber || season.IndexNumber,
          episodeNumber: ep.IndexNumber,
          absoluteIndex: episodes.length + 1,
          duration: ep.RunTimeTicks ? Math.floor(ep.RunTimeTicks / 10000) : 0,
          addedAt: ep.DateCreated ? new Date(ep.DateCreated) : null,
          viewCount: ep.UserData?.PlayCount || 0,
          lastViewedAt: ep.UserData?.LastPlayedDate ? new Date(ep.UserData.LastPlayedDate) : null,
          isPlayed: ep.UserData?.Played || false,
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
    const response = await this.client.get('/Users');
    return (response.data || []).map(user => ({
      id: user.Id,
      username: user.Name,
      thumb: user.PrimaryImageTag ? `${this.url}/Users/${user.Id}/Images/Primary` : null,
      isAdmin: user.Policy?.IsAdministrator || false,
      isDisabled: user.Policy?.IsDisabled || false
    }));
  }

  // =====================================================
  // WATCHLIST (using Favorites)
  // =====================================================

  /**
   * Jellyfin doesn't have a native watchlist like Plex.
   * We use "Favorites" as a workaround.
   */
  async getWatchlist(userId = null) {
    const targetUserId = userId || this.userId;

    const response = await this.client.get(`/Users/${targetUserId}/Items`, {
      params: {
        Recursive: true,
        IncludeItemTypes: 'Movie,Series',
        IsFavorite: true,
        Fields: 'ProviderIds,DateCreated,Overview'
      }
    });

    return (response.data.Items || []).map(item => this.normalizeItem(item));
  }

  async isOnWatchlist(itemId, itemMetadata = null) {
    const item = await this.getItem(itemId);
    return item?.UserData?.IsFavorite || false;
  }

  /**
   * Add to favorites (Jellyfin's watchlist equivalent)
   */
  async addToWatchlist(itemId) {
    try {
      await this.client.post(`/Users/${this.userId}/FavoriteItems/${itemId}`);
      return { success: true };
    } catch (error) {
      console.error('[Jellyfin] Error adding to favorites:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove from favorites
   */
  async removeFromWatchlist(itemId) {
    try {
      await this.client.delete(`/Users/${this.userId}/FavoriteItems/${itemId}`);
      return { success: true };
    } catch (error) {
      console.error('[Jellyfin] Error removing from favorites:', error.message);
      return { success: false, error: error.message };
    }
  }

  // =====================================================
  // COLLECTIONS
  // =====================================================

  async getCollections(libraryId) {
    const response = await this.client.get(`/Users/${this.userId}/Items`, {
      params: {
        ParentId: libraryId,
        IncludeItemTypes: 'BoxSet',
        Recursive: false
      }
    });
    return (response.data.Items || []).map(item => ({
      id: item.Id,
      ratingKey: item.Id, // Alias for compatibility
      title: item.Name,
      summary: item.Overview
    }));
  }

  async createCollection(libraryId, title, description = '') {
    // Jellyfin uses Collections API
    const response = await this.client.post('/Collections', null, {
      params: {
        Name: title,
        ParentId: libraryId
      }
    });

    // Update description if provided
    if (description && response.data?.Id) {
      await this.client.post(`/Items/${response.data.Id}`, {
        Id: response.data.Id,
        Name: title,
        Overview: description
      });
    }

    return {
      id: response.data?.Id,
      title,
      summary: description
    };
  }

  async getOrCreateCollection(libraryId, title, description = '', itemType = null) {
    const collections = await this.getCollections(libraryId);
    let collection = collections.find(c => c.title === title);

    if (!collection) {
      collection = await this.createCollection(libraryId, title, description);
    }

    return collection;
  }

  async addToCollection(collectionId, itemId) {
    await this.client.post(`/Collections/${collectionId}/Items`, null, {
      params: {
        Ids: itemId
      }
    });
  }

  async removeFromCollection(collectionId, itemId) {
    await this.client.delete(`/Collections/${collectionId}/Items`, {
      params: {
        Ids: itemId
      }
    });
  }

  // =====================================================
  // UTILITY METHODS
  // =====================================================

  extractExternalIds(item) {
    const providerIds = item.ProviderIds || {};
    return {
      tmdbId: providerIds.Tmdb ? parseInt(providerIds.Tmdb, 10) : null,
      tvdbId: providerIds.Tvdb ? parseInt(providerIds.Tvdb, 10) : null,
      imdbId: providerIds.Imdb || null
    };
  }

  normalizeItem(item) {
    const externalIds = this.extractExternalIds(item);
    return {
      id: item.Id,
      ratingKey: item.Id, // Alias for Plex compatibility
      title: item.Name,
      year: item.ProductionYear,
      type: this.mapJellyfinItemType(item.Type),
      thumb: this.getThumbnailUrl(item.Id),
      addedAt: item.DateCreated ? new Date(item.DateCreated) : null,
      viewCount: item.UserData?.PlayCount || 0,
      lastViewedAt: item.UserData?.LastPlayedDate ? new Date(item.UserData.LastPlayedDate) : null,
      isPlayed: item.UserData?.Played || false,
      isFavorite: item.UserData?.IsFavorite || false,
      ...externalIds
    };
  }

  getThumbnailUrl(itemId) {
    return `${this.url}/Items/${itemId}/Images/Primary`;
  }

  // =====================================================
  // JELLYFIN-SPECIFIC METHODS
  // =====================================================

  async getShowActivity(showId) {
    const episodes = await this.getShowEpisodesWithUserStatus(showId);

    let lastActivity = null;
    let totalWatched = 0;
    const totalEpisodes = episodes.length;

    for (const episode of episodes) {
      if (episode.isPlayed || episode.viewCount > 0) {
        totalWatched++;
        if (episode.lastViewedAt) {
          if (!lastActivity || episode.lastViewedAt > lastActivity) {
            lastActivity = episode.lastViewedAt;
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

  async search(query, mediaType = null) {
    const includeTypes = mediaType === 'movie' ? 'Movie' :
                         mediaType === 'tv' ? 'Series' :
                         'Movie,Series';

    const response = await this.client.get(`/Users/${this.userId}/Items`, {
      params: {
        SearchTerm: query,
        IncludeItemTypes: includeTypes,
        Recursive: true,
        Limit: 10,
        Fields: 'ProviderIds,Overview'
      }
    });

    return (response.data.Items || []).map(item => this.normalizeItem(item));
  }

  /**
   * Get recently added items
   */
  async getRecentlyAdded(libraryId = null, limit = 50) {
    const params = {
      Recursive: true,
      IncludeItemTypes: 'Movie,Series,Episode',
      SortBy: 'DateCreated',
      SortOrder: 'Descending',
      Limit: limit,
      Fields: 'ProviderIds,DateCreated'
    };

    if (libraryId) {
      params.ParentId = libraryId;
    }

    const response = await this.client.get(`/Users/${this.userId}/Items`, { params });
    return (response.data.Items || []).map(item => this.normalizeItem(item));
  }

  /**
   * Mark item as played
   */
  async markPlayed(itemId) {
    await this.client.post(`/Users/${this.userId}/PlayedItems/${itemId}`);
  }

  /**
   * Mark item as unplayed
   */
  async markUnplayed(itemId) {
    await this.client.delete(`/Users/${this.userId}/PlayedItems/${itemId}`);
  }
}

module.exports = JellyfinMediaServer;
