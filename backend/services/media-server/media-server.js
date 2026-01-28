/**
 * MediaServer Base Class
 *
 * Abstract base class defining the interface for media server implementations.
 * Both Plex and Jellyfin servers extend this class.
 */

class MediaServer {
  constructor(config) {
    if (this.constructor === MediaServer) {
      throw new Error('MediaServer is an abstract class and cannot be instantiated directly');
    }

    this.id = config.id;
    this.type = config.type; // 'plex' or 'jellyfin'
    this.name = config.name;
    this.url = config.url?.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.adminUserId = config.adminUserId;
    this.adminToken = config.adminToken;
    this.settings = config.settings || {};
  }

  // =====================================================
  // CONNECTION & AUTHENTICATION
  // =====================================================

  /**
   * Test the connection to the media server
   * @returns {Promise<{success: boolean, version?: string, name?: string, error?: string}>}
   */
  async testConnection() {
    throw new Error('Method testConnection() must be implemented');
  }

  /**
   * Get server information
   * @returns {Promise<{name: string, version: string, id: string}>}
   */
  async getServerInfo() {
    throw new Error('Method getServerInfo() must be implemented');
  }

  // =====================================================
  // LIBRARIES
  // =====================================================

  /**
   * Get all libraries from the server
   * @returns {Promise<Array<{id: string, title: string, type: string}>>}
   */
  async getLibraries() {
    throw new Error('Method getLibraries() must be implemented');
  }

  /**
   * Get contents of a library
   * @param {string} libraryId
   * @returns {Promise<Array>}
   */
  async getLibraryContents(libraryId) {
    throw new Error('Method getLibraryContents() must be implemented');
  }

  // =====================================================
  // ITEMS
  // =====================================================

  /**
   * Get a single item by its ID
   * @param {string} itemId - Server-specific item identifier (ratingKey for Plex, Id for Jellyfin)
   * @returns {Promise<Object>}
   */
  async getItem(itemId) {
    throw new Error('Method getItem() must be implemented');
  }

  /**
   * Get children of an item (seasons for shows, episodes for seasons)
   * @param {string} itemId
   * @returns {Promise<Array>}
   */
  async getItemChildren(itemId) {
    throw new Error('Method getItemChildren() must be implemented');
  }

  /**
   * Get detailed metadata for an item
   * @param {string} itemId
   * @returns {Promise<Object>} Normalized metadata object
   */
  async getItemMetadata(itemId) {
    throw new Error('Method getItemMetadata() must be implemented');
  }

  /**
   * Delete an item from the server
   * @param {string} itemId
   * @returns {Promise<void>}
   */
  async deleteItem(itemId) {
    throw new Error('Method deleteItem() must be implemented');
  }

  // =====================================================
  // WATCH HISTORY & STATUS
  // =====================================================

  /**
   * Get watch history
   * @param {Object} options
   * @param {string} options.userId - User ID to filter by
   * @param {Date} options.since - Only get history since this date
   * @returns {Promise<Array>}
   */
  async getWatchHistory(options = {}) {
    throw new Error('Method getWatchHistory() must be implemented');
  }

  /**
   * Get watch status for an item
   * @param {string} itemId
   * @param {string} userId - Optional user ID
   * @returns {Promise<{viewCount: number, lastViewedAt: Date, viewOffset: number}>}
   */
  async getItemWatchStatus(itemId, userId = null) {
    throw new Error('Method getItemWatchStatus() must be implemented');
  }

  /**
   * Get all episodes of a show with watch status
   * @param {string} showId
   * @returns {Promise<Array>}
   */
  async getShowEpisodesWithUserStatus(showId) {
    throw new Error('Method getShowEpisodesWithUserStatus() must be implemented');
  }

  // =====================================================
  // USERS
  // =====================================================

  /**
   * Get all users with access to this server
   * @returns {Promise<Array<{id: string, username: string, thumb?: string, isAdmin: boolean}>>}
   */
  async getAllUsers() {
    throw new Error('Method getAllUsers() must be implemented');
  }

  // =====================================================
  // WATCHLIST / FAVORITES
  // =====================================================

  /**
   * Get watchlist/favorites for a user
   * @param {string} userId - Optional user ID
   * @returns {Promise<Array>}
   */
  async getWatchlist(userId = null) {
    throw new Error('Method getWatchlist() must be implemented');
  }

  /**
   * Check if an item is on the watchlist/favorites
   * @param {string} itemId
   * @param {Object} itemMetadata - Optional metadata for fallback matching
   * @returns {Promise<boolean>}
   */
  async isOnWatchlist(itemId, itemMetadata = null) {
    throw new Error('Method isOnWatchlist() must be implemented');
  }

  /**
   * Add item to watchlist/favorites
   * @param {string} itemId
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async addToWatchlist(itemId) {
    throw new Error('Method addToWatchlist() must be implemented');
  }

  /**
   * Remove item from watchlist/favorites
   * @param {string} itemId
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async removeFromWatchlist(itemId) {
    throw new Error('Method removeFromWatchlist() must be implemented');
  }

  // =====================================================
  // COLLECTIONS
  // =====================================================

  /**
   * Get all collections in a library
   * @param {string} libraryId
   * @returns {Promise<Array>}
   */
  async getCollections(libraryId) {
    throw new Error('Method getCollections() must be implemented');
  }

  /**
   * Create a new collection
   * @param {string} libraryId
   * @param {string} title
   * @param {string} description
   * @returns {Promise<Object>}
   */
  async createCollection(libraryId, title, description = '') {
    throw new Error('Method createCollection() must be implemented');
  }

  /**
   * Get or create a collection
   * @param {string} libraryId
   * @param {string} title
   * @param {string} description
   * @param {string} itemType - Type of items in collection
   * @returns {Promise<Object>}
   */
  async getOrCreateCollection(libraryId, title, description = '', itemType = null) {
    throw new Error('Method getOrCreateCollection() must be implemented');
  }

  /**
   * Add an item to a collection
   * @param {string} collectionId
   * @param {string} itemId
   * @returns {Promise<void>}
   */
  async addToCollection(collectionId, itemId) {
    throw new Error('Method addToCollection() must be implemented');
  }

  /**
   * Remove an item from a collection
   * @param {string} collectionId
   * @param {string} itemId
   * @returns {Promise<void>}
   */
  async removeFromCollection(collectionId, itemId) {
    throw new Error('Method removeFromCollection() must be implemented');
  }

  // =====================================================
  // UTILITY METHODS
  // =====================================================

  /**
   * Get the server's unique machine identifier
   * @returns {Promise<string>}
   */
  async getServerId() {
    throw new Error('Method getServerId() must be implemented');
  }

  /**
   * Extract external IDs (TMDB, TVDB, IMDB) from item
   * @param {Object} item
   * @returns {{tmdbId: number|null, tvdbId: number|null, imdbId: string|null}}
   */
  extractExternalIds(item) {
    throw new Error('Method extractExternalIds() must be implemented');
  }

  /**
   * Normalize an item to a common format
   * @param {Object} item - Server-specific item object
   * @returns {Object} Normalized item object
   */
  normalizeItem(item) {
    throw new Error('Method normalizeItem() must be implemented');
  }

  /**
   * Get thumbnail URL for an item
   * @param {string} itemId
   * @returns {string}
   */
  getThumbnailUrl(itemId) {
    throw new Error('Method getThumbnailUrl() must be implemented');
  }

  // =====================================================
  // SERVER TYPE HELPERS
  // =====================================================

  /**
   * Check if this is a Plex server
   * @returns {boolean}
   */
  isPlex() {
    return this.type === 'plex';
  }

  /**
   * Check if this is a Jellyfin server
   * @returns {boolean}
   */
  isJellyfin() {
    return this.type === 'jellyfin';
  }
}

module.exports = MediaServer;
